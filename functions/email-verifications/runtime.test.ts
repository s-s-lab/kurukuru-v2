// @vitest-environment node
import type { Pool } from 'pg';
import { describe, expect, it, vi } from 'vitest';

import { PostgresEmailVerificationRepository } from './postgres-email-verification-repository';
import { createRuntimeApp } from '../runtime';

const eventId = '9bed1489-b31f-4b6d-8dcb-e8d95109f98c';

function poolFake(): Pool {
  return {
    query: vi.fn(async () => ({ rows: [{ request_count: 1, retry_after_seconds: 60 }] })),
  } as unknown as Pool;
}

describe('メール確認ランタイム構成', () => {
  it('任意のメール設定がなくても起動し対象ルートだけ503にする', async () => {
    const app = createRuntimeApp({
      DATABASE_URL: 'postgresql://runtime.example/kurukuru',
      KURUKURU_TOKEN_SECRET: 's'.repeat(32),
    }, { createPool: poolFake });

    const response = await app.request(`/api/v1/events/${eventId}/email-verifications`, {
      method: 'POST',
      headers: { authorization: 'Bearer session-token-value' },
    });
    expect(response.status).toBe(503);
  });

  it('完全な設定からPostgres確認処理とResend送信を配線する', async () => {
    const prepareSend = vi.spyOn(PostgresEmailVerificationRepository.prototype, 'prepareSend')
      .mockResolvedValue({
        status: 'ready',
        eventTitle: '研究会',
        organizerEmail: 'organizer@example.com',
      });
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ id: 'resend-message-id' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));
    try {
      const app = createRuntimeApp({
        DATABASE_URL: 'postgresql://runtime.example/kurukuru',
        KURUKURU_TOKEN_SECRET: 's'.repeat(32),
        RESEND_API_KEY: 're_test_key',
        KURUKURU_MAIL_FROM: 'Kurukuru <no-reply@notify.kurukuru-app.jp>',
        KURUKURU_PUBLIC_BASE_URL: 'https://kurukuru-app.jp',
      }, { createPool: poolFake, fetcher });

      const response = await app.request(`/api/v1/events/${eventId}/email-verifications`, {
        method: 'POST',
        headers: { authorization: 'Bearer session-token-value' },
      });

      expect(response.status).toBe(202);
      expect(prepareSend).toHaveBeenCalledWith(expect.objectContaining({ eventId }));
      expect(fetcher).toHaveBeenCalledWith('https://api.resend.com/emails', expect.objectContaining({ method: 'POST' }));
    } finally {
      prepareSend.mockRestore();
    }
  });

  it('一部だけのメール設定は安全のため無効として扱う', async () => {
    const app = createRuntimeApp({
      DATABASE_URL: 'postgresql://runtime.example/kurukuru',
      KURUKURU_TOKEN_SECRET: 's'.repeat(32),
      RESEND_API_KEY: 're_test_key',
    }, { createPool: poolFake });
    const response = await app.request(`/api/v1/events/${eventId}/email-verifications`, {
      method: 'POST',
      headers: { authorization: 'Bearer session-token-value' },
    });
    expect(response.status).toBe(503);
  });
});
