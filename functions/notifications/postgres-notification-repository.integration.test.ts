// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, describe, expect, it } from 'vitest';

import { PostgresAdminRepository } from '../admin/postgres-admin-repository';
import { PostgresNotificationRepository } from './postgres-notification-repository';

const databaseUrl = process.env.DATABASE_URL;
const pool = databaseUrl ? new Pool({ connectionString: databaseUrl }) : null;

afterAll(async () => { await pool?.end(); });

describe.skipIf(!pool)('Postgres通知リポジトリ統合', () => {
  it('claim、失敗再試行、送信完了を実DBで遷移する', async () => {
    const eventId = randomUUID();
    const responseId = randomUUID();
    const notificationId = randomUUID();
    let current = new Date();
    const repository = new PostgresNotificationRepository(pool!, () => current);
    try {
      await pool!.query(
        `INSERT INTO events (id, title, organizer_email, admin_secret_hash, organizer_email_verified_at)
         VALUES ($1, '通知統合', 'organizer@example.com', 'admin-hash', now())`,
        [eventId],
      );
      await pool!.query(
        `INSERT INTO responses (id, event_id, display_name, edit_secret_hash)
         VALUES ($1, $2, '参加者', 'edit-hash')`,
        [responseId, eventId],
      );
      await pool!.query(
        `INSERT INTO notification_outbox (id, event_id, response_id, kind, idempotency_key)
         VALUES ($1, $2, $3, 'created', $4)`,
        [notificationId, eventId, responseId, `notification-integration-${notificationId}`],
      );

      current = new Date(Date.now() + 1_000);
      const first = await repository.claim(10);
      expect(first).toEqual([expect.objectContaining({
        id: notificationId, eventTitle: '通知統合', respondentName: '参加者', attempts: 1,
      })]);
      await repository.markFailed(notificationId, 'provider-rejected');
      expect(await repository.claim(10)).toEqual([]);
      current = new Date(current.getTime() + 61_000);
      const second = await repository.claim(10);
      expect(second).toEqual([expect.objectContaining({ id: notificationId, attempts: 2 })]);
      await repository.markSent(notificationId, 'provider-message-id');

      const stored = await pool!.query(
        `SELECT status, attempts, error_message, provider_message_id, sent_at
           FROM notification_outbox WHERE id = $1`,
        [notificationId],
      );
      expect(stored.rows[0]).toMatchObject({
        status: 'sent', attempts: 2, error_message: null, provider_message_id: 'provider-message-id',
      });
      expect(stored.rows[0].sent_at).not.toBeNull();
    } finally {
      await pool!.query('DELETE FROM events WHERE id = $1', [eventId]);
    }
  });

  it('claim後の主催者メール変更で旧世代の失敗通知を再試行せず破棄する', async () => {
    const eventId = randomUUID();
    const responseId = randomUUID();
    const notificationId = randomUUID();
    const sessionTokenHash = `admin-${randomUUID()}`;
    const current = new Date(Date.now() + 1_000);
    const notificationRepository = new PostgresNotificationRepository(pool!, () => current);
    const adminRepository = new PostgresAdminRepository(pool!);
    try {
      await pool!.query(
        `INSERT INTO events
           (id, title, description, organizer_email, admin_secret_hash,
            organizer_email_verified_at, notify_on_response)
         VALUES ($1, '通知世代統合', '', 'old-owner@example.com', 'admin-hash', now(), true)`,
        [eventId],
      );
      await adminRepository.createSession({
        eventId,
        tokenHash: sessionTokenHash,
        expiresAt: new Date(Date.now() + 60 * 60 * 1_000),
      });
      await pool!.query(
        `INSERT INTO responses (id, event_id, display_name, edit_secret_hash)
         VALUES ($1, $2, '参加者', 'edit-hash')`,
        [responseId, eventId],
      );
      await pool!.query(
        `INSERT INTO notification_outbox (id, event_id, response_id, kind, idempotency_key)
         VALUES ($1, $2, $3, 'created', $4)`,
        [notificationId, eventId, responseId, `notification-generation-${notificationId}`],
      );

      await expect(notificationRepository.claim(10)).resolves.toEqual([
        expect.objectContaining({ id: notificationId, organizerEmail: 'old-owner@example.com' }),
      ]);
      await adminRepository.updateEvent({
        eventId,
        tokenHash: sessionTokenHash,
        request: {
          title: '通知世代統合',
          description: '',
          organizerEmail: 'new-owner@example.com',
          notifyOnResponse: true,
        },
      });

      await notificationRepository.markFailed(notificationId, 'provider-rejected');

      expect((await pool!.query(
        'SELECT id FROM notification_outbox WHERE id = $1', [notificationId],
      )).rows).toEqual([]);
      expect((await pool!.query<{ notification_generation: number }>(
        'SELECT notification_generation FROM events WHERE id = $1', [eventId],
      )).rows[0]?.notification_generation).toBe(2);
    } finally {
      await pool!.query('DELETE FROM events WHERE id = $1', [eventId]);
    }
  });
});
