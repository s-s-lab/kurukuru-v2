// @vitest-environment node
import type { Pool } from 'pg';
import { describe, expect, it } from 'vitest';

import { AdminAccessDeniedError } from './service';
import { PostgresAdminRepository } from './postgres-admin-repository';

const eventId = '11111111-1111-4111-8111-111111111111';
const otherEventId = '22222222-2222-4222-8222-222222222222';
const slotId = '33333333-3333-4333-8333-333333333333';
const responseId = '44444444-4444-4444-8444-444444444444';
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
});
