BEGIN;

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS notification_generation integer NOT NULL DEFAULT 1
    CHECK (notification_generation >= 1);

ALTER TABLE notification_outbox
  ADD COLUMN IF NOT EXISTS notification_generation integer NOT NULL DEFAULT 1
    CHECK (notification_generation >= 1);

UPDATE events AS e
SET notification_generation = e.notification_generation + 1
WHERE (
    e.notify_on_response = false
    OR e.organizer_email_verified_at IS NULL
    OR e.deleted_at IS NOT NULL
    OR e.status = 'deleted'
  )
  AND EXISTS (
    SELECT 1
    FROM notification_outbox AS n
    WHERE n.event_id = e.id
      AND n.notification_generation = e.notification_generation
  );

DELETE FROM notification_outbox AS n
USING events AS e
WHERE n.event_id = e.id
  AND n.status IN ('pending', 'failed')
  AND (
    e.notify_on_response = false
    OR e.organizer_email_verified_at IS NULL
    OR e.deleted_at IS NOT NULL
    OR e.status = 'deleted'
  );

CREATE INDEX IF NOT EXISTS idx_notifications_event_generation_ready
  ON notification_outbox (event_id, notification_generation, next_attempt_at, created_at)
  WHERE status IN ('pending', 'failed');

CREATE INDEX IF NOT EXISTS idx_notifications_event_generation_sending
  ON notification_outbox (event_id, notification_generation, last_attempt_at, created_at)
  WHERE status = 'sending';

COMMIT;
