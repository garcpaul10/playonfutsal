-- P12: Ops & Compliance
-- Court availability blocks, venue insurance tracking, staff clearance expiry,
-- incident report reviews (append-only), and DB-level court double-booking prevention.

-- Enable GiST index extension (required for range exclusion constraints)
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- Court availability: blocked periods (maintenance, external bookings, etc.)
CREATE TABLE IF NOT EXISTS court_availability (
  id serial PRIMARY KEY,
  court_id integer NOT NULL REFERENCES courts(id) ON DELETE CASCADE,
  blocked_by_user_id integer REFERENCES users(id) ON DELETE SET NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  reason text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Staff clearance expiry tracking
ALTER TABLE staff_profiles
  ADD COLUMN IF NOT EXISTS background_check_expiry date,
  ADD COLUMN IF NOT EXISTS certification_expiry date;

-- Venue insurance tracking
ALTER TABLE venues
  ADD COLUMN IF NOT EXISTS insurance_provider text,
  ADD COLUMN IF NOT EXISTS insurance_policy_number text,
  ADD COLUMN IF NOT EXISTS insurance_expiry date;

-- Incident report reviews: append-only status/review entries
-- The original incident_reports record is NEVER updated after creation.
-- Status changes are recorded here as immutable review events.
CREATE TABLE IF NOT EXISTS incident_report_reviews (
  id serial PRIMARY KEY,
  report_id integer NOT NULL REFERENCES incident_reports(id) ON DELETE CASCADE,
  reviewer_user_id integer REFERENCES users(id) ON DELETE SET NULL,
  status text NOT NULL,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- DB-level cross-offering court conflict enforcement.
-- A single shared function checks fixtures, drop-ins, AND camp days for same-court overlap.
-- Half-open interval semantics: [start, end) — back-to-back events (end == next start) are NOT conflicts.

CREATE OR REPLACE FUNCTION check_court_conflicts_cross_offering(
  p_court_id integer,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_exclude_source text DEFAULT '',
  p_exclude_id integer DEFAULT -1
) RETURNS void AS $$
BEGIN
  -- Fixtures
  IF EXISTS (
    SELECT 1 FROM fixtures
    WHERE court_id = p_court_id
      AND NOT (p_exclude_source = 'fixture' AND id = p_exclude_id)
      AND status != 'cancelled'
      AND scheduled_at IS NOT NULL
      AND scheduled_at < p_ends_at
      AND scheduled_at + (duration_minutes * interval '1 minute') > p_starts_at
  ) THEN
    RAISE EXCEPTION 'Court % already booked (fixture conflict) during this time slot', p_court_id;
  END IF;

  -- Drop-ins
  IF EXISTS (
    SELECT 1 FROM dropins
    WHERE court_id = p_court_id
      AND NOT (p_exclude_source = 'dropin' AND id = p_exclude_id)
      AND status NOT IN ('cancelled', 'completed')
      AND starts_at < p_ends_at
      AND starts_at + (duration_minutes * interval '1 minute') > p_starts_at
  ) THEN
    RAISE EXCEPTION 'Court % already booked (drop-in conflict) during this time slot', p_court_id;
  END IF;

  -- Camp days (join with camps for court_id; times stored as HH:MM text)
  IF EXISTS (
    SELECT 1 FROM camp_days cd
    JOIN camps c ON c.id = cd.camp_id
    WHERE c.court_id = p_court_id
      AND NOT (p_exclude_source = 'camp_day' AND cd.id = p_exclude_id)
      AND (cd.date + cd.start_time::time)::timestamptz < p_ends_at
      AND (cd.date + cd.end_time::time)::timestamptz > p_starts_at
  ) THEN
    RAISE EXCEPTION 'Court % already booked (camp day conflict) during this time slot', p_court_id;
  END IF;

  -- Court availability blocks: no booking allowed during explicitly blocked windows
  IF EXISTS (
    SELECT 1 FROM court_availability
    WHERE court_id = p_court_id
      AND starts_at < p_ends_at
      AND ends_at   > p_starts_at
  ) THEN
    RAISE EXCEPTION 'Court % is blocked/unavailable during the requested time window', p_court_id;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- Fixture trigger
CREATE OR REPLACE FUNCTION fixture_court_conflict_trigger()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.court_id IS NOT NULL AND NEW.scheduled_at IS NOT NULL AND NEW.status != 'cancelled' THEN
    PERFORM check_court_conflicts_cross_offering(
      NEW.court_id,
      NEW.scheduled_at,
      NEW.scheduled_at + (NEW.duration_minutes * interval '1 minute'),
      'fixture',
      COALESCE(NEW.id, -1)
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS court_no_double_booking ON fixtures;
CREATE TRIGGER court_no_double_booking
  BEFORE INSERT OR UPDATE ON fixtures
  FOR EACH ROW EXECUTE FUNCTION fixture_court_conflict_trigger();

-- Drop-in trigger
CREATE OR REPLACE FUNCTION dropin_court_conflict_trigger()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.court_id IS NOT NULL AND NEW.status NOT IN ('cancelled', 'completed') THEN
    PERFORM check_court_conflicts_cross_offering(
      NEW.court_id,
      NEW.starts_at,
      NEW.starts_at + (NEW.duration_minutes * interval '1 minute'),
      'dropin',
      COALESCE(NEW.id, -1)
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS dropin_court_no_double_booking ON dropins;
CREATE TRIGGER dropin_court_no_double_booking
  BEFORE INSERT OR UPDATE ON dropins
  FOR EACH ROW EXECUTE FUNCTION dropin_court_conflict_trigger();

-- Camp day trigger
CREATE OR REPLACE FUNCTION camp_day_court_conflict_trigger()
RETURNS TRIGGER AS $$
DECLARE
  v_court_id integer;
BEGIN
  SELECT court_id INTO v_court_id FROM camps WHERE id = NEW.camp_id;
  IF v_court_id IS NOT NULL THEN
    PERFORM check_court_conflicts_cross_offering(
      v_court_id,
      (NEW.date + NEW.start_time::time)::timestamptz,
      (NEW.date + NEW.end_time::time)::timestamptz,
      'camp_day',
      COALESCE(NEW.id, -1)
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS camp_day_court_no_double_booking ON camp_days;
CREATE TRIGGER camp_day_court_no_double_booking
  BEFORE INSERT OR UPDATE ON camp_days
  FOR EACH ROW EXECUTE FUNCTION camp_day_court_conflict_trigger();
