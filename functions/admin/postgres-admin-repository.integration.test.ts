// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, describe, expect, it } from 'vitest';

import { AdminAccessDeniedError } from './service';
import { PostgresAdminRepository } from './postgres-admin-repository';

const databaseUrl = process.env.DATABASE_URL;
const pool = databaseUrl ? new Pool({ connectionString: databaseUrl }) : null;

afterAll(async () => {
  await pool?.end();
});

describe.skipIf(!pool)('Postgres管理リポジトリ統合', () => {
  it('認証境界、更新、受付状態の冪等性を実DBで保つ', async () => {
    const repository = new PostgresAdminRepository(pool!);
    const eventId = randomUUID();
    const otherEventId = randomUUID();
    const tokenHash = `admin-${randomUUID()}`;
    try {
      await pool!.query(
        `INSERT INTO events (id, title, description, organizer_email, admin_secret_hash, notify_on_response)
         VALUES ($1, '管理統合', '説明', 'admin@example.com', 'scrypt$test', true),
                ($2, '別イベント', '', 'other@example.com', 'scrypt$other', false)`,
        [eventId, otherEventId],
      );

      expect(await repository.findPasswordHash(eventId)).toBe('scrypt$test');
      await repository.createSession({
        eventId,
        tokenHash,
        expiresAt: new Date(Date.now() + 60 * 60 * 1_000),
      });
      await expect(repository.getAdminEvent(otherEventId, tokenHash))
        .rejects.toBeInstanceOf(AdminAccessDeniedError);

      const updated = await repository.updateEvent({
        eventId,
        tokenHash,
        request: { title: '更新後', description: '更新説明', notifyOnResponse: false },
      });
      const closed = await repository.setEventStatus({ eventId, tokenHash, status: 'closed' });
      const closedAgain = await repository.setEventStatus({ eventId, tokenHash, status: 'closed' });

      expect(updated).toMatchObject({ title: '更新後', notifyOnResponse: false, version: 2 });
      expect(closed).toMatchObject({ status: 'closed', version: 3 });
      expect(closedAgain).toMatchObject({ status: 'closed', version: 3 });

      await pool!.query('UPDATE admin_sessions SET expires_at = now() WHERE token_hash = $1', [tokenHash]);
      await expect(repository.setEventStatus({ eventId, tokenHash, status: 'open' }))
        .rejects.toBeInstanceOf(AdminAccessDeniedError);
      const persisted = await pool!.query<{ status: string; version: number }>(
        'SELECT status, version FROM events WHERE id = $1',
        [eventId],
      );
      expect(persisted.rows[0]).toEqual({ status: 'closed', version: 3 });
    } finally {
      await pool!.query('DELETE FROM events WHERE id = ANY($1::uuid[])', [[eventId, otherEventId]]);
    }
  });
});
