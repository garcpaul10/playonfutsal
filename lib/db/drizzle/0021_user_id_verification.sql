ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "address_line1" text;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "address_line2" text;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "city" text;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "state" text;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "zip" text;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "id_verified" boolean NOT NULL DEFAULT false;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "id_verified_at" timestamp with time zone;
