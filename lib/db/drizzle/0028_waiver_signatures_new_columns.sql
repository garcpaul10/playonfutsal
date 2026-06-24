ALTER TABLE "waiver_signatures" ADD COLUMN IF NOT EXISTS "youth_user_id" integer;--> statement-breakpoint
ALTER TABLE "waiver_signatures" ADD COLUMN IF NOT EXISTS "expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "waiver_signatures" ADD COLUMN IF NOT EXISTS "signature_type" text DEFAULT 'typed';--> statement-breakpoint
ALTER TABLE "waiver_signatures" ADD CONSTRAINT "waiver_signatures_youth_user_id_users_id_fk" FOREIGN KEY ("youth_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
