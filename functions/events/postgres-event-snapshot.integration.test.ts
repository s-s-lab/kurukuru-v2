// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import type { PoolClient } from 'pg';
import { afterAll, afterEach, describe, expect, it } from 'vitest';

import { PostgresResponseRepository } from '../responses/postgres-response-repository';
import type { CreateResponsePersistenceInput } from '../responses/service';
import { PostgresEventRepository } from './postgres-event-repository';

const databaseUrl = process.env.DATABASE_URL;
const pool = databaseUrl ? new Pool({ connectionString: databaseUrl }) : null;
const eventIds: string[] = [];

async function fixture(): Promise<CreateResponsePersistenceInput> {
  const eventId = randomUUID();
  await pool!.query(
    `INSERT INTO events (id, title, organizer_email, admin_secret_hash, notify_on_response)
     VALUES ($1, 'snapshot integration', 'snapshot@example.com', 'private-admin-hash', false)`,
    [eventId],
  );
  eventIds.push(eventId);
  const slots = await pool!.query<{ id: string }>(
    `INSERT INTO candidate_slots (event_id, candidate_date, slot_index)
     VALUES ($1, '2027-01-12', 20), ($1, '2027-01-12', 21) RETURNING id`,
    [eventId],
  );
  return {
    eventId, responseId: randomUUID(), idempotencyKey: `snapshot-${randomUUID()}`,
    requestHash: 'a'.repeat(64), editTokenHash: 'b'.repeat(64),
    request: {
      displayName: 'before', comment: 'before comment',
      availability: slots.rows.map(({ id }) => ({ candidateSlotId: id, mark: 'ok' })),
    },
  };
}

// Every query still executes against real PostgreSQL. The wrapper coordinates only
// when each read is sent, on both legacy pool reads and checked-out client reads.
function stagedPool(before: (sql: string) => Promise<void>, after: (sql: string) => Promise<void>): Pool {
  function query(owner: Pool | PoolClient) {
    return async (sql: string, values?: unknown[]) => {
      await before(sql);
      const result = await owner.query(sql, values);
      await after(sql);
      return result;
    };
  }
  return {
    query: query(pool!),
    async connect() {
      const client = await pool!.connect();
      return { query: query(client), release() { client.release(); } };
    },
  } as unknown as Pool;
}

function commitGate() {
  let release!: () => void;
  let reject!: (error: unknown) => void;
  const committed = new Promise<void>((resolve, rejectPromise) => {
    release = resolve;
    reject = rejectPromise;
  });
  return { committed, release, reject };
}

afterEach(async () => {
  if (eventIds.length === 0) return;
  await pool!.query('DELETE FROM idempotency_keys WHERE scope = ANY($1::text[])',
    [eventIds.map((id) => `create-response:${id}`)]);
  await pool!.query('DELETE FROM events WHERE id = ANY($1::uuid[])', [eventIds]);
  eventIds.length = 0;
});

afterAll(async () => { await pool?.end(); });

describe.skipIf(!pool)('公開イベントのPostgreSQL共有スナップショット', () => {
  it('候補回答枠の読取後にPOSTがコミットしても新規回答だけが混入しない', async () => {
    const input = await fixture();
    const writer = new PostgresResponseRepository(pool!);
    const gate = commitGate();
    let createdId: string | undefined;
    const reader = new PostgresEventRepository(stagedPool(
      async (sql) => {
        if (/FROM responses\s/.test(sql)) await gate.committed;
      },
      async (sql) => {
        if (!/FROM candidate_slots/.test(sql)) return;
        try {
          const created = await writer.createResponse(input);
          createdId = created.response.id;
          gate.release();
        } catch (error) {
          gate.reject(error);
          throw error;
        }
      },
    ));
    const duringCreate = await reader.getPublicEvent(input.eventId);
    expect(createdId).toBe(input.responseId); // Writer committed before the response SELECT.
    expect(duringCreate?.responses).toEqual([]);
    const afterCreate = await new PostgresEventRepository(pool!).getPublicEvent(input.eventId);
    expect(afterCreate?.responses).toHaveLength(1);
    expect(afterCreate?.responses[0]).toMatchObject({ id: input.responseId, displayName: 'before',
      availability: expect.arrayContaining(input.request.availability) });
    expect(afterCreate?.responses[0].availability).toHaveLength(2);
  });

  it('回答メタデータと枠読取の間にPATCHがコミットしても異なる版を混ぜない', async () => {
    const input = await fixture();
    const writer = new PostgresResponseRepository(pool!);
    const created = await writer.createResponse(input);
    const gate = commitGate();
    let updateCommitted = false;
    const reader = new PostgresEventRepository(stagedPool(
      async (sql) => {
        if (/FROM response_availability/.test(sql)) await gate.committed;
      },
      async (sql) => {
        if (!/FROM responses\s/.test(sql)) return;
        try {
          await writer.updateResponse({ responseId: input.responseId, editTokenHash: input.editTokenHash,
            request: { ...input.request, displayName: 'after', comment: 'after comment',
              availability: input.request.availability.map((value) => ({ ...value, mark: 'ng' })) } });
          updateCommitted = true;
          gate.release();
        } catch (error) {
          gate.reject(error);
          throw error;
        }
      },
    ));
    const duringUpdate = await reader.getPublicEvent(input.eventId);
    expect(updateCommitted).toBe(true); // Writer committed before the availability SELECT.
    expect(duringUpdate?.responses).toEqual([created.response]);
    const afterUpdate = await new PostgresEventRepository(pool!).getPublicEvent(input.eventId);
    expect(afterUpdate?.responses[0]).toMatchObject({ displayName: 'after', comment: 'after comment' });
    expect(afterUpdate?.responses[0].availability).toHaveLength(2);
    expect(afterUpdate?.responses[0].availability.every((value) => value.mark === 'ng')).toBe(true);
  });
});
