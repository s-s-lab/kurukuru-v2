// @vitest-environment node
import type { Pool, PoolClient } from 'pg';
import { describe, expect, it, vi } from 'vitest';

import { PostgresNotificationRepository } from './postgres-notification-repository';

const now = new Date('2026-11-03T12:00:00.000Z');

function poolWith(query: PoolClient['query']) {
  const client = { query, release: vi.fn() } as unknown as PoolClient;
  return { pool: { connect: vi.fn(async () => client) } as unknown as Pool, client };
}

describe('Postgres通知リポジトリ', () => {
  it('SKIP LOCKEDで準備済みと停滞中の通知をclaimして試行回数を増やす', async () => {
    const query = vi.fn(async (sql: string) => {
      if (/ready_events AS MATERIALIZED/.test(sql)) return { rows: [{
        id: 'notification-1',
        event_id: '9bed1489-b31f-4b6d-8dcb-e8d95109f98c',
        title: '研究会',
        organizer_email: 'organizer@example.com',
        response_id: 'a9210ea7-8827-448a-952a-8510a6fdcb44',
        display_name: '参加者',
        kind: 'created',
        attempts: 2,
        idempotency_key: 'response-created:key',
      }] };
      return { rows: [] };
    }) as unknown as PoolClient['query'];
    const { pool, client } = poolWith(query);
    const repository = new PostgresNotificationRepository(pool, () => now);

    await expect(repository.claim(10)).resolves.toEqual([expect.objectContaining({
      id: 'notification-1', attempts: 2, respondentName: '参加者',
    })]);
    const claimCall = vi.mocked(client.query).mock.calls.find(([sql]) =>
      /ready_events AS MATERIALIZED/.test(String(sql)))!;
    expect(String(claimCall[0])).toContain('ready_events AS MATERIALIZED');
    expect(String(claimCall[0])).toContain('FOR UPDATE OF n SKIP LOCKED');
    expect(String(claimCall[0])).toContain("status = 'sending'");
    expect(String(claimCall[0])).toContain("interval '15 minutes'");
    expect(String(claimCall[0])).toContain('attempts = n.attempts + 1');
    expect(String(claimCall[0])).toContain('organizer_email_verified_at IS NOT NULL');
    expect(String(claimCall[0])).toContain('notify_on_response = true');
    expect(String(claimCall[0])).toContain('n.notification_generation = ready_event.notification_generation');
    expect(claimCall[1]).toEqual([now, 10]);
  });

  it('provider IDと送信日時を保存する', async () => {
    const query = vi.fn(async () => ({ rows: [] })) as unknown as PoolClient['query'];
    const { pool, client } = poolWith(query);
    const repository = new PostgresNotificationRepository(pool, () => now);
    await repository.markSent('notification-1', 'provider-1');

    const call = vi.mocked(client.query).mock.calls.find(([sql]) => /SET status = 'sent'/.test(String(sql)))!;
    expect(String(call[0])).toContain('provider_message_id = $2');
    expect(call[1]).toEqual(['notification-1', 'provider-1', now]);
  });

  it('失敗理由を短く保存し1分・2分・4分の指数バックオフを6時間で上限化する', async () => {
    const query = vi.fn(async (sql: string) => /FOR UPDATE OF e/.test(sql)
      ? {
          rows: [{ event_generation: 2, notification_generation: 2, eligible: true }],
          rowCount: 1,
        }
      : { rows: [], rowCount: 1 }) as unknown as PoolClient['query'];
    const { pool, client } = poolWith(query);
    const repository = new PostgresNotificationRepository(pool, () => now);
    await repository.markFailed('notification-1', 'x'.repeat(500));

    const eventLockIndex = vi.mocked(client.query).mock.calls.findIndex(([sql]) =>
      /FOR UPDATE OF e/.test(String(sql)));
    const failureIndex = vi.mocked(client.query).mock.calls.findIndex(([sql]) =>
      /SET status = 'failed'/.test(String(sql)));
    const call = vi.mocked(client.query).mock.calls.find(([sql]) => /SET status = 'failed'/.test(String(sql)))!;
    expect(eventLockIndex).toBeGreaterThan(-1);
    expect(failureIndex).toBeGreaterThan(eventLockIndex);
    expect(String(call[0])).toContain("power(2, GREATEST(attempts - 1, 0)) * interval '1 minute'");
    expect(String(call[0])).toContain("interval '6 hours'");
    expect(String(call[0])).toContain('notification_generation = $4');
    expect(call[1]).toEqual(['notification-1', 'x'.repeat(120), now, 2]);
  });

  it('世代不一致で再試行対象外になったsending通知を削除する', async () => {
    const query = vi.fn(async (sql: string) => /FOR UPDATE OF e/.test(sql)
      ? {
          rows: [{ event_generation: 2, notification_generation: 1, eligible: true }],
          rowCount: 1,
        }
      : { rows: [], rowCount: 1 }) as unknown as PoolClient['query'];
    const { pool, client } = poolWith(query);
    const repository = new PostgresNotificationRepository(pool, () => now);
    await repository.markFailed('notification-1', 'provider-rejected');

    expect(vi.mocked(client.query).mock.calls.some(([sql]) =>
      /SET status = 'failed'/.test(String(sql)))).toBe(false);
    expect(vi.mocked(client.query).mock.calls).toContainEqual([
      expect.stringMatching(/DELETE FROM notification_outbox/),
      ['notification-1'],
    ]);
  });
});
