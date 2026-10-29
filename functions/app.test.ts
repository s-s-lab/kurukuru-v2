// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { createApp } from './app';

describe('Neon Functions API', () => {
  it('ヘルスチェックに秘密情報を含めず応答する', async () => {
    const app = createApp({ allowedOrigins: ['http://localhost:5173'] });
    const response = await app.request('/api/v1/health');

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: 'ok', service: 'kurukuru-api' });
  });

  it('許可したOriginのプリフライトだけにCORSヘッダーを返す', async () => {
    const app = createApp({ allowedOrigins: ['https://s-s-lab.github.io'] });
    const allowed = await app.request('/api/v1/health', {
      method: 'OPTIONS',
      headers: { origin: 'https://s-s-lab.github.io' },
    });
    const denied = await app.request('/api/v1/health', {
      method: 'OPTIONS',
      headers: { origin: 'https://example.invalid' },
    });

    expect(allowed.status).toBe(204);
    expect(allowed.headers.get('access-control-allow-origin')).toBe('https://s-s-lab.github.io');
    expect(denied.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('存在しないAPIは共通形式の404を返す', async () => {
    const app = createApp({ allowedOrigins: [] });
    const response = await app.request('/api/v1/missing');
    const body = (await response.json()) as { code: string; requestId: string };

    expect(response.status).toBe(404);
    expect(body).toMatchObject({ code: 'NOT_FOUND' });
    expect(body.requestId).toEqual(expect.any(String));
  });
});
