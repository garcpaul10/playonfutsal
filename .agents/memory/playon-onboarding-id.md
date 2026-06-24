---
name: PlayOn onboarding + ID verification
description: How the onboarding gate, ID photo upload, and identity verification flow work; key gotchas for the api-server build and codegen.
---

# Rule
New users land at /onboarding until both `roles.length > 0` AND `idVerified === true`. The profile gate (`use-profile-gate.ts`) checks both conditions.

**Why:** `users.role` previously had `DEFAULT "player"` so any freshly created user appeared to have a role, bypassing onboarding. Migration 0076 dropped the DEFAULT and NOT NULL, making role nullable so the roles array stays empty until the user completes onboarding.

**How to apply:** When changing profile-gate logic, always verify both conditions. When adding new onboarding steps, add a third check here.

# DB shape
- `users.role`: nullable `text`, no default (migration 0076). Existing users keep their value.
- `users.id_photo_url`: nullable `text` (migration 0075). Stores GCS object name (not a full URL).

# ID photo storage
- `idPhotoStorage.ts` (artifacts/api-server/src/lib/) — Replit sidecar GCS auth (`new Storage()` with no explicit credentials).
- Signed URLs expire in 15 minutes. Admin viewer calls `GET /admin/users/:id/id-photo` which returns a fresh signed URL.

# Codegen
- Run via: `pnpm --filter @workspace/api-spec run codegen`
- Typecheck step in codegen always fails on pre-existing `lib/db/src/seed.ts` errors — not a blocker.

# api-server build gotcha
- esbuild cannot resolve `zod` as an external (not in its bundle config).
- Do NOT `import { z } from "zod"` directly in api-server routes.
- Instead: return plain objects, or import schemas from `@workspace/api-zod`.
- `GetMyIdDataResponse` was stripped from api-zod by codegen (not in OpenAPI spec); now handled as inline plain object returns in `/me/id-data` route.

# OpenAPI schema changes (from this session)
- `UserProfile.role`: now nullable (migration 0076 aligned)
- `UserProfile` and `UserProfileUpdate`: added `roles` (array), `adminLevel` (nullable), `addressLine1`, `city`, `state`, `zip`
