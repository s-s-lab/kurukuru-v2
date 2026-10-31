BEGIN;

CREATE TABLE IF NOT EXISTS events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title varchar NOT NULL CHECK (length(btrim(title)) > 0),
  description text NOT NULL DEFAULT '',
  organizer_email text NOT NULL,
  admin_secret_hash text NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed', 'deleted')),
  final_date date,
  final_start_slot smallint CHECK (final_start_slot IS NULL OR final_start_slot BETWEEN 0 AND 47),
  final_end_slot smallint CHECK (final_end_slot IS NULL OR final_end_slot BETWEEN 1 AND 48),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT final_slots_valid CHECK (
    (final_date IS NULL AND final_start_slot IS NULL AND final_end_slot IS NULL)
    OR
    (final_date IS NOT NULL AND final_start_slot IS NOT NULL AND final_end_slot IS NOT NULL
      AND final_end_slot > final_start_slot)
  )
);

CREATE TABLE IF NOT EXISTS candidate_slots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  candidate_date date NOT NULL,
  slot_index smallint NOT NULL CHECK (slot_index BETWEEN 12 AND 47),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id, candidate_date, slot_index)
);

CREATE INDEX IF NOT EXISTS idx_candidate_slots_event_date
  ON candidate_slots (event_id, candidate_date, slot_index);

CREATE TABLE IF NOT EXISTS responses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  display_name varchar NOT NULL CHECK (length(btrim(display_name)) > 0),
  comment text NOT NULL DEFAULT '',
  edit_secret_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_responses_event
  ON responses (event_id, created_at);

CREATE TABLE IF NOT EXISTS response_availability (
  response_id uuid NOT NULL REFERENCES responses(id) ON DELETE CASCADE,
  candidate_slot_id uuid NOT NULL REFERENCES candidate_slots(id) ON DELETE CASCADE,
  mark text NOT NULL CHECK (mark IN ('best', 'ok', 'maybe', 'ng')),
  PRIMARY KEY (response_id, candidate_slot_id)
);

CREATE TABLE IF NOT EXISTS notification_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  response_id uuid NOT NULL REFERENCES responses(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('created', 'updated')),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'sending', 'sent', 'failed')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  error_message text,
  provider_message_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_notifications_pending
  ON notification_outbox (status, created_at)
  WHERE status IN ('pending', 'failed');

COMMIT;
