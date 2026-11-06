// @vitest-environment node
import type { Pool } from 'pg';
import { describe, expect, it } from 'vitest';

import { PostgresResponseRepository } from './postgres-response-repository';
import { EventClosedError, EventNotFoundError, ResponseNotFoundError } from './repository';
import type { CreateResponsePersistenceInput } from './service';

const input: CreateResponsePersistenceInput = {
  eventId: '11111111-1111-4111-8111-111111111111',
  responseId: '22222222-2222-4222-8222-222222222222',
  idempotencyKey: 'replay-lifecycle-test-key',
  requestHash: 'a'.repeat(64),
  editTokenHash: 'b'.repeat(64),
  request: {
    displayName: '参加者', comment: '',
    availability: [{ candidateSlotId: '33333333-3333-4333-8333-333333333333', mark: 'ok' }],
  },
};

// The pg boundary is scripted because local PostgreSQL is unavailable. These cases
// verify repository error mapping only; real locks/side effects have integration coverage.
function replayPool(state: 'closed' | 'deleted' | 'soft-deleted' | 'hard-deleted'): Pool {
  const client = {
    async query(sql: string) {
      if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(sql) || /^\s*DELETE FROM idempotency_keys/.test(sql)) {
        return { rows: [], rowCount: 0 };
      }
      if (/^\s*INSERT INTO idempotency_keys/.test(sql)) return { rows: [], rowCount: 0 };
      if (/^\s*SELECT request_hash, status_code, response_body/.test(sql)) {
        return { rows: [{ request_hash: input.requestHash, status_code: 201,
          response_body: { responseId: input.responseId } }], rowCount: 1 };
      }
      if (/^\s*SELECT \* FROM responses/.test(sql)) {
        return { rows: state === 'hard-deleted' ? [] : [{
          id: input.responseId, event_id: input.eventId, display_name: '参加者', comment: '',
          edit_secret_hash: input.editTokenHash, version: 1,
          created_at: new Date('2026-10-30T00:00:00.000Z'),
          updated_at: new Date('2026-10-30T00:00:00.000Z'),
        }], rowCount: state === 'hard-deleted' ? 0 : 1 };
      }
      if (/^\s*SELECT status, deleted_at, notify_on_response, organizer_email_verified_at/.test(sql)) {
        return { rows: state === 'hard-deleted' ? [] : [{
          status: state === 'soft-deleted' ? 'open' : state,
          deleted_at: state === 'soft-deleted' ? new Date('2026-10-30T01:00:00Z') : null,
          notify_on_response: true, organizer_email_verified_at: new Date('2026-10-30T00:00:00Z'),
          notification_generation: 1,
        }], rowCount: state === 'hard-deleted' ? 0 : 1 };
      }
      if (/^\s*SELECT candidate_slot_id, mark FROM response_availability/.test(sql)) {
        return { rows: [{ candidate_slot_id: input.request.availability[0].candidateSlotId, mark: 'ok' }], rowCount: 1 };
      }
      throw new Error(`Unexpected persistence operation: ${sql}`);
    },
    release() { return undefined; },
  };
  return { async connect() { return client; } } as unknown as Pool;
}

function creationPool(queries: Array<{ sql: string; parameters?: unknown[] }>): Pool {
  const response = {
    id: input.responseId,
    event_id: input.eventId,
    display_name: input.request.displayName,
    comment: input.request.comment,
    edit_secret_hash: input.editTokenHash,
    version: 1,
    created_at: new Date('2026-11-04T00:00:00.000Z'),
    updated_at: new Date('2026-11-04T00:00:00.000Z'),
  };
  const client = {
    async query(sql: string, parameters?: unknown[]) {
      queries.push({ sql, parameters });
      if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(sql)) return { rows: [], rowCount: 0 };
      if (/^\s*DELETE FROM idempotency_keys/.test(sql)) return { rows: [], rowCount: 0 };
      if (/^\s*INSERT INTO idempotency_keys/.test(sql)) return { rows: [{}], rowCount: 1 };
      if (/^\s*SELECT status, deleted_at, notify_on_response/.test(sql)) {
        return { rows: [{
          status: 'open', deleted_at: null, notify_on_response: true,
          organizer_email_verified_at: new Date('2026-11-04T00:00:00.000Z'),
          notification_generation: 7,
        }], rowCount: 1 };
      }
      if (/SELECT id FROM candidate_slots/.test(sql)) {
        return { rows: [{ id: input.request.availability[0].candidateSlotId }], rowCount: 1 };
      }
      if (/^\s*INSERT INTO responses/.test(sql)) return { rows: [response], rowCount: 1 };
      if (/^\s*INSERT INTO response_availability/.test(sql)) return { rows: [], rowCount: 1 };
      if (/^\s*INSERT INTO notification_outbox/.test(sql)) return { rows: [], rowCount: 1 };
      if (/^\s*UPDATE idempotency_keys/.test(sql)) return { rows: [], rowCount: 1 };
      throw new Error(`Unexpected persistence operation: ${sql}`);
    },
    release() { return undefined; },
  };
  return { async connect() { return client; } } as unknown as Pool;
}

