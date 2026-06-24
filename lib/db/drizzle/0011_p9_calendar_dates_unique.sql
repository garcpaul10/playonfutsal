-- P9 fix: add unique constraint on ai_calendar_dates (source_id, date)
-- This prevents duplicate rows on repeated iCal/CSV fetches.
-- onConflictDoNothing() in the ingestion endpoint relies on this constraint.

ALTER TABLE ai_calendar_dates
  ADD CONSTRAINT ai_calendar_dates_source_date_uq UNIQUE (source_id, date);
