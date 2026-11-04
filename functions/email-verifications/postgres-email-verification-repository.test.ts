// @vitest-environment node
import type { Pool } from 'pg';
import { describe, expect, it } from 'vitest';

import { AdminAccessDeniedError } from '../admin/service';
import { PostgresEmailVerificationRepository } from './postgres-email-verification-repository';

const eventId = '11111111-1111-4111-8111-111111111111';
const sentAt = new Date('2026-11-03T12:00:00.000Z');
const expiresAt = new Date('2026-11-04T12:00:00.000Z');

function verificationPool(options: {
  authorized?: boolean;
  verified?: boolean;
  validToken?: boolean;
} = {}) {
  const queries: Array<{ sql: string; parameters?: unknown[] }> = [];
  let outcome = '';
  const client = {
    async query(sql: string, parameters?: unknown[]) {
      queries.push({ sql, parameters });
      if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(sql)) {
        if (sql !== 'BEGIN') outcome = sql;
        return { rows: [], rowCount: 0 };
      }
      if (/JOIN admin_sessions/.test(sql)) {
        if (options.authorized === false) return { rows: [], rowCount: 0 };
        return {
          rows: [{
            id: eventId,
            title: '研究会',
            organizer_email: 'owner@example.com',
            organizer_email_verified_at: options.verified ? sentAt : null,
          }],
          rowCount: 1,
        };
      }
      if (/INSERT INTO email_verifications/.test(sql)) {
        return { rows: [], rowCount: 1 };
      }
      if (/SELECT event_id\s+FROM email_verifications\s+WHERE token_hash/.test(sql)) {
        return options.validToken === false
          ? { rows: [], rowCount: 0 }
          : { rows: [{ event_id: eventId }], rowCount: 1 };
      }
      if (/SELECT id\s+FROM events/.test(sql)) {
        return { rows: [{ id: eventId }], rowCount: 1 };
      }
      if (/SELECT event_id, verified_at\s+FROM email_verifications/.test(sql)) {
        return { rows: [{ event_id: eventId, verified_at: options.verified ? sentAt : null }], rowCount: 1 };
      }
      if (/UPDATE email_verifications/.test(sql) || /UPDATE events/.test(sql)) {
        return { rows: [], rowCount: 1 };
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
    release() {},
  };
  return {
    pool: { connect: async () => client } as unknown as Pool,
    queries,
    outcome: () => outcome,
  };
}

describe('PostgresEmailVerificationRepository', () => {
  it('authorizes the live admin session and rotates only the hashed verification token', async () => {
    const boundary = verificationPool();
    const repository = new PostgresEmailVerificationRepository(boundary.pool);

    await expect(repository.prepareSend({
      eventId,
      sessionTokenHash: 'session-hash',
      tokenHash: 'verification-hash',
      sentAt,
      expiresAt,
    })).resolves.toEqual({
      status: 'ready', eventTitle: '研究会', organizerEmail: 'owner@example.com',
    });
    const authorization = boundary.queries.find(({ sql }) => /JOIN admin_sessions/.test(sql));
    const rotation = boundary.queries.find(({ sql }) => /INSERT INTO email_verifications/.test(sql));
    expect(authorization?.sql).toMatch(/s\.expires_at > \$3/);
    expect(authorization?.sql).toMatch(/deleted_at IS NULL/);
    expect(authorization?.parameters).toEqual([eventId, 'session-hash', sentAt]);
    expect(rotation?.sql).toMatch(/ON CONFLICT \(event_id\) DO UPDATE/);
    expect(rotation?.sql).toMatch(/send_attempts = email_verifications\.send_attempts \+ 1/);
    expect(rotation?.parameters).toEqual([
      eventId, 'verification-hash', expiresAt, sentAt,
    ]);
    expect(boundary.outcome()).toBe('COMMIT');
  });

  it('does not rotate or send when the email is already verified', async () => {
    const boundary = verificationPool({ verified: true });
    const result = await new PostgresEmailVerificationRepository(boundary.pool).prepareSend({
      eventId, sessionTokenHash: 'session-hash', tokenHash: 'verification-hash', sentAt, expiresAt,
    });

    expect(result).toEqual({ status: 'already-verified' });
    expect(boundary.queries.some(({ sql }) => /INSERT INTO email_verifications/.test(sql))).toBe(false);
    expect(boundary.outcome()).toBe('COMMIT');
  });

  it('rolls back and hides an invalid admin session', async () => {
    const boundary = verificationPool({ authorized: false });

    await expect(new PostgresEmailVerificationRepository(boundary.pool).prepareSend({
      eventId, sessionTokenHash: 'bad-session', tokenHash: 'verification-hash', sentAt, expiresAt,
    })).rejects.toBeInstanceOf(AdminAccessDeniedError);
    expect(boundary.outcome()).toBe('ROLLBACK');
  });

  it('atomically verifies a live token and advances the event version only on first verification', async () => {
    const boundary = verificationPool();
    const repository = new PostgresEmailVerificationRepository(boundary.pool);

    await expect(repository.verify({ tokenHash: 'verification-hash', verifiedAt: sentAt }))
      .resolves.toEqual({ eventId });
    const candidate = boundary.queries.find(({ sql }) => /WHERE token_hash = \$1/.test(sql));
    const eventLockIndex = boundary.queries.findIndex(({ sql }) => /SELECT id\s+FROM events/.test(sql));
    const verificationLockIndex = boundary.queries.findIndex(({ sql }) =>
      /SELECT event_id, verified_at\s+FROM email_verifications/.test(sql));
    const eventUpdate = boundary.queries.find(({ sql }) => /UPDATE events/.test(sql));
    expect(candidate?.parameters).toEqual(['verification-hash']);
    expect(eventLockIndex).toBeGreaterThan(-1);
    expect(verificationLockIndex).toBeGreaterThan(eventLockIndex);
    expect(boundary.queries[eventLockIndex]?.sql).toMatch(/FOR UPDATE/);
    expect(boundary.queries[verificationLockIndex]?.sql).toMatch(/expires_at > \$3/);
    expect(boundary.queries[verificationLockIndex]?.sql).toMatch(/FOR UPDATE/);
    expect(eventUpdate?.sql).toMatch(/organizer_email_verified_at = COALESCE/);
    expect(eventUpdate?.sql).toMatch(/version = version \+ 1/);
    expect(boundary.outcome()).toBe('COMMIT');
  });

  it('returns null without mutation for invalid or expired tokens', async () => {
    const boundary = verificationPool({ validToken: false });
    await expect(new PostgresEmailVerificationRepository(boundary.pool).verify({
      tokenHash: 'invalid-hash', verifiedAt: sentAt,
    })).resolves.toBeNull();
    expect(boundary.queries.some(({ sql }) => /UPDATE (events|email_verifications)/.test(sql)))
      .toBe(false);
    expect(boundary.outcome()).toBe('COMMIT');
  });
});
