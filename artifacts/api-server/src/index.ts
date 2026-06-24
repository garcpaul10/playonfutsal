import app from "./app";
import { logger } from "./lib/logger";
import { startReminderScheduler } from "./services/reminders";
import { startDeadlineScheduler } from "./services/deadlineScheduler";
import { startPaymentIntentCleanupScheduler } from "./services/paymentIntentCleanup";
import { startDropinRecurrenceScheduler, startDropinAutoCompleteScheduler } from "./services/dropinRecurrenceScheduler";
import { startDropinPreStartScheduler } from "./services/dropinPreStartScheduler";
import { startRegistrationExpiryScheduler } from "./services/registrationExpiryScheduler";
import { startSpotExpiryScheduler } from "./services/spotExpiryScheduler";
import { runQrBackfill } from "./routes/users";
import { seedWaiver } from "./routes/waivers";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

/**
 * Validates that all columns expected by the Drizzle schema physically exist in the DB.
 * Logs a warning for every missing column so schema drift is immediately diagnosable.
 * Does NOT throw — partial schema drift should not block endpoints that aren't affected.
 */
async function checkSchemaSync(): Promise<void> {
  const EXPECTED: Record<string, string[]> = {
    users: [
      "id", "clerk_id", "email", "first_name", "last_name", "phone", "date_of_birth",
      "role", "roles", "admin_level", "playon_id", "qr_code",
      "emergency_contact_name", "emergency_contact_phone", "avatar_url",
      "address_line1", "address_line2", "city", "state", "zip",
      "id_verified", "id_verified_at", "id_first_name", "id_last_name", "id_dob", "id_address",
      "stripe_customer_id", "created_at", "updated_at",
    ],
    staff_profiles: [
      "can_manage_payouts", "can_manage_announcements", "can_manage_game_cards",
    ],
  };
  try {
    const result = await db.execute<{ table_name: string; column_name: string }>(sql`
      SELECT table_name, column_name
      FROM information_schema.columns
      WHERE table_name = ANY(ARRAY['users','staff_profiles'])
    `);
    // drizzle-orm/node-postgres returns a pg QueryResult; rows are in .rows
    const rowList: any[] = Array.isArray(result) ? result : (result as any).rows ?? [];
    const present = new Set(rowList.map((r: any) => `${r.table_name}.${r.column_name}`));
    for (const [table, cols] of Object.entries(EXPECTED)) {
      for (const col of cols) {
        if (!present.has(`${table}.${col}`)) {
          logger.warn(`[schema-check] MISSING COLUMN: ${table}.${col} — run db:push or re-publish to fix`);
        }
      }
    }
    logger.info("[schema-check] Schema validation complete");
  } catch (err: any) {
    logger.warn({ err: err?.message }, "[schema-check] Could not validate schema — skipping");
  }
}

/**
 * Creates the team_invites table if it does not yet exist.
 * This is a safe idempotent migration that runs on every startup.
 */
