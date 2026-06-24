---
name: PlayOn DB migrations
description: How to safely apply schema changes in this project (drizzle-kit push fails in non-TTY)
---

## Rule
Always use `pnpm --filter @workspace/db run ensure-schema` for DB migrations, never `drizzle-kit push`.

**Why:** The environment is non-TTY, and drizzle-kit push fails without an interactive terminal. The ensure-schema.mjs script is safe, idempotent, and runs in any environment.

## How to apply
1. Add a new entry to `lib/db/src/ensure-schema.mjs` MIGRATIONS array with `ADD COLUMN IF NOT EXISTS` SQL
2. Add the column to the Drizzle schema TypeScript file (e.g. `lib/db/src/schema/teamMembers.ts`)
3. Run `pnpm --filter @workspace/db run ensure-schema`
4. Verify "All required columns verified present" in output

## Current migration numbering
Last migration applied: 0032 (team_members.notes)
