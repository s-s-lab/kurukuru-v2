import type { Pool, PoolClient } from 'pg';

import { AdminAccessDeniedError } from '../admin/service';
import type {
  EmailVerificationRepository,
  PreparedVerificationSend,
} from './repository';

type SendRow = {
  id: string;
  title: string;
  organizer_email: string;
  organizer_email_verified_at: Date | null;
};

type VerificationRow = {
  event_id: string;
  verified_at: Date | null;
};

type VerificationCandidateRow = {
  event_id: string;
};

async function transaction<T>(pool: Pool, work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export class PostgresEmailVerificationRepository implements EmailVerificationRepository {
  constructor(private readonly pool: Pool) {}

  prepareSend(input: {
    eventId: string;
    sessionTokenHash: string;
    tokenHash: string;
    sentAt: Date;
    expiresAt: Date;
  }): Promise<PreparedVerificationSend> {
    return transaction(this.pool, async (client) => {
      const authorized = await client.query<SendRow>(
        `SELECT e.id, e.title, e.organizer_email, e.organizer_email_verified_at
           FROM events e
           JOIN admin_sessions s ON s.event_id = e.id
          WHERE e.id = $1 AND s.token_hash = $2 AND s.expires_at > $3
            AND e.deleted_at IS NULL AND e.status <> 'deleted'
          FOR UPDATE OF e`,
        [input.eventId, input.sessionTokenHash, input.sentAt],
      );
      const event = authorized.rows[0];
      if (!event) throw new AdminAccessDeniedError();
      if (event.organizer_email_verified_at) return { status: 'already-verified' };

      await client.query(
        `INSERT INTO email_verifications
           (event_id, token_hash, expires_at, verified_at, send_attempts, last_sent_at, created_at, updated_at)
         VALUES ($1, $2, $3, NULL, 1, $4, $4, $4)
         ON CONFLICT (event_id) DO UPDATE
           SET token_hash = EXCLUDED.token_hash,
               expires_at = EXCLUDED.expires_at,
               verified_at = NULL,
               send_attempts = email_verifications.send_attempts + 1,
               last_sent_at = EXCLUDED.last_sent_at,
               updated_at = EXCLUDED.updated_at`,
        [input.eventId, input.tokenHash, input.expiresAt, input.sentAt],
      );
      return {
        status: 'ready',
        eventTitle: event.title,
        organizerEmail: event.organizer_email,
      };
    });
  }

  verify(input: {
    tokenHash: string;
    verifiedAt: Date;
  }): Promise<{ eventId: string } | null> {
    return transaction(this.pool, async (client) => {
      const candidate = await client.query<VerificationCandidateRow>(
        `SELECT event_id
           FROM email_verifications
          WHERE token_hash = $1`,
        [input.tokenHash],
      );
      const eventId = candidate.rows[0]?.event_id;
      if (!eventId) return null;

      const event = await client.query<{ id: string }>(
        `SELECT id
           FROM events
          WHERE id = $1 AND deleted_at IS NULL AND status <> 'deleted'
          FOR UPDATE`,
        [eventId],
      );
      if (!event.rows[0]) return null;

      const matched = await client.query<VerificationRow>(
        `SELECT event_id, verified_at
           FROM email_verifications
          WHERE event_id = $1 AND token_hash = $2 AND expires_at > $3
          FOR UPDATE`,
        [eventId, input.tokenHash, input.verifiedAt],
      );
      const verification = matched.rows[0];
      if (!verification) return null;

      if (!verification.verified_at) {
        await client.query(
          `UPDATE email_verifications
              SET verified_at = $2, updated_at = $2
            WHERE token_hash = $1`,
          [input.tokenHash, input.verifiedAt],
        );
        await client.query(
          `UPDATE events
              SET organizer_email_verified_at = COALESCE(organizer_email_verified_at, $2),
                  version = version + 1,
                  updated_at = $2
            WHERE id = $1`,
          [verification.event_id, input.verifiedAt],
        );
      }
      return { eventId: verification.event_id };
    });
  }
}
