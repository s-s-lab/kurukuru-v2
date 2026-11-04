// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, describe, expect, it } from 'vitest';

import {
  AdminAccessDeniedError,
  EventFinalizedError,
  InvalidFinalizationError,
} from './service';
import { PostgresAdminRepository } from './postgres-admin-repository';

const databaseUrl = process.env.DATABASE_URL;
const pool = databaseUrl ? new Pool({ connectionString: databaseUrl }) : null;

afterAll(async () => {
  await pool?.end();
});

describe.skipIf(!pool)('Postgres管理リポジトリ統合', () => {
  it('主催者メール変更で確認状態・旧リンク・未送信通知を同一トランザクションで失効する', async () => {
    const repository = new PostgresAdminRepository(pool!);
    const eventId = randomUUID();
    const responseId = randomUUID();
    const tokenHash = `admin-${randomUUID()}`;
    try {
      await pool!.query(
        `INSERT INTO events
           (id, title, description, organizer_email, admin_secret_hash,
            organizer_email_verified_at, notify_on_response)
         VALUES ($1, 'メール変更統合', '', 'old-owner@example.com', 'scrypt$test', now(), true)`,
        [eventId],
      );
      await repository.createSession({
        eventId,
        tokenHash,
        expiresAt: new Date(Date.now() + 60 * 60 * 1_000),
      });
      await pool!.query(
        `INSERT INTO email_verifications (event_id, token_hash, expires_at, verified_at)
         VALUES ($1, $2, now() + interval '1 hour', now())`,
        [eventId, `verification-${randomUUID()}`],
      );
      await pool!.query(
        `INSERT INTO responses (id, event_id, display_name, edit_secret_hash)
         VALUES ($1, $2, '参加者', 'edit-hash')`,
        [responseId, eventId],
      );
      await pool!.query(
        `INSERT INTO notification_outbox (event_id, response_id, kind, idempotency_key)
         VALUES ($1, $2, 'created', $3)`,
        [eventId, responseId, `email-change-${randomUUID()}`],
      );

      const updated = await repository.updateEvent({
        eventId,
        tokenHash,
        request: {
          title: 'メール変更統合', description: '',
          organizerEmail: 'new-owner@example.com', notifyOnResponse: true,
        },
      });

      expect(updated).toMatchObject({
        organizerEmail: 'new-owner@example.com', organizerEmailVerified: false, version: 2,
      });
      expect((await pool!.query(
        'SELECT id FROM email_verifications WHERE event_id = $1', [eventId],
      )).rows).toEqual([]);
      expect((await pool!.query(
        'SELECT id FROM notification_outbox WHERE event_id = $1', [eventId],
      )).rows).toEqual([]);
    } finally {
      await pool!.query('DELETE FROM events WHERE id = $1', [eventId]);
    }
  });

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
        request: {
          title: '更新後', description: '更新説明',
          organizerEmail: 'admin@example.com', notifyOnResponse: false,
        },
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

  it('候補枠差分、既存回答のng補完、確定枠保護を同一トランザクションで保つ', async () => {
    const repository = new PostgresAdminRepository(pool!);
    const eventId = randomUUID();
    const tokenHash = `admin-${randomUUID()}`;
    const retainedSlotId = randomUUID();
    const removedSlotId = randomUUID();
    const responseIds = [randomUUID(), randomUUID()];
    try {
      await pool!.query(
        `INSERT INTO events (id, title, description, organizer_email, admin_secret_hash)
         VALUES ($1, '候補枠統合', '', 'admin@example.com', 'scrypt$test')`,
        [eventId],
      );
      await repository.createSession({
        eventId,
        tokenHash,
        expiresAt: new Date(Date.now() + 60 * 60 * 1_000),
      });
      await pool!.query(
        `INSERT INTO candidate_slots (id, event_id, candidate_date, slot_index)
         VALUES ($1, $3, '2026-11-10', 18), ($2, $3, '2026-11-11', 19)`,
        [retainedSlotId, removedSlotId, eventId],
      );
      await pool!.query(
        `INSERT INTO responses (id, event_id, display_name, comment, edit_secret_hash)
         VALUES ($1, $3, '参加者1', '', 'hash-1'), ($2, $3, '参加者2', '', 'hash-2')`,
        [responseIds[0], responseIds[1], eventId],
      );
      await pool!.query(
        `INSERT INTO response_availability (response_id, candidate_slot_id, mark)
         VALUES ($1, $3, 'best'), ($1, $4, 'ok'), ($2, $3, 'maybe'), ($2, $4, 'ng')`,
        [responseIds[0], responseIds[1], retainedSlotId, removedSlotId],
      );

      const request = {
        candidateSlots: [{ date: '2026-11-10', slotIndexes: [18, 19, 20] }],
      };
      const replaced = await repository.replaceCandidateSlots({
        eventId,
        tokenHash,
        request,
      });
      const repeated = await repository.replaceCandidateSlots({
        eventId,
        tokenHash,
        request,
      });

      expect(replaced.version).toBe(2);
      expect(repeated.version).toBe(2);
      expect(replaced.candidateSlots.find(({ slotIndex }) => slotIndex === 18)?.id)
        .toBe(retainedSlotId);
      expect(replaced.candidateSlots.map(({ date, slotIndex }) => [date, slotIndex]))
        .toEqual([
          ['2026-11-10', 18],
          ['2026-11-10', 19],
          ['2026-11-10', 20],
        ]);
      const availability = await pool!.query<{
        response_id: string;
        slot_index: number;
        mark: string;
      }>(
        `SELECT a.response_id, c.slot_index, a.mark
         FROM response_availability a
         JOIN candidate_slots c ON c.id = a.candidate_slot_id
         WHERE c.event_id = $1
         ORDER BY a.response_id, c.slot_index`,
        [eventId],
      );
      expect(availability.rows).toHaveLength(6);
      for (const responseId of responseIds) {
        expect(availability.rows.filter((row) =>
          row.response_id === responseId && row.slot_index > 18))
          .toEqual([
            { response_id: responseId, slot_index: 19, mark: 'ng' },
            { response_id: responseId, slot_index: 20, mark: 'ng' },
          ]);
      }
      expect(availability.rows).not.toEqual(expect.arrayContaining([
        expect.objectContaining({ slot_index: 19, mark: 'ok' }),
      ]));

      await pool!.query(
        `UPDATE events
         SET final_date = '2026-11-10', final_start_slot = 18, final_end_slot = 21
         WHERE id = $1`,
        [eventId],
      );
      await expect(repository.replaceCandidateSlots({
        eventId,
        tokenHash,
        request: { candidateSlots: [{ date: '2026-11-10', slotIndexes: [18, 19] }] },
      })).rejects.toBeInstanceOf(EventFinalizedError);
      const afterRejected = await repository.getAdminEvent(eventId, tokenHash);
      expect(afterRejected).toMatchObject({
        version: 2,
        candidateSlots: expect.arrayContaining([
          expect.objectContaining({ date: '2026-11-10', slotIndex: 20 }),
        ]),
      });
    } finally {
      await pool!.query('DELETE FROM events WHERE id = $1', [eventId]);
    }
  });

  it('確定・解除の冪等性と論理削除時の全管理セッション失効を保つ', async () => {
    const repository = new PostgresAdminRepository(pool!);
    const eventId = randomUUID();
    const tokenHashes = [`admin-${randomUUID()}`, `admin-${randomUUID()}`];
    try {
      await pool!.query(
        `INSERT INTO events (id, title, description, organizer_email, admin_secret_hash)
         VALUES ($1, '確定統合', '', 'admin@example.com', 'scrypt$test')`,
        [eventId],
      );
      for (const tokenHash of tokenHashes) {
        await repository.createSession({
          eventId,
          tokenHash,
          expiresAt: new Date(Date.now() + 60 * 60 * 1_000),
        });
      }
      await pool!.query(
        `INSERT INTO candidate_slots (event_id, candidate_date, slot_index)
         VALUES ($1, '2026-11-10', 18), ($1, '2026-11-10', 19),
                ($1, '2026-11-10', 20), ($1, '2026-11-10', 22)`,
        [eventId],
      );

      await expect(repository.setFinalization({
        eventId,
        tokenHash: tokenHashes[0],
        request: { date: '2026-11-10', startSlot: 18, endSlot: 23 },
      })).rejects.toBeInstanceOf(InvalidFinalizationError);
      const afterInvalid = await repository.getAdminEvent(eventId, tokenHashes[0]);
      expect(afterInvalid).toMatchObject({ status: 'open', finalization: null, version: 1 });

      const request = { date: '2026-11-10', startSlot: 18, endSlot: 21 };
      const finalized = await repository.setFinalization({
        eventId,
        tokenHash: tokenHashes[0],
        request,
      });
      const finalizedAgain = await repository.setFinalization({
        eventId,
        tokenHash: tokenHashes[0],
        request,
      });
      expect(finalized).toMatchObject({ status: 'open', finalization: request, version: 2 });
      expect(finalizedAgain.version).toBe(2);

      const cleared = await repository.clearFinalization({
        eventId,
        tokenHash: tokenHashes[0],
      });
      const clearedAgain = await repository.clearFinalization({
        eventId,
        tokenHash: tokenHashes[0],
      });
      expect(cleared).toMatchObject({ finalization: null, version: 3 });
      expect(clearedAgain.version).toBe(3);

      await repository.deleteEvent({ eventId, tokenHash: tokenHashes[0] });
      await expect(repository.getAdminEvent(eventId, tokenHashes[0]))
        .rejects.toBeInstanceOf(AdminAccessDeniedError);
      await expect(repository.getAdminEvent(eventId, tokenHashes[1]))
        .rejects.toBeInstanceOf(AdminAccessDeniedError);
      const persisted = await pool!.query<{
        status: string;
        deleted: boolean;
        version: number;
        session_count: number;
      }>(
        `SELECT e.status, e.deleted_at IS NOT NULL AS deleted, e.version,
           count(s.token_hash)::int AS session_count
         FROM events e
         LEFT JOIN admin_sessions s ON s.event_id = e.id
         WHERE e.id = $1
         GROUP BY e.id`,
        [eventId],
      );
      expect(persisted.rows[0]).toEqual({
        status: 'deleted',
        deleted: true,
        version: 4,
        session_count: 0,
      });
    } finally {
      await pool!.query('DELETE FROM events WHERE id = $1', [eventId]);
    }
  });
});
