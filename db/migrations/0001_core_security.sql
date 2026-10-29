BEGIN;

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS notify_on_response boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS organizer_email_verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;

CREATE TABLE IF NOT EXISTS email_verifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL UNIQUE REFERENCES events(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  verified_at timestamptz,
  send_attempts integer NOT NULL DEFAULT 0 CHECK (send_attempts >= 0),
  last_sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (expires_at > created_at)
);

CREATE INDEX IF NOT EXISTS idx_email_verifications_pending
  ON email_verifications (expires_at)
  WHERE verified_at IS NULL;

CREATE TABLE IF NOT EXISTS admin_sessions (
  token_hash text PRIMARY KEY,
  event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (expires_at > created_at)
);

CREATE INDEX IF NOT EXISTS idx_admin_sessions_event_expiry
  ON admin_sessions (event_id, expires_at);

CREATE TABLE IF NOT EXISTS idempotency_keys (
  scope text NOT NULL,
  idempotency_key text NOT NULL,
  request_hash text NOT NULL,
  status_code integer,
  response_body jsonb,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (scope, idempotency_key),
  CHECK (length(btrim(scope)) > 0),
  CHECK (length(btrim(idempotency_key)) >= 16),
  CHECK (expires_at > created_at)
);

CREATE INDEX IF NOT EXISTS idx_idempotency_keys_expiry
  ON idempotency_keys (expires_at);

ALTER TABLE notification_outbox
  ADD COLUMN IF NOT EXISTS idempotency_key text,
  ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS last_attempt_at timestamptz,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

UPDATE notification_outbox
SET idempotency_key = id::text
WHERE idempotency_key IS NULL;

ALTER TABLE notification_outbox
  ALTER COLUMN idempotency_key SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS notification_outbox_idempotency_key_key
  ON notification_outbox (idempotency_key);

CREATE INDEX IF NOT EXISTS idx_notifications_ready
  ON notification_outbox (next_attempt_at, created_at)
  WHERE status IN ('pending', 'failed');

COMMIT;

