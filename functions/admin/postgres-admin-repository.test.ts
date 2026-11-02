// @vitest-environment node
import type { Pool } from 'pg';
import { describe, expect, it } from 'vitest';

import {
  AdminAccessDeniedError,
  EventFinalizedError,
  InvalidFinalizationError,
} from './service';
import { PostgresAdminRepository } from './postgres-admin-repository';

const eventId = '11111111-1111-4111-8111-111111111111';
const otherEventId = '22222222-2222-4222-8222-222222222222';
const slotId = '33333333-3333-4333-8333-333333333333';
const responseId = '44444444-4444-4444-8444-444444444444';
const removedSlotId = '55555555-5555-4555-8555-555555555555';
const addedSlotId = '66666666-6666-4666-8666-666666666666';
const timestamp = '2026-11-02T00:00:00.000Z';

function adminPool(options: { authorized?: boolean } = {}) {
  const queries: Array<{ sql: string; parameters?: unknown[] }> = [];
  let status: 'open' | 'closed' = 'open';
  let version = 1;
  let title = '研究会';
  let description = '説明';
  let notifyOnResponse = true;
  let outcome: string | undefined;
  let released = false;

  const eventRow = () => ({
    id: eventId,
    title,
    description,
    organizer_email: 'organizer@example.com',
    organizer_email_verified_at: null,
    notify_on_response: notifyOnResponse,
    status,
    final_date: null,
    final_start_slot: null,
    final_end_slot: null,
    version,
    created_at: timestamp,
    updated_at: timestamp,
  });

  const client = {
    async query(sql: string, parameters?: unknown[]) {
      queries.push({ sql, parameters });
      if (/^(BEGIN|COMMIT|ROLLBACK)/.test(sql)) {
        if (sql === 'COMMIT' || sql === 'ROLLBACK') outcome = sql;
        return { rows: [], rowCount: 0 };
      }
      if (/DELETE FROM admin_sessions/.test(sql)) return { rows: [], rowCount: 1 };
      if (/INSERT INTO admin_sessions/.test(sql)) return { rows: [], rowCount: 1 };
      if (/JOIN admin_sessions/.test(sql)) {
        return { rows: options.authorized === false ? [] : [eventRow()], rowCount: options.authorized === false ? 0 : 1 };
      }
      if (/FROM events e/.test(sql)) return { rows: [eventRow()], rowCount: 1 };
      if (/UPDATE events\s+SET title/.test(sql)) {
        title = String(parameters?.[1]);
        description = String(parameters?.[2]);
        notifyOnResponse = Boolean(parameters?.[3]);
        version += 1;
        return { rows: [eventRow()], rowCount: 1 };
      }
      if (/UPDATE events\s+SET status/.test(sql)) {
        status = parameters?.[1] as 'open' | 'closed';
        version += 1;
        return { rows: [eventRow()], rowCount: 1 };
      }
      if (/FROM candidate_slots/.test(sql)) {
        return { rows: [{ id: slotId, candidate_date: '2026-11-10', slot_index: 18 }] };
      }
      if (/FROM responses\s/.test(sql)) {
        return { rows: [{ id: responseId, display_name: '参加者', comment: '', created_at: timestamp, updated_at: timestamp }] };
      }
      if (/FROM response_availability/.test(sql)) {
        return { rows: [{ response_id: responseId, candidate_slot_id: slotId, mark: 'best' }] };
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
    release() { released = true; },
  };
  const pool = {
    async query(sql: string, parameters?: unknown[]) {
      queries.push({ sql, parameters });
      if (/SELECT admin_secret_hash/.test(sql)) {
        return { rows: [{ admin_secret_hash: 'scrypt$stored' }], rowCount: 1 };
      }
      throw new Error(`Unexpected pool query: ${sql}`);
    },
    async connect() { return client; },
  } as unknown as Pool;

  return {
    pool,
    queries,
    outcome: () => outcome,
    released: () => released,
    state: () => ({ status, version, title, description, notifyOnResponse }),
  };
}

function candidatePool(initialCandidates: Array<{
  id: string;
  candidate_date: string;
  slot_index: number;
}>, finalization: null | { date: string; startSlot: number; endSlot: number } = null) {
  const queries: Array<{ sql: string; parameters?: unknown[] }> = [];
  let candidates = [...initialCandidates];
  let version = 1;

  const eventRow = () => ({
    id: eventId,
    title: '研究会',
    description: '説明',
    organizer_email: 'organizer@example.com',
    organizer_email_verified_at: null,
    notify_on_response: true,
    status: 'open' as const,
    final_date: finalization?.date ?? null,
    final_start_slot: finalization?.startSlot ?? null,
    final_end_slot: finalization?.endSlot ?? null,
    version,
    created_at: timestamp,
    updated_at: timestamp,
  });
  const client = {
    async query(sql: string, parameters?: unknown[]) {
      queries.push({ sql, parameters });
      if (/^(BEGIN|COMMIT|ROLLBACK)/.test(sql)) return { rows: [], rowCount: 0 };
      if (/JOIN admin_sessions/.test(sql)) return { rows: [eventRow()], rowCount: 1 };
      if (/WITH added AS/.test(sql)) {
        const dates = parameters?.[1] as string[];
        const indexes = parameters?.[2] as number[];
        candidates.push(...dates.map((date, index) => ({
          id: index === 0 ? addedSlotId : `added-${index}`,
          candidate_date: date,
          slot_index: indexes[index],
        })));
        return { rows: [], rowCount: dates.length };
      }
      if (/DELETE FROM candidate_slots/.test(sql)) {
        const removedIds = new Set(parameters?.[1] as string[]);
        candidates = candidates.filter(({ id }) => !removedIds.has(id));
        return { rows: [], rowCount: removedIds.size };
      }
      if (/UPDATE events\s+SET version/.test(sql)) {
        version += 1;
        return { rows: [eventRow()], rowCount: 1 };
      }
      if (/FROM candidate_slots/.test(sql)) return { rows: [...candidates], rowCount: candidates.length };
      if (/FROM responses\s/.test(sql)) return { rows: [], rowCount: 0 };
      if (/FROM response_availability/.test(sql)) return { rows: [], rowCount: 0 };
      throw new Error(`Unexpected query: ${sql}`);
    },
    release() {},
  };
  return {
    pool: { connect: async () => client } as unknown as Pool,
    queries,
  };
}

function lifecyclePool(options: {
  candidateIndexes?: number[];
  finalization?: null | { date: string; startSlot: number; endSlot: number };
  failSessionDelete?: boolean;
} = {}) {
  const queries: Array<{ sql: string; parameters?: unknown[] }> = [];
  let version = 1;
  let finalization = options.finalization ?? null;
  let status: 'open' | 'closed' | 'deleted' = 'open';
  let outcome: string | undefined;
  const candidateIndexes = options.candidateIndexes ?? [18, 19];
  const eventRow = () => ({
    id: eventId,
    title: '研究会',
    description: '説明',
    organizer_email: 'organizer@example.com',
    organizer_email_verified_at: null,
    notify_on_response: true,
    status,
    final_date: finalization?.date ?? null,
    final_start_slot: finalization?.startSlot ?? null,
    final_end_slot: finalization?.endSlot ?? null,
    version,
    created_at: timestamp,
    updated_at: timestamp,
  });
  const client = {
    async query(sql: string, parameters?: unknown[]) {
      queries.push({ sql, parameters });
      if (/^(BEGIN|COMMIT|ROLLBACK)/.test(sql)) {
        if (sql === 'COMMIT' || sql === 'ROLLBACK') outcome = sql;
        return { rows: [], rowCount: 0 };
      }
      if (/JOIN admin_sessions/.test(sql)) return { rows: [eventRow()], rowCount: 1 };
      if (/SELECT slot_index/.test(sql)) {
        return { rows: candidateIndexes.map((slot_index) => ({ slot_index })), rowCount: candidateIndexes.length };
      }
      if (/UPDATE events\s+SET final_date = \$2/.test(sql)) {
        finalization = {
          date: String(parameters?.[1]),
          startSlot: Number(parameters?.[2]),
          endSlot: Number(parameters?.[3]),
        };
        version += 1;
        return { rows: [eventRow()], rowCount: 1 };
      }
      if (/UPDATE events\s+SET final_date = NULL/.test(sql)) {
        finalization = null;
        version += 1;
        return { rows: [eventRow()], rowCount: 1 };
      }
      if (/UPDATE events\s+SET status = 'deleted'/.test(sql)) {
        status = 'deleted';
        version += 1;
        return { rows: [], rowCount: 1 };
      }
      if (/DELETE FROM admin_sessions/.test(sql)) {
        if (options.failSessionDelete) throw new Error('session deletion failed');
        return { rows: [], rowCount: 2 };
      }
      if (/FROM candidate_slots/.test(sql)) {
        return {
          rows: candidateIndexes.map((slot_index, index) => ({
            id: index === 0 ? slotId : removedSlotId,
            candidate_date: '2026-11-10',
            slot_index,
          })),
          rowCount: candidateIndexes.length,
        };
      }
      if (/FROM responses\s/.test(sql) || /FROM response_availability/.test(sql)) {
        return { rows: [], rowCount: 0 };
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
    release() {},
  };
  return {
    pool: { connect: async () => client } as unknown as Pool,
    queries,
    outcome: () => outcome,
  };
}

describe('PostgresAdminRepository', () => {
  it('reads only a live non-deleted event password hash', async () => {
    const boundary = adminPool();
    const result = await new PostgresAdminRepository(boundary.pool).findPasswordHash(eventId);

    expect(result).toBe('scrypt$stored');
    expect(boundary.queries[0].sql).toMatch(/deleted_at IS NULL/);
    expect(boundary.queries[0].sql).toMatch(/status <> 'deleted'/);
  });

  it('deletes expired sessions, inserts only the token hash, and returns the private admin projection', async () => {
    const boundary = adminPool();
    const expiresAt = new Date('2026-11-02T12:00:00.000Z');
    const result = await new PostgresAdminRepository(boundary.pool).createSession({
      eventId,
      tokenHash: 'sha256-session-token',
      expiresAt,
    });

    expect(boundary.queries).toContainEqual(expect.objectContaining({
      sql: expect.stringMatching(/INSERT INTO admin_sessions/),
      parameters: ['sha256-session-token', eventId, expiresAt],
    }));
    expect(result).toMatchObject({
      id: eventId,
      organizerEmail: 'organizer@example.com',
      organizerEmailVerified: false,
      notifyOnResponse: true,
      version: 1,
      candidateSlots: [{ id: slotId, date: '2026-11-10', slotIndex: 18 }],
      responses: [{ id: responseId, availability: [{ candidateSlotId: slotId, mark: 'best' }] }],
    });
    expect(boundary.outcome()).toBe('COMMIT');
    expect(boundary.released()).toBe(true);
  });

  it('rejects expired, invalid, or cross-event authorization and rolls back', async () => {
    const boundary = adminPool({ authorized: false });
    const repository = new PostgresAdminRepository(boundary.pool);

    await expect(repository.getAdminEvent(otherEventId, 'wrong-hash'))
      .rejects.toBeInstanceOf(AdminAccessDeniedError);
    expect(boundary.queries.find(({ sql }) => /JOIN admin_sessions/.test(sql))?.sql)
      .toMatch(/expires_at > now\(\)/);
    expect(boundary.outcome()).toBe('ROLLBACK');
    expect(boundary.released()).toBe(true);
  });

  it('updates basic information after authorization and increments version', async () => {
    const boundary = adminPool();
    const result = await new PostgresAdminRepository(boundary.pool).updateEvent({
      eventId,
      tokenHash: 'session-hash',
      request: { title: '更新後', description: '新しい説明', notifyOnResponse: false },
    });

    expect(result).toMatchObject({ title: '更新後', description: '新しい説明', notifyOnResponse: false, version: 2 });
    expect(boundary.outcome()).toBe('COMMIT');
  });

  it('changes lifecycle once and preserves version for an idempotent repeated command', async () => {
    const boundary = adminPool();
    const repository = new PostgresAdminRepository(boundary.pool);

    const closed = await repository.setEventStatus({ eventId, tokenHash: 'session-hash', status: 'closed' });
    const repeated = await repository.setEventStatus({ eventId, tokenHash: 'session-hash', status: 'closed' });

    expect(closed).toMatchObject({ status: 'closed', version: 2 });
    expect(repeated).toMatchObject({ status: 'closed', version: 2 });
    expect(boundary.queries.filter(({ sql }) => /UPDATE events\s+SET status/.test(sql))).toHaveLength(1);
  });

  it('reconciles candidate tuples, backfills new response availability as ng, and increments version once', async () => {
    const boundary = candidatePool([
      { id: slotId, candidate_date: '2026-11-10', slot_index: 18 },
      { id: removedSlotId, candidate_date: '2026-11-11', slot_index: 19 },
    ]);
    const result = await new PostgresAdminRepository(boundary.pool).replaceCandidateSlots({
      eventId,
      tokenHash: 'session-hash',
      request: {
        candidateSlots: [{ date: '2026-11-10', slotIndexes: [18, 20] }],
      },
    });

    expect(result).toMatchObject({
      version: 2,
      candidateSlots: [
        { id: slotId, date: '2026-11-10', slotIndex: 18 },
        { id: addedSlotId, date: '2026-11-10', slotIndex: 20 },
      ],
    });
    const lockedCandidates = boundary.queries.find(({ sql }) => /FROM candidate_slots/.test(sql) && /FOR UPDATE/.test(sql));
    expect(lockedCandidates).toBeDefined();
    expect(boundary.queries).toContainEqual({
      sql: expect.stringMatching(/WITH added AS/),
      parameters: [eventId, ['2026-11-10'], [20]],
    });
    expect(boundary.queries.find(({ sql }) => /WITH added AS/.test(sql))?.sql)
      .toMatch(/'ng'/);
    expect(boundary.queries).toContainEqual({
      sql: expect.stringMatching(/DELETE FROM candidate_slots/),
      parameters: [eventId, [removedSlotId]],
    });
    expect(boundary.queries.filter(({ sql }) => /UPDATE events\s+SET version/.test(sql)))
      .toHaveLength(1);
  });

  it('preserves candidate rows and event version for a normalized no-op replacement', async () => {
    const boundary = candidatePool([
      { id: slotId, candidate_date: '2026-11-10', slot_index: 18 },
    ]);
    const result = await new PostgresAdminRepository(boundary.pool).replaceCandidateSlots({
      eventId,
      tokenHash: 'session-hash',
      request: {
        candidateSlots: [{ date: '2026-11-10', slotIndexes: [18] }],
      },
    });

    expect(result).toMatchObject({ version: 1, candidateSlots: [{ id: slotId }] });
    expect(boundary.queries.some(({ sql }) => /WITH added AS|DELETE FROM candidate_slots|UPDATE events\s+SET version/.test(sql)))
      .toBe(false);
  });

  it('rejects removal of a finalized candidate slot before any candidate write', async () => {
    const boundary = candidatePool([
      { id: slotId, candidate_date: '2026-11-10', slot_index: 18 },
      { id: removedSlotId, candidate_date: '2026-11-10', slot_index: 19 },
    ], { date: '2026-11-10', startSlot: 18, endSlot: 20 });
    const repository = new PostgresAdminRepository(boundary.pool);

    await expect(repository.replaceCandidateSlots({
      eventId,
      tokenHash: 'session-hash',
      request: { candidateSlots: [{ date: '2026-11-10', slotIndexes: [18] }] },
    })).rejects.toBeInstanceOf(EventFinalizedError);
    expect(boundary.queries.some(({ sql }) => /WITH added AS|DELETE FROM candidate_slots|UPDATE events\s+SET version/.test(sql)))
      .toBe(false);
    expect(boundary.queries.at(-1)?.sql).toBe('ROLLBACK');
  });

  it('sets a continuous finalization once without changing event status', async () => {
    const boundary = lifecyclePool({ candidateIndexes: [18, 19, 22] });
    const repository = new PostgresAdminRepository(boundary.pool);
    const request = { date: '2026-11-10', startSlot: 18, endSlot: 20 };

    const finalized = await repository.setFinalization({
      eventId,
      tokenHash: 'session-hash',
      request,
    });
    const repeated = await repository.setFinalization({
      eventId,
      tokenHash: 'session-hash',
      request,
    });

    expect(finalized).toMatchObject({ status: 'open', finalization: request, version: 2 });
    expect(repeated).toMatchObject({ status: 'open', finalization: request, version: 2 });
    expect(boundary.queries).toContainEqual({
      sql: expect.stringMatching(/SELECT slot_index/),
      parameters: [eventId, '2026-11-10'],
    });
    expect(boundary.queries.filter(({ sql }) => /UPDATE events\s+SET final_date = \$2/.test(sql)))
      .toHaveLength(1);
  });

  it('rejects a finalization with a missing candidate and rolls back', async () => {
    const boundary = lifecyclePool({ candidateIndexes: [18, 20] });
    const repository = new PostgresAdminRepository(boundary.pool);

    await expect(repository.setFinalization({
      eventId,
      tokenHash: 'session-hash',
      request: { date: '2026-11-10', startSlot: 18, endSlot: 21 },
    })).rejects.toBeInstanceOf(InvalidFinalizationError);
    expect(boundary.queries.some(({ sql }) => /UPDATE events\s+SET final_date/.test(sql))).toBe(false);
    expect(boundary.outcome()).toBe('ROLLBACK');
  });

  it('clears finalization once and preserves version when already clear', async () => {
    const boundary = lifecyclePool({
      finalization: { date: '2026-11-10', startSlot: 18, endSlot: 20 },
    });
    const repository = new PostgresAdminRepository(boundary.pool);

    const cleared = await repository.clearFinalization({ eventId, tokenHash: 'session-hash' });
    const repeated = await repository.clearFinalization({ eventId, tokenHash: 'session-hash' });

    expect(cleared).toMatchObject({ finalization: null, version: 2 });
    expect(repeated).toMatchObject({ finalization: null, version: 2 });
    expect(boundary.queries.filter(({ sql }) => /UPDATE events\s+SET final_date = NULL/.test(sql)))
      .toHaveLength(1);
  });

  it('logically deletes the event and all admin sessions in one transaction', async () => {
    const boundary = lifecyclePool();
    const repository = new PostgresAdminRepository(boundary.pool);

    await expect(repository.deleteEvent({ eventId, tokenHash: 'session-hash' }))
      .resolves.toBeUndefined();

    const updateIndex = boundary.queries.findIndex(({ sql }) => /SET status = 'deleted'/.test(sql));
    const sessionIndex = boundary.queries.findIndex(({ sql }) => /DELETE FROM admin_sessions/.test(sql));
    expect(updateIndex).toBeGreaterThan(0);
    expect(sessionIndex).toBeGreaterThan(updateIndex);
    expect(boundary.queries[sessionIndex].parameters).toEqual([eventId]);
    expect(boundary.outcome()).toBe('COMMIT');
  });

  it('rolls back logical deletion if session invalidation fails', async () => {
    const boundary = lifecyclePool({ failSessionDelete: true });
    const repository = new PostgresAdminRepository(boundary.pool);

    await expect(repository.deleteEvent({ eventId, tokenHash: 'session-hash' }))
      .rejects.toThrow('session deletion failed');
    expect(boundary.outcome()).toBe('ROLLBACK');
  });
});
