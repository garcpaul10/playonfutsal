---
name: PlayOn admin permission gating
description: Pattern for scoped permission checks across backend middleware and frontend UI controls in the admin dashboard.
---

## Rule
Every admin UI edit/delete/create control must be gated by the specific section permission (e.g. `canManageCourts`, `canManageLeagues`) rather than a broad `isSuperAdmin` role check. Backend routes must use the narrowest applicable permission middleware.

**Why:** Scoped staff members (role=staff or adminLevel=scoped) have individual boolean permission flags in `staffProfilesTable`. Broad role checks excluded these users from controls they're authorized to use, and allowing cross-domain mutations (e.g. team name via a tournament-registration PATCH) bypasses the per-section permission model.

**How to apply:**

### Frontend
Use the `useAdminPermissions` hook from `@/hooks/use-admin-permissions`:
```ts
const { canManageLeagues, canManageTournaments, canManageCourts, ... } = useAdminPermissions();
```
- Safe to call in any sub-component — TanStack Query (`queryKey: ["my-staff-profile"]`) caches the result for 60s.
- Super-admins (role=admin && adminLevel≠scoped) get all flags true without an extra network call.
- Scoped staff/admins resolve flags from GET /api/staff-profiles/me.
- Gate UI controls: `{canManageCourts && <Button>Edit</Button>}` not `{isSuperAdmin && ...}`.

### Backend
Two middleware helpers in `artifacts/api-server/src/middlewares/auth.ts`:
- `requirePermission(key)` — exactly one permission must be true.
- `requireAnyPermission(keys[])` — at least one permission in the list must be true. Use for routes that span multiple admin domains (e.g. team rename accessible to both league and tournament admins).

### Team rename
`PATCH /teams/:id` uses `requireAnyPermission(["canManageLeagues", "canManageTournaments"])`.
Never mutate teams from within a registration PATCH — call the teams endpoint separately to preserve the permission boundary.
