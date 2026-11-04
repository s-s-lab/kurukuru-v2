import type { Pool, PoolClient } from 'pg';

import type { ClaimedNotification, NotificationRepository } from './repository';

type NotificationRow = {
  id: string;
  event_id: string;
  title: string;
  organizer_email: string;
  response_id: string;
  display_name: string;
  kind: 'created' | 'updated';
  attempts: number;
  idempotency_key: string;
};

type NotificationEligibilityRow = {
  event_generation: number;
  notification_generation: number;
  eligible: boolean;
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

export class PostgresNotificationRepository implements NotificationRepository {
  constructor(
    private readonly pool: Pool,
    private readonly now: () => Date = () => new Date(),
  ) {}

  claim(limit: number): Promise<ClaimedNotification[]> {
    const claimedAt = this.now();
    const safeLimit = Math.max(1, Math.min(Math.trunc(limit), 100));
    return transaction(this.pool, async (client) => {
      const result = await client.query<NotificationRow>(
        `WITH ready_events AS MATERIALIZED (
           SELECT ready_event.id, ready_event.notification_generation
             FROM events ready_event
            WHERE ready_event.organizer_email_verified_at IS NOT NULL
              AND ready_event.notify_on_response = true
              AND ready_event.deleted_at IS NULL
              AND ready_event.status <> 'deleted'
              AND EXISTS (
                SELECT 1
                  FROM notification_outbox candidate
                 WHERE candidate.event_id = ready_event.id
                   AND candidate.notification_generation = ready_event.notification_generation
                   AND ((candidate.status IN ('pending', 'failed')
                         AND candidate.next_attempt_at <= $1)
                     OR (candidate.status = 'sending'
                         AND candidate.last_attempt_at < $1 - interval '15 minutes'))
              )
            ORDER BY ready_event.id
            FOR UPDATE SKIP LOCKED
            LIMIT $2
         ), ready AS (
           SELECT n.id
             FROM notification_outbox n
             JOIN ready_events ready_event ON ready_event.id = n.event_id
            WHERE ((n.status IN ('pending', 'failed') AND n.next_attempt_at <= $1)
               OR (n.status = 'sending' AND n.last_attempt_at < $1 - interval '15 minutes'))
              AND n.notification_generation = ready_event.notification_generation
            ORDER BY n.created_at
            FOR UPDATE OF n SKIP LOCKED
            LIMIT $2
         ), claimed AS (
           UPDATE notification_outbox AS n
              SET status = 'sending',
                  attempts = n.attempts + 1,
                  last_attempt_at = $1,
                  updated_at = $1
             FROM ready
            WHERE n.id = ready.id
         RETURNING n.id, n.event_id, n.response_id, n.kind, n.attempts, n.idempotency_key
         )
         SELECT c.id, c.event_id, e.title, e.organizer_email,
                c.response_id, r.display_name, c.kind, c.attempts, c.idempotency_key
           FROM claimed c
           JOIN events e ON e.id = c.event_id
           JOIN responses r ON r.id = c.response_id
          ORDER BY c.id`,
        [claimedAt, safeLimit],
      );
      return result.rows.map((row) => ({
        id: row.id,
        eventId: row.event_id,
        eventTitle: row.title,
        organizerEmail: row.organizer_email,
        responseId: row.response_id,
        respondentName: row.display_name,
        kind: row.kind,
        attempts: row.attempts,
        idempotencyKey: row.idempotency_key,
      }));
    });
  }

  markSent(notificationId: string, providerMessageId: string): Promise<void> {
    const sentAt = this.now();
    return transaction(this.pool, async (client) => {
      await client.query(
        `UPDATE notification_outbox
            SET status = 'sent', provider_message_id = $2, sent_at = $3,
                error_message = NULL, updated_at = $3
          WHERE id = $1 AND status = 'sending'`,
        [notificationId, providerMessageId, sentAt],
      );
    });
  }

  markFailed(notificationId: string, errorCategory: string): Promise<void> {
    const failedAt = this.now();
    return transaction(this.pool, async (client) => {
      const eligibility = await client.query<NotificationEligibilityRow>(
        `SELECT e.notification_generation AS event_generation,
                n.notification_generation,
                (e.organizer_email_verified_at IS NOT NULL
                 AND e.notify_on_response = true
                 AND e.deleted_at IS NULL
                 AND e.status <> 'deleted') AS eligible
           FROM notification_outbox AS n
           JOIN events AS e ON e.id = n.event_id
          WHERE n.id = $1 AND n.status = 'sending'
          FOR UPDATE OF e`,
        [notificationId],
      );
      const current = eligibility.rows[0];
      if (!current
        || !current.eligible
        || current.notification_generation !== current.event_generation) {
        await client.query(
          `DELETE FROM notification_outbox
            WHERE id = $1 AND status = 'sending'`,
          [notificationId],
        );
        return;
      }

      await client.query(
        `UPDATE notification_outbox AS n
            SET status = 'failed', error_message = $2,
                next_attempt_at = $3 + LEAST(
                  power(2, GREATEST(attempts - 1, 0)) * interval '1 minute',
                  interval '6 hours'
                ),
                updated_at = $3
          WHERE n.id = $1
            AND n.status = 'sending'
            AND n.notification_generation = $4`,
        [
          notificationId,
          errorCategory.slice(0, 120),
          failedAt,
          current.event_generation,
        ],
      );
    });
  }
}
