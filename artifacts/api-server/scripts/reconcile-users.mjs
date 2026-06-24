/**
 * reconcile-users.mjs — One-time orphan reconciliation for PlayOn users.
 *
 * This script compares Clerk users against the local PostgreSQL DB users table
 * and reports (or removes) mismatches in either direction:
 *   - DB rows whose clerkId no longer exists in Clerk  → orphaned DB rows
 *   - Clerk accounts whose ID is not in the DB         → orphaned Clerk accounts
 *
 * HOW TO RUN (dry run — safe, makes no changes):
 *   node scripts/reconcile-users.mjs
 *
 * HOW TO EXECUTE REAL CHANGES:
 *   node scripts/reconcile-users.mjs --execute
 *
 * HOW TO RUN AGAINST PRODUCTION:
 *   1. Export the production DATABASE_URL and CLERK_SECRET_KEY from your
 *      secrets manager / Replit production environment.
 *   2. Run a dry run first to review what will be removed:
 *        DATABASE_URL="postgres://..." CLERK_SECRET_KEY="sk_live_..." \
 *          node scripts/reconcile-users.mjs
 *   3. If the output looks correct, execute for real:
 *        DATABASE_URL="postgres://..." CLERK_SECRET_KEY="sk_live_..." \
 *          node scripts/reconcile-users.mjs --execute
 *
 * IMPORTANT: Always do a dry run before --execute on production.
 */

import pg from "pg";

const { Client } = pg;

const DRY_RUN = !process.argv.includes("--execute");

const DATABASE_URL = process.env.DATABASE_URL;
const CLERK_SECRET_KEY = process.env.CLERK_SECRET_KEY;

if (!DATABASE_URL) {
  console.error("ERROR: DATABASE_URL environment variable is required.");
  process.exit(1);
}
if (!CLERK_SECRET_KEY) {
  console.error("ERROR: CLERK_SECRET_KEY environment variable is required.");
  process.exit(1);
}

console.log(`\n=== PlayOn User Reconciliation ===`);
console.log(`Mode: ${DRY_RUN ? "DRY RUN (no changes will be made)" : "EXECUTE (changes will be applied)"}`);
console.log(`Database: ${DATABASE_URL.replace(/:[^:@]+@/, ":***@")}`);
console.log(`Clerk key: [set]`);
console.log(`\nFetching data...\n`);

async function fetchAllClerkUsers() {
  const users = [];
  let offset = 0;
  const limit = 500;

  while (true) {
    const url = `https://api.clerk.com/v1/users?limit=${limit}&offset=${offset}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${CLERK_SECRET_KEY}` },
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Clerk API error ${res.status}: ${text}`);
    }
    const data = await res.json();
    if (!Array.isArray(data) || data.length === 0) break;
    users.push(...data);
    if (data.length < limit) break;
    offset += limit;
  }

  return users;
}

async function main() {
  const client = new Client({ connectionString: DATABASE_URL });
  await client.connect();

  try {
    // --- Fetch all Clerk users ---
    const clerkUsers = await fetchAllClerkUsers();
    const clerkIdSet = new Set(clerkUsers.map((u) => u.id));
    console.log(`Clerk: ${clerkUsers.length} total users`);

    // --- Fetch all DB users ---
    const { rows: dbUsers } = await client.query(
      `SELECT id, clerk_id AS "clerkId", email, role FROM users ORDER BY id`,
    );
    const dbClerkIdSet = new Set(dbUsers.map((u) => u.clerkId));
    console.log(`DB:    ${dbUsers.length} total users\n`);

    // --- Find orphaned DB rows (clerkId not in Clerk) ---
    const orphanedDbRows = dbUsers.filter((u) => !clerkIdSet.has(u.clerkId));
    console.log(`Orphaned DB rows (in DB but not in Clerk): ${orphanedDbRows.length}`);
    if (orphanedDbRows.length > 0) {
      for (const row of orphanedDbRows) {
        console.log(`  DB id=${row.id}  clerkId=${row.clerkId}  email=${row.email ?? "(none)"}  role=${row.role}`);
      }
      if (!DRY_RUN) {
        for (const row of orphanedDbRows) {
          await client.query(`DELETE FROM users WHERE clerk_id = $1`, [row.clerkId]);
          console.log(`  [DELETED] DB row clerkId=${row.clerkId}`);
        }
      }
    }

    console.log();

    // --- Find orphaned Clerk accounts (Clerk ID not in DB) ---
    const orphanedClerkAccounts = clerkUsers.filter((u) => !dbClerkIdSet.has(u.id));
    console.log(`Orphaned Clerk accounts (in Clerk but not in DB): ${orphanedClerkAccounts.length}`);
    if (orphanedClerkAccounts.length > 0) {
      for (const u of orphanedClerkAccounts) {
        const email = u.email_addresses?.[0]?.email_address ?? "(none)";
        console.log(`  Clerk id=${u.id}  email=${email}`);
      }
      if (!DRY_RUN) {
        for (const u of orphanedClerkAccounts) {
          const delRes = await fetch(`https://api.clerk.com/v1/users/${u.id}`, {
            method: "DELETE",
            headers: { Authorization: `Bearer ${CLERK_SECRET_KEY}` },
          });
          if (delRes.ok) {
            console.log(`  [DELETED] Clerk account id=${u.id}`);
          } else {
            const text = await delRes.text();
            console.error(`  [ERROR] Failed to delete Clerk account id=${u.id}: ${delRes.status} ${text}`);
          }
        }
      }
    }

    console.log();
    console.log(`=== Summary ===`);
    console.log(`  Orphaned DB rows:         ${orphanedDbRows.length}`);
    console.log(`  Orphaned Clerk accounts:  ${orphanedClerkAccounts.length}`);

    if (DRY_RUN) {
      console.log(`\nDRY RUN complete — no changes were made.`);
      console.log(`Re-run with --execute to apply the changes above.`);
    } else {
      console.log(`\nReconciliation complete.`);
    }
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
