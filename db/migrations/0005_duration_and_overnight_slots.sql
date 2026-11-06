BEGIN;

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS duration text NOT NULL DEFAULT '';

ALTER TABLE candidate_slots
  DROP CONSTRAINT IF EXISTS candidate_slots_slot_index_check;

ALTER TABLE candidate_slots
  ADD CONSTRAINT candidate_slots_slot_index_check
  CHECK (slot_index BETWEEN 12 AND 59);

ALTER TABLE events
  DROP CONSTRAINT IF EXISTS events_final_start_slot_check;

ALTER TABLE events
  ADD CONSTRAINT events_final_start_slot_check
  CHECK (final_start_slot IS NULL OR final_start_slot BETWEEN 12 AND 59);

ALTER TABLE events
  DROP CONSTRAINT IF EXISTS events_final_end_slot_check;

ALTER TABLE events
  ADD CONSTRAINT events_final_end_slot_check
  CHECK (final_end_slot IS NULL OR final_end_slot BETWEEN 13 AND 60);

COMMIT;
