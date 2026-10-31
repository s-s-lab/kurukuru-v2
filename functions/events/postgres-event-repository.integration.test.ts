// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, describe, expect, it } from 'vitest';

import {
  IdempotencyConflictError,
  PostgresEventRepository,
} from './postgres-event-repository';
import type { CreateEventPersistenceInput } from './repository';

const databaseUrl = process.env.DATABASE_URL;
const pool = databaseUrl ? new Pool({ connectionString: databaseUrl }) : null;

afterAll(async () => {
  await pool?.end();
});

describe.skipIf(!pool)('Postgresイベントリポジトリ統合', () => {
  it('イベント作成・冪等再実行・公開取得を実DBで一貫して処理する', async () => {
    const repository = new PostgresEventRepository(pool!);
    const unique = randomUUID();
    const createdEventIds: string[] = [];
    const input: CreateEventPersistenceInput = {
      idempotencyKey: `integration-${unique}`,
      requestHash: 'a'.repeat(64),
      event: {
        title: `統合テスト ${unique}`,
        description: 'developmentブランチの自動検証データ',
        organizerEmail: `integration+${unique}@example.com`,
        adminSecretHash: 'scrypt$test-only-hash',
        notifyOnResponse: true,
      },
      candidateSlots: [
        { date: '2027-01-12', slotIndex: 20 },
        { date: '2027-01-12', slotIndex: 21 },
        { date: '2027-01-13', slotIndex: 30 },
      ],
      emailVerification: {
        tokenHash: `verification-${unique}`,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
    };

    try {
      const [created, concurrentReplay] = await Promise.all([
        repository.createEvent(input),
        repository.createEvent(input),
      ]);
      createdEventIds.push(created.event.id);
      const replayed = await repository.createEvent(input);
      const fetched = await repository.getPublicEvent(created.event.id);

      expect(concurrentReplay).toEqual(created);
      expect(replayed).toEqual(created);
      expect(fetched).toEqual(created.event);
      expect(created.event).toMatchObject({
        title: input.event.title,
        description: input.event.description,
        status: 'open',
        candidateSlots: [
          { date: '2027-01-12', slotIndex: 20 },
          { date: '2027-01-12', slotIndex: 21 },
          { date: '2027-01-13', slotIndex: 30 },
        ],
        responses: [],
      });

      await expect(
        repository.createEvent({ ...input, requestHash: 'b'.repeat(64) }),
      ).rejects.toBeInstanceOf(IdempotencyConflictError);

      await pool!.query(
        `UPDATE idempotency_keys
         SET created_at = now() - interval '2 days',
             expires_at = now() - interval '1 day'
         WHERE scope = 'create-event' AND idempotency_key = $1`,
        [input.idempotencyKey],
      );
      const reused = await repository.createEvent({
        ...input,
        requestHash: 'b'.repeat(64),
        event: { ...input.event, title: `${input.event.title} reused` },
        emailVerification: {
          ...input.emailVerification,
          tokenHash: `verification-reused-${unique}`,
        },
      });
      createdEventIds.push(reused.event.id);
      expect(reused.event.id).not.toBe(created.event.id);

      const persisted = await pool!.query<{
        organizer_email: string;
        admin_secret_hash: string;
        token_hash: string;
      }>(
        `SELECT e.organizer_email, e.admin_secret_hash, v.token_hash
         FROM events e
         JOIN email_verifications v ON v.event_id = e.id
         WHERE e.id = $1`,
        [created.event.id],
      );
      expect(persisted.rows[0]).toEqual({
        organizer_email: input.event.organizerEmail,
        admin_secret_hash: input.event.adminSecretHash,
        token_hash: input.emailVerification.tokenHash,
      });
      expect(JSON.stringify(created)).not.toContain(input.event.organizerEmail);
      expect(JSON.stringify(created)).not.toContain(input.event.adminSecretHash);
      expect(JSON.stringify(created)).not.toContain(input.emailVerification.tokenHash);
    } finally {
      if (createdEventIds.length > 0) {
        await pool!.query('DELETE FROM events WHERE id = ANY($1::uuid[])', [createdEventIds]);
      }
      await pool!.query(
        `DELETE FROM idempotency_keys
         WHERE scope = 'create-event' AND idempotency_key = $1`,
        [input.idempotencyKey],
      );
    }
  });

  it('候補枠登録失敗時にイベントと冪等キーをロールバックする', async () => {
    const repository = new PostgresEventRepository(pool!);
    const unique = randomUUID();
    const input: CreateEventPersistenceInput = {
      idempotencyKey: `rollback-${unique}`,
      requestHash: 'c'.repeat(64),
      event: {
        title: `ロールバックテスト ${unique}`,
        description: '',
        organizerEmail: `rollback+${unique}@example.com`,
        adminSecretHash: 'scrypt$test-only-hash',
        notifyOnResponse: false,
      },
      candidateSlots: [
        { date: '2027-01-12', slotIndex: 20 },
        { date: '2027-01-12', slotIndex: 20 },
      ],
      emailVerification: {
        tokenHash: `rollback-verification-${unique}`,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
    };

    await expect(repository.createEvent(input)).rejects.toBeTruthy();
    const [events, keys] = await Promise.all([
      pool!.query('SELECT id FROM events WHERE organizer_email = $1', [input.event.organizerEmail]),
      pool!.query(
        `SELECT idempotency_key FROM idempotency_keys
         WHERE scope = 'create-event' AND idempotency_key = $1`,
        [input.idempotencyKey],
      ),
    ]);
    expect(events.rowCount).toBe(0);
    expect(keys.rowCount).toBe(0);
  });
});
