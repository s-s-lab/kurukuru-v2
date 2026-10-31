// @vitest-environment node
import type { Pool } from 'pg';
import { describe, expect, it } from 'vitest';

import { PostgresResponseRepository } from './postgres-response-repository';
import { EventClosedError, EventNotFoundError } from './repository';
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

describe('回答リポジトリの再送ライフサイクル', () => {
  it.each(['closed', 'deleted', 'soft-deleted', 'hard-deleted'] as const)(
    '%sでは保存済みIDの再送でも現在のイベント状態を返す', async (state) => {
      const repository = new PostgresResponseRepository(replayPool(state));
      await expect(repository.createResponse(input))
        .rejects.toBeInstanceOf(state === 'closed' ? EventClosedError : EventNotFoundError);
    },
  );
});
