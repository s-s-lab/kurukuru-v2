import { timingSafeEqual } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';

import type { PublicResponse } from '../events/service';
import {
  EventClosedError,
  EventNotFoundError,
  IdempotencyConflictError,
  InvalidAvailabilityError,
  ResponseNotFoundError,
} from './repository';
import type {
  CreateResponsePersistenceInput,
  ResponseRepository,
  ResponseRequest,
  UpdateResponsePersistenceInput,
  UpdateResponseResult,
} from './service';

type EventRow = {
  status: 'open' | 'closed' | 'deleted';
  deleted_at: Date | null;
  notify_on_response: boolean;
  organizer_email_verified_at: Date | null;
};

type ResponseRow = {
  id: string;
  event_id: string;
  display_name: string;
  comment: string;
  edit_secret_hash: string;
  version: number;
  created_at: Date | string;
  updated_at: Date | string;
};

type Availability = ResponseRequest['availability'];

class IdempotencyStateError extends Error {
  constructor() {
    super('The idempotent operation has no stored response.');
    this.name = 'IdempotencyStateError';
  }
}

function mapResponse(row: ResponseRow, availability: Availability): PublicResponse {
  return {
    id: row.id,
    displayName: row.display_name,
    comment: row.comment,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
    availability,
  };
}

function assertOpenEvent(event: EventRow | undefined): asserts event is EventRow {
  if (!event || event.status === 'deleted' || event.deleted_at !== null) {
    throw new EventNotFoundError();
  }
  if (event.status !== 'open') throw new EventClosedError();
}

function validHashMatches(actual: string, expected: string): boolean {
  // Buffer.from(hex) alone silently truncates malformed hex. Only compare complete hashes.
  if (!/^[a-f0-9]{64}$/.test(actual) || !/^[a-f0-9]{64}$/.test(expected)) return false;
  return timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(expected, 'hex'));
}

async function validateAvailability(
  client: PoolClient,
  eventId: string,
  availability: Availability,
): Promise<Availability> {
  const slots = await client.query<{ id: string }>(
    'SELECT id FROM candidate_slots WHERE event_id = $1 ORDER BY id FOR SHARE',
    [eventId],
  );
  const sorted = availability
    .map((value) => ({ ...value, candidateSlotId: value.candidateSlotId.toLowerCase() }))
    .sort((a, b) => a.candidateSlotId.localeCompare(b.candidateSlotId));
  if (sorted.length === 0 || sorted.length !== slots.rows.length ||
      sorted.some((value, index) => value.candidateSlotId !== slots.rows[index].id)) {
    throw new InvalidAvailabilityError();
  }
  return sorted;
}

async function loadAvailability(client: PoolClient, responseId: string): Promise<Availability> {
  const result = await client.query<{ candidate_slot_id: string; mark: Availability[number]['mark'] }>(
    `SELECT candidate_slot_id, mark FROM response_availability
     WHERE response_id = $1 ORDER BY candidate_slot_id`,
    [responseId],
  );
  return result.rows.map((row) => ({ candidateSlotId: row.candidate_slot_id, mark: row.mark }));
}

async function insertAvailability(client: PoolClient, responseId: string, availability: Availability) {
  const parameters: string[] = [responseId];
  const values = availability.map((value, index) => {
    const base = 2 + index * 2;
    parameters.push(value.candidateSlotId, value.mark);
    return `($1, $${base}, $${base + 1})`;
  });
  await client.query(
    `INSERT INTO response_availability (response_id, candidate_slot_id, mark)
     VALUES ${values.join(', ')}`,
    parameters,
  );
}

async function enqueueNotification(
  client: PoolClient,
  event: EventRow,
  response: ResponseRow,
  kind: 'created' | 'updated',
) {
  if (!event.notify_on_response || event.organizer_email_verified_at === null) return;
  const key = kind === 'created'
    ? `response-created:${response.id}`
    : `response-updated:${response.id}:${response.version}`;
  await client.query(
    `INSERT INTO notification_outbox (event_id, response_id, kind, idempotency_key)
     VALUES ($1, $2, $3, $4)`,
    [response.event_id, response.id, kind, key],
  );
}

export class PostgresResponseRepository implements ResponseRepository {
  constructor(private readonly pool: Pool) {}

