ALTER TABLE "waiver_signatures" ADD COLUMN IF NOT EXISTS "entity_type" text;--> statement-breakpoint
ALTER TABLE "waiver_signatures" ADD COLUMN IF NOT EXISTS "entity_id" integer;
