// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, afterEach, describe, expect, it } from 'vitest';

import { PostgresEventRepository } from '../events/postgres-event-repository';
import type { AvailabilityMark } from '../events/service';
import { PostgresResponseRepository } from './postgres-response-repository';
import {
  EventClosedError,
  EventNotFoundError,
  IdempotencyConflictError,
  InvalidAvailabilityError,
  ResponseNotFoundError,
} from './repository';
import type { CreateResponsePersistenceInput, ResponseRequest } from './service';

const databaseUrl = process.env.DATABASE_URL;
const pool = databaseUrl ? new Pool({ connectionString: databaseUrl }) : null;
const eventIds: string[] = [];

async function fixture(verified = true, notify = true) {
  const eventId = randomUUID();
  await pool!.query(
    `INSERT INTO events (id, title, organizer_email, admin_secret_hash,
                         organizer_email_verified_at, notify_on_response)
     VALUES ($1, 'response integration', 'response@example.com', 'test-admin-hash', $2, $3)`,
    [eventId, verified ? new Date() : null, notify],
  );
  eventIds.push(eventId);
  const slots = await pool!.query<{ id: string }>(
    `INSERT INTO candidate_slots (event_id, candidate_date, slot_index)
     VALUES ($1, '2027-01-12', 20), ($1, '2027-01-12', 21)
     RETURNING id`,
    [eventId],
  );
  const input: CreateResponsePersistenceInput = {
    eventId,
    responseId: randomUUID(),
    idempotencyKey: `response-integration-${randomUUID()}`,
    requestHash: 'a'.repeat(64),
    editTokenHash: 'b'.repeat(64),
    request: {
      displayName: '参加者',
      comment: 'よろしく',
      availability: slots.rows.map(({ id }, index) => ({
        candidateSlotId: id,
        mark: (index === 0 ? 'best' : 'ok') as AvailabilityMark,
      })),
    },
  };
  return { input, repository: new PostgresResponseRepository(pool!) };
}

async function stored(responseId: string) {
  const response = await pool!.query(
    `SELECT id, display_name, comment, edit_secret_hash, version, created_at, updated_at
     FROM responses WHERE id = $1`,
    [responseId],
  );
  const availability = await pool!.query(
    `SELECT candidate_slot_id, mark FROM response_availability
     WHERE response_id = $1 ORDER BY candidate_slot_id`,
    [responseId],
  );
  const outbox = await pool!.query(
    `SELECT kind, idempotency_key FROM notification_outbox
     WHERE response_id = $1 ORDER BY created_at, idempotency_key`,
    [responseId],
  );
  return { response: response.rows[0], availability: availability.rows, outbox: outbox.rows };
}

afterEach(async () => {
  if (eventIds.length === 0) return;
  await pool!.query('DELETE FROM idempotency_keys WHERE scope = ANY($1::text[])', [
    eventIds.map((id) => `create-response:${id}`),
  ]);
  await pool!.query('DELETE FROM events WHERE id = ANY($1::uuid[])', [eventIds]);
  eventIds.length = 0;
});

afterAll(async () => {
  await pool?.end();
});

