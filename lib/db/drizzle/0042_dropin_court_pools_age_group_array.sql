DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'dropin_court_pools'
      AND column_name = 'age_group'
      AND data_type = 'text'
  ) THEN
    ALTER TABLE "dropin_court_pools"
      ALTER COLUMN "age_group" TYPE text[]
      USING ARRAY["age_group"];
  END IF;
END $$;
