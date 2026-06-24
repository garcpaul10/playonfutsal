ALTER TABLE "staff_profiles" ADD COLUMN IF NOT EXISTS "training_completed_at" timestamp with time zone;
ALTER TABLE "staff_profiles" ADD COLUMN IF NOT EXISTS "training_progress" jsonb;
