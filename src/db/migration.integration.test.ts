// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { Pool } from 'pg';
import { afterAll, describe, expect, it } from 'vitest';

const databaseUrl = process.env.DATABASE_URL;
const pool = databaseUrl ? new Pool({ connectionString: databaseUrl }) : null;
const migrations = ['0000_base.sql', '0001_core_security.sql', '0002_request_rate_limits.sql',
  '0003_response_version.sql', '0004_notification_generation.sql',
  '0005_duration_and_overnight_slots.sql'];

afterAll(async () => { await pool?.end(); });

describe.skipIf(!pool)('DBマイグレーション統合', () => {
  it('0004適用時に通知対象外の旧キューだけを失効する', async () => {
    const schema = `migration_${randomUUID().replaceAll('-', '')}`;
    const client = await pool!.connect();
    try {
      await client.query(`CREATE SCHEMA "${schema}"`);
      await client.query(`SET search_path TO "${schema}", public`);
      for (const migration of migrations.slice(0, -2)) {
        await client.query(readFileSync(resolve(process.cwd(), 'db/migrations', migration), 'utf8'));
      }

      const offEventId = randomUUID();
      const eligibleEventId = randomUUID();
      const offResponseId = randomUUID();
      const eligibleResponseId = randomUUID();
      const offPendingId = randomUUID();
      const offSendingId = randomUUID();
      const eligiblePendingId = randomUUID();
      await client.query(
        `INSERT INTO events
           (id, title, organizer_email, admin_secret_hash,
            organizer_email_verified_at, notify_on_response)
         VALUES ($1, '通知OFF', 'off@example.com', 'hash', now(), false),
                ($2, '通知ON', 'on@example.com', 'hash', now(), true)`,
        [offEventId, eligibleEventId],
      );
      await client.query(
        `INSERT INTO responses (id, event_id, display_name, edit_secret_hash)
         VALUES ($1, $2, 'OFF回答', 'hash'), ($3, $4, 'ON回答', 'hash')`,
        [offResponseId, offEventId, eligibleResponseId, eligibleEventId],
      );
      await client.query(
        `INSERT INTO notification_outbox
           (id, event_id, response_id, kind, status, idempotency_key)
         VALUES ($1, $2, $3, 'created', 'pending', $4),
                ($5, $2, $3, 'updated', 'sending', $6),
                ($7, $8, $9, 'created', 'pending', $10)`,
        [
          offPendingId,
          offEventId,
          offResponseId,
          `off-pending-${randomUUID()}`,
          offSendingId,
          `off-sending-${randomUUID()}`,
          eligiblePendingId,
          eligibleEventId,
          eligibleResponseId,
          `on-pending-${randomUUID()}`,
        ],
      );

      await client.query(readFileSync(
        resolve(process.cwd(), 'db/migrations', '0004_notification_generation.sql'),
        'utf8',
      ));

      const events = await client.query<{ id: string; notification_generation: number }>(
        `SELECT id, notification_generation FROM events
          WHERE id = ANY($1::uuid[])`,
        [[offEventId, eligibleEventId]],
      );
      expect(events.rows.find(({ id }) => id === offEventId)?.notification_generation).toBe(2);
      expect(events.rows.find(({ id }) => id === eligibleEventId)?.notification_generation).toBe(1);

      const outbox = await client.query<{
        id: string;
        event_id: string;
        status: string;
        notification_generation: number;
      }>(
        `SELECT id, event_id, status, notification_generation
           FROM notification_outbox ORDER BY status`,
      );
      expect(outbox.rows).toEqual(expect.arrayContaining([
        expect.objectContaining({
          id: offSendingId,
          event_id: offEventId,
          status: 'sending',
          notification_generation: 1,
        }),
        expect.objectContaining({
          id: eligiblePendingId,
          event_id: eligibleEventId,
          status: 'pending',
          notification_generation: 1,
        }),
      ]));
      expect(outbox.rows).toHaveLength(2);
    } finally {
      await client.query('ROLLBACK').catch(() => undefined);
      await client.query('SET search_path TO public');
      await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      client.release();
    }
  });
});
