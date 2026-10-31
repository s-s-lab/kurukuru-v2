// @vitest-environment node
import type { Pool } from 'pg';
import { describe, expect, it, vi } from 'vitest';

import { createRuntimeApp } from './runtime';
import { PostgresResponseRepository } from './responses/postgres-response-repository';
import { deriveResponseEditToken, hashOpaqueToken } from './security/secrets';

describe('Functionランタイム構成', () => {
  it('DATABASE_URLがない場合は起動を拒否する', () => {
    expect(() =>
      createRuntimeApp({ KURUKURU_ALLOWED_ORIGINS: 'https://s-s-lab.github.io' }),
    ).toThrow('DATABASE_URL');
  });

  it('DB接続と許可OriginをAPIへ組み込む', async () => {
    const pool = {} as Pool;
    const createPool = vi.fn(() => pool);
    const app = createRuntimeApp(
      {
        DATABASE_URL: 'postgresql://runtime.example/kurukuru',
        KURUKURU_TOKEN_SECRET: 's'.repeat(32),
        KURUKURU_ALLOWED_ORIGINS:
          'https://s-s-lab.github.io, http://localhost:5173, https://s-s-lab.github.io',
      },
      { createPool },
    );
    const response = await app.request('/api/v1/health', {
      headers: { origin: 'http://localhost:5173' },
    });

    expect(createPool).toHaveBeenCalledWith('postgresql://runtime.example/kurukuru');
    expect(response.status).toBe(200);
    expect(response.headers.get('access-control-allow-origin')).toBe('http://localhost:5173');
  });
});

describe('回答APIランタイム', () => {
  it.each([undefined, '', 's'.repeat(31)])('不足したトークン秘密鍵でDB生成前に起動を拒否する', (secret) => {
    const createPool = vi.fn(() => ({} as Pool));
    expect(() => createRuntimeApp({ DATABASE_URL: 'postgresql://runtime.example/kurukuru', KURUKURU_TOKEN_SECRET: secret }, { createPool })).toThrow('KURUKURU_TOKEN_SECRET');
    expect(createPool).not.toHaveBeenCalled();
  });

  it('32文字の秘密鍵を使う回答サービスとPostgresリポジトリを配線する', async () => {
    const responseId = 'a9210ea7-8827-448a-952a-8510a6fdcb44';
    const body = { displayName: '参加者', comment: '', availability: [{ candidateSlotId: '150da5e0-f923-492c-be9b-263bf5af58fc', mark: 'ok' as const }] };
    const response = { ...body, id: responseId, createdAt: '2026-10-30T00:00:00.000Z', updatedAt: '2026-10-30T00:00:00.000Z' };
    const create = vi.spyOn(PostgresResponseRepository.prototype, 'createResponse').mockResolvedValue({ response });
    const update = vi.spyOn(PostgresResponseRepository.prototype, 'updateResponse').mockResolvedValue({ response });
    const pool = { query: vi.fn(async () => ({ rows: [{ request_count: 1, retry_after_seconds: 60 }] })) } as unknown as Pool;
    const secret = 's'.repeat(32);
    try {
      const app = createRuntimeApp({ DATABASE_URL: 'postgresql://runtime.example/kurukuru', KURUKURU_TOKEN_SECRET: secret }, { createPool: () => pool });
      const created = await app.request('/api/v1/events/9bed1489-b31f-4b6d-8dcb-e8d95109f98c/responses', { method: 'POST', headers: { 'idempotency-key': 'response-runtime-0001' }, body: JSON.stringify(body) });
      const editToken = deriveResponseEditToken(secret, responseId);
      expect(created.status).toBe(201);
      await expect(created.json()).resolves.toEqual({ response, editToken });
      expect(create).toHaveBeenCalledWith(expect.objectContaining({ editTokenHash: expect.stringMatching(/^[a-f0-9]{64}$/) }));
      const persisted = create.mock.calls[0][0];
      expect(persisted.editTokenHash).toBe(hashOpaqueToken(deriveResponseEditToken(secret, persisted.responseId)));
      const updated = await app.request(`/api/v1/responses/${responseId}`, { method: 'PATCH', headers: { authorization: `Bearer ${editToken}` }, body: JSON.stringify(body) });
      expect(updated.status).toBe(200);
      await expect(updated.json()).resolves.toEqual({ response });
      expect(update).toHaveBeenCalledWith({ responseId, editTokenHash: hashOpaqueToken(editToken), request: body });
    } finally {
      create.mockRestore();
      update.mockRestore();
    }
  });
});