async function ensureTeamInvitesTable(): Promise<void> {
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS team_invites (
        id         SERIAL PRIMARY KEY,
        token      TEXT NOT NULL UNIQUE,
        email      TEXT NOT NULL,
        team_id    INTEGER NOT NULL,
        role       TEXT NOT NULL,
        created_by TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        expires_at TIMESTAMPTZ NOT NULL,
        used_at    TIMESTAMPTZ,
        used_by    TEXT,
        revoked_at TIMESTAMPTZ
      )
    `);
    logger.info("[migration] team_invites table ensured");
  } catch (err: any) {
    logger.warn({ err: err?.message }, "[migration] Could not ensure team_invites table");
  }
}

/**
 * Adds Stripe Connect columns to the venues table (idempotent).
 */
async function ensureVenueStripeConnectColumns(): Promise<void> {
  try {
    await db.execute(sql`
      ALTER TABLE venues
        ADD COLUMN IF NOT EXISTS stripe_connect_account_id TEXT,
        ADD COLUMN IF NOT EXISTS stripe_connect_onboarding_status TEXT NOT NULL DEFAULT 'none'
    `);
    logger.info("[migration] venues stripe_connect columns ensured");
  } catch (err: any) {
    logger.warn({ err: err?.message }, "[migration] Could not ensure venues stripe_connect columns");
  }
}

async function ensurePayoutsVenueIdColumn(): Promise<void> {
  try {
    await db.execute(sql`ALTER TABLE payouts ADD COLUMN IF NOT EXISTS venue_id INTEGER`);
    logger.info("[migration] payouts.venue_id column ensured");
  } catch (err: any) {
    logger.warn({ err: err?.message }, "[migration] Could not ensure payouts.venue_id column");
  }
}

async function ensureDropinTemplatesTables(): Promise<void> {
  try {
    await db.execute(sql`
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
        legacy_session_template_id  INTEGER,
        created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      ALTER TABLE dropin_templates ADD COLUMN IF NOT EXISTS legacy_session_template_id INTEGER;
      ALTER TABLE dropin_court_pools ADD COLUMN IF NOT EXISTS dropin_template_pool_id INTEGER;
      CREATE UNIQUE INDEX IF NOT EXISTS dropin_court_pools_dropin_tpool_uidx
        ON dropin_court_pools (dropin_id, dropin_template_pool_id)
        WHERE dropin_template_pool_id IS NOT NULL;
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
    `);
    logger.info("[migration] dropin_templates family tables ensured");
  } catch (err: any) {
    logger.warn({ err: err?.message }, "[migration] Could not ensure dropin_templates tables");
  }
}

async function ensureGuestRegistrationColumns(): Promise<void> {
  try {
    await db.execute(sql`
      ALTER TABLE dropin_court_pools
        ADD COLUMN IF NOT EXISTS simplified_registration BOOLEAN NOT NULL DEFAULT false
    `);
    await db.execute(sql`
      ALTER TABLE spots
        ADD COLUMN IF NOT EXISTS guest_name TEXT,
        ADD COLUMN IF NOT EXISTS guest_email TEXT
    `);
    logger.info("[migration] guest registration columns ensured");
  } catch (err: any) {
    logger.warn({ err: err?.message }, "[migration] Could not ensure guest registration columns");
  }
}

async function ensureServiceFeeConfigsTable(): Promise<void> {
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS service_fee_configs (
        id                    SERIAL PRIMARY KEY,
        name                  TEXT NOT NULL,
        fee_percent           NUMERIC(5,2) NOT NULL DEFAULT 3.00,
        max_fee_amount        NUMERIC(10,2),
        min_fee_amount        NUMERIC(10,2),
        applies_to_card       BOOLEAN NOT NULL DEFAULT true,
        applies_to_external   BOOLEAN NOT NULL DEFAULT false,
        non_refundable        BOOLEAN NOT NULL DEFAULT true,
        is_active             BOOLEAN NOT NULL DEFAULT true,
        notes                 TEXT,
        created_by_clerk_id   TEXT,
        created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    logger.info("[migration] service_fee_configs table ensured");
  } catch (err: any) {
    logger.warn({ err: err?.message }, "[migration] Could not ensure service_fee_configs table");
  }
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
  checkSchemaSync().catch(() => {});
  ensureDropinTemplatesTables().catch(() => {});
  ensureTeamInvitesTable().catch(() => {});
  ensureServiceFeeConfigsTable().catch(() => {});
  ensureVenueStripeConnectColumns().catch(() => {});
  ensurePayoutsVenueIdColumn().catch(() => {});
  ensureGuestRegistrationColumns().catch(() => {});
  seedWaiver().then(() => logger.info("[waiver-seed] Default waiver template ensured")).catch((err) => logger.warn({ err: err?.message }, "[waiver-seed] Could not seed waiver template"));
  startReminderScheduler();
  startDeadlineScheduler();
  startPaymentIntentCleanupScheduler();
  // Legacy scheduler: start only when unmigrated recurring session_templates still exist.
  // Once all are migrated to dropin_templates the scheduler is a no-op and can be skipped.
  // Running both schedulers simultaneously would produce duplicate inventory, so the gate
  // checks for any session_template that has no matching dropin_template row.
  (async () => {
    try {
      const checkResult = await db.execute(sql`
        SELECT COUNT(*) AS cnt FROM session_templates st
        WHERE st.is_recurring = true
          AND NOT EXISTS (
            SELECT 1 FROM dropin_templates dt WHERE dt.legacy_session_template_id = st.id
          )
      `);
      const checkRows = Array.isArray(checkResult) ? checkResult : (checkResult as any).rows ?? [];
      const unmigrated = Number(checkRows[0]?.cnt ?? 0);
      if (unmigrated > 0) {
        startDropinRecurrenceScheduler();
        logger.info({ count: unmigrated }, "[scheduler] legacy dropin recurrence scheduler started — unmigrated recurring templates detected");
      } else {
        logger.info("[scheduler] legacy dropin recurrence scheduler skipped — all recurring templates migrated");
      }
    } catch (e: any) {
      logger.warn({ err: e?.message }, "[scheduler] could not check unmigrated session_templates; legacy scheduler not started");
    }
  })();
  startDropinAutoCompleteScheduler();
  startDropinPreStartScheduler();
  startRegistrationExpiryScheduler();
  startSpotExpiryScheduler();
  runQrBackfill().then(() => logger.info("QR backfill complete")).catch(() => {});
});
