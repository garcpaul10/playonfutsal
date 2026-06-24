CREATE TABLE "session_templates" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"day_of_week" integer NOT NULL,
	"start_time" text NOT NULL,
	"duration_minutes" integer DEFAULT 120 NOT NULL,
	"age_group" text NOT NULL,
	"skill_level" text DEFAULT 'all' NOT NULL,
	"court_id" integer NOT NULL,
	"default_cap" integer DEFAULT 15 NOT NULL,
	"cancellation_window_minutes" integer DEFAULT 120 NOT NULL,
	"description" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dropin_court_pools" (
	"id" serial PRIMARY KEY NOT NULL,
	"dropin_id" integer NOT NULL,
	"court_id" integer NOT NULL,
	"age_group" text NOT NULL,
	"skill_level" text DEFAULT 'all' NOT NULL,
	"cap" integer DEFAULT 15 NOT NULL,
	"is_closed" boolean DEFAULT false NOT NULL,
	"template_id" integer,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "dropins" ALTER COLUMN "duration_minutes" SET DEFAULT 120;--> statement-breakpoint
ALTER TABLE "dropins" ALTER COLUMN "max_players" SET DEFAULT 15;--> statement-breakpoint
ALTER TABLE "dropins" ADD COLUMN "skill_level" text DEFAULT 'all' NOT NULL;--> statement-breakpoint
ALTER TABLE "dropins" ADD COLUMN "cancellation_window_minutes" integer DEFAULT 120 NOT NULL;--> statement-breakpoint
ALTER TABLE "dropins" ADD COLUMN "template_id" integer;--> statement-breakpoint
ALTER TABLE "spots" ADD COLUMN "pool_id" integer;--> statement-breakpoint
ALTER TABLE "spots" ADD COLUMN "payment_status" text DEFAULT 'unpaid' NOT NULL;--> statement-breakpoint
ALTER TABLE "spots" ADD COLUMN "no_show" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "spots" ADD COLUMN "promoted_from_waitlist" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "dropin_court_pools" ADD CONSTRAINT "dropin_court_pools_dropin_id_dropins_id_fk" FOREIGN KEY ("dropin_id") REFERENCES "public"."dropins"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dropin_court_pools" ADD CONSTRAINT "dropin_court_pools_template_id_session_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."session_templates"("id") ON DELETE set null ON UPDATE no action;