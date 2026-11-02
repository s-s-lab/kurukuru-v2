import type { Pool, PoolClient } from 'pg';

import type { AvailabilityMark, PublicCandidateSlot, PublicResponse } from '../events/service';
import type { AdminRepository } from './repository';
import {
  AdminAccessDeniedError,
  type AdminEvent,
  type AdminEventUpdateRequest,
} from './service';

type AdminEventRow = {
  id: string;
  title: string;
  description: string;
  organizer_email: string;
  organizer_email_verified_at: Date | string | null;
  notify_on_response: boolean;
  status: 'open' | 'closed';
  final_date: string | null;
  final_start_slot: number | null;
  final_end_slot: number | null;
  version: number;
  created_at: Date | string;
  updated_at: Date | string;
};

type CandidateSlotRow = {
  id: string;
  candidate_date: string;
  slot_index: number;
};

type ResponseRow = {
  id: string;
  display_name: string;
  comment: string;
  created_at: Date | string;
  updated_at: Date | string;
};

type AvailabilityRow = {
  response_id: string;
  candidate_slot_id: string;
  mark: AvailabilityMark;
};

const EVENT_COLUMNS = `e.id, e.title, e.description, e.organizer_email,
  e.organizer_email_verified_at, e.notify_on_response, e.status,
  e.final_date::text, e.final_start_slot, e.final_end_slot, e.version,
  e.created_at, e.updated_at`;

function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function mapCandidateSlot(row: CandidateSlotRow): PublicCandidateSlot {
  return { id: row.id, date: row.candidate_date, slotIndex: row.slot_index };
}

async function loadAdminEvent(
  client: PoolClient,
  row: AdminEventRow,
): Promise<AdminEvent> {
  const slotResult = await client.query<CandidateSlotRow>(
    `SELECT id, candidate_date::text, slot_index
     FROM candidate_slots
     WHERE event_id = $1
     ORDER BY candidate_date, slot_index`,
    [row.id],
  );
  const responseResult = await client.query<ResponseRow>(
    `SELECT id, display_name, comment, created_at, updated_at
     FROM responses
     WHERE event_id = $1
     ORDER BY created_at, id`,
    [row.id],
  );
  const availabilityResult = await client.query<AvailabilityRow>(
    `SELECT a.response_id, a.candidate_slot_id, a.mark
     FROM response_availability a
     JOIN responses r ON r.id = a.response_id
     WHERE r.event_id = $1
     ORDER BY a.response_id, a.candidate_slot_id`,
    [row.id],
  );
  const availabilityByResponse = new Map<string, PublicResponse['availability']>();
  for (const availabilityRow of availabilityResult.rows) {
    const availability = availabilityByResponse.get(availabilityRow.response_id) ?? [];
    availability.push({
      candidateSlotId: availabilityRow.candidate_slot_id,
      mark: availabilityRow.mark,
    });
    availabilityByResponse.set(availabilityRow.response_id, availability);
  }

  return {
    id: row.id,
    title: row.title,
    description: row.description,
    organizerEmail: row.organizer_email,
    organizerEmailVerified: row.organizer_email_verified_at !== null,
    notifyOnResponse: row.notify_on_response,
    status: row.status,
    finalization:
      row.final_date && row.final_start_slot !== null && row.final_end_slot !== null
        ? { date: row.final_date, startSlot: row.final_start_slot, endSlot: row.final_end_slot }
        : null,
    version: row.version,
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at),
    candidateSlots: slotResult.rows.map(mapCandidateSlot),
    responses: responseResult.rows.map((responseRow) => ({
      id: responseRow.id,
      displayName: responseRow.display_name,
      comment: responseRow.comment,
      createdAt: toIsoString(responseRow.created_at),
      updatedAt: toIsoString(responseRow.updated_at),
      availability: availabilityByResponse.get(responseRow.id) ?? [],
    })),
  };
}

async function selectEvent(
  client: PoolClient,
  eventId: string,
  lock: 'FOR SHARE' | 'FOR UPDATE' | '',
): Promise<AdminEventRow> {
  const result = await client.query<AdminEventRow>(
    `SELECT ${EVENT_COLUMNS}
     FROM events e
     WHERE e.id = $1 AND e.deleted_at IS NULL AND e.status <> 'deleted'
     ${lock}`,
    [eventId],
  );
  const row = result.rows[0];
  if (!row) throw new AdminAccessDeniedError();
  return row;
}

async function selectAuthorizedEvent(
  client: PoolClient,
  eventId: string,
  tokenHash: string,
  lock: boolean,
): Promise<AdminEventRow> {
  const result = await client.query<AdminEventRow>(
    `SELECT ${EVENT_COLUMNS}
     FROM events e
     JOIN admin_sessions s
       ON s.event_id = e.id
      AND s.token_hash = $2
      AND s.expires_at > now()
     WHERE e.id = $1 AND e.deleted_at IS NULL AND e.status <> 'deleted'
     ${lock ? 'FOR UPDATE OF e' : ''}`,
    [eventId, tokenHash],
  );
  const row = result.rows[0];
  if (!row) throw new AdminAccessDeniedError();
  return row;
}

async function inTransaction<T>(
  pool: Pool,
  begin: string,
  operation: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query(begin);
    const result = await operation(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export class PostgresAdminRepository implements AdminRepository {
  constructor(private readonly pool: Pool) {}

  async findPasswordHash(eventId: string): Promise<string | null> {
    const result = await this.pool.query<{ admin_secret_hash: string }>(
      `SELECT admin_secret_hash
       FROM events
       WHERE id = $1 AND deleted_at IS NULL AND status <> 'deleted'`,
      [eventId],
    );
    return result.rows[0]?.admin_secret_hash ?? null;
  }

  createSession(input: {
    eventId: string;
    tokenHash: string;
    expiresAt: Date;
  }): Promise<AdminEvent> {
    return inTransaction(this.pool, 'BEGIN', async (client) => {
      const event = await selectEvent(client, input.eventId, 'FOR SHARE');
      await client.query(
        'DELETE FROM admin_sessions WHERE event_id = $1 AND expires_at <= now()',
        [input.eventId],
      );
      await client.query(
        `INSERT INTO admin_sessions (token_hash, event_id, expires_at)
         VALUES ($1, $2, $3)`,
        [input.tokenHash, input.eventId, input.expiresAt],
      );
      return loadAdminEvent(client, event);
    });
  }

  getAdminEvent(eventId: string, tokenHash: string): Promise<AdminEvent> {
    return inTransaction(
      this.pool,
      'BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY',
      async (client) => loadAdminEvent(
        client,
        await selectAuthorizedEvent(client, eventId, tokenHash, false),
      ),
    );
  }

  updateEvent(input: {
    eventId: string;
    tokenHash: string;
    request: AdminEventUpdateRequest;
  }): Promise<AdminEvent> {
    return inTransaction(this.pool, 'BEGIN', async (client) => {
      let event = await selectAuthorizedEvent(client, input.eventId, input.tokenHash, true);
      if (
        event.title !== input.request.title
        || event.description !== input.request.description
        || event.notify_on_response !== input.request.notifyOnResponse
      ) {
        const updated = await client.query<AdminEventRow>(
          `UPDATE events
           SET title = $2, description = $3, notify_on_response = $4,
               version = version + 1, updated_at = now()
           WHERE id = $1
           RETURNING id, title, description, organizer_email,
             organizer_email_verified_at, notify_on_response, status,
             final_date::text, final_start_slot, final_end_slot, version,
             created_at, updated_at`,
          [
            input.eventId,
            input.request.title,
            input.request.description,
            input.request.notifyOnResponse,
          ],
        );
        event = updated.rows[0];
      }
      return loadAdminEvent(client, event);
    });
  }

  setEventStatus(input: {
    eventId: string;
    tokenHash: string;
    status: 'open' | 'closed';
  }): Promise<AdminEvent> {
    return inTransaction(this.pool, 'BEGIN', async (client) => {
      let event = await selectAuthorizedEvent(client, input.eventId, input.tokenHash, true);
      if (event.status !== input.status) {
        const updated = await client.query<AdminEventRow>(
          `UPDATE events
           SET status = $2, version = version + 1, updated_at = now()
           WHERE id = $1
           RETURNING id, title, description, organizer_email,
             organizer_email_verified_at, notify_on_response, status,
             final_date::text, final_start_slot, final_end_slot, version,
             created_at, updated_at`,
          [input.eventId, input.status],
        );
        event = updated.rows[0];
      }
      return loadAdminEvent(client, event);
    });
  }
}
