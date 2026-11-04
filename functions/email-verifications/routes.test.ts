// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import { createApp } from '../app';
import { EmailVerificationNotFoundError } from './repository';
import type { EmailVerificationService } from './service';

const eventId = '9bed1489-b31f-4b6d-8dcb-e8d95109f98c';

function serviceFake(): EmailVerificationService {
  return {
    send: vi.fn(async () => ({ status: 'sent' as const })),
    verify: vi.fn(async () => ({ eventId, status: 'verified' as const })),
  };
}

describe('メール確認API', () => {
  it('管理セッションで確認メールを送りno-storeの202を返す', async () => {
    const service = serviceFake();
    const app = createApp({ allowedOrigins: [], emailVerificationService: service });
    const response = await app.request(`/api/v1/events/${eventId}/email-verifications`, {
      method: 'POST',
      headers: { authorization: 'Bearer admin-session-token' },
    });

    expect(response.status).toBe(202);
    expect(response.headers.get('cache-control')).toBe('no-store');
    await expect(response.json()).resolves.toEqual({ status: 'sent' });
    expect(service.send).toHaveBeenCalledWith({ eventId, sessionToken: 'admin-session-token' });
  });

  it('確認済みなら200で同じ状態を返す', async () => {
    const service = serviceFake();
    vi.mocked(service.send).mockResolvedValue({ status: 'already-verified' });
    const app = createApp({ allowedOrigins: [], emailVerificationService: service });
    const response = await app.request(`/api/v1/events/${eventId}/email-verifications`, {
      method: 'POST',
      headers: { authorization: 'Bearer admin-session-token' },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: 'already-verified' });
  });

  it('公開トークンを確認してイベントIDだけを返す', async () => {
    const service = serviceFake();
    const app = createApp({ allowedOrigins: [], emailVerificationService: service });
    const response = await app.request('/api/v1/email-verifications/opaque-verification-token');

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    await expect(response.json()).resolves.toEqual({ eventId, status: 'verified' });
  });

  it('無効・期限切れトークンを固定404で返す', async () => {
    const service = serviceFake();
    vi.mocked(service.verify).mockRejectedValue(new EmailVerificationNotFoundError());
    const app = createApp({ allowedOrigins: [], emailVerificationService: service });
    const response = await app.request('/api/v1/email-verifications/expired-token-value');

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ code: 'EMAIL_VERIFICATION_NOT_FOUND' });
  });

  it('メール構成がない場合も既存APIを起動し対象ルートだけ503にする', async () => {
    const app = createApp({ allowedOrigins: [] });
    const health = await app.request('/api/v1/health');
    const send = await app.request(`/api/v1/events/${eventId}/email-verifications`, {
      method: 'POST',
      headers: { authorization: 'Bearer admin-session-token' },
    });

    expect(health.status).toBe(200);
    expect(send.status).toBe(503);
    await expect(send.json()).resolves.toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
  });

  it('送信をイベント単位で制限する', async () => {
    const service = serviceFake();
    const rateLimiter = {
      check: vi.fn(async (request: { scope: string }) => ({
        allowed: request.scope !== 'send-email-verification-event',
        retryAfterSeconds: 180,
      })),
    };
    const app = createApp({ allowedOrigins: [], emailVerificationService: service, rateLimiter });
    const response = await app.request(`/api/v1/events/${eventId}/email-verifications`, {
      method: 'POST',
      headers: { authorization: 'Bearer admin-session-token' },
    });

    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('180');
    expect(service.send).not.toHaveBeenCalled();
  });
});
