#!/bin/bash
set -e

# Only run pnpm install if the lockfile changed in the merge.
# This avoids the slow ~30s install on every merge when deps haven't changed.
if git --no-optional-locks diff --name-only HEAD~1 HEAD 2>/dev/null | grep -q "pnpm-lock.yaml"; then
  echo "[post-merge] pnpm-lock.yaml changed — running pnpm install"
  pnpm install --frozen-lockfile
else
  echo "[post-merge] pnpm-lock.yaml unchanged — skipping install"
fi

# Idempotent schema enforcement: applies any missing columns (ADD COLUMN IF NOT EXISTS)
# This handles all schema changes without requiring a TTY or interactive prompts.
node lib/db/src/ensure-schema.mjs

# Integration smoke test: verifies GET /api/me, PATCH /api/me, and
# GET /api/memberships/my DB shapes all succeed after schema enforcement.
pnpm --filter db run smoke-test-auth
