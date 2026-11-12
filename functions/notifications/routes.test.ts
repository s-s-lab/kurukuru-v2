// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import { createApp } from '../app';
import type { NotificationDispatcher } from './service';

describe('通知ワーカーAPI', () => {
  it('正しいBearer secretだけが最大10件を処理できる', async () => {
    const notificationDispatcher: NotificationDispatcher = {
      drain: vi.fn(async () => ({ processed: 2, sent: 1, failed: 1 })),
    };
    const app = createApp({
      allowedOrigins: [],
      notificationDispatcher,
      notificationWorkerSecret: 'worker-secret-value',
    });
    const response = await app.request('/api/v1/internal/notifications/drain', {
      method: 'POST',
      headers: { authorization: 'Bearer worker-secret-value' },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    await expect(response.json()).resolves.toEqual({ processed: 2, sent: 1, failed: 1 });
    expect(notificationDispatcher.drain).toHaveBeenCalledWith(10);
  });

  it('誤ったsecretでは存在を隠す404を返し処理しない', async () => {
    const notificationDispatcher: NotificationDispatcher = {
      drain: vi.fn(async () => ({ processed: 0, sent: 0, failed: 0 })),
    };
    const app = createApp({
      allowedOrigins: [], notificationDispatcher, notificationWorkerSecret: 'worker-secret-value',
    });
    const response = await app.request('/api/v1/internal/notifications/drain', {
      method: 'POST', headers: { authorization: 'Bearer wrong-secret' },
    });

    expect(response.status).toBe(404);
    expect(notificationDispatcher.drain).not.toHaveBeenCalled();
  });

  it('ワーカー構成がない場合は503にする', async () => {
    const app = createApp({ allowedOrigins: [] });
    const response = await app.request('/api/v1/internal/notifications/drain', {
      method: 'POST', headers: { authorization: 'Bearer any-secret' },
    });
    expect(response.status).toBe(503);
  });

  it('Neonのスケジュール実行だけが送信待ち通知を処理できる', async () => {
    const notificationDispatcher: NotificationDispatcher = {
      drain: vi.fn(async () => ({ processed: 1, sent: 1, failed: 0 })),
    };
    const app = createApp({ allowedOrigins: [], notificationDispatcher });
    const response = await app.request('/api/v1/internal/notifications/drain-trigger', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-neon-trigger-invocation-id': 'scheduled-invocation-1',
      },
      body: JSON.stringify({
        version: 1,
        invocation_id: 'scheduled-invocation-1',
        trigger: { type: 'schedule', id: 'trigger-1', name: 'notification-drain' },
        data: { scheduled_at: '2026-11-12T03:00:00.000Z' },
      }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ processed: 1, sent: 1, failed: 0 });
    expect(notificationDispatcher.drain).toHaveBeenCalledWith(10);
  });

  it('通常のHTTPリクエストではスケジュール処理を起動できない', async () => {
    const notificationDispatcher: NotificationDispatcher = {
      drain: vi.fn(async () => ({ processed: 0, sent: 0, failed: 0 })),
    };
    const app = createApp({ allowedOrigins: [], notificationDispatcher });
    const response = await app.request('/api/v1/internal/notifications/drain-trigger', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        version: 1,
        invocation_id: 'forged-invocation',
        trigger: { type: 'schedule', id: 'trigger-1', name: 'notification-drain' },
        data: { scheduled_at: '2026-11-12T03:00:00.000Z' },
      }),
    });

    expect(response.status).toBe(404);
    expect(notificationDispatcher.drain).not.toHaveBeenCalled();
  });
});
