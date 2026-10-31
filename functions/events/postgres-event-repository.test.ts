// @vitest-environment node
import type { Pool } from 'pg';
import { describe, expect, it } from 'vitest';

import { PostgresEventRepository } from './postgres-event-repository';

const eventId = '11111111-1111-4111-8111-111111111111';
const responseId = '22222222-2222-4222-8222-222222222222';
const slotId = '33333333-3333-4333-8333-333333333333';
const timestamp = '2026-10-31T00:00:00.000Z';

// This boundary double rejects weaker isolation and independent pool reads. Real
// PostgreSQL interleavings are covered in postgres-event-snapshot.integration.test.ts.
function snapshotPool(options: { missing?: boolean; failAvailability?: Error } = {}) {
  let active = false;
  let released = false;
  let outcome: string | undefined;
  const client = {
    async query(sql: string) {
      if (sql === 'BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY') {
        active = true;
        return { rows: [] };
      }
      if (sql === 'COMMIT' || sql === 'ROLLBACK') {
        if (!active) throw new Error('No snapshot transaction to finish.');
        active = false;
        outcome = sql;
        return { rows: [] };
      }
      if (!active) throw new Error('Public reads need a repeatable read, read-only transaction.');
      if (/FROM events/.test(sql)) return { rows: options.missing ? [] : [{
        id: eventId, title: 'snapshot', description: '', status: 'open',
        final_date: null, final_start_slot: null, final_end_slot: null,
        created_at: timestamp, updated_at: timestamp, organizer_email: 'private@example.com',
        admin_secret_hash: 'private-admin-hash',
      }] };
      if (/FROM candidate_slots/.test(sql)) return { rows: [{ id: slotId, candidate_date: '2027-01-12', slot_index: 20 }] };
      if (/FROM responses\s/.test(sql)) return { rows: [{ id: responseId,
        display_name: '参加者', comment: 'snapshot', created_at: timestamp, updated_at: timestamp,
        edit_secret_hash: 'private-edit-hash' }] };
      if (/FROM response_availability/.test(sql)) {
        if (options.failAvailability) throw options.failAvailability;
        return { rows: [{ response_id: responseId, candidate_slot_id: slotId, mark: 'ok' }] };
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
    release() { released = true; },
  };
  const pool = {
    async query() { throw new Error('Independent pool reads do not share a snapshot.'); },
    async connect() { return client; },
  } as unknown as Pool;
  return { pool, outcome: () => outcome, released: () => released };
}

describe('公開イベント読取のトランザクション境界', () => {
  it('共有スナップショットから公開項目だけを返しコミットして接続を解放する', async () => {
    const boundary = snapshotPool();
    const result = await new PostgresEventRepository(boundary.pool).getPublicEvent(eventId);
    expect(result).toEqual({
      id: eventId, title: 'snapshot', description: '', status: 'open', finalization: null,
      createdAt: timestamp, updatedAt: timestamp,
      candidateSlots: [{ id: slotId, date: '2027-01-12', slotIndex: 20 }],
      responses: [{ id: responseId, displayName: '参加者', comment: 'snapshot',
        createdAt: timestamp, updatedAt: timestamp,
        availability: [{ candidateSlotId: slotId, mark: 'ok' }] }],
    });
    expect(boundary.outcome()).toBe('COMMIT');
    expect(boundary.released()).toBe(true);
  });

  it('イベントが見つからない場合も読取をコミットして接続を解放する', async () => {
    const boundary = snapshotPool({ missing: true });
    expect(await new PostgresEventRepository(boundary.pool).getPublicEvent(eventId)).toBeNull();
    expect(boundary.outcome()).toBe('COMMIT');
    expect(boundary.released()).toBe(true);
  });

  it('読取失敗はロールバックして元のエラーを返し接続を解放する', async () => {
    const failure = new Error('availability read failed');
    const boundary = snapshotPool({ failAvailability: failure });
    await expect(new PostgresEventRepository(boundary.pool).getPublicEvent(eventId)).rejects.toBe(failure);
    expect(boundary.outcome()).toBe('ROLLBACK');
    expect(boundary.released()).toBe(true);
  });
});
