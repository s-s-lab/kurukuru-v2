BEGIN;

CREATE TABLE IF NOT EXISTS request_rate_limits (
  scope text NOT NULL CHECK (length(btrim(scope)) > 0),
  subject_hash text NOT NULL CHECK (length(subject_hash) = 64),
  window_started_at timestamptz NOT NULL,
  request_count integer NOT NULL DEFAULT 1 CHECK (request_count >= 1),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (scope, subject_hash)
);

CREATE INDEX IF NOT EXISTS idx_request_rate_limits_updated_at
  ON request_rate_limits (updated_at);

COMMIT;
