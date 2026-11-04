// @vitest-environment node
import type { Pool } from 'pg';
import { describe, expect, it, vi } from 'vitest';

import { createRuntimeApp } from '../runtime';
import { PostgresNotificationRepository } from './postgres-notification-repository';

describe('通知ワーカーランタイム構成', () => {
  it('メール設定とworker secretからアウトボックス配信を配線する', async () => {
    const claim = vi.spyOn(PostgresNotificationRepository.prototype, 'claim').mockResolvedValue([]);
    try {
      const app = createRuntimeApp({
        DATABASE_URL: 'postgresql://runtime.example/kurukuru',
        KURUKURU_TOKEN_SECRET: 's'.repeat(32),
        RESEND_API_KEY: 're_test_key',
        KURUKURU_MAIL_FROM: 'Kurukuru <no-reply@notify.kurukuru-app.jp>',
        KURUKURU_PUBLIC_BASE_URL: 'https://kurukuru-app.jp',
        KURUKURU_NOTIFICATION_WORKER_SECRET: 'worker-secret-value',
      }, { createPool: () => ({} as Pool) });

      const response = await app.request('/api/v1/internal/notifications/drain', {
        method: 'POST', headers: { authorization: 'Bearer worker-secret-value' },
      });
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ processed: 0, sent: 0, failed: 0 });
      expect(claim).toHaveBeenCalledWith(10);
    } finally {
      claim.mockRestore();
    }
  });

  it('worker secretがない場合は通知ルートを無効にする', async () => {
    const app = createRuntimeApp({
      DATABASE_URL: 'postgresql://runtime.example/kurukuru',
      KURUKURU_TOKEN_SECRET: 's'.repeat(32),
      RESEND_API_KEY: 're_test_key',
      KURUKURU_MAIL_FROM: 'Kurukuru <no-reply@notify.kurukuru-app.jp>',
      KURUKURU_PUBLIC_BASE_URL: 'https://kurukuru-app.jp',
    }, { createPool: () => ({} as Pool) });
    const response = await app.request('/api/v1/internal/notifications/drain', {
      method: 'POST', headers: { authorization: 'Bearer any-secret' },
    });
    expect(response.status).toBe(503);
  });
});
