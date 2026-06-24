/**
 * One-time migration: session_templates + dropin_court_pools → dropin_templates + dropin_template_pools
 *
 * Run with:
 *   node artifacts/api-server/src/scripts/migrate-legacy-dropins.mjs
 *
 * Safe to run multiple times — checks for existing records by sessionTemplateId reference.
 */

import postgres from "postgres";
import dotenv from "dotenv";
dotenv.config();

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const sql = postgres(DATABASE_URL, { max: 1 });

async function run() {
  console.log("[migrate] Starting legacy drop-in migration...");

  // 1. Fetch all session templates that look like drop-in series (sport, recurrence_rule, etc.)
  const sessionTemplates = await sql`
    SELECT st.*, 
           d.id AS sample_dropin_id,
           d.starts_at AS sample_starts_at,
           d.duration_minutes,
           d.price AS dropin_price,
           d.age_group,
           d.registration_open,
           d.image_url,
           d.description
    FROM session_templates st
    LEFT JOIN LATERAL (
      SELECT * FROM dropins WHERE session_template_id = st.id ORDER BY starts_at ASC LIMIT 1
    ) d ON true
    WHERE st.sport IS NOT NULL
    ORDER BY st.id
  `;

  console.log(`[migrate] Found ${sessionTemplates.length} session templates to migrate`);

  let created = 0;
  let skipped = 0;

  for (const st of sessionTemplates) {
    // Skip if already migrated — key off legacy_session_template_id for reliable idempotency
    const [existing] = await sql`
      SELECT id FROM dropin_templates WHERE legacy_session_template_id = ${st.id} LIMIT 1
    `;
    if (existing) {
      skipped++;
      continue;
    }

    // Build recurrence_rule JSONB from session_template fields
    const dayOfWeek = st.pools_config?.[0]?.dayOfWeek ?? st.day_of_week ?? null;
    const startTime = st.pools_config?.[0]?.startTime ?? st.start_time ?? "18:00";
    const durationMinutes = st.pools_config?.[0]?.durationMinutes ?? st.duration_minutes ?? 120;
    const startDate = st.start_date ?? (st.sample_starts_at ? st.sample_starts_at.toISOString().slice(0, 10) : null);

    if (!startDate) {
      console.warn(`[migrate] Skipping template ${st.id} (${st.name}) — no startDate`);
      skipped++;
      continue;
    }

    const recurrenceRule = {
      type: dayOfWeek != null ? "recurring" : "one_time",
      startDate,
      startTime,
      durationMinutes: durationMinutes ?? 120,
      dayOfWeek: dayOfWeek ?? null,
      intervalNum: 1,
      intervalUnit: "week",
      endCondition: st.ends_at ? "on_date" : "never",
      endDate: st.ends_at ? st.ends_at.toISOString().slice(0, 10) : null,
      endAfterN: null,
      skippedDates: [],
    };

    // Insert dropin_template — store legacy_session_template_id for idempotency on re-runs
    const [newTemplate] = await sql`
      INSERT INTO dropin_templates (
        name, sport, venue_id, description, image_url,
        recurrence_rule, is_draft, is_published, publish_at,
        registration_opens, registration_cutoff_minutes,
        legacy_session_template_id,
        created_at, updated_at
      ) VALUES (
        ${st.name},
        ${st.sport ?? "basketball"},
        ${st.venue_id ?? null},
        ${st.description ?? null},
        ${st.image_url ?? null},
        ${JSON.stringify(recurrenceRule)},
        false,
        ${st.is_published ?? true},
        null,
        'immediately',
        ${st.registration_cutoff_minutes ?? null},
        ${st.id},
        NOW(),
        NOW()
      )
      RETURNING id
    `;

    // Fetch pools config from session_template
    const pools_config = st.pools_config ?? [];

    if (pools_config.length > 0) {
      // Multi-pool template: one dropin_template_pool per pool config
      for (const pc of pools_config) {
        const [court] = await sql`
          SELECT id FROM courts WHERE name = ${pc.courtName ?? ""} LIMIT 1
        `;
        const courtId = court?.id ?? (await getDefaultCourt(sql));

        await sql`
          INSERT INTO dropin_template_pools (
            template_id, court_id, age_group, skill_level, cap, price,
            gender, offer_window_minutes, created_at, updated_at
          ) VALUES (
            ${newTemplate.id},
            ${courtId},
            ${sql.array(pc.ageGroup ? (Array.isArray(pc.ageGroup) ? pc.ageGroup : [pc.ageGroup]) : ["adult"])},
            ${"all"},
            ${pc.cap ?? 20},
            ${pc.price ?? "0"},
            ${pc.gender ?? null},
            ${pc.offerWindowMinutes ?? 240},
            NOW(), NOW()
          )
        `;
      }
    } else {
      // Single-pool fallback: derive from dropin + dropin_court_pools
      const courtPools = await sql`
        SELECT dcp.*, c.id AS cid
        FROM dropin_court_pools dcp
        JOIN courts c ON c.id = dcp.court_id
        JOIN dropins d ON d.id = dcp.dropin_id AND d.session_template_id = ${st.id}
        ORDER BY dcp.id ASC
        LIMIT 10
      `;

      const seen = new Set();
      for (const cp of courtPools) {
        if (seen.has(cp.court_id)) continue;
        seen.add(cp.court_id);

        await sql`
          INSERT INTO dropin_template_pools (
            template_id, court_id, age_group, skill_level, cap, price,
            gender, offer_window_minutes, created_at, updated_at
          ) VALUES (
            ${newTemplate.id},
            ${cp.court_id},
            ${sql.array(Array.isArray(cp.age_group) ? cp.age_group : [cp.age_group ?? "adult"])},
            ${cp.skill_level ?? "all"},
            ${cp.cap ?? 20},
            ${cp.price ?? "0"},
            ${cp.gender ?? null},
            ${cp.offer_window_minutes ?? 240},
            NOW(), NOW()
          )
        `;
      }

      if (!courtPools.length) {
        // Last resort: single stub pool
        const courtId = await getDefaultCourt(sql);
        await sql`
          INSERT INTO dropin_template_pools (
            template_id, court_id, age_group, skill_level, cap, price,
            offer_window_minutes, created_at, updated_at
          ) VALUES (
            ${newTemplate.id}, ${courtId},
            ${sql.array(["adult"])}, ${"all"}, ${20}, ${"0"}, ${240},
            NOW(), NOW()
          )
        `;
      }
    }

    // Backfill dropin_occurrences from existing dropins rows
    const existingDropins = await sql`
      SELECT * FROM dropins WHERE session_template_id = ${st.id} ORDER BY starts_at ASC
    `;

    for (const d of existingDropins) {
      const occDate = d.starts_at.toISOString().slice(0, 10);
      await sql`
        INSERT INTO dropin_occurrences (template_id, occurrence_date, status, created_at, updated_at)
        VALUES (${newTemplate.id}, ${occDate}, ${d.status ?? "upcoming"}, NOW(), NOW())
        ON CONFLICT (template_id, occurrence_date) DO NOTHING
      `;
      // Update dropin to reference the new template
      await sql`
        UPDATE dropins SET template_id = ${newTemplate.id} WHERE id = ${d.id}
      `;
    }

    created++;
    console.log(`[migrate] Created dropin_template ${newTemplate.id} from session_template ${st.id} (${st.name})`);
  }

  console.log(`[migrate] Done. Created: ${created}, Skipped (already existed): ${skipped}`);
  await sql.end();
}

async function getDefaultCourt(sql) {
  const [c] = await sql`SELECT id FROM courts ORDER BY id ASC LIMIT 1`;
  return c?.id ?? 1;
}

run().catch((err) => {
  console.error("[migrate] Fatal:", err);
  process.exit(1);
});
