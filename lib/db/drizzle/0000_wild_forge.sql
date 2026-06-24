CREATE TYPE "public"."guardian_status" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."pricing_category" AS ENUM('drop_in', 'camp', 'league', 'tournament');--> statement-breakpoint
CREATE TYPE "public"."split_type" AS ENUM('percentage', 'flat', 'hybrid');--> statement-breakpoint
CREATE TYPE "public"."offering_type" AS ENUM('league', 'camp', 'drop_in', 'tournament');--> statement-breakpoint
CREATE TYPE "public"."qr_code_scope" AS ENUM('check_in', 'registration', 'event', 'membership');--> statement-breakpoint
CREATE TYPE "public"."sub_ref_alert_status" AS ENUM('open', 'claimed', 'filled', 'cancelled');--> statement-breakpoint
CREATE TABLE "courts" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"type" text DEFAULT 'full' NOT NULL,
	"description" text,
	"available_for_scheduling" boolean DEFAULT true NOT NULL,
	"max_players" integer DEFAULT 10 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "seasons" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"is_active" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leagues" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"age_group" text NOT NULL,
	"format" text DEFAULT '5v5' NOT NULL,
	"court_id" integer NOT NULL,
	"season_id" integer NOT NULL,
	"status" text DEFAULT 'upcoming' NOT NULL,
	"registration_price" numeric(10, 2) DEFAULT '0' NOT NULL,
	"max_teams" integer DEFAULT 8 NOT NULL,
	"teams_registered" integer DEFAULT 0 NOT NULL,
	"registration_open" boolean DEFAULT false NOT NULL,
	"registration_deadline" timestamp with time zone,
	"start_date" date,
	"end_date" date,
	"description" text,
	"image_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "camps" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"age_group" text NOT NULL,
	"court_id" integer NOT NULL,
	"status" text DEFAULT 'upcoming' NOT NULL,
	"price" numeric(10, 2) DEFAULT '0' NOT NULL,
	"max_participants" integer DEFAULT 20 NOT NULL,
	"participants_registered" integer DEFAULT 0 NOT NULL,
	"registration_open" boolean DEFAULT false NOT NULL,
	"registration_deadline" timestamp with time zone,
	"start_date" date,
	"end_date" date,
	"description" text,
	"image_url" text,
	"coach_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dropins" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"age_group" text NOT NULL,
	"court_id" integer NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"duration_minutes" integer DEFAULT 60 NOT NULL,
	"price" numeric(10, 2) DEFAULT '0' NOT NULL,
	"max_players" integer DEFAULT 10 NOT NULL,
	"players_registered" integer DEFAULT 0 NOT NULL,
	"registration_open" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'upcoming' NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tournaments" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"age_group" text NOT NULL,
	"format" text DEFAULT '5v5' NOT NULL,
	"court_id" integer NOT NULL,
	"status" text DEFAULT 'upcoming' NOT NULL,
	"team_price" numeric(10, 2) DEFAULT '0' NOT NULL,
	"max_teams" integer DEFAULT 8 NOT NULL,
	"teams_registered" integer DEFAULT 0 NOT NULL,
	"registration_open" boolean DEFAULT false NOT NULL,
	"registration_deadline" timestamp with time zone,
	"start_date" date,
	"end_date" date,
	"description" text,
	"image_url" text,
	"prize_pot" numeric(10, 2),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"clerk_id" text NOT NULL,
	"email" text NOT NULL,
	"first_name" text,
	"last_name" text,
	"phone" text,
	"date_of_birth" date,
	"role" text DEFAULT 'player' NOT NULL,
	"playon_id" text,
	"qr_code" text,
	"emergency_contact_name" text,
	"emergency_contact_phone" text,
	"avatar_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_clerk_id_unique" UNIQUE("clerk_id"),
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_playon_id_unique" UNIQUE("playon_id")
);
--> statement-breakpoint
CREATE TABLE "teams" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"league_id" integer,
	"tournament_id" integer,
	"captain_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "registrations" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"program_type" text NOT NULL,
	"program_id" integer NOT NULL,
	"program_name" text DEFAULT '' NOT NULL,
	"team_id" integer,
	"status" text DEFAULT 'pending' NOT NULL,
	"amount_paid" numeric(10, 2) DEFAULT '0' NOT NULL,
	"payment_status" text DEFAULT 'unpaid' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "activity" (
	"id" serial PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"message" text NOT NULL,
	"user_id" text,
	"user_name" text,
	"program_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "venues" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"address" text NOT NULL,
	"city" text DEFAULT 'Lexington' NOT NULL,
	"state" text DEFAULT 'KY' NOT NULL,
	"zip" text,
	"phone" text,
	"website" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "age_groups" (
	"id" serial PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"min_age" integer,
	"max_age" integer,
	"division" text DEFAULT 'youth' NOT NULL,
	"display_order" integer DEFAULT 0 NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "guardians" (
	"id" serial PRIMARY KEY NOT NULL,
	"guardian_user_id" integer NOT NULL,
	"youth_user_id" integer NOT NULL,
	"relationship" text DEFAULT 'parent' NOT NULL,
	"is_primary" boolean DEFAULT true NOT NULL,
	"can_register" boolean DEFAULT true NOT NULL,
	"can_pickup" boolean DEFAULT true NOT NULL,
	"status" "guardian_status" DEFAULT 'pending' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "staff_profiles" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"title" text,
	"bio" text,
	"certifications" text[] DEFAULT '{}' NOT NULL,
	"background_check_status" text DEFAULT 'pending' NOT NULL,
	"background_check_date" date,
	"scoped_permissions" text[] DEFAULT '{}' NOT NULL,
	"can_manage_leagues" boolean DEFAULT false NOT NULL,
	"can_manage_camps" boolean DEFAULT false NOT NULL,
	"can_manage_dropins" boolean DEFAULT false NOT NULL,
	"can_manage_tournaments" boolean DEFAULT false NOT NULL,
	"can_view_registrations" boolean DEFAULT true NOT NULL,
	"can_edit_registrations" boolean DEFAULT false NOT NULL,
	"can_manage_users" boolean DEFAULT false NOT NULL,
	"can_manage_courts" boolean DEFAULT false NOT NULL,
	"can_manage_venues" boolean DEFAULT false NOT NULL,
	"can_manage_age_groups" boolean DEFAULT false NOT NULL,
	"can_view_reports" boolean DEFAULT false NOT NULL,
	"can_process_refunds" boolean DEFAULT false NOT NULL,
	"can_manage_schedules" boolean DEFAULT false NOT NULL,
	"can_manage_assignments" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staff_profiles_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"actor_user_id" integer,
	"actor_clerk_id" text,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text,
	"before" text,
	"after" text,
	"ip_address" text,
	"user_agent" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"channel" text DEFAULT 'in_app' NOT NULL,
	"type" text NOT NULL,
	"subject" text,
	"body" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"error_message" text,
	"sent_at" timestamp with time zone,
	"read_at" timestamp with time zone,
	"metadata" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pricing_rules" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"category" "pricing_category" NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"is_latest" boolean DEFAULT true NOT NULL,
	"superseded_by_id" integer,
	"base_price" numeric(10, 2),
	"member_price" numeric(10, 2),
	"deposit_amount" numeric(10, 2),
	"deposit_required" boolean DEFAULT false,
	"balance_due_date" date,
	"skill_tier_pricing" text,
	"pack_size" integer,
	"pack_price" numeric(10, 2),
	"pricing_basis" text,
	"early_bird_price" numeric(10, 2),
	"early_bird_cutoff" date,
	"late_fee" numeric(10, 2),
	"sibling_discount_pct" numeric(5, 2),
	"team_fee" numeric(10, 2),
	"player_fee" numeric(10, 2),
	"installment_plan" boolean DEFAULT false,
	"installment_count" integer,
	"team_entry_fee" numeric(10, 2),
	"per_player_fee" numeric(10, 2),
	"notes" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by_clerk_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "facility_split_rules" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"venue_id" integer,
	"offering_type" text,
	"offering_id" integer,
	"split_type" "split_type" DEFAULT 'percentage' NOT NULL,
	"facility_pct" numeric(5, 2),
	"flat_fee" numeric(10, 2),
	"flat_fee_unit" text,
	"version" integer DEFAULT 1 NOT NULL,
	"is_latest" boolean DEFAULT true NOT NULL,
	"superseded_by_id" integer,
	"is_active" boolean DEFAULT true NOT NULL,
	"notes" text,
	"created_by_clerk_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recurring_schedule_rules" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" integer,
	"court_id" integer,
	"day_of_week" integer NOT NULL,
	"start_time" time NOT NULL,
	"end_time" time NOT NULL,
	"duration_minutes" integer DEFAULT 60 NOT NULL,
	"format" text,
	"max_participants" integer,
	"is_active" boolean DEFAULT true NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "external_calendars" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"provider" text DEFAULT 'google' NOT NULL,
	"calendar_id" text,
	"access_token_encrypted" text,
	"refresh_token_encrypted" text,
	"token_expires_at" timestamp with time zone,
	"sync_enabled" boolean DEFAULT true NOT NULL,
	"last_synced_at" timestamp with time zone,
	"last_sync_error" text,
	"webhook_channel" text,
	"webhook_expiry" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "schedule_proposals" (
	"id" serial PRIMARY KEY NOT NULL,
	"created_by_user_id" integer,
	"reviewed_by_user_id" integer,
	"status" text DEFAULT 'draft' NOT NULL,
	"entity_type" text,
	"entity_id" integer,
	"proposal_data" text,
	"conflict_summary" text,
	"notes" text,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "event_suggestions" (
	"id" serial PRIMARY KEY NOT NULL,
	"submitted_by_user_id" integer,
	"entity_type" text DEFAULT 'drop_in' NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"suggested_date" date,
	"suggested_age_group" text,
	"suggested_format" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"review_notes" text,
	"reviewed_by_user_id" integer,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assistant_conversations" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"title" text,
	"messages" text DEFAULT '[]' NOT NULL,
	"context" text,
	"model" text DEFAULT 'gpt-4o' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_message_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "age_group_mappings" (
	"id" serial PRIMARY KEY NOT NULL,
	"age_group_id" integer NOT NULL,
	"default_court_id" integer,
	"default_format" text DEFAULT '5v5' NOT NULL,
	"default_duration_minutes" integer DEFAULT 60 NOT NULL,
	"timeband_start" text,
	"timeband_end" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "player_profiles" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"display_name" text,
	"date_of_birth" date,
	"gender" text,
	"dominant_foot" text DEFAULT 'right',
	"primary_position" text,
	"secondary_position" text,
	"jersey_number" text,
	"height_cm" integer,
	"weight_kg" integer,
	"bio" text,
	"profile_photo_url" text,
	"qr_code" text,
	"emergency_contact_name" text,
	"emergency_contact_phone" text,
	"emergency_contact_relationship" text,
	"medical_conditions" text,
	"allergies" text,
	"fitness_level" text DEFAULT 'recreational',
	"is_public" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "player_profiles_user_id_unique" UNIQUE("user_id"),
	CONSTRAINT "player_profiles_qr_code_unique" UNIQUE("qr_code")
);
--> statement-breakpoint
CREATE TABLE "fixtures" (
	"id" serial PRIMARY KEY NOT NULL,
	"entity_type" text DEFAULT 'league' NOT NULL,
	"entity_id" integer NOT NULL,
	"home_team_id" integer,
	"away_team_id" integer,
	"court_id" integer,
	"scheduled_at" timestamp with time zone,
	"duration_minutes" integer DEFAULT 60 NOT NULL,
	"home_score" integer,
	"away_score" integer,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"round" integer,
	"phase" text DEFAULT 'group',
	"referee_user_id" integer,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "standings" (
	"id" serial PRIMARY KEY NOT NULL,
	"league_id" integer NOT NULL,
	"season_id" integer,
	"team_id" integer NOT NULL,
	"games_played" integer DEFAULT 0 NOT NULL,
	"wins" integer DEFAULT 0 NOT NULL,
	"draws" integer DEFAULT 0 NOT NULL,
	"losses" integer DEFAULT 0 NOT NULL,
	"goals_for" integer DEFAULT 0 NOT NULL,
	"goals_against" integer DEFAULT 0 NOT NULL,
	"goal_difference" integer DEFAULT 0 NOT NULL,
	"points" integer DEFAULT 0 NOT NULL,
	"rank" integer,
	"group" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "brackets" (
	"id" serial PRIMARY KEY NOT NULL,
	"tournament_id" integer NOT NULL,
	"name" text NOT NULL,
	"bracket_type" text DEFAULT 'single_elimination' NOT NULL,
	"age_group" text,
	"total_teams" integer,
	"current_round" integer DEFAULT 1 NOT NULL,
	"total_rounds" integer,
	"status" text DEFAULT 'draft' NOT NULL,
	"is_locked" boolean DEFAULT false NOT NULL,
	"bracket_data" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "spots" (
	"id" serial PRIMARY KEY NOT NULL,
	"entity_type" text DEFAULT 'dropin' NOT NULL,
	"entity_id" integer NOT NULL,
	"user_id" integer,
	"status" text DEFAULT 'reserved' NOT NULL,
	"waitlisted" boolean DEFAULT false NOT NULL,
	"waitlist_position" integer,
	"confirmed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"cancellation_reason" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "check_ins" (
	"id" serial PRIMARY KEY NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" integer NOT NULL,
	"user_id" integer,
	"checked_in_by_user_id" integer,
	"method" text DEFAULT 'qr' NOT NULL,
	"qr_code_scanned" text,
	"is_manual" boolean DEFAULT false NOT NULL,
	"notes" text,
	"checked_in_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "waiver_signatures" (
	"id" serial PRIMARY KEY NOT NULL,
	"template_id" integer NOT NULL,
	"user_id" integer,
	"entity_type" text,
	"entity_id" integer,
	"signed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"signature_data" text,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "waiver_templates" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"body" text NOT NULL,
	"applicable_to" text DEFAULT 'all' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"entity_type" text NOT NULL,
	"entity_id" integer NOT NULL,
	"registration_id" integer,
	"amount" numeric(10, 2) NOT NULL,
	"currency" text DEFAULT 'usd' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"provider" text DEFAULT 'stripe' NOT NULL,
	"provider_payment_id" text,
	"provider_charge_id" text,
	"provider_customer_id" text,
	"payment_method" text,
	"receipt_url" text,
	"failure_reason" text,
	"refunded" boolean DEFAULT false NOT NULL,
	"refunded_at" timestamp with time zone,
	"refund_amount" numeric(10, 2),
	"metadata" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payouts" (
	"id" serial PRIMARY KEY NOT NULL,
	"recipient_user_id" integer,
	"amount" numeric(10, 2) NOT NULL,
	"currency" text DEFAULT 'usd' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"payout_type" text DEFAULT 'referee_fee' NOT NULL,
	"provider" text DEFAULT 'stripe',
	"provider_payout_id" text,
	"period_start" timestamp with time zone,
	"period_end" timestamp with time zone,
	"description" text,
	"notes" text,
	"processed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "revenue_records" (
	"id" serial PRIMARY KEY NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" integer,
	"payment_id" integer,
	"split_rule_id" integer,
	"pricing_rule_id" integer,
	"gross_amount" numeric(10, 2) NOT NULL,
	"facility_amount" numeric(10, 2) DEFAULT '0' NOT NULL,
	"service_fee_amount" numeric(10, 2) DEFAULT '0' NOT NULL,
	"playon_net" numeric(10, 2) NOT NULL,
	"currency" text DEFAULT 'usd' NOT NULL,
	"revenue_date" date NOT NULL,
	"category" text DEFAULT 'registration' NOT NULL,
	"description" text,
	"metadata" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "membership_plans" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"price" numeric(10, 2) NOT NULL,
	"billing_cycle" text DEFAULT 'monthly' NOT NULL,
	"trial_days" integer DEFAULT 0 NOT NULL,
	"features" text[] DEFAULT '{}' NOT NULL,
	"discount_percent" numeric(5, 2) DEFAULT '0' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_memberships" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"plan_id" integer NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date,
	"renews_at" date,
	"cancelled_at" timestamp with time zone,
	"provider_subscription_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "discount_codes" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"description" text,
	"discount_type" text DEFAULT 'percent' NOT NULL,
	"discount_value" numeric(10, 2) NOT NULL,
	"applicable_to" text DEFAULT 'all' NOT NULL,
	"entity_type" text,
	"entity_id" integer,
	"max_uses" integer,
	"times_used" integer DEFAULT 0 NOT NULL,
	"min_order_amount" numeric(10, 2),
	"valid_from" timestamp with time zone,
	"valid_until" timestamp with time zone,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "discount_codes_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "service_fee_configs" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"fee_percent" numeric(5, 2) DEFAULT '3.00' NOT NULL,
	"max_fee_amount" numeric(10, 2),
	"min_fee_amount" numeric(10, 2),
	"applies_to_card" boolean DEFAULT true NOT NULL,
	"applies_to_external" boolean DEFAULT false NOT NULL,
	"non_refundable" boolean DEFAULT true NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"notes" text,
	"created_by_clerk_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "refund_credit_policies" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"entity_type" text DEFAULT 'all' NOT NULL,
	"refund_type" text DEFAULT 'credit' NOT NULL,
	"window_days" integer DEFAULT 7 NOT NULL,
	"refund_percent" numeric(5, 2) DEFAULT '100.00' NOT NULL,
	"credit_percent" numeric(5, 2) DEFAULT '100.00' NOT NULL,
	"non_refundable_amount" numeric(10, 2) DEFAULT '0' NOT NULL,
	"allow_partial_refund" boolean DEFAULT true NOT NULL,
	"requires_admin_approval" boolean DEFAULT false NOT NULL,
	"notes" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "account_credits" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"amount" numeric(10, 2) NOT NULL,
	"remaining_amount" numeric(10, 2) NOT NULL,
	"currency" text DEFAULT 'usd' NOT NULL,
	"reason" text DEFAULT 'refund' NOT NULL,
	"source_entity_type" text,
	"source_entity_id" integer,
	"source_payment_id" integer,
	"expires_at" timestamp with time zone,
	"used_at" timestamp with time zone,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assignments" (
	"id" serial PRIMARY KEY NOT NULL,
	"staff_user_id" integer NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" integer NOT NULL,
	"role" text DEFAULT 'referee' NOT NULL,
	"start_at" timestamp with time zone,
	"end_at" timestamp with time zone,
	"status" text DEFAULT 'assigned' NOT NULL,
	"confirmed_at" timestamp with time zone,
	"declined_at" timestamp with time zone,
	"decline_reason" text,
	"compensation_amount" text,
	"is_paid" boolean DEFAULT false NOT NULL,
	"paid_at" timestamp with time zone,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "incident_reports" (
	"id" serial PRIMARY KEY NOT NULL,
	"reported_by_user_id" integer,
	"reviewed_by_user_id" integer,
	"entity_type" text,
	"entity_id" integer,
	"involved_user_ids" text[] DEFAULT '{}' NOT NULL,
	"incident_type" text DEFAULT 'general' NOT NULL,
	"severity" text DEFAULT 'low' NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"action_taken" text,
	"status" text DEFAULT 'open' NOT NULL,
	"is_confidential" boolean DEFAULT false NOT NULL,
	"occurred_at" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	"follow_up_required" boolean DEFAULT false NOT NULL,
	"attachment_urls" text[] DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "offerings" (
	"id" serial PRIMARY KEY NOT NULL,
	"program_type" "offering_type" NOT NULL,
	"program_id" integer NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "offerings_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "qr_codes" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"scope" "qr_code_scope" DEFAULT 'check_in' NOT NULL,
	"user_id" integer,
	"entity_type" text,
	"entity_id" integer,
	"is_active" boolean DEFAULT true NOT NULL,
	"scanned_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "qr_codes_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "sub_ref_alerts" (
	"id" serial PRIMARY KEY NOT NULL,
	"requested_by_user_id" integer NOT NULL,
	"claimed_by_user_id" integer,
	"fixture_id" integer,
	"game_date" timestamp with time zone,
	"notes" text,
	"status" "sub_ref_alert_status" DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "guardians" ADD CONSTRAINT "guardians_guardian_user_id_users_id_fk" FOREIGN KEY ("guardian_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guardians" ADD CONSTRAINT "guardians_youth_user_id_users_id_fk" FOREIGN KEY ("youth_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_profiles" ADD CONSTRAINT "staff_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "facility_split_rules" ADD CONSTRAINT "facility_split_rules_venue_id_venues_id_fk" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_schedule_rules" ADD CONSTRAINT "recurring_schedule_rules_court_id_courts_id_fk" FOREIGN KEY ("court_id") REFERENCES "public"."courts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_calendars" ADD CONSTRAINT "external_calendars_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_proposals" ADD CONSTRAINT "schedule_proposals_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_proposals" ADD CONSTRAINT "schedule_proposals_reviewed_by_user_id_users_id_fk" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_suggestions" ADD CONSTRAINT "event_suggestions_submitted_by_user_id_users_id_fk" FOREIGN KEY ("submitted_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_suggestions" ADD CONSTRAINT "event_suggestions_reviewed_by_user_id_users_id_fk" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_conversations" ADD CONSTRAINT "assistant_conversations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "age_group_mappings" ADD CONSTRAINT "age_group_mappings_age_group_id_age_groups_id_fk" FOREIGN KEY ("age_group_id") REFERENCES "public"."age_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "age_group_mappings" ADD CONSTRAINT "age_group_mappings_default_court_id_courts_id_fk" FOREIGN KEY ("default_court_id") REFERENCES "public"."courts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_profiles" ADD CONSTRAINT "player_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fixtures" ADD CONSTRAINT "fixtures_home_team_id_teams_id_fk" FOREIGN KEY ("home_team_id") REFERENCES "public"."teams"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fixtures" ADD CONSTRAINT "fixtures_away_team_id_teams_id_fk" FOREIGN KEY ("away_team_id") REFERENCES "public"."teams"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fixtures" ADD CONSTRAINT "fixtures_court_id_courts_id_fk" FOREIGN KEY ("court_id") REFERENCES "public"."courts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "standings" ADD CONSTRAINT "standings_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spots" ADD CONSTRAINT "spots_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "check_ins" ADD CONSTRAINT "check_ins_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "check_ins" ADD CONSTRAINT "check_ins_checked_in_by_user_id_users_id_fk" FOREIGN KEY ("checked_in_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waiver_signatures" ADD CONSTRAINT "waiver_signatures_template_id_waiver_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."waiver_templates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waiver_signatures" ADD CONSTRAINT "waiver_signatures_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_recipient_user_id_users_id_fk" FOREIGN KEY ("recipient_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_memberships" ADD CONSTRAINT "user_memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_memberships" ADD CONSTRAINT "user_memberships_plan_id_membership_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."membership_plans"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_credits" ADD CONSTRAINT "account_credits_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_staff_user_id_users_id_fk" FOREIGN KEY ("staff_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incident_reports" ADD CONSTRAINT "incident_reports_reported_by_user_id_users_id_fk" FOREIGN KEY ("reported_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incident_reports" ADD CONSTRAINT "incident_reports_reviewed_by_user_id_users_id_fk" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qr_codes" ADD CONSTRAINT "qr_codes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sub_ref_alerts" ADD CONSTRAINT "sub_ref_alerts_requested_by_user_id_users_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sub_ref_alerts" ADD CONSTRAINT "sub_ref_alerts_claimed_by_user_id_users_id_fk" FOREIGN KEY ("claimed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;