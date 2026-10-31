import type { Pool, PoolClient } from 'pg';

import type { CreateEventPersistenceInput, EventRepository } from './repository';
import type {
  AvailabilityMark,
  CreateEventResult,
  EventStatus,
  PublicCandidateSlot,
  PublicEvent,
  PublicResponse,
} from './service';

export class IdempotencyConflictError extends Error {
  constructor() {
    super('The idempotency key has already been used for another request.');
    this.name = 'IdempotencyConflictError';
  }
}

class IdempotencyStateError extends Error {
  constructor() {
    super('The idempotent operation has no stored response.');
    this.name = 'IdempotencyStateError';
  }
}

type EventRow = {
  id: string;
  title: string;
  description: string;
  status: EventStatus;
  final_date: string | null;
  final_start_slot: number | null;
  final_end_slot: number | null;
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

function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function mapCandidateSlot(row: CandidateSlotRow): PublicCandidateSlot {
  return {
    id: row.id,
    date: row.candidate_date,
    slotIndex: row.slot_index,
  };
}

function mapEvent(
  row: EventRow,
  candidateSlots: PublicCandidateSlot[],
  responses: PublicResponse[],
): PublicEvent {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    status: row.status,
    finalization:
      row.final_date && row.final_start_slot !== null && row.final_end_slot !== null
        ? {
            date: row.final_date,
            startSlot: row.final_start_slot,
            endSlot: row.final_end_slot,
          }
        : null,
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at),
    candidateSlots,
    responses,
  };
}

async function insertCandidateSlots(
  client: PoolClient,
  eventId: string,
  slots: CreateEventPersistenceInput['candidateSlots'],
): Promise<PublicCandidateSlot[]> {
  const parameters: Array<string | number> = [eventId];
  const values = slots.map((slot, index) => {
    const base = 2 + index * 2;
    parameters.push(slot.date, slot.slotIndex);
    return `($1, $${base}, $${base + 1})`;
  });
  const result = await client.query<CandidateSlotRow>(
    `INSERT INTO candidate_slots (event_id, candidate_date, slot_index)
     VALUES ${values.join(', ')}
     RETURNING id, candidate_date::text, slot_index`,
    parameters,
  );
  return result.rows.map(mapCandidateSlot);
}

export class PostgresEventRepository implements EventRepository {
  constructor(private readonly pool: Pool) {}

  async createEvent(input: CreateEventPersistenceInput): Promise<CreateEventResult> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `DELETE FROM idempotency_keys
         WHERE scope = 'create-event'
           AND idempotency_key = $1
           AND expires_at <= now()`,
        [input.idempotencyKey],
      );
      const claim = await client.query<{ idempotency_key: string }>(
        `INSERT INTO idempotency_keys
           (scope, idempotency_key, request_hash, expires_at)
         VALUES ('create-event', $1, $2, now() + interval '24 hours')
         ON CONFLICT (scope, idempotency_key) DO NOTHING
         RETURNING idempotency_key`,
        [input.idempotencyKey, input.requestHash],
      );

      if (claim.rowCount === 0) {
        const existing = await client.query<{
          request_hash: string;
          status_code: number | null;
          response_body: CreateEventResult | null;
        }>(
          `SELECT request_hash, status_code, response_body
           FROM idempotency_keys
           WHERE scope = 'create-event' AND idempotency_key = $1
           FOR UPDATE`,
          [input.idempotencyKey],
        );
        const stored = existing.rows[0];
        if (!stored || stored.request_hash !== input.requestHash) {
          throw new IdempotencyConflictError();
        }
        if (stored.status_code !== 201 || !stored.response_body) {
          throw new IdempotencyStateError();
        }
        await client.query('COMMIT');
        return stored.response_body;
      }

      const eventResult = await client.query<EventRow>(
        `INSERT INTO events
           (title, description, organizer_email, admin_secret_hash, notify_on_response)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, title, description, status, final_date::text,
                   final_start_slot, final_end_slot, created_at, updated_at`,
        [
          input.event.title,
          input.event.description,
          input.event.organizerEmail,
          input.event.adminSecretHash,
          input.event.notifyOnResponse,
        ],
      );
      const eventRow = eventResult.rows[0];
      const candidateSlots = await insertCandidateSlots(
        client,
        eventRow.id,
        input.candidateSlots,
      );
      await client.query(
        `INSERT INTO email_verifications (event_id, token_hash, expires_at)
         VALUES ($1, $2, $3)`,
        [eventRow.id, input.emailVerification.tokenHash, input.emailVerification.expiresAt],
      );

      const response: CreateEventResult = {
        event: mapEvent(eventRow, candidateSlots, []),
        emailVerificationRequired: true,
      };
      await client.query(
        `UPDATE idempotency_keys
         SET status_code = 201, response_body = $1::jsonb
         WHERE scope = 'create-event' AND idempotency_key = $2`,
        [JSON.stringify(response), input.idempotencyKey],
      );
      await client.query('COMMIT');
      return response;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async getPublicEvent(eventId: string): Promise<PublicEvent | null> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const eventResult = await client.query<EventRow>(
        `SELECT id, title, description, status, final_date::text,
                final_start_slot, final_end_slot, created_at, updated_at
         FROM events
         WHERE id = $1 AND deleted_at IS NULL AND status <> 'deleted'`,
        [eventId],
      );
      const eventRow = eventResult.rows[0];
      if (!eventRow) {
        await client.query('COMMIT');
        return null;
      }

      const [slotResult, responseResult, availabilityResult] = await Promise.all([
        client.query<CandidateSlotRow>(
          `SELECT id, candidate_date::text, slot_index
           FROM candidate_slots
           WHERE event_id = $1
           ORDER BY candidate_date, slot_index`,
          [eventId],
        ),
        client.query<ResponseRow>(
          `SELECT id, display_name, comment, created_at, updated_at
           FROM responses
           WHERE event_id = $1
           ORDER BY created_at, id`,
          [eventId],
        ),
        client.query<AvailabilityRow>(
          `SELECT a.response_id, a.candidate_slot_id, a.mark
           FROM response_availability a
           JOIN responses r ON r.id = a.response_id
           WHERE r.event_id = $1
           ORDER BY a.response_id, a.candidate_slot_id`,
          [eventId],
        ),
      ]);
      const availabilityByResponse = new Map<string, PublicResponse['availability']>();
      for (const row of availabilityResult.rows) {
        const availability = availabilityByResponse.get(row.response_id) ?? [];
        availability.push({ candidateSlotId: row.candidate_slot_id, mark: row.mark });
        availabilityByResponse.set(row.response_id, availability);
      }
      const responses = responseResult.rows.map<PublicResponse>((row) => ({
        id: row.id,
        displayName: row.display_name,
        comment: row.comment,
        createdAt: toIsoString(row.created_at),
        updatedAt: toIsoString(row.updated_at),
        availability: availabilityByResponse.get(row.id) ?? [],
      }));

      const event = mapEvent(eventRow, slotResult.rows.map(mapCandidateSlot), responses);
      await client.query('COMMIT');
      return event;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}