function publicUpdatePool(queries: Array<{ sql: string; parameters?: unknown[] }>, missing = false): Pool {
  const response = {
    id: input.responseId,
    event_id: input.eventId,
    display_name: '変更前',
    comment: '',
    edit_secret_hash: input.editTokenHash,
    version: 1,
    created_at: new Date('2026-11-04T00:00:00.000Z'),
    updated_at: new Date('2026-11-04T00:00:00.000Z'),
    status: 'open',
    deleted_at: null,
    notify_on_response: false,
    organizer_email_verified_at: null,
    notification_generation: 1,
  };
  const client = {
    async query(sql: string, parameters?: unknown[]) {
      queries.push({ sql, parameters });
      if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(sql)) return { rows: [], rowCount: 0 };
      if (/FROM responses r JOIN events/.test(sql)) {
        return { rows: missing ? [] : [response], rowCount: missing ? 0 : 1 };
      }
      if (/SELECT id FROM candidate_slots/.test(sql)) {
        return { rows: [{ id: input.request.availability[0].candidateSlotId }], rowCount: 1 };
      }
      if (/SELECT candidate_slot_id, mark FROM response_availability/.test(sql)) {
        return { rows: [{ candidate_slot_id: input.request.availability[0].candidateSlotId, mark: 'ng' }], rowCount: 1 };
      }
      if (/UPDATE responses SET/.test(sql)) {
        return { rows: [{ ...response, display_name: input.request.displayName, version: 2 }], rowCount: 1 };
      }
      if (/DELETE FROM response_availability/.test(sql) || /INSERT INTO response_availability/.test(sql)) {
        return { rows: [], rowCount: 1 };
      }
      throw new Error(`Unexpected persistence operation: ${sql}`);
    },
    release() { return undefined; },
  };
  return { async connect() { return client; } } as unknown as Pool;
}

describe('回答リポジトリの再送ライフサイクル', () => {
  it('通知予約へ現在の通知世代を固定する', async () => {
    const queries: Array<{ sql: string; parameters?: unknown[] }> = [];
    await new PostgresResponseRepository(creationPool(queries)).createResponse(input);
    const enqueue = queries.find(({ sql }) => /INSERT INTO notification_outbox/.test(sql));
    expect(enqueue?.sql).toContain('notification_generation');
    expect(enqueue?.parameters).toEqual([
      input.eventId,
      input.responseId,
      'created',
      `response-created:${input.responseId}`,
      7,
    ]);
  });

  it.each(['closed', 'deleted', 'soft-deleted', 'hard-deleted'] as const)(
    '%sでは保存済みIDの再送でも現在のイベント状態を返す', async (state) => {
      const repository = new PostgresResponseRepository(replayPool(state));
      await expect(repository.createResponse(input))
        .rejects.toBeInstanceOf(state === 'closed' ? EventClosedError : EventNotFoundError);
    },
  );
});

describe('公開回答編集', () => {
  it('回答が指定イベントに属するときトークンなしで更新する', async () => {
    const queries: Array<{ sql: string; parameters?: unknown[] }> = [];
    const result = await new PostgresResponseRepository(publicUpdatePool(queries))
      .updatePublicResponse({ eventId: input.eventId, responseId: input.responseId, request: input.request });

    expect(result.response).toMatchObject({ id: input.responseId, displayName: '参加者' });
    expect(queries.find(({ sql }) => /FROM responses r JOIN events/.test(sql))?.parameters)
      .toEqual([input.responseId, input.eventId]);
    expect(queries.at(-1)?.sql).toBe('COMMIT');
  });

  it('イベントと回答の組み合わせが一致しない場合は存在を隠す', async () => {
    const queries: Array<{ sql: string; parameters?: unknown[] }> = [];
    await expect(new PostgresResponseRepository(publicUpdatePool(queries, true))
      .updatePublicResponse({ eventId: input.eventId, responseId: input.responseId, request: input.request }))
      .rejects.toBeInstanceOf(ResponseNotFoundError);
    expect(queries.at(-1)?.sql).toBe('ROLLBACK');
  });
});