describe.skipIf(!pool)('Postgres回答リポジトリ統合', () => {
  it('全候補枠とハッシュを保存し、version 1と新規通知を確定する', async () => {
    const { input, repository } = await fixture();
    const result = await repository.createResponse(input);
    const snapshot = await stored(input.responseId);
    expect(result.response).toMatchObject({
      id: input.responseId,
      displayName: '参加者',
      comment: 'よろしく',
      availability: expect.arrayContaining(input.request.availability),
    });
    expect(result.response.availability).toHaveLength(2);
    expect(snapshot.response).toMatchObject({ version: 1, edit_secret_hash: 'b'.repeat(64) });
    expect(snapshot.availability).toHaveLength(2);
    expect(snapshot.outbox).toEqual([
      { kind: 'created', idempotency_key: `response-created:${input.responseId}` },
    ]);
    const publicEvent = await new PostgresEventRepository(pool!).getPublicEvent(input.eventId);
    expect(publicEvent?.responses).toEqual([result.response]);
    expect(JSON.stringify(result)).not.toContain(input.editTokenHash);
    const key = await pool!.query(
      'SELECT status_code, response_body FROM idempotency_keys WHERE scope = $1 AND idempotency_key = $2',
      [`create-response:${input.eventId}`, input.idempotencyKey],
    );
    expect(key.rows[0]).toEqual({ status_code: 201, response_body: { responseId: input.responseId } });
    expect(JSON.stringify(key.rows[0])).not.toContain(input.editTokenHash);
  });

  it('同じ冪等キーの同時再送は新規ID提案が違っても同じ回答と通知1件を返す', async () => {
    const { input, repository } = await fixture();
    const results = await Promise.all(
      Array.from({ length: 4 }, () => repository.createResponse({ ...input, responseId: randomUUID() })),
    );
    for (const result of results) expect(result).toEqual(results[0]);
    expect(await repository.createResponse(input)).toEqual(results[0]);
    const rows = await pool!.query('SELECT id FROM responses WHERE event_id = $1', [input.eventId]);
    expect(rows.rows).toEqual([{ id: results[0].response.id }]);
    expect((await stored(results[0].response.id)).outbox).toHaveLength(1);
    await expect(repository.createResponse({ ...input, requestHash: 'c'.repeat(64) }))
      .rejects.toBeInstanceOf(IdempotencyConflictError);
    expect((await stored(results[0].response.id)).response.version).toBe(1);
  });

  it('更新後の新規登録再送は保存IDから現在の回答を返す', async () => {
    const { input, repository } = await fixture();
    await repository.createResponse(input);
    const updated = await repository.updateResponse({ responseId: input.responseId,
      editTokenHash: input.editTokenHash, request: { ...input.request, comment: '編集後' } });
    expect(await repository.createResponse({ ...input, responseId: randomUUID() })).toEqual(updated);
    expect((await stored(input.responseId)).outbox).toHaveLength(2);
  });

  it.each(['closed', 'deleted', 'soft-deleted', 'hard-deleted'] as const)(
    '%sイベントでは成功済みの同一キー・同一本文の再送も拒否する', async (status) => {
      const { input, repository } = await fixture();
      await repository.createResponse(input);
      if (status === 'hard-deleted') {
        await pool!.query('DELETE FROM events WHERE id = $1', [input.eventId]);
      } else {
        await pool!.query('UPDATE events SET status = $2, deleted_at = $3 WHERE id = $1',
          [input.eventId, status === 'soft-deleted' ? 'open' : status,
            status === 'soft-deleted' ? new Date() : null]);
      }
      const before = await stored(input.responseId);
      const keyBefore = await pool!.query(
        'SELECT * FROM idempotency_keys WHERE scope = $1 AND idempotency_key = $2',
        [`create-response:${input.eventId}`, input.idempotencyKey],
      );
      expect(keyBefore.rows[0].response_body).toEqual({ responseId: input.responseId });
      await expect(repository.createResponse({ ...input, responseId: randomUUID() }))
        .rejects.toBeInstanceOf(status === 'closed' ? EventClosedError : EventNotFoundError);
      expect(await stored(input.responseId)).toEqual(before);
      const keyAfter = await pool!.query(
        'SELECT * FROM idempotency_keys WHERE scope = $1 AND idempotency_key = $2',
        [`create-response:${input.eventId}`, input.idempotencyKey],
      );
      expect(keyAfter.rows).toEqual(keyBefore.rows);
    },
  );

  it('再送は回答ロックを待つ間にイベントをロックせず更新と同じ順序で取得する', async () => {
    const { input, repository } = await fixture();
    const created = await repository.createResponse(input);
    const before = await stored(input.responseId);
    const replayPool = new Pool({ connectionString: databaseUrl, max: 1 });
    const session = await replayPool.query<{ pid: number }>('SELECT pg_backend_pid() AS pid');
    const blocker = await pool!.connect();
    let replay: Promise<unknown> | undefined;
    try {
      await blocker.query('BEGIN');
      // Model the update lock order: response first, then event.
      await blocker.query('SELECT id FROM responses WHERE id = $1 FOR UPDATE', [input.responseId]);
      replay = new PostgresResponseRepository(replayPool).createResponse(input);
      // Observe the actual blocked query instead of relying on a scheduling delay.
      const deadline = Date.now() + 3000;
      let blockedQuery: string | undefined;
      while (Date.now() < deadline) {
        const activity = await pool!.query<{ query: string; wait_event_type: string | null }>(
          'SELECT query, wait_event_type FROM pg_stat_activity WHERE pid = $1', [session.rows[0].pid],
        );
        if (activity.rows[0]?.wait_event_type === 'Lock') {
          blockedQuery = activity.rows[0].query;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(blockedQuery).toMatch(/FROM responses/);
      // An event-first replay would hold FOR SHARE and make this fail with 55P03.
      await blocker.query('SELECT id FROM events WHERE id = $1 FOR UPDATE NOWAIT', [input.eventId]);
      await blocker.query('COMMIT');
      expect(await replay).toEqual(created);
      expect(await stored(input.responseId)).toEqual(before);
    } finally {
      await blocker.query('ROLLBACK');
      blocker.release();
      await replay?.catch(() => undefined);
      await replayPool.end();
    }
  });

  it('同じキーの異内容同時送信は片方だけ保存し片方は競合する', async () => {
    const { input, repository } = await fixture();
    const results = await Promise.allSettled([
      repository.createResponse(input),
      repository.createResponse({ ...input, responseId: randomUUID(), requestHash: 'c'.repeat(64),
        request: { ...input.request, comment: '別内容' } }),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const failure = results.find((result) => result.status === 'rejected');
    expect(failure?.status === 'rejected' && failure.reason).toBeInstanceOf(IdempotencyConflictError);
    expect((await pool!.query('SELECT id FROM responses WHERE event_id = $1', [input.eventId])).rowCount).toBe(1);
  });

  it('冪等キーのスコープはイベントごとに独立する', async () => {
    const first = await fixture();
    const second = await fixture();
    await first.repository.createResponse(first.input);
    const result = await second.repository.createResponse({
      ...second.input, idempotencyKey: first.input.idempotencyKey, requestHash: 'c'.repeat(64),
    });
    expect(result.response.id).toBe(second.input.responseId);
  });

  it('UUIDの大文字小文字でも同じイベントの冪等スコープを使う', async () => {
    const { input, repository } = await fixture();
    const created = await repository.createResponse(input);
    const replayed = await repository.createResponse({ ...input, eventId: input.eventId.toUpperCase(),
      responseId: randomUUID() });
    expect(replayed).toEqual(created);
    expect((await pool!.query('SELECT id FROM responses WHERE event_id = $1', [input.eventId])).rowCount).toBe(1);
  });

  it('期限切れの冪等キーは新しい回答に再利用できる', async () => {
    const { input, repository } = await fixture();
    await repository.createResponse(input);
    await pool!.query(
      `UPDATE idempotency_keys SET created_at = now() - interval '2 days',
         expires_at = now() - interval '1 day'
       WHERE scope = $1 AND idempotency_key = $2`,
      [`create-response:${input.eventId}`, input.idempotencyKey],
    );
    const responseId = randomUUID();
    const result = await repository.createResponse({ ...input, responseId, requestHash: 'c'.repeat(64) });
    expect(result.response.id).toBe(responseId);
    expect((await pool!.query('SELECT id FROM responses WHERE event_id = $1', [input.eventId])).rowCount).toBe(2);
  });

  it.each([
    ['未認証・通知ON', false, true],
    ['認証済・通知OFF', true, false],
    ['未認証・通知OFF', false, false],
  ])('%sでは新規・更新通知を作らない', async (_label, verified, notify) => {
    const { input, repository } = await fixture(verified, notify);
    await repository.createResponse(input);
    await repository.updateResponse({
      responseId: input.responseId, editTokenHash: input.editTokenHash,
      request: { ...input.request, comment: '変更' },
    });
    expect((await stored(input.responseId)).outbox).toEqual([]);
    expect((await stored(input.responseId)).response.version).toBe(2);
  });

  it.each(['missing', 'duplicate', 'foreign', 'extra', 'empty'] as const)(
    '候補枠の%sを拒否し回答・冪等キー・通知を保存しない', async (kind) => {
      const { input, repository } = await fixture();
      const other = await fixture();
      const [first, second] = input.request.availability;
      const foreign = other.input.request.availability[0];
      const values = {
        missing: [first], duplicate: [first, first], foreign: [first, foreign],
        extra: [first, second, foreign], empty: [],
      };
      await expect(repository.createResponse({
        ...input, request: { ...input.request, availability: values[kind] },
      })).rejects.toBeInstanceOf(InvalidAvailabilityError);
      expect(await stored(input.responseId)).toEqual({ response: undefined, availability: [], outbox: [] });
      expect((await pool!.query('SELECT 1 FROM idempotency_keys WHERE scope = $1',
        [`create-response:${input.eventId}`])).rowCount).toBe(0);
      await repository.createResponse(input);
    },
  );

  it('正しいハッシュで回答と枠を変更しversion 2と更新通知を保存する', async () => {
    const { input, repository } = await fixture();
    const created = await repository.createResponse(input);
    const request: ResponseRequest = {
      displayName: '変更後', comment: '変更コメント',
      availability: input.request.availability.map((value) => ({ ...value, mark: 'ng' })),
    };
    const result = await repository.updateResponse({ responseId: input.responseId,
      editTokenHash: input.editTokenHash, request });
    expect(result.response).toMatchObject({ ...request, id: input.responseId,
      createdAt: created.response.createdAt, availability: expect.arrayContaining(request.availability) });
    expect(result.response.availability).toHaveLength(2);
    const snapshot = await stored(input.responseId);
    expect(snapshot.response).toMatchObject({ version: 2, display_name: '変更後', comment: '変更コメント' });
    expect(snapshot.availability.every((value) => value.mark === 'ng')).toBe(true);
    expect(snapshot.outbox).toEqual([
      { kind: 'created', idempotency_key: `response-created:${input.responseId}` },
      { kind: 'updated', idempotency_key: `response-updated:${input.responseId}:2` },
    ]);
    expect(Object.keys(result)).toEqual(['response']);
    expect(JSON.stringify(result)).not.toContain(input.editTokenHash);
  });

  it.each(['displayName', 'availability'] as const)('%sだけの変更も保存する', async (field) => {
    const { input, repository } = await fixture();
    await repository.createResponse(input);
    const request: ResponseRequest = field === 'displayName'
      ? { ...input.request, displayName: '名前のみ変更' }
      : { ...input.request, availability: input.request.availability.map((value) => ({ ...value, mark: 'maybe' })) };
    const result = await repository.updateResponse({ responseId: input.responseId,
      editTokenHash: input.editTokenHash, request });
    expect(result.response).toMatchObject({ ...request, availability: expect.arrayContaining(request.availability) });
    const snapshot = await stored(input.responseId);
    expect(snapshot.response.version).toBe(2);
    expect(snapshot.outbox).toHaveLength(2);
  });

  it('枠順序だけ違う同一内容はupdated_at・version・通知・枠行を変更しない', async () => {
    const { input, repository } = await fixture();
    const created = await repository.createResponse(input);
    const before = await stored(input.responseId);
    const tupleBefore = await pool!.query('SELECT ctid::text FROM response_availability WHERE response_id = $1 ORDER BY candidate_slot_id', [input.responseId]);
    const result = await repository.updateResponse({ responseId: input.responseId,
      editTokenHash: input.editTokenHash,
      request: { ...input.request, availability: [...input.request.availability].reverse() } });
    expect(result).toEqual(created);
    expect(await stored(input.responseId)).toEqual(before);
    const tupleAfter = await pool!.query('SELECT ctid::text FROM response_availability WHERE response_id = $1 ORDER BY candidate_slot_id', [input.responseId]);
    expect(tupleAfter.rows).toEqual(tupleBefore.rows);
  });

  it('同一変更の同時更新は1回だけversionを増やし通知も1件だけ追加する', async () => {
    const { input, repository } = await fixture();
    await repository.createResponse(input);
    const update = { responseId: input.responseId, editTokenHash: input.editTokenHash,
      request: { ...input.request, comment: '同時更新' } };
    const results = await Promise.all([repository.updateResponse(update), repository.updateResponse(update)]);
    expect(results[0]).toEqual(results[1]);
    const snapshot = await stored(input.responseId);
    expect(snapshot.response.version).toBe(2);
    expect(snapshot.outbox.filter((row) => row.kind === 'updated')).toHaveLength(1);
  });

  it('異なる同時更新は直列化し連続versionの通知をそれぞれ保存する', async () => {
    const { input, repository } = await fixture();
    await repository.createResponse(input);
    const results = await Promise.all(['変更A', '変更B'].map((comment) => repository.updateResponse({
      responseId: input.responseId, editTokenHash: input.editTokenHash,
      request: { ...input.request, comment },
    })));
    expect(results.map((result) => result.response.comment).sort()).toEqual(['変更A', '変更B']);
    const snapshot = await stored(input.responseId);
    expect(snapshot.response.version).toBe(3);
    expect(snapshot.outbox.map((row) => row.idempotency_key).sort()).toEqual([
      `response-created:${input.responseId}`,
      `response-updated:${input.responseId}:2`,
      `response-updated:${input.responseId}:3`,
    ]);
  });

  it.each(['c'.repeat(64), '', 'b', 'z'.repeat(64), 'b'.repeat(63), 'b'.repeat(65)])(
    '不正ハッシュ(%s)は存在を隠すエラーとなり変更を保存しない', async (editTokenHash) => {
      const { input, repository } = await fixture();
      await repository.createResponse(input);
      const before = await stored(input.responseId);
      await expect(repository.updateResponse({ responseId: input.responseId, editTokenHash,
        request: { ...input.request, comment: '攻撃' } })).rejects.toBeInstanceOf(ResponseNotFoundError);
      expect(await stored(input.responseId)).toEqual(before);
    },
  );

  it('保存済みハッシュが壊れていても例外を漏らさず存在を隠す', async () => {
    const { input, repository } = await fixture();
    await repository.createResponse(input);
    await pool!.query('UPDATE responses SET edit_secret_hash = $2 WHERE id = $1', [input.responseId, 'bad-hash']);
    await expect(repository.updateResponse({ responseId: input.responseId,
      editTokenHash: input.editTokenHash, request: input.request }))
      .rejects.toBeInstanceOf(ResponseNotFoundError);
    expect((await stored(input.responseId)).response.version).toBe(1);
  });

  it('未知の回答IDでも不正ハッシュと同じエラーを返す', async () => {
    const { input, repository } = await fixture();
    await expect(repository.updateResponse({ responseId: randomUUID(),
      editTokenHash: input.editTokenHash, request: input.request }))
      .rejects.toBeInstanceOf(ResponseNotFoundError);
  });

  it('更新でも枠不足・重複・別イベント枠を拒否し既存の回答を保つ', async () => {
    const { input, repository } = await fixture();
    const other = await fixture();
    await repository.createResponse(input);
    const before = await stored(input.responseId);
    for (const availability of [
      input.request.availability.slice(0, 1),
      [input.request.availability[0], input.request.availability[0]],
      [input.request.availability[0], other.input.request.availability[0]],
    ]) {
      await expect(repository.updateResponse({ responseId: input.responseId,
        editTokenHash: input.editTokenHash, request: { ...input.request, availability } }))
        .rejects.toBeInstanceOf(InvalidAvailabilityError);
      expect(await stored(input.responseId)).toEqual(before);
    }
  });

  it.each(['closed', 'deleted', 'soft-deleted'] as const)(
    '%sイベントの新規・更新は拒否し認証不正なら存在を隠す', async (status) => {
      const { input, repository } = await fixture();
      await repository.createResponse(input);
      await pool!.query('UPDATE events SET status = $2, deleted_at = $3 WHERE id = $1',
        [input.eventId, status === 'soft-deleted' ? 'open' : status,
          status === 'soft-deleted' ? new Date() : null]);
      const expectedError = status === 'closed' ? EventClosedError : EventNotFoundError;
      await expect(repository.createResponse({ ...input, responseId: randomUUID(),
        idempotencyKey: `fresh-${randomUUID()}` })).rejects.toBeInstanceOf(expectedError);
      const before = await stored(input.responseId);
      await expect(repository.updateResponse({ responseId: input.responseId,
        editTokenHash: input.editTokenHash, request: input.request })).rejects.toBeInstanceOf(expectedError);
      await expect(repository.updateResponse({ responseId: input.responseId,
        editTokenHash: 'c'.repeat(64), request: input.request })).rejects.toBeInstanceOf(ResponseNotFoundError);
      expect(await stored(input.responseId)).toEqual(before);
    },
  );

  it('存在しないイベントへの登録は404用エラーとし冪等キーも残さない', async () => {
    const { input, repository } = await fixture();
    const eventId = randomUUID();
    await expect(repository.createResponse({ ...input, eventId })).rejects.toBeInstanceOf(EventNotFoundError);
    expect((await pool!.query('SELECT 1 FROM idempotency_keys WHERE scope = $1',
      [`create-response:${eventId}`])).rowCount).toBe(0);
  });

  it('通知登録に失敗した新規回答は枠・回答・冪等キーと共にロールバックする', async () => {
    const { input, repository } = await fixture();
    await repository.createResponse(input);
    const failedId = randomUUID();
    const key = `failed-${randomUUID()}`;
    await pool!.query(
      `INSERT INTO notification_outbox (event_id, response_id, kind, idempotency_key)
       VALUES ($1, $2, 'created', $3)`,
      [input.eventId, input.responseId, `response-created:${failedId}`],
    );
    await expect(repository.createResponse({ ...input, responseId: failedId, idempotencyKey: key }))
      .rejects.toBeTruthy();
    expect(await stored(failedId)).toEqual({ response: undefined, availability: [], outbox: [] });
    expect((await pool!.query('SELECT 1 FROM idempotency_keys WHERE scope = $1 AND idempotency_key = $2',
      [`create-response:${input.eventId}`, key])).rowCount).toBe(0);
  });

  it('通知登録に失敗した更新は回答・枠・versionをロールバックする', async () => {
    const { input, repository } = await fixture();
    await repository.createResponse(input);
    await pool!.query(
      `INSERT INTO notification_outbox (event_id, response_id, kind, idempotency_key)
       VALUES ($1, $2, 'updated', $3)`,
      [input.eventId, input.responseId, `response-updated:${input.responseId}:2`],
    );
    const before = await stored(input.responseId);
    await expect(repository.updateResponse({ responseId: input.responseId,
      editTokenHash: input.editTokenHash, request: { ...input.request, comment: '失敗する変更',
        availability: input.request.availability.map((value) => ({ ...value, mark: 'ng' })) } }))
      .rejects.toBeTruthy();
    expect(await stored(input.responseId)).toEqual(before);
  });

  it('versionのDB制約は0への更新を拒否する', async () => {
    const { input, repository } = await fixture();
    await repository.createResponse(input);
    await expect(pool!.query('UPDATE responses SET version = 0 WHERE id = $1', [input.responseId]))
      .rejects.toMatchObject({ code: '23514' });
  });
});