  async createResponse(input: CreateResponsePersistenceInput): Promise<UpdateResponseResult> {
    const client = await this.pool.connect();
    const scope = `create-response:${input.eventId.toLowerCase()}`;
    try {
      await client.query('BEGIN');
      await client.query(
        `DELETE FROM idempotency_keys
         WHERE scope = $1 AND idempotency_key = $2 AND expires_at <= now()`,
        [scope, input.idempotencyKey],
      );
      const claim = await client.query(
        `INSERT INTO idempotency_keys (scope, idempotency_key, request_hash, expires_at)
         VALUES ($1, $2, $3, now() + interval '24 hours')
         ON CONFLICT (scope, idempotency_key) DO NOTHING RETURNING idempotency_key`,
        [scope, input.idempotencyKey, input.requestHash],
      );
      if (claim.rowCount === 0) {
        const existing = await client.query<{
          request_hash: string;
          status_code: number | null;
          response_body: { responseId?: string } | null;
        }>(
          `SELECT request_hash, status_code, response_body FROM idempotency_keys
           WHERE scope = $1 AND idempotency_key = $2 FOR UPDATE`,
          [scope, input.idempotencyKey],
        );
        const key = existing.rows[0];
        if (!key || key.request_hash !== input.requestHash) throw new IdempotencyConflictError();
        if (key.status_code !== 201 || !key.response_body?.responseId) {
          throw new IdempotencyStateError();
        }
        // Match update's response-then-event lock order while reconstructing a replay.
        const stored = await client.query<ResponseRow>(
          'SELECT * FROM responses WHERE id = $1 AND event_id = $2 FOR SHARE',
          [key.response_body.responseId, input.eventId],
        );
        const events = await client.query<EventRow>(
          `SELECT status, deleted_at, notify_on_response, organizer_email_verified_at
           FROM events WHERE id = $1 FOR SHARE`,
          [input.eventId],
        );
        // A hard-deleted event cascades its response; report lifecycle before state corruption.
        assertOpenEvent(events.rows[0]);
        if (!stored.rows[0]) throw new IdempotencyStateError();
        const availability = await loadAvailability(client, stored.rows[0].id);
        const result = { response: mapResponse(stored.rows[0], availability) };
        await client.query('COMMIT');
        return result;
      }

      const events = await client.query<EventRow>(
        `SELECT status, deleted_at, notify_on_response, organizer_email_verified_at
         FROM events WHERE id = $1 FOR SHARE`,
        [input.eventId],
      );
      const event = events.rows[0];
      assertOpenEvent(event);
      const availability = await validateAvailability(client, input.eventId, input.request.availability);
      const inserted = await client.query<ResponseRow>(
        `INSERT INTO responses (id, event_id, display_name, comment, edit_secret_hash)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [input.responseId, input.eventId, input.request.displayName, input.request.comment, input.editTokenHash],
      );
      const response = inserted.rows[0];
      await insertAvailability(client, response.id, availability);
      await enqueueNotification(client, event, response, 'created');
      await client.query(
        `UPDATE idempotency_keys SET status_code = 201, response_body = $3::jsonb
         WHERE scope = $1 AND idempotency_key = $2`,
        [scope, input.idempotencyKey, JSON.stringify({ responseId: response.id })],
      );
      await client.query('COMMIT');
      return { response: mapResponse(response, availability) };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async updateResponse(input: UpdateResponsePersistenceInput): Promise<UpdateResponseResult> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const existing = await client.query<ResponseRow & EventRow>(
        `SELECT r.*, e.status, e.deleted_at, e.notify_on_response, e.organizer_email_verified_at
         FROM responses r JOIN events e ON e.id = r.event_id
         WHERE r.id = $1 FOR UPDATE OF r, e`,
        [input.responseId],
      );
      const response = existing.rows[0];
      if (!response || !validHashMatches(input.editTokenHash, response.edit_secret_hash)) {
        throw new ResponseNotFoundError();
      }
      assertOpenEvent(response);
      const availability = await validateAvailability(client, response.event_id, input.request.availability);
      const previous = await loadAvailability(client, response.id);
      const unchanged = response.display_name === input.request.displayName &&
        response.comment === input.request.comment &&
        previous.length === availability.length &&
        previous.every((value, index) => value.candidateSlotId === availability[index].candidateSlotId &&
          value.mark === availability[index].mark);
      if (unchanged) {
        await client.query('COMMIT');
        return { response: mapResponse(response, previous) };
      }
      const updated = await client.query<ResponseRow>(
        `UPDATE responses SET display_name = $2, comment = $3, version = version + 1, updated_at = now()
         WHERE id = $1 RETURNING *`,
        [response.id, input.request.displayName, input.request.comment],
      );
      await client.query('DELETE FROM response_availability WHERE response_id = $1', [response.id]);
      await insertAvailability(client, response.id, availability);
      await enqueueNotification(client, response, updated.rows[0], 'updated');
      await client.query('COMMIT');
      return { response: mapResponse(updated.rows[0], availability) };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}
