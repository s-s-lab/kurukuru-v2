import { createHash } from 'node:crypto';
import type { Pool } from 'pg';

export type RateLimitRequest = {
  scope: string;
  subject: string;
  limit: number;
  windowSeconds: number;
};

export type RateLimitDecision = {
  allowed: boolean;
  retryAfterSeconds: number;
};

export interface RequestRateLimiter {
  check(request: RateLimitRequest): Promise<RateLimitDecision>;
}

export class PostgresRequestRateLimiter implements RequestRateLimiter {
  constructor(private readonly pool: Pool) {}

  async check(request: RateLimitRequest): Promise<RateLimitDecision> {
    const subjectHash = createHash('sha256').update(request.subject, 'utf8').digest('hex');
    const result = await this.pool.query<{
      request_count: number;
      retry_after_seconds: number;
    }>(
      `INSERT INTO request_rate_limits
         (scope, subject_hash, window_started_at, request_count, updated_at)
       VALUES ($1, $2, now(), 1, now())
       ON CONFLICT (scope, subject_hash) DO UPDATE
       SET window_started_at = CASE
             WHEN request_rate_limits.window_started_at <= now() - ($3 * interval '1 second')
               THEN now()
             ELSE request_rate_limits.window_started_at
           END,
           request_count = CASE
             WHEN request_rate_limits.window_started_at <= now() - ($3 * interval '1 second')
               THEN 1
             ELSE request_rate_limits.request_count + 1
           END,
           updated_at = now()
       RETURNING request_count,
         GREATEST(
           1,
           CEIL(EXTRACT(EPOCH FROM
             (window_started_at + ($3 * interval '1 second') - now())
           )
         ))::integer AS retry_after_seconds`,
      [request.scope, subjectHash, request.windowSeconds],
    );
    const row = result.rows[0];
    return {
      allowed: row.request_count <= request.limit,
      retryAfterSeconds: row.retry_after_seconds,
    };
  }
}
