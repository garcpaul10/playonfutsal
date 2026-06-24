/**
 * ensure-schema.mjs
 *
 * Non-interactive, idempotent schema enforcement script.
 * Applies all columns that the Drizzle schema defines but that may be
 * absent from the database (e.g. after a failed `drizzle-kit push` in CI).
 *
 * Safe to run multiple times — every ALTER TABLE uses ADD COLUMN IF NOT EXISTS.
 * Exits 0 on success, 1 on failure.
 *
 * Usage: pnpm --filter db run ensure-schema
 */

import pkg from "pg";
const { Pool } = pkg;

if (!process.env.DATABASE_URL) {
  console.error("[ensure-schema] DATABASE_URL is not set");
  process.exit(1);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const MIGRATIONS = [
  {
    name: "0080 — dropin_templates family (template-first lazy-materialization)",
    sql: `
      CREATE TABLE IF NOT EXISTS dropin_templates (
        id                          SERIAL PRIMARY KEY,
        name                        TEXT NOT NULL,
        sport                       TEXT NOT NULL DEFAULT 'basketball',
        venue_id                    INTEGER,
        description                 TEXT,
        image_url                   TEXT,
        recurrence_rule             JSONB NOT NULL,
        is_draft                    BOOLEAN NOT NULL DEFAULT true,
        is_published                BOOLEAN NOT NULL DEFAULT false,
        publish_at                  TIMESTAMPTZ,
        staff_user_id               INTEGER,
        auto_cancel_threshold       INTEGER,
        registration_cutoff_minutes INTEGER,
        registration_opens          TEXT NOT NULL DEFAULT 'immediately',
        registration_opens_at       TIMESTAMPTZ,
        waitlist_enabled            BOOLEAN NOT NULL DEFAULT true,
        auto_promote_enabled        BOOLEAN NOT NULL DEFAULT false,
        created_by_clerk_id         TEXT,
        created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS dropin_template_pools (
        id                           SERIAL PRIMARY KEY,
        template_id                  INTEGER NOT NULL REFERENCES dropin_templates(id) ON DELETE CASCADE,
        court_id                     INTEGER NOT NULL,
        cap                          INTEGER NOT NULL DEFAULT 15,
        price                        NUMERIC(10,2) NOT NULL DEFAULT 0,
        age_group                    TEXT[] NOT NULL DEFAULT '{adult}',
        skill_level                  TEXT NOT NULL DEFAULT 'all',
        gender                       TEXT,
        early_bird_pricing           JSONB,
        cancellation_phase_overrides JSONB,
        offer_window_minutes         INTEGER NOT NULL DEFAULT 240,
        sort_order                   INTEGER NOT NULL DEFAULT 0,
        created_at                   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at                   TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS dropin_occurrences (
        id                        SERIAL PRIMARY KEY,
        template_id               INTEGER NOT NULL REFERENCES dropin_templates(id) ON DELETE CASCADE,
        forked_from_template_id   INTEGER,
        occurrence_date           TEXT NOT NULL,
        status                    TEXT NOT NULL DEFAULT 'upcoming',
        cancelled_reason          TEXT,
        materialized_dropin_id    INTEGER,
        created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (template_id, occurrence_date)
      );
      CREATE UNIQUE INDEX IF NOT EXISTS dropin_occurrences_template_date_uidx
        ON dropin_occurrences (template_id, occurrence_date);
      CREATE TABLE IF NOT EXISTS dropin_occurrence_overrides (
        id                SERIAL PRIMARY KEY,
        occurrence_id     INTEGER NOT NULL REFERENCES dropin_occurrences(id) ON DELETE CASCADE,
        template_pool_id  INTEGER REFERENCES dropin_template_pools(id) ON DELETE CASCADE,
        field             TEXT NOT NULL,
        value             JSONB,
        created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS dropin_pool_presets (
        id                  SERIAL PRIMARY KEY,
        created_by_user_id  INTEGER,
        name                TEXT NOT NULL,
        config              JSONB NOT NULL,
        created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `,
  },
  {
    name: "0081 — dropin_template_pools per-pool time overrides (start_time, duration_minutes)",
    sql: `
      ALTER TABLE "dropin_template_pools" ADD COLUMN IF NOT EXISTS "start_time" text;
      ALTER TABLE "dropin_template_pools" ADD COLUMN IF NOT EXISTS "duration_minutes" integer;
    `,
  },
  {
    name: "0082 — dropin_templates visibility flags (is_featured, show_on_mobile)",
    sql: `
      ALTER TABLE "dropin_templates" ADD COLUMN IF NOT EXISTS "is_featured"    boolean NOT NULL DEFAULT false;
      ALTER TABLE "dropin_templates" ADD COLUMN IF NOT EXISTS "show_on_mobile" boolean NOT NULL DEFAULT false;
    `,
  },
  {
    name: "0079 — session_templates recurrence_interval + recurrence_unit",
    sql: `
      ALTER TABLE "session_templates" ADD COLUMN IF NOT EXISTS "recurrence_interval" integer NOT NULL DEFAULT 1;
      ALTER TABLE "session_templates" ADD COLUMN IF NOT EXISTS "recurrence_unit" text NOT NULL DEFAULT 'week';
    `,
  },
  {
    name: "0077 — users.gender nullable text column for onboarding",
    sql: `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "gender" text;`,
  },
  {
    name: "0090 — Kings of The Court core tables",
    sql: `
      CREATE TABLE IF NOT EXISTS kotc_seasons (
        id                    SERIAL PRIMARY KEY,
        name                  TEXT NOT NULL,
        sport                 TEXT NOT NULL DEFAULT 'basketball',
        sport_config          JSONB NOT NULL DEFAULT '{}',
        gender_bracket        TEXT NOT NULL DEFAULT 'coed',
        age_bracket           TEXT NOT NULL DEFAULT 'open',
        team_size             INTEGER NOT NULL DEFAULT 4,
        win_condition         TEXT NOT NULL DEFAULT 'points',
        win_target            INTEGER NOT NULL DEFAULT 7,
        time_limit_minutes    INTEGER NOT NULL DEFAULT 5,
        grace_period_seconds  INTEGER NOT NULL DEFAULT 60,
        lives_required        INTEGER NOT NULL DEFAULT 3,
        max_teams_per_court   INTEGER NOT NULL DEFAULT 8,
        status                TEXT NOT NULL DEFAULT 'upcoming',
        starts_at             TIMESTAMPTZ,
        ends_at               TIMESTAMPTZ,
        venue_id              INTEGER,
        prior_season_id       INTEGER,
        champion_team_id      INTEGER,
        is_youth              BOOLEAN NOT NULL DEFAULT false,
        notes                 TEXT,
        created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS kotc_battles (
        id                    SERIAL PRIMARY KEY,
        season_id             INTEGER NOT NULL REFERENCES kotc_seasons(id) ON DELETE CASCADE,
        scheduled_at          TIMESTAMPTZ NOT NULL,
        venue_id              INTEGER,
        court_count           INTEGER NOT NULL DEFAULT 1,
        max_teams_per_court   INTEGER NOT NULL DEFAULT 8,
        duration_minutes      INTEGER NOT NULL DEFAULT 120,
        status                TEXT NOT NULL DEFAULT 'scheduled',
        started_at            TIMESTAMPTZ,
        ended_at              TIMESTAMPTZ,
        registration_cutoff_at TIMESTAMPTZ,
        notes                 TEXT,
        created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS kotc_battle_mods (
        id            SERIAL PRIMARY KEY,
        battle_id     INTEGER NOT NULL REFERENCES kotc_battles(id) ON DELETE CASCADE,
        user_id       INTEGER NOT NULL,
        court_number  INTEGER NOT NULL DEFAULT 1,
        assigned_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS kotc_teams (
        id               SERIAL PRIMARY KEY,
        season_id        INTEGER NOT NULL REFERENCES kotc_seasons(id) ON DELETE CASCADE,
        captain_user_id  INTEGER NOT NULL,
        name             TEXT NOT NULL,
        color            TEXT,
        logo_url         TEXT,
        lives_balance    INTEGER NOT NULL DEFAULT 0,
        lives_consumed   INTEGER NOT NULL DEFAULT 0,
        status           TEXT NOT NULL DEFAULT 'active',
        qr_code          TEXT NOT NULL UNIQUE,
        is_reigning      BOOLEAN NOT NULL DEFAULT false,
        created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS kotc_team_players (
        id                     SERIAL PRIMARY KEY,
        team_id                INTEGER NOT NULL REFERENCES kotc_teams(id) ON DELETE CASCADE,
        user_id                INTEGER NOT NULL,
        role                   TEXT NOT NULL DEFAULT 'player',
        status                 TEXT NOT NULL DEFAULT 'active',
        rules_acknowledged_at  TIMESTAMPTZ,
        invited_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        joined_at              TIMESTAMPTZ,
        created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS kotc_battle_registrations (
        id                      SERIAL PRIMARY KEY,
        battle_id               INTEGER NOT NULL REFERENCES kotc_battles(id) ON DELETE CASCADE,
        team_id                 INTEGER NOT NULL REFERENCES kotc_teams(id) ON DELETE CASCADE,
        court_number            INTEGER NOT NULL DEFAULT 1,
        acting_captain_user_id  INTEGER,
        status                  TEXT NOT NULL DEFAULT 'registered',
        registered_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        checked_in_at           TIMESTAMPTZ,
        withdrawn_at            TIMESTAMPTZ
      );

      CREATE TABLE IF NOT EXISTS kotc_rotation_queues (
        id              SERIAL PRIMARY KEY,
        battle_id       INTEGER NOT NULL REFERENCES kotc_battles(id) ON DELETE CASCADE,
        team_id         INTEGER NOT NULL REFERENCES kotc_teams(id) ON DELETE CASCADE,
        court_number    INTEGER NOT NULL DEFAULT 1,
        position        INTEGER NOT NULL,
        status          TEXT NOT NULL DEFAULT 'queued',
        grace_started_at TIMESTAMPTZ,
        grace_expires_at TIMESTAMPTZ,
        bowed_out_at    TIMESTAMPTZ,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS kotc_game_cards (
        id                 SERIAL PRIMARY KEY,
        battle_id          INTEGER NOT NULL REFERENCES kotc_battles(id) ON DELETE CASCADE,
        court_number       INTEGER NOT NULL DEFAULT 1,
        team1_id           INTEGER NOT NULL REFERENCES kotc_teams(id),
        team2_id           INTEGER NOT NULL REFERENCES kotc_teams(id),
        winner_team_id     INTEGER REFERENCES kotc_teams(id),
        loser_team_id      INTEGER REFERENCES kotc_teams(id),
        moderator_user_id  INTEGER,
        status             TEXT NOT NULL DEFAULT 'in_progress',
        scanned_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        completed_at       TIMESTAMPTZ,
        notes              TEXT,
        created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS kotc_life_ledger (
        id                SERIAL PRIMARY KEY,
        team_id           INTEGER NOT NULL REFERENCES kotc_teams(id) ON DELETE CASCADE,
        delta             INTEGER NOT NULL,
        reason            TEXT NOT NULL,
        reference_type    TEXT,
        reference_id      INTEGER,
        balance_after     INTEGER NOT NULL,
        created_by_user_id INTEGER,
        created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `,
  },
  {
    name: "0091 — KotC Phase 2: economy + waitlist tables",
    sql: `
      -- Add life packs config and waitlist window to seasons
      ALTER TABLE kotc_seasons ADD COLUMN IF NOT EXISTS life_packs JSONB NOT NULL DEFAULT '[]';
      ALTER TABLE kotc_seasons ADD COLUMN IF NOT EXISTS waitlist_window_minutes INTEGER NOT NULL DEFAULT 15;
    `,
  },
  {
    name: "0092 — KotC discovery visibility flags",
    sql: `
      ALTER TABLE kotc_seasons ADD COLUMN IF NOT EXISTS is_published   BOOLEAN NOT NULL DEFAULT false;
      ALTER TABLE kotc_seasons ADD COLUMN IF NOT EXISTS is_featured    BOOLEAN NOT NULL DEFAULT false;
      ALTER TABLE kotc_seasons ADD COLUMN IF NOT EXISTS show_on_mobile BOOLEAN NOT NULL DEFAULT false;

      -- Add economy + purchase tracking to teams
      ALTER TABLE kotc_teams ADD COLUMN IF NOT EXISTS first_purchase_at TIMESTAMPTZ;
      ALTER TABLE kotc_teams ADD COLUMN IF NOT EXISTS guardian_spending_cap_cents INTEGER;
      ALTER TABLE kotc_teams ADD COLUMN IF NOT EXISTS total_purchased_cents INTEGER NOT NULL DEFAULT 0;

      -- Add pause + waitlist lock to battles
      ALTER TABLE kotc_battles ADD COLUMN IF NOT EXISTS paused_at TIMESTAMPTZ;
      ALTER TABLE kotc_battles ADD COLUMN IF NOT EXISTS paused_duration_seconds INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE kotc_battles ADD COLUMN IF NOT EXISTS waitlist_locked_at TIMESTAMPTZ;

      -- Add dispute override to game cards
      ALTER TABLE kotc_game_cards ADD COLUMN IF NOT EXISTS is_disputed BOOLEAN NOT NULL DEFAULT false;
      ALTER TABLE kotc_game_cards ADD COLUMN IF NOT EXISTS dispute_override_by_user_id INTEGER;
      ALTER TABLE kotc_game_cards ADD COLUMN IF NOT EXISTS dispute_override_notes TEXT;

      -- Drama rules
      CREATE TABLE IF NOT EXISTS kotc_drama_rules (
        id                    SERIAL PRIMARY KEY,
        season_id             INTEGER NOT NULL REFERENCES kotc_seasons(id) ON DELETE CASCADE,
        name                  TEXT NOT NULL,
        trigger_type          TEXT NOT NULL,
        threshold             INTEGER NOT NULL DEFAULT 1,
        reward_lives          INTEGER NOT NULL DEFAULT 1,
        notification_message  TEXT NOT NULL,
        is_active             BOOLEAN NOT NULL DEFAULT true,
        created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      -- Waitlist
      CREATE TABLE IF NOT EXISTS kotc_waitlist (
        id               SERIAL PRIMARY KEY,
        battle_id        INTEGER NOT NULL REFERENCES kotc_battles(id) ON DELETE CASCADE,
        team_id          INTEGER NOT NULL REFERENCES kotc_teams(id) ON DELETE CASCADE,
        position         INTEGER NOT NULL,
        status           TEXT NOT NULL DEFAULT 'waiting',
        carry_forward    BOOLEAN NOT NULL DEFAULT false,
        notified_at      TIMESTAMPTZ,
        response_deadline TIMESTAMPTZ,
        confirmed_at     TIMESTAMPTZ,
        released_at      TIMESTAMPTZ,
        created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      -- Pending purchases (guardian approval flow for youth teams)
      CREATE TABLE IF NOT EXISTS kotc_pending_purchases (
        id                 SERIAL PRIMARY KEY,
        team_id            INTEGER NOT NULL REFERENCES kotc_teams(id) ON DELETE CASCADE,
        season_id          INTEGER NOT NULL REFERENCES kotc_seasons(id) ON DELETE CASCADE,
        guardian_user_id   INTEGER REFERENCES users(id) ON DELETE SET NULL,
        pack_index         INTEGER NOT NULL,
        pack_name          TEXT NOT NULL,
        pack_lives         INTEGER NOT NULL,
        pack_price_cents   INTEGER NOT NULL,
        stripe_session_id  TEXT,
        status             TEXT NOT NULL DEFAULT 'pending',
        expires_at         TIMESTAMPTZ,
        processed_at       TIMESTAMPTZ,
        created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `,
  },
  {
    name: "0076 — users.role drop DEFAULT + NOT NULL (nullable for new unboarded users)",
    sql: `
      ALTER TABLE "users" ALTER COLUMN "role" DROP DEFAULT;
      ALTER TABLE "users" ALTER COLUMN "role" DROP NOT NULL;
    `,
  },
  {
    name: "0075 — users.id_photo_url for private ID photo storage",
    sql: `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "id_photo_url" text;`,
  },
  {
    name: "0074 — dropin_court_pools.cancellation_phase_overrides JSONB column",
    sql: `ALTER TABLE "dropin_court_pools" ADD COLUMN IF NOT EXISTS "cancellation_phase_overrides" jsonb;`,
  },
  {
    name: "0073 — spots.stripe_checkout_session_id for pre-created waitlist offer sessions",
    sql: `ALTER TABLE "spots" ADD COLUMN IF NOT EXISTS "stripe_checkout_session_id" text;`,
  },
  {
    name: "0072 — spots offer tracking + dropin_court_pools offer window",
    sql: `
      ALTER TABLE "spots"
        ADD COLUMN IF NOT EXISTS "offer_sent_at"    timestamp with time zone,
        ADD COLUMN IF NOT EXISTS "offer_expires_at" timestamp with time zone;
      ALTER TABLE "dropin_court_pools"
        ADD COLUMN IF NOT EXISTS "offer_window_minutes" integer NOT NULL DEFAULT 240;
    `,
  },
  {
    name: "0015 — users.stripe_customer_id",
    sql: `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "stripe_customer_id" text;`,
  },
  {
    name: "0018 — users.roles",
    sql: `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "roles" text[] NOT NULL DEFAULT '{}';`,
  },
  {
    name: "0021 — users address + id_verified fields",
    sql: `
      ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "address_line1" text;
      ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "address_line2" text;
      ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "city" text;
      ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "state" text;
      ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "zip" text;
      ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "id_verified" boolean NOT NULL DEFAULT false;
      ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "id_verified_at" timestamp with time zone;
    `,
  },
  {
    name: "0022 — users encrypted ID fields",
    sql: `
      ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "id_first_name" text;
      ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "id_last_name" text;
      ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "id_dob" text;
      ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "id_address" text;
    `,
  },
  {
    name: "0027 — users.admin_level + staff_profiles permission toggles",
    sql: `
      ALTER TABLE "users"
        ADD COLUMN IF NOT EXISTS "admin_level" text NOT NULL DEFAULT 'super';
      ALTER TABLE "staff_profiles"
        ADD COLUMN IF NOT EXISTS "can_manage_payouts"       boolean NOT NULL DEFAULT false;
      ALTER TABLE "staff_profiles"
        ADD COLUMN IF NOT EXISTS "can_manage_announcements" boolean NOT NULL DEFAULT false;
      ALTER TABLE "staff_profiles"
        ADD COLUMN IF NOT EXISTS "can_manage_game_cards"    boolean NOT NULL DEFAULT false;
    `,
  },
  {
    name: "0030 — league_free_agents AI matching columns",
    sql: `
      ALTER TABLE "league_free_agents"
        ADD COLUMN IF NOT EXISTS "positions" text,
        ADD COLUMN IF NOT EXISTS "skill_level" text,
        ADD COLUMN IF NOT EXISTS "availability" text,
        ADD COLUMN IF NOT EXISTS "match_status" text DEFAULT 'unmatched',
        ADD COLUMN IF NOT EXISTS "proposed_team_id" integer REFERENCES "teams"("id") ON DELETE SET NULL,
        ADD COLUMN IF NOT EXISTS "proposed_at" timestamp with time zone,
        ADD COLUMN IF NOT EXISTS "match_reasoning" text;
    `,
  },
  {
    name: "0031 — camp_registrations skill/shirt/health-packet columns",
    sql: `
      ALTER TABLE "camp_registrations"
        ADD COLUMN IF NOT EXISTS "skill_level" text,
        ADD COLUMN IF NOT EXISTS "shirt_size" text,
        ADD COLUMN IF NOT EXISTS "health_packet_json" text,
        ADD COLUMN IF NOT EXISTS "health_packet_submitted_at" timestamp with time zone;
    `,
  },
  {
    name: "0032 — team_members.notes for schedule conflicts",
    sql: `ALTER TABLE "team_members" ADD COLUMN IF NOT EXISTS "notes" text;`,
  },
  {
    name: "0033 — dropins.age_group text → text[] (multi-age-group support)",
    sql: `
      DO $$
      BEGIN
        IF (SELECT data_type FROM information_schema.columns
            WHERE table_name = 'dropins' AND column_name = 'age_group') <> 'ARRAY' THEN
          ALTER TABLE "dropins"
            ALTER COLUMN "age_group" TYPE text[]
            USING ARRAY["age_group"]::text[];
        END IF;
      END $$;
    `,
  },
  {
    name: "0034 — add gender column to leagues, tournaments, camps, dropins",
    sql: `
      ALTER TABLE "leagues"      ADD COLUMN IF NOT EXISTS "gender" text;
      ALTER TABLE "tournaments"  ADD COLUMN IF NOT EXISTS "gender" text;
      ALTER TABLE "camps"        ADD COLUMN IF NOT EXISTS "gender" text;
      ALTER TABLE "dropins"      ADD COLUMN IF NOT EXISTS "gender" text;
    `,
  },
  {
    name: "0035 — expand legacy age group values in dropins text[] (u8_u11 → individual, u12_u15 → individual)",
    sql: `
      UPDATE "dropins"
        SET "age_group" = array_remove("age_group", 'u8_u11') || ARRAY['u8','u9','u10','u11']
        WHERE 'u8_u11' = ANY("age_group");
      UPDATE "dropins"
        SET "age_group" = array_remove("age_group", 'u12_u15') || ARRAY['u12','u13','u14','u15']
        WHERE 'u12_u15' = ANY("age_group");
    `,
  },
  {
    name: "0036 — preserve legacy age group bucket values in leagues, tournaments, camps (no-op: u8_u11/u12_u15 kept as-is to preserve eligibility scope)",
    sql: `SELECT 1;`,
  },
  {
    name: "0037 — convert ageGroup text → text[] in leagues, tournaments, camps and expand legacy bucket values",
    sql: `
      DO $$
      BEGIN
        IF (SELECT data_type FROM information_schema.columns WHERE table_name = 'leagues' AND column_name = 'age_group') <> 'ARRAY' THEN
          ALTER TABLE "leagues" ALTER COLUMN "age_group" TYPE text[] USING ARRAY["age_group"];
        END IF;
      END $$;
      UPDATE "leagues"     SET "age_group" = array_remove("age_group", 'u8_u11')  || ARRAY['u8','u9','u10','u11']  WHERE 'u8_u11'  = ANY("age_group");
      UPDATE "leagues"     SET "age_group" = array_remove("age_group", 'u12_u15') || ARRAY['u12','u13','u14','u15'] WHERE 'u12_u15' = ANY("age_group");

      DO $$
      BEGIN
        IF (SELECT data_type FROM information_schema.columns WHERE table_name = 'tournaments' AND column_name = 'age_group') <> 'ARRAY' THEN
          ALTER TABLE "tournaments" ALTER COLUMN "age_group" TYPE text[] USING ARRAY["age_group"];
        END IF;
      END $$;
      UPDATE "tournaments" SET "age_group" = array_remove("age_group", 'u8_u11')  || ARRAY['u8','u9','u10','u11']  WHERE 'u8_u11'  = ANY("age_group");
      UPDATE "tournaments" SET "age_group" = array_remove("age_group", 'u12_u15') || ARRAY['u12','u13','u14','u15'] WHERE 'u12_u15' = ANY("age_group");

      DO $$
      BEGIN
        IF (SELECT data_type FROM information_schema.columns WHERE table_name = 'camps' AND column_name = 'age_group') <> 'ARRAY' THEN
          ALTER TABLE "camps" ALTER COLUMN "age_group" TYPE text[] USING ARRAY["age_group"];
        END IF;
      END $$;
      UPDATE "camps"       SET "age_group" = array_remove("age_group", 'u8_u11')  || ARRAY['u8','u9','u10','u11']  WHERE 'u8_u11'  = ANY("age_group");
      UPDATE "camps"       SET "age_group" = array_remove("age_group", 'u12_u15') || ARRAY['u12','u13','u14','u15'] WHERE 'u12_u15' = ANY("age_group");
    `,
  },
  {
    name: "0038 — migrate drop_in_court_pools.age_group and session_templates.age_group from band values to per-year values",
    sql: `
      DO $$
      BEGIN
        IF (SELECT data_type FROM information_schema.columns
            WHERE table_name = 'dropin_court_pools' AND column_name = 'age_group') = 'text' THEN
          UPDATE "dropin_court_pools" SET "age_group" = 'u8'  WHERE "age_group" = 'u8_u11';
          UPDATE "dropin_court_pools" SET "age_group" = 'u12' WHERE "age_group" = 'u12_u15';
        END IF;
      END $$;

      UPDATE "session_templates"
        SET "age_group" = 'u8'
        WHERE "age_group" = 'u8_u11';
      UPDATE "session_templates"
        SET "age_group" = 'u12'
        WHERE "age_group" = 'u12_u15';
    `,
  },
  {
    name: "0039 — remove legacy band rows from age_groups canonical table",
    sql: `
      DELETE FROM "age_groups"
        WHERE "division" IN ('u8_u11', 'u12_u15')
           OR "label" IN ('8-11 Band', '12-15 Band', 'Youth Ages 8–11', 'Youth Ages 12–15', 'Youth Ages 8-11', 'Youth Ages 12-15');
    `,
  },
  {
    name: "0040 — fix admin_level column: drop NOT NULL + default, backfill non-admin users to null",
    sql: `
      ALTER TABLE "users" ALTER COLUMN "admin_level" DROP NOT NULL;
      ALTER TABLE "users" ALTER COLUMN "admin_level" DROP DEFAULT;
      UPDATE "users"
        SET "admin_level" = NULL
        WHERE "role" IN ('player', 'staff', 'scorekeeper', 'parent', 'ref', 'coach')
          AND "admin_level" = 'super';
    `,
  },
  {
    name: "0028 — waiver_signatures youth_user_id, expires_at, signature_type columns",
    sql: `
      ALTER TABLE "waiver_signatures" ADD COLUMN IF NOT EXISTS "youth_user_id" integer REFERENCES "users"("id") ON DELETE SET NULL;
      ALTER TABLE "waiver_signatures" ADD COLUMN IF NOT EXISTS "expires_at" timestamp with time zone;
      ALTER TABLE "waiver_signatures" ADD COLUMN IF NOT EXISTS "signature_type" text DEFAULT 'typed';
    `,
  },
  {
    name: "0041 — waiver_signatures entity_type + entity_id columns",
    sql: `
      ALTER TABLE "waiver_signatures" ADD COLUMN IF NOT EXISTS "entity_type" text;
      ALTER TABLE "waiver_signatures" ADD COLUMN IF NOT EXISTS "entity_id" integer;
    `,
  },
  {
    name: "0044 — camp_registrations.waitlist_position",
    sql: `ALTER TABLE "camp_registrations" ADD COLUMN IF NOT EXISTS "waitlist_position" integer;`,
  },
  {
    name: "0045 — league_registrations.waitlist_position",
    sql: `ALTER TABLE "league_registrations" ADD COLUMN IF NOT EXISTS "waitlist_position" integer;`,
  },
  {
    name: "0046 — tournament_registrations.waitlist_position",
    sql: `ALTER TABLE "tournament_registrations" ADD COLUMN IF NOT EXISTS "waitlist_position" integer;`,
  },
  {
    name: "0047 — registrations.waitlist_position",
    sql: `ALTER TABLE "registrations" ADD COLUMN IF NOT EXISTS "waitlist_position" integer;`,
  },
  {
    name: "0048 — session_templates ends_at + last_generated_at for rolling recurrence",
    sql: `
      ALTER TABLE "session_templates" ADD COLUMN IF NOT EXISTS "ends_at" timestamp with time zone;
      ALTER TABLE "session_templates" ADD COLUMN IF NOT EXISTS "last_generated_at" timestamp with time zone;
    `,
  },
  {
    name: "0042 — active time windows: startsAt/endsAt on leagues, tournaments, camps; activeOverride on all four",
    sql: `
      ALTER TABLE "leagues"
        ADD COLUMN IF NOT EXISTS "starts_at" timestamp with time zone,
        ADD COLUMN IF NOT EXISTS "ends_at" timestamp with time zone,
        ADD COLUMN IF NOT EXISTS "active_override" text;
      ALTER TABLE "tournaments"
        ADD COLUMN IF NOT EXISTS "starts_at" timestamp with time zone,
        ADD COLUMN IF NOT EXISTS "ends_at" timestamp with time zone,
        ADD COLUMN IF NOT EXISTS "active_override" text;
      ALTER TABLE "camps"
        ADD COLUMN IF NOT EXISTS "starts_at" timestamp with time zone,
        ADD COLUMN IF NOT EXISTS "ends_at" timestamp with time zone,
        ADD COLUMN IF NOT EXISTS "active_override" text;
      ALTER TABLE "dropins"
        ADD COLUMN IF NOT EXISTS "active_override" text;
    `,
  },
  {
    name: "0048 — partial unique indexes to block duplicate registrations at the DB level",
    sql: `
      CREATE UNIQUE INDEX IF NOT EXISTS spots_user_pool_active_unique
        ON "spots" (user_id, pool_id)
        WHERE status != 'cancelled' AND pool_id IS NOT NULL;

      CREATE UNIQUE INDEX IF NOT EXISTS camp_registrations_player_camp_active_unique
        ON "camp_registrations" (player_user_id, camp_id)
        WHERE status != 'cancelled';

      CREATE UNIQUE INDEX IF NOT EXISTS tournament_registrations_team_tournament_active_unique
        ON "tournament_registrations" (team_id, tournament_id)
        WHERE status != 'cancelled';

      CREATE UNIQUE INDEX IF NOT EXISTS league_registrations_team_league_active_unique
        ON "league_registrations" (team_id, league_id)
        WHERE status != 'cancelled';
    `,
  },
  {
    name: "0049 — fix league_registrations uniqueness: enforce per-user (not per-team) to close concurrent registration race",
    sql: `
      DROP INDEX IF EXISTS league_registrations_team_league_active_unique;

      CREATE UNIQUE INDEX IF NOT EXISTS league_registrations_user_league_active_unique
        ON "league_registrations" (registered_by_user_id, league_id)
        WHERE status != 'cancelled';
    `,
  },
  {
    name: "0050 — session_templates.skipped_dates for per-occurrence skip without deleting the series",
    sql: `ALTER TABLE "session_templates" ADD COLUMN IF NOT EXISTS "skipped_dates" text[] NOT NULL DEFAULT '{}';`,
  },
  {
    name: "0051 — dropins.max_players: drop NOT NULL + default (column retained as nullable for legacy reads)",
    sql: `
      ALTER TABLE "dropins" ALTER COLUMN "max_players" DROP NOT NULL;
      ALTER TABLE "dropins" ALTER COLUMN "max_players" DROP DEFAULT;
    `,
  },
  {
    name: "0052 — drop legacy dropins.players_registered counter (superseded by spots table aggregates)",
    sql: `ALTER TABLE "dropins" DROP COLUMN IF EXISTS "players_registered";`,
  },
  {
    name: "0053 — event visibility flags: isPublished, isFeatured, showOnMobile on all four event tables",
    sql: `
      ALTER TABLE "leagues"
        ADD COLUMN IF NOT EXISTS "is_published"   boolean NOT NULL DEFAULT true,
        ADD COLUMN IF NOT EXISTS "is_featured"    boolean NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS "show_on_mobile" boolean NOT NULL DEFAULT true;
      ALTER TABLE "tournaments"
        ADD COLUMN IF NOT EXISTS "is_published"   boolean NOT NULL DEFAULT true,
        ADD COLUMN IF NOT EXISTS "is_featured"    boolean NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS "show_on_mobile" boolean NOT NULL DEFAULT true;
      ALTER TABLE "camps"
        ADD COLUMN IF NOT EXISTS "is_published"   boolean NOT NULL DEFAULT true,
        ADD COLUMN IF NOT EXISTS "is_featured"    boolean NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS "show_on_mobile" boolean NOT NULL DEFAULT true;
      ALTER TABLE "dropins"
        ADD COLUMN IF NOT EXISTS "is_published"   boolean NOT NULL DEFAULT true,
        ADD COLUMN IF NOT EXISTS "is_featured"    boolean NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS "show_on_mobile" boolean NOT NULL DEFAULT true;
    `,
  },
  {
    name: "0055 — check_ins soft-void columns (voidedAt + voidedByUserId)",
    sql: `
      ALTER TABLE "check_ins"
        ADD COLUMN IF NOT EXISTS "voided_at" timestamp with time zone,
        ADD COLUMN IF NOT EXISTS "voided_by_user_id" integer REFERENCES "users"("id") ON DELETE SET NULL;
    `,
  },
  {
    name: "0054 — courts.venue_id: associate courts with a venue for revenue split resolution",
    sql: `ALTER TABLE "courts" ADD COLUMN IF NOT EXISTS "venue_id" integer;`,
  },
  {
    name: "0055 — spots.guardian_user_id for parent-on-behalf-of-child drop-in registrations",
    sql: `ALTER TABLE "spots" ADD COLUMN IF NOT EXISTS "guardian_user_id" integer REFERENCES "users"("id") ON DELETE SET NULL;`,
  },
  {
    name: "0056 — league_divisions table",
    sql: `
      CREATE TABLE IF NOT EXISTS "league_divisions" (
        "id" serial PRIMARY KEY,
        "league_id" integer NOT NULL REFERENCES "leagues"("id") ON DELETE CASCADE,
        "name" text NOT NULL,
        "age_groups" text[] NOT NULL DEFAULT '{}',
        "format" text,
        "division_order" integer NOT NULL DEFAULT 0,
        "created_at" timestamp with time zone NOT NULL DEFAULT now(),
        "updated_at" timestamp with time zone NOT NULL DEFAULT now()
      );
    `,
  },
  {
    name: "0057 — add division_id columns to teams, fixtures, standings",
    sql: `
      ALTER TABLE "teams"     ADD COLUMN IF NOT EXISTS "division_id" integer REFERENCES "league_divisions"("id") ON DELETE SET NULL;
      ALTER TABLE "fixtures"  ADD COLUMN IF NOT EXISTS "division_id" integer REFERENCES "league_divisions"("id") ON DELETE SET NULL;
      ALTER TABLE "standings" ADD COLUMN IF NOT EXISTS "division_id" integer REFERENCES "league_divisions"("id") ON DELETE SET NULL;
    `,
  },
  {
    name: "0058 — backfill default division per existing league and stamp division_id on teams/fixtures/standings",
    sql: `
      DO $$
      DECLARE
        r RECORD;
        div_id integer;
      BEGIN
        FOR r IN SELECT id, name, age_group, format FROM leagues LOOP
          -- Only create a default division if none exists yet
          SELECT id INTO div_id FROM league_divisions WHERE league_id = r.id LIMIT 1;
          IF div_id IS NULL THEN
            INSERT INTO league_divisions (league_id, name, age_groups, format, division_order)
            VALUES (r.id, 'Default Division', COALESCE(r.age_group, '{}'), r.format, 0)
            RETURNING id INTO div_id;
          END IF;

          -- Stamp teams
          UPDATE teams SET division_id = div_id
            WHERE league_id = r.id AND division_id IS NULL;

          -- Stamp fixtures
          UPDATE fixtures SET division_id = div_id
            WHERE entity_type = 'league' AND entity_id = r.id AND division_id IS NULL;

          -- Stamp standings
          UPDATE standings SET division_id = div_id
            WHERE league_id = r.id AND division_id IS NULL;
        END LOOP;
      END $$;
    `,
  },
  {
    name: "0059 — create unique index on standings(division_id, team_id) for division-scoped standings",
    sql: `
      CREATE UNIQUE INDEX IF NOT EXISTS standings_division_team_unique
        ON "standings" (division_id, team_id)
        WHERE division_id IS NOT NULL;
    `,
  },
  {
    name: "0060 — dropin_court_pools.age_group text → text[] (multi-age-group support)",
    sql: `
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
    `,
  },
  {
    name: "0061 — tournament_divisions table + division_id columns on brackets, tournament_seeds, tournament_registrations",
    sql: `
      CREATE TABLE IF NOT EXISTS "tournament_divisions" (
        "id" serial PRIMARY KEY,
        "tournament_id" integer NOT NULL REFERENCES "tournaments"("id") ON DELETE CASCADE,
        "name" text NOT NULL,
        "age_groups" text[] NOT NULL DEFAULT '{}',
        "bracket_format" text,
        "has_group_stage" boolean,
        "division_order" integer NOT NULL DEFAULT 0,
        "created_at" timestamp with time zone NOT NULL DEFAULT now(),
        "updated_at" timestamp with time zone NOT NULL DEFAULT now()
      );

      -- fixtures.division_id was added by migration 0057 with a FK to league_divisions.
      -- Tournament bracket generation also stores tournament_divisions IDs here, so we
      -- drop the FK constraint to make the column a bare integer usable by both systems.
      ALTER TABLE "fixtures" DROP CONSTRAINT IF EXISTS "fixtures_division_id_fkey";

      -- Add tournament-specific division columns not covered by the league migration.
      ALTER TABLE "brackets"                 ADD COLUMN IF NOT EXISTS "division_id" integer REFERENCES "tournament_divisions"("id") ON DELETE SET NULL;
      ALTER TABLE "tournament_seeds"         ADD COLUMN IF NOT EXISTS "division_id" integer REFERENCES "tournament_divisions"("id") ON DELETE SET NULL;
      ALTER TABLE "tournament_registrations" ADD COLUMN IF NOT EXISTS "division_id" integer REFERENCES "tournament_divisions"("id") ON DELETE SET NULL;

      -- Backfill: create a default "Main" division for each existing tournament.
      INSERT INTO "tournament_divisions" ("tournament_id", "name", "age_groups", "division_order")
      SELECT t.id, 'Main', COALESCE(t."age_group", ARRAY['adult']::text[]), 0
      FROM "tournaments" t
      WHERE t.id NOT IN (SELECT DISTINCT "tournament_id" FROM "tournament_divisions");

      -- Stamp tournament fixtures with the default division.
      UPDATE "fixtures" f
      SET "division_id" = d.id
      FROM "tournament_divisions" d
      WHERE f."entity_type" = 'tournament'
        AND f."entity_id" = d."tournament_id"
        AND f."division_id" IS NULL;

      -- Stamp brackets.
      UPDATE "brackets" b
      SET "division_id" = d.id
      FROM "tournament_divisions" d
      WHERE b."tournament_id" = d."tournament_id"
        AND b."division_id" IS NULL;

      -- Stamp tournament seeds.
      UPDATE "tournament_seeds" ts
      SET "division_id" = d.id
      FROM "tournament_divisions" d
      WHERE ts."tournament_id" = d."tournament_id"
        AND ts."division_id" IS NULL;

      -- Stamp tournament registrations.
      UPDATE "tournament_registrations" tr
      SET "division_id" = d.id
      FROM "tournament_divisions" d
      WHERE tr."tournament_id" = d."tournament_id"
        AND tr."division_id" IS NULL;
    `,
  },
  {
    name: "0062 — session_templates price + gender for pool-level logistics propagation",
    sql: `
      ALTER TABLE "session_templates"
        ADD COLUMN IF NOT EXISTS "price"  numeric(10,2) NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS "gender" text;
    `,
  },
  {
    name: "0061 — dropin_court_pools logistics columns (moved from session level)",
    sql: `
      ALTER TABLE "dropin_court_pools"
        ADD COLUMN IF NOT EXISTS "starts_at"                   timestamp with time zone,
        ADD COLUMN IF NOT EXISTS "duration_minutes"            integer        NOT NULL DEFAULT 120,
        ADD COLUMN IF NOT EXISTS "price"                       numeric(10,2)  NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS "cancellation_window_minutes" integer        NOT NULL DEFAULT 120,
        ADD COLUMN IF NOT EXISTS "registration_open"           boolean        NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS "active_override"             text,
        ADD COLUMN IF NOT EXISTS "gender"                      text;

      UPDATE "dropin_court_pools" p
      SET starts_at                   = d.starts_at,
          duration_minutes            = d.duration_minutes,
          price                       = d.price,
          cancellation_window_minutes = d.cancellation_window_minutes,
          registration_open           = d.registration_open,
          active_override             = d.active_override,
          gender                      = d.gender
      FROM "dropins" d
      WHERE p.dropin_id = d.id
        AND p.starts_at IS NULL;
    `,
  },
  {
    name: "0063 — age_group_waivers table for USYS play-up/play-down admin waivers",
    sql: `
      CREATE TABLE IF NOT EXISTS "age_group_waivers" (
        "id"           serial PRIMARY KEY,
        "player_id"    integer NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
        "requested_by" integer NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
        "age_group"    text NOT NULL,
        "reason"       text NOT NULL,
        "status"       text NOT NULL DEFAULT 'pending',
        "admin_note"   text,
        "reviewed_by"  integer REFERENCES "users"("id") ON DELETE SET NULL,
        "created_at"   timestamp with time zone NOT NULL DEFAULT now(),
        "updated_at"   timestamp with time zone NOT NULL DEFAULT now()
      );
    `,
  },
  {
    name: "0064 — service_fee_configs table for in-app card payment service fees",
    sql: `
      CREATE TABLE IF NOT EXISTS "service_fee_configs" (
        "id"                  serial PRIMARY KEY,
        "name"                text NOT NULL,
        "fee_percent"         numeric(5,2) NOT NULL DEFAULT 3.00,
        "max_fee_amount"      numeric(10,2),
        "min_fee_amount"      numeric(10,2),
        "applies_to_card"     boolean NOT NULL DEFAULT true,
        "applies_to_external" boolean NOT NULL DEFAULT false,
        "non_refundable"      boolean NOT NULL DEFAULT true,
        "is_active"           boolean NOT NULL DEFAULT true,
        "notes"               text,
        "created_by_clerk_id" text,
        "created_at"          timestamp with time zone NOT NULL DEFAULT now(),
        "updated_at"          timestamp with time zone NOT NULL DEFAULT now()
      );
    `,
  },
  {
    name: "0067 — registrations.expires_at for pending_payment expiry window",
    sql: `ALTER TABLE "registrations" ADD COLUMN IF NOT EXISTS "expires_at" timestamp with time zone;`,
  },
  {
    name: "0070 — refund_credit_policies.window_minutes for drop-in minute-based matching",
    sql: `ALTER TABLE "refund_credit_policies" ADD COLUMN IF NOT EXISTS "window_minutes" integer;`,
  },
  {
    name: "0071 — dropin_court_pools.refund_policy_id per-pool override",
    sql: `ALTER TABLE "dropin_court_pools" ADD COLUMN IF NOT EXISTS "refund_policy_id" integer REFERENCES "refund_credit_policies"("id") ON DELETE SET NULL;`,
  },
  {
    name: "0066 — payments dispute_status + disputed_at columns",
    sql: `
      ALTER TABLE "payments"
        ADD COLUMN IF NOT EXISTS "dispute_status" text,
        ADD COLUMN IF NOT EXISTS "disputed_at" timestamp with time zone;
    `,
  },
  {
    name: "0068 — session_templates.pools_config for per-pool independent schedules",
    sql: `ALTER TABLE "session_templates" ADD COLUMN IF NOT EXISTS "pools_config" jsonb;`,
  },
  {
    name: "0065 — rebuild service_fee_configs with correct schema (drop legacy columns, add missing ones)",
    sql: `
      DO $$
      BEGIN
        -- If the table has the old schema (fee_value column = legacy), drop and recreate it.
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'service_fee_configs' AND column_name = 'fee_value'
        ) THEN
          DROP TABLE service_fee_configs;
          CREATE TABLE "service_fee_configs" (
            "id"                  serial PRIMARY KEY,
            "name"                text NOT NULL,
            "fee_percent"         numeric(5,2) NOT NULL DEFAULT 3.00,
            "max_fee_amount"      numeric(10,2),
            "min_fee_amount"      numeric(10,2),
            "applies_to_card"     boolean NOT NULL DEFAULT true,
            "applies_to_external" boolean NOT NULL DEFAULT false,
            "non_refundable"      boolean NOT NULL DEFAULT true,
            "is_active"           boolean NOT NULL DEFAULT true,
            "notes"               text,
            "created_by_clerk_id" text,
            "created_at"          timestamp with time zone NOT NULL DEFAULT now(),
            "updated_at"          timestamp with time zone NOT NULL DEFAULT now()
          );
        END IF;
      END $$;
    `,
  },
  {
    name: "0069 — spots.expires_at for payment_pending expiry window",
    sql: `ALTER TABLE "spots" ADD COLUMN IF NOT EXISTS "expires_at" timestamp with time zone;`,
  },
  {
    name: "0070 — broadcast_messages audit table",
    sql: `
      CREATE TABLE IF NOT EXISTS "broadcast_messages" (
        "id"              serial PRIMARY KEY,
        "created_by"      integer NOT NULL REFERENCES "users"("id"),
        "created_at"      timestamp with time zone NOT NULL DEFAULT now(),
        "subject"         text NOT NULL,
        "body"            text NOT NULL,
        "channels"        text[] NOT NULL DEFAULT '{}',
        "offering_type"   text,
        "event_id"        integer,
        "pool_id"         integer,
        "status_filter"   text,
        "recipient_count" integer NOT NULL DEFAULT 0
      );
    `,
  },
  {
    name: "0071 — web_push_subscriptions table for browser push delivery",
    sql: `
      CREATE TABLE IF NOT EXISTS "web_push_subscriptions" (
        "id"         serial PRIMARY KEY,
        "user_id"    integer NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
        "endpoint"   text NOT NULL,
        "p256dh"     text NOT NULL,
        "auth"       text NOT NULL,
        "created_at" timestamp with time zone NOT NULL DEFAULT now(),
        "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
        CONSTRAINT "uq_web_push_user_endpoint" UNIQUE ("user_id", "endpoint")
      );
    `,
  },
  {
    name: "0078 — dropins.image_url: optional cover photo for event cards",
    sql: `ALTER TABLE "dropins" ADD COLUMN IF NOT EXISTS "image_url" text;`,
  },
  {
    name: "0081 — dropin_templates.legacy_session_template_id for migration idempotency",
    sql: `ALTER TABLE "dropin_templates" ADD COLUMN IF NOT EXISTS "legacy_session_template_id" integer;`,
  },
  {
    name: "0082 — dropin_court_pools.dropin_template_pool_id bridge column",
    sql: `
      ALTER TABLE "dropin_court_pools" ADD COLUMN IF NOT EXISTS "dropin_template_pool_id" integer;
      CREATE UNIQUE INDEX IF NOT EXISTS dropin_court_pools_dropin_tpool_uidx
        ON "dropin_court_pools" ("dropin_id", "dropin_template_pool_id")
        WHERE "dropin_template_pool_id" IS NOT NULL;
    `,
  },
  {
    name: "0083 — simplified_registration + guest spots",
    sql: `
      ALTER TABLE "dropin_court_pools" ADD COLUMN IF NOT EXISTS "simplified_registration" boolean NOT NULL DEFAULT false;
      ALTER TABLE "spots" ADD COLUMN IF NOT EXISTS "guest_name" text;
      ALTER TABLE "spots" ADD COLUMN IF NOT EXISTS "guest_email" text;
    `,
  },
  {
    name: "0084 — dropin_template_pools.simplified_registration",
    sql: `ALTER TABLE "dropin_template_pools" ADD COLUMN IF NOT EXISTS "simplified_registration" boolean NOT NULL DEFAULT false;`,
  },
  {
    name: "0026 — staff_invites table for role-based email invitations",
    sql: `
      CREATE TABLE IF NOT EXISTS "staff_invites" (
        "id"         serial PRIMARY KEY NOT NULL,
        "token"      text NOT NULL UNIQUE,
        "email"      text NOT NULL,
        "role"       text NOT NULL,
        "created_by" text NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "expires_at" timestamptz NOT NULL,
        "used_at"    timestamptz,
        "used_by"    text,
        "revoked_at" timestamptz
      );
      CREATE INDEX IF NOT EXISTS "staff_invites_token_idx" ON "staff_invites" ("token");
      CREATE INDEX IF NOT EXISTS "staff_invites_email_idx" ON "staff_invites" ("email");
    `,
  },
  {
    name: "0085 — notifications.link for in-app inbox deep-link navigation",
    sql: `
      ALTER TABLE notifications ADD COLUMN IF NOT EXISTS link TEXT;
      CREATE INDEX IF NOT EXISTS notifications_user_channel_idx ON notifications (user_id, channel);
      CREATE INDEX IF NOT EXISTS notifications_user_read_idx ON notifications (user_id, read_at);
    `,
  },
  {
    name: "0086 — staff_profiles Stripe Connect columns",
    sql: `
      ALTER TABLE "staff_profiles"
        ADD COLUMN IF NOT EXISTS "connect_account_id" text;
      ALTER TABLE "staff_profiles"
        ADD COLUMN IF NOT EXISTS "connect_onboarding_status" text NOT NULL DEFAULT 'pending';
    `,
  },
  {
    name: "0091 — qr_code_scope enum: add kotc_captain value",
    sql: `
      DO $$ BEGIN
        ALTER TYPE qr_code_scope ADD VALUE IF NOT EXISTS 'kotc_captain';
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;
    `,
  },
  {
    name: "0092 — kotc_battles.court_ids integer[]",
    sql: `
      ALTER TABLE kotc_battles ADD COLUMN IF NOT EXISTS court_ids integer[];
    `,
  },
];

const REQUIRED_COLUMNS = [
  // 0015 – 0022: users base columns
  ["users", "stripe_customer_id"],
  ["users", "roles"],
  ["users", "address_line1"], ["users", "address_line2"], ["users", "city"],
  ["users", "state"], ["users", "zip"],
  ["users", "id_verified"], ["users", "id_verified_at"],
  ["users", "id_first_name"], ["users", "id_last_name"], ["users", "id_dob"], ["users", "id_address"],
  // 0027: admin / staff permission columns
  ["users", "admin_level"],
  ["staff_profiles", "can_manage_payouts"],
  ["staff_profiles", "can_manage_announcements"],
  ["staff_profiles", "can_manage_game_cards"],
  // 0030: free agent AI-matching columns
  ["league_free_agents", "positions"],
  ["league_free_agents", "skill_level"],
  ["league_free_agents", "match_status"],
  // 0031: camp registration health / skill columns
  ["camp_registrations", "skill_level"],
  ["camp_registrations", "shirt_size"],
  ["camp_registrations", "health_packet_json"],
  // 0044–0047: waitlist position columns
  ["camp_registrations", "waitlist_position"],
  ["league_registrations", "waitlist_position"],
  ["tournament_registrations", "waitlist_position"],
  ["registrations", "waitlist_position"],
  // 0032: team member schedule-conflict notes
  ["team_members", "notes"],
  // 0033: dropins age_group promoted to text[]
  // (array type verified separately via data_type check below)
  // 0034: gender column on all program tables
  ["leagues", "gender"],
  ["tournaments", "gender"],
  ["camps", "gender"],
  ["dropins", "gender"],
  // 0028+0041: waiver_signatures missing columns
  ["waiver_signatures", "youth_user_id"],
  ["waiver_signatures", "expires_at"],
  ["waiver_signatures", "signature_type"],
  ["waiver_signatures", "entity_type"],
  ["waiver_signatures", "entity_id"],
  // 0042: active time window columns
  ["leagues", "starts_at"],
  ["leagues", "ends_at"],
  ["leagues", "active_override"],
  ["tournaments", "starts_at"],
  ["tournaments", "ends_at"],
  ["tournaments", "active_override"],
  ["camps", "starts_at"],
  ["camps", "ends_at"],
  ["camps", "active_override"],
  ["dropins", "active_override"],
  // 0048: session_templates recurrence columns
  ["session_templates", "ends_at"],
  ["session_templates", "last_generated_at"],
  // 0050: session_templates skip-occurrence tracking
  ["session_templates", "skipped_dates"],
  // 0062: session_templates pool-level logistics defaults
  ["session_templates", "price"],
  ["session_templates", "gender"],
  // 0068: session_templates per-pool schedule config
  ["session_templates", "pools_config"],
  // 0053: event visibility flags
  ["leagues", "is_published"],
  ["leagues", "is_featured"],
  ["leagues", "show_on_mobile"],
  ["tournaments", "is_published"],
  ["tournaments", "is_featured"],
  ["tournaments", "show_on_mobile"],
  ["camps", "is_published"],
  ["camps", "is_featured"],
  ["camps", "show_on_mobile"],
  ["dropins", "is_published"],
  ["dropins", "is_featured"],
  ["dropins", "show_on_mobile"],
  // 0054: courts.venue_id for revenue split resolution
  ["courts", "venue_id"],
  // 0055: check_ins soft-void columns
  ["check_ins", "voided_at"],
  ["check_ins", "voided_by_user_id"],
  // 0055: spots.guardian_user_id for parent-on-behalf-of-child registrations
  ["spots", "guardian_user_id"],
  // 0069: spots.expires_at for payment_pending expiry window
  ["spots", "expires_at"],
  // 0057: division_id on teams/fixtures/standings (league divisions)
  ["teams", "division_id"],
  // 0063: age_group_waivers columns
  ["age_group_waivers", "player_id"],
  ["age_group_waivers", "requested_by"],
  ["age_group_waivers", "age_group"],
  ["age_group_waivers", "status"],
  ["fixtures", "division_id"],
  ["standings", "division_id"],
  // 0060: division_id on tournament-specific tables
  ["brackets", "division_id"],
  ["tournament_seeds", "division_id"],
  ["tournament_registrations", "division_id"],
  // 0061: dropin_court_pools logistics columns
  ["dropin_court_pools", "duration_minutes"],
  ["dropin_court_pools", "price"],
  ["dropin_court_pools", "cancellation_window_minutes"],
  ["dropin_court_pools", "registration_open"],
  // 0066: payments dispute columns
  ["payments", "dispute_status"],
  ["payments", "disputed_at"],
  // 0067: registrations expiry window
  ["registrations", "expires_at"],
  // 0068: refund_credit_policies minute-based window for drop-ins
  ["refund_credit_policies", "window_minutes"],
  // 0069: dropin_court_pools per-pool refund policy override
  ["dropin_court_pools", "refund_policy_id"],
  // 0070: broadcast_messages audit table
  ["broadcast_messages", "id"],
  ["broadcast_messages", "created_by"],
  ["broadcast_messages", "subject"],
  ["broadcast_messages", "body"],
  ["broadcast_messages", "channels"],
  ["broadcast_messages", "recipient_count"],
  // 0071: web_push_subscriptions for browser push delivery
  ["web_push_subscriptions", "id"],
  ["web_push_subscriptions", "user_id"],
  ["web_push_subscriptions", "endpoint"],
  ["web_push_subscriptions", "p256dh"],
  ["web_push_subscriptions", "auth"],
  // 0072: waitlist offer tracking on spots + offer window on pools
  ["spots", "offer_sent_at"],
  ["spots", "offer_expires_at"],
  ["dropin_court_pools", "offer_window_minutes"],
  // 0073: pre-created Stripe checkout session ID stored on spot for deterministic expiry
  ["spots", "stripe_checkout_session_id"],
  // 0075: id_photo_url for private GCS ID photo storage
  ["users", "id_photo_url"],
  // 0078: dropins.image_url for cover photo on event cards
  ["dropins", "image_url"],
  // 0079: session_templates recurrence columns
  ["session_templates", "recurrence_interval"],
  ["session_templates", "recurrence_unit"],
  // 0082: dropin_templates visibility flags
  ["dropin_templates", "is_featured"],
  ["dropin_templates", "show_on_mobile"],
  // 0026: staff_invites table
  ["staff_invites", "token"],
  ["staff_invites", "email"],
  ["staff_invites", "role"],
  ["staff_invites", "expires_at"],
  // 0083: simplified_registration + guest spots
  ["dropin_court_pools", "simplified_registration"],
  ["spots", "guest_name"],
  ["spots", "guest_email"],
  // 0084: dropin_template_pools.simplified_registration (propagated to court pools on materialization)
  ["dropin_template_pools", "simplified_registration"],
  // 0085: notifications.link for in-app inbox deep-link navigation
  ["notifications", "link"],
  // 0086: staff_profiles Stripe Connect columns
  ["staff_profiles", "connect_account_id"],
  ["staff_profiles", "connect_onboarding_status"],
  // 0090: Kings of The Court core tables
  ["kotc_seasons", "id"],
  ["kotc_seasons", "name"],
  ["kotc_seasons", "sport"],
  ["kotc_seasons", "gender_bracket"],
  ["kotc_seasons", "age_bracket"],
  ["kotc_battles", "id"],
  ["kotc_battles", "season_id"],
  ["kotc_battles", "scheduled_at"],
  ["kotc_teams", "id"],
  ["kotc_teams", "season_id"],
  ["kotc_teams", "captain_user_id"],
  ["kotc_teams", "qr_code"],
  ["kotc_teams", "lives_balance"],
  ["kotc_team_players", "id"],
  ["kotc_team_players", "team_id"],
  ["kotc_team_players", "rules_acknowledged_at"],
  ["kotc_battle_registrations", "id"],
  ["kotc_battle_registrations", "battle_id"],
  ["kotc_battle_registrations", "team_id"],
  ["kotc_rotation_queues", "id"],
  ["kotc_rotation_queues", "battle_id"],
  ["kotc_rotation_queues", "position"],
  ["kotc_game_cards", "id"],
  ["kotc_game_cards", "battle_id"],
  ["kotc_game_cards", "team1_id"],
  ["kotc_game_cards", "team2_id"],
  ["kotc_life_ledger", "id"],
  ["kotc_life_ledger", "team_id"],
  ["kotc_life_ledger", "delta"],
  // 0091: KotC Phase 2 new columns on existing tables
  ["kotc_seasons", "life_packs"],
  ["kotc_seasons", "waitlist_window_minutes"],
  // 0092: KotC discovery visibility flags
  ["kotc_seasons", "is_published"],
  ["kotc_seasons", "is_featured"],
  ["kotc_seasons", "show_on_mobile"],
  ["kotc_teams", "first_purchase_at"],
  ["kotc_teams", "total_purchased_cents"],
  ["kotc_battles", "paused_duration_seconds"],
  ["kotc_battles", "waitlist_locked_at"],
  ["kotc_game_cards", "is_disputed"],
  // 0091: KotC Phase 2 new tables
  ["kotc_drama_rules", "id"],
  ["kotc_drama_rules", "season_id"],
  ["kotc_drama_rules", "trigger_type"],
  ["kotc_waitlist", "id"],
  ["kotc_waitlist", "battle_id"],
  ["kotc_waitlist", "team_id"],
  ["kotc_waitlist", "position"],
  ["kotc_pending_purchases", "id"],
  ["kotc_pending_purchases", "team_id"],
  ["kotc_pending_purchases", "status"],
];

const REQUIRED_ARRAY_COLUMNS = [
  // 0033: dropins.age_group → text[]
  ["dropins", "age_group"],
  // 0037: leagues/tournaments/camps age_group → text[]
  ["leagues", "age_group"],
  ["tournaments", "age_group"],
  ["camps", "age_group"],
  // 0056: dropin_court_pools.age_group → text[]
  ["dropin_court_pools", "age_group"],
  // 0092: kotc_battles.court_ids → integer[]
  ["kotc_battles", "court_ids"],
];

async function run() {
  const client = await pool.connect();
  try {
    for (const migration of MIGRATIONS) {
      process.stdout.write(`[ensure-schema] Applying: ${migration.name} ... `);
      await client.query(migration.sql);
      process.stdout.write("OK\n");
    }

    // 0043 — backfill: events created before active-window feature get activeOverride='active'
    // so they remain visible/accessible until admins configure their time windows.
    process.stdout.write(`[ensure-schema] Applying: 0043 — backfill activeOverride for windowless events ... `);
    await client.query(`
      UPDATE leagues SET active_override = 'active' WHERE starts_at IS NULL AND active_override IS NULL;
      UPDATE tournaments SET active_override = 'active' WHERE starts_at IS NULL AND active_override IS NULL;
      UPDATE camps SET active_override = 'active' WHERE starts_at IS NULL AND active_override IS NULL;
    `);
    process.stdout.write("OK\n");

    // Seed three default drop-in refund policies (100% at 120m, 50% at 60m, 0% under 60m)
    process.stdout.write(`[ensure-schema] Seeding: default drop-in refund policies ... `);
    await client.query(`
      INSERT INTO refund_credit_policies (name, entity_type, refund_type, window_days, window_minutes, refund_percent, credit_percent, non_refundable_amount, allow_partial_refund, requires_admin_approval, notes, is_active)
      SELECT 'Drop-in Full Refund (120m+)', 'drop_in', 'refund', 0, 120, 100.00, 100.00, 0, true, false, 'Full refund when cancelled 120+ minutes before session start.', true
      WHERE NOT EXISTS (SELECT 1 FROM refund_credit_policies WHERE entity_type = 'drop_in' AND window_minutes = 120);

      INSERT INTO refund_credit_policies (name, entity_type, refund_type, window_days, window_minutes, refund_percent, credit_percent, non_refundable_amount, allow_partial_refund, requires_admin_approval, notes, is_active)
      SELECT 'Drop-in Half Refund (60–120m)', 'drop_in', 'refund', 0, 60, 50.00, 100.00, 0, true, false, '50% refund when cancelled 60–120 minutes before session start.', true
      WHERE NOT EXISTS (SELECT 1 FROM refund_credit_policies WHERE entity_type = 'drop_in' AND window_minutes = 60);

      INSERT INTO refund_credit_policies (name, entity_type, refund_type, window_days, window_minutes, refund_percent, credit_percent, non_refundable_amount, allow_partial_refund, requires_admin_approval, notes, is_active)
      SELECT 'Drop-in No Refund (under 60m)', 'drop_in', 'refund', 0, 0, 0.00, 100.00, 0, true, false, 'No refund when cancelled less than 60 minutes before session start.', true
      WHERE NOT EXISTS (SELECT 1 FROM refund_credit_policies WHERE entity_type = 'drop_in' AND window_minutes = 0);
    `);
    process.stdout.write("OK\n");

    // Seed default service fee config — ensures computeRevenueSplit always finds an active row
    // without requiring an admin to visit the fee-config page first.
    process.stdout.write(`[ensure-schema] Seeding: default 3% service fee config ... `);
    await client.query(`
      INSERT INTO service_fee_configs (name, fee_percent, applies_to_card, applies_to_external, non_refundable, notes)
      SELECT 'Default Service Fee', 3.00, true, false, true,
             'Default 3% service fee on in-app card payments to cover processing costs.'
      WHERE NOT EXISTS (SELECT 1 FROM service_fee_configs WHERE is_active = true);
    `);
    process.stdout.write("OK\n");

    // Verification: confirm every required column is now present
    const { rows } = await client.query(`
      SELECT table_name, column_name, data_type
      FROM information_schema.columns
      WHERE table_name IN (
        'users', 'staff_profiles', 'league_free_agents',
        'camp_registrations', 'league_registrations', 'tournament_registrations', 'registrations',
        'team_members',
        'leagues', 'tournaments', 'camps', 'dropins',
        'waiver_signatures', 'session_templates',
        'courts', 'check_ins', 'spots', 'dropin_court_pools',
        'teams', 'fixtures', 'standings', 'brackets', 'tournament_seeds',
        'age_group_waivers', 'payments', 'registrations',
        'refund_credit_policies', 'broadcast_messages',
        'web_push_subscriptions', 'dropin_templates', 'dropin_template_pools', 'staff_invites',
        'notifications',
        'kotc_seasons', 'kotc_battles', 'kotc_battle_mods',
        'kotc_teams', 'kotc_team_players', 'kotc_battle_registrations',
        'kotc_rotation_queues', 'kotc_game_cards', 'kotc_life_ledger',
        'kotc_drama_rules', 'kotc_waitlist', 'kotc_pending_purchases'
      )
    `);
    const present = new Set(rows.map((r) => `${r.table_name}.${r.column_name}`));
    const arrayPresent = new Set(
      rows.filter((r) => r.data_type === "ARRAY").map((r) => `${r.table_name}.${r.column_name}`)
    );

    let allPresent = true;
    for (const [table, col] of REQUIRED_COLUMNS) {
      if (!present.has(`${table}.${col}`)) {
        console.error(`[ensure-schema] STILL MISSING: ${table}.${col}`);
        allPresent = false;
      }
    }

    for (const [table, col] of REQUIRED_ARRAY_COLUMNS) {
      if (!arrayPresent.has(`${table}.${col}`)) {
        console.error(`[ensure-schema] NOT text[]: ${table}.${col} (expected ARRAY type)`);
        allPresent = false;
      }
    }

    if (!allPresent) {
      console.error("[ensure-schema] Schema verification FAILED — see above");
      process.exit(1);
    }

    console.log("[ensure-schema] All required columns verified present. Schema is in sync.");
  } catch (err) {
    console.error("[ensure-schema] ERROR:", err?.message ?? err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

run();
