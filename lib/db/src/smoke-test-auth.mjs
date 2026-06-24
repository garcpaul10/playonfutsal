/**
 * smoke-test-auth.mjs
 *
 * Integration smoke test for the auth/profile DB layer.
 * Simulates the full signup → read → update flow against the live dev DB
 * to verify that all schema columns required by GET /api/me, PATCH /api/me,
 * and GET /api/memberships/my are present and queryable.
 *
 * Usage: pnpm --filter db run smoke-test-auth
 *
 * Exits 0 on success, 1 on failure.
 */

import pkg from "pg";
const { Pool } = pkg;

if (!process.env.DATABASE_URL) {
  console.error("[smoke-auth] DATABASE_URL is not set");
  process.exit(1);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function run() {
  const client = await pool.connect();
  const testClerkId = `smoke_${Date.now()}`;
  const testEmail = `${testClerkId}@playon.test`;
  let passed = 0;
  let failed = 0;

  function ok(label) {
    console.log(`  \u2713 ${label}`);
    passed++;
  }
  function fail(label, err) {
    console.error(`  \u2717 ${label}: ${err?.message ?? err}`);
    failed++;
  }

  try {
    console.log("[smoke-auth] Running auth/profile smoke test...\n");

    // Step 1: Lazy-create new user (simulates getOrCreateUser INSERT path)
    try {
      await client.query(
        `INSERT INTO users (clerk_id, email, role, roles, admin_level, playon_id, qr_code)
         VALUES ($1, $2, 'player', '{}', 'super', $3, $4)`,
        [testClerkId, testEmail, `PO-${testClerkId.slice(-8).toUpperCase()}`, `playon:player:${testClerkId}`],
      );
      ok("INSERT new user row (lazy-create / signup path)");
    } catch (err) {
      fail("INSERT new user row", err);
    }

    // Step 2: Read full profile — all 29 columns Drizzle SELECT * returns
    // (simulates GET /api/me → getOrCreateUser SELECT path)
    try {
      const { rows } = await client.query(
        `SELECT id, clerk_id, email, first_name, last_name, phone, date_of_birth,
                role, roles, admin_level, playon_id, qr_code,
                emergency_contact_name, emergency_contact_phone, avatar_url,
                address_line1, address_line2, city, state, zip,
                id_verified, id_verified_at,
                id_first_name, id_last_name, id_dob, id_address,
                stripe_customer_id, created_at, updated_at
         FROM users WHERE clerk_id = $1`,
        [testClerkId],
      );
      if (rows.length !== 1) throw new Error(`Expected 1 row, got ${rows.length}`);
      const user = rows[0];
      if (user.role !== "player") throw new Error(`role mismatch: ${user.role}`);
      if (user.admin_level !== "super") throw new Error(`admin_level mismatch: ${user.admin_level}`);
      if (user.id_verified !== false) throw new Error(`id_verified should default to false`);
      ok("SELECT all 29 profile columns (GET /api/me shape)");
    } catch (err) {
      fail("SELECT all profile columns", err);
    }

    // Step 3: Update profile (simulates PATCH /api/me)
    try {
      const { rows } = await client.query(
        `UPDATE users
         SET first_name = 'Smoke', last_name = 'Test', phone = '555-0000', updated_at = now()
         WHERE clerk_id = $1
         RETURNING first_name, last_name, phone`,
        [testClerkId],
      );
      if (rows[0].first_name !== "Smoke") throw new Error("first_name not persisted");
      ok("UPDATE profile fields (PATCH /api/me shape)");
    } catch (err) {
      fail("UPDATE profile fields", err);
    }

    // Step 4: Membership route lookup (simulates GET /api/memberships/my)
    try {
      const { rows } = await client.query(
        `SELECT id, email, role, admin_level FROM users WHERE clerk_id = $1`,
        [testClerkId],
      );
      if (!rows[0]?.id) throw new Error("id missing");
      ok("SELECT for memberships route (GET /api/memberships/my shape)");
    } catch (err) {
      fail("SELECT for memberships route", err);
    }

  } finally {
    try { await client.query(`DELETE FROM users WHERE clerk_id = $1`, [testClerkId]); } catch (_) {}
    client.release();
    await pool.end();
  }

  console.log(`\n[smoke-auth] Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.error("[smoke-auth] FAILED — auth layer is broken");
    process.exit(1);
  }
  console.log("[smoke-auth] PASSED — auth/profile DB layer is healthy");
}

run().catch((err) => {
  console.error("[smoke-auth] Unexpected error:", err?.message ?? err);
  process.exit(1);
});
