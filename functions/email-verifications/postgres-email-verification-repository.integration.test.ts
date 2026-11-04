// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, describe, expect, it } from 'vitest';

import { PostgresEmailVerificationRepository } from './postgres-email-verification-repository';

const databaseUrl = process.env.DATABASE_URL;
const pool = databaseUrl ? new Pool({ connectionString: databaseUrl }) : null;

afterAll(async () => { await pool?.end(); });

describe.skipIf(!pool)('Postgresメール確認リポジトリ統合', () => {
  it('管理境界、トークンローテーション、二テーブルの冪等な確認を保つ', async () => {
    const eventId = randomUUID();
    const sessionTokenHash = `session-${randomUUID()}`;
    const firstTokenHash = `verification-${randomUUID()}`;
    const secondTokenHash = `verification-${randomUUID()}`;
    const repository = new PostgresEmailVerificationRepository(pool!);
    try {
      await pool!.query(
        `INSERT INTO events (id, title, organizer_email, admin_secret_hash)
         VALUES ($1, 'メール確認統合', 'organizer@example.com', 'admin-hash')`,
        [eventId],
      );
      await pool!.query(
        `INSERT INTO admin_sessions (token_hash, event_id, expires_at)
         VALUES ($1, $2, now() + interval '1 hour')`,
        [sessionTokenHash, eventId],
      );
      const sentAt = new Date();
      await expect(repository.prepareSend({
        eventId,
        sessionTokenHash,
        tokenHash: firstTokenHash,
        sentAt,
        expiresAt: new Date(sentAt.getTime() + 86_400_000),
      })).resolves.toMatchObject({ status: 'ready', organizerEmail: 'organizer@example.com' });
      const resentAt = new Date(sentAt.getTime() + 1_000);
      await repository.prepareSend({
        eventId,
        sessionTokenHash,
        tokenHash: secondTokenHash,
        sentAt: resentAt,
        expiresAt: new Date(resentAt.getTime() + 86_400_000),
      });
      await expect(repository.verify({ tokenHash: firstTokenHash, verifiedAt: resentAt }))
        .resolves.toBeNull();
      await expect(repository.verify({ tokenHash: secondTokenHash, verifiedAt: resentAt }))
        .resolves.toEqual({ eventId });
      await expect(repository.verify({ tokenHash: secondTokenHash, verifiedAt: new Date(resentAt.getTime() + 1_000) }))
        .resolves.toEqual({ eventId });

      const stored = await pool!.query(
        `SELECT e.organizer_email_verified_at, e.version, ev.verified_at, ev.send_attempts
           FROM events e JOIN email_verifications ev ON ev.event_id = e.id
          WHERE e.id = $1`,
        [eventId],
      );
      expect(stored.rows[0]).toMatchObject({ version: 2, send_attempts: 2 });
      expect(stored.rows[0].organizer_email_verified_at).not.toBeNull();
      expect(stored.rows[0].verified_at).not.toBeNull();
    } finally {
      await pool!.query('DELETE FROM events WHERE id = $1', [eventId]);
    }
  });
});
