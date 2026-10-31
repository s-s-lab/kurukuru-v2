// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, describe, expect, it } from 'vitest';

import { PostgresRequestRateLimiter } from './rate-limit';

const databaseUrl = process.env.DATABASE_URL;
const pool = databaseUrl ? new Pool({ connectionString: databaseUrl }) : null;

afterAll(async () => {
  await pool?.end();
});

describe.skipIf(!pool)('Postgresリクエスト回数制限統合', () => {
  it('同一ウィンドウの上限を全Functionインスタンスで共有する', async () => {
    const limiter = new PostgresRequestRateLimiter(pool!);
    const scope = `integration-rate-${randomUUID()}`;
    const request = {
      scope,
      subject: '203.0.113.25',
      limit: 2,
      windowSeconds: 60,
    };

    try {
      await expect(limiter.check(request)).resolves.toMatchObject({ allowed: true });
      await expect(limiter.check(request)).resolves.toMatchObject({ allowed: true });
      await expect(limiter.check(request)).resolves.toMatchObject({
        allowed: false,
        retryAfterSeconds: expect.any(Number),
      });
    } finally {
      await pool!.query('DELETE FROM request_rate_limits WHERE scope = $1', [scope]);
    }
  });
});
