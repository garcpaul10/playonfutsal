import { getAuth } from "@clerk/express";
import { db, usersTable, staffProfilesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import type { Request, Response, NextFunction } from "express";

export interface AuthedRequest extends Request {
  clerkUserId: string;
  dbUser?: typeof usersTable.$inferSelect;
}

/** Any authenticated Clerk session */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const auth = getAuth(req);
  const userId = auth?.userId;
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  (req as AuthedRequest).clerkUserId = userId;
  next();
}

/**
 * Super-admin only (role === "admin" AND adminLevel === "super").
 * Required for privileged mutations: role changes, system config, audit log.
 * Scoped admins (adminLevel === "scoped") are explicitly blocked here.
 */
export async function requireSuperAdmin(req: Request, res: Response, next: NextFunction): Promise<void> {
  const auth = getAuth(req);
  const clerkUserId = auth?.userId;
  if (!clerkUserId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const [user] = await db.select().from(usersTable).where(eq(usersTable.clerkId, clerkUserId));
  if (!user || user.role !== "admin" || (user as any).adminLevel !== "super") {
    res.status(403).json({ error: "Forbidden: requires super-admin" });
    return;
  }
  (req as AuthedRequest).clerkUserId = clerkUserId;
  (req as AuthedRequest).dbUser = user;
  next();
}

/** Scoped staff OR super-admin for general read access to admin data. */
export async function requireAdmin(req: Request, res: Response, next: NextFunction): Promise<void> {
  const auth = getAuth(req);
  const clerkUserId = auth?.userId;
  if (!clerkUserId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const [user] = await db.select().from(usersTable).where(eq(usersTable.clerkId, clerkUserId));
  if (!user || (user.role !== "admin" && user.role !== "staff")) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  (req as AuthedRequest).clerkUserId = clerkUserId;
  (req as AuthedRequest).dbUser = user;
  next();
}

/**
 * Checks whether a user (by clerkUserId) has a specific permission without blocking the request.
 * Super-admins (role=admin AND adminLevel=super) always return true.
 * Scoped admins (role=admin AND adminLevel=scoped) are routed through staff_profiles, same as staff.
 * Regular users (role !== "admin" | "staff") always return false.
 * Use this inside mixed-auth route handlers (owner OR staff) where blocking middleware isn't appropriate.
 */
export async function hasPermission(clerkUserId: string, permissionKey: string): Promise<boolean> {
  const [user] = await db.select().from(usersTable).where(eq(usersTable.clerkId, clerkUserId));
  if (!user) return false;
  if (user.role === "admin" && (user as any).adminLevel !== "scoped") return true;
  if (user.role !== "admin" && user.role !== "staff") return false;
  const [profile] = await db.select().from(staffProfilesTable).where(eq(staffProfilesTable.userId, user.id));
  if (!profile || !profile.isActive) return false;
  return !!(profile as Record<string, any>)[permissionKey];
}

/**
 * Allows admin, staff, OR any user with an active staffProfile record (covers refs who
 * may have user role "player" but have been set up as referees in the staff system).
 * Use for operations that refs need access to (e.g. filing incident reports, accessing referee tools).
 */
export async function requireStaffOrRef(req: Request, res: Response, next: NextFunction): Promise<void> {
  const auth = getAuth(req);
  const clerkUserId = auth?.userId;
  if (!clerkUserId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const [user] = await db.select().from(usersTable).where(eq(usersTable.clerkId, clerkUserId));
  if (!user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  // Admin (any level), staff, and scorekeepers always pass
  if (user.role === "admin" || user.role === "staff" || user.role === "scorekeeper") {
    (req as AuthedRequest).clerkUserId = clerkUserId;
    (req as AuthedRequest).dbUser = user;
    next();
    return;
  }
  // Also allow users with an active staffProfile (e.g. referees set up in the staff system)
  const [profile] = await db.select().from(staffProfilesTable).where(eq(staffProfilesTable.userId, user.id));
  if (profile?.isActive) {
    (req as AuthedRequest).clerkUserId = clerkUserId;
    (req as AuthedRequest).dbUser = user;
    next();
    return;
  }
  res.status(403).json({ error: "Forbidden: requires staff, admin, scorekeeper, or active referee profile" });
}

/**
 * Requires the authenticated user to have completed ID verification (idVerified = true in DB).
 * Admin and staff accounts are exempt (they pre-date the ID-scan requirement).
 * Apply to player-facing mutation endpoints that require a verified adult identity.
 */
export async function requireIdVerified(req: Request, res: Response, next: NextFunction): Promise<void> {
  const auth = getAuth(req);
  const clerkUserId = auth?.userId;
  if (!clerkUserId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const [user] = await db.select().from(usersTable).where(eq(usersTable.clerkId, clerkUserId));
  if (!user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  // Admin and staff are exempt from ID-scan verification requirement
  if (user.role === "admin" || user.role === "staff") {
    (req as AuthedRequest).clerkUserId = clerkUserId;
    (req as AuthedRequest).dbUser = user;
    next();
    return;
  }
  if (!(user as any).idVerified) {
    res.status(403).json({ error: "ID verification required. Please scan your driver's license in the PlayOn mobile app." });
    return;
  }
  (req as AuthedRequest).clerkUserId = clerkUserId;
  (req as AuthedRequest).dbUser = user;
  next();
}

/**
 * Permission-scoped guard for staff and scoped admins.
 * Super-admins (role=admin AND adminLevel=super) pass unconditionally.
 * Scoped admins (role=admin AND adminLevel=scoped) are routed through staff_profiles, same as staff.
 * Staff must have the specified boolean permission field set in their staff_profiles row.
 * permissionKey must be a boolean field key on staffProfilesTable.
 */
export function requirePermission(permissionKey: string) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const auth = getAuth(req);
    const clerkUserId = auth?.userId;
    if (!clerkUserId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const [user] = await db.select().from(usersTable).where(eq(usersTable.clerkId, clerkUserId));
    if (!user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    if (user.role === "admin" && (user as any).adminLevel !== "scoped") {
      // Super-admin passes all permission checks
      (req as AuthedRequest).clerkUserId = clerkUserId;
      (req as AuthedRequest).dbUser = user;
      next();
      return;
    }
    if (user.role !== "admin" && user.role !== "staff") {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    // Check staff profile for the scoped permission (applies to both staff and scoped admins)
    const [profile] = await db.select().from(staffProfilesTable).where(eq(staffProfilesTable.userId, user.id));
    if (!profile || !profile.isActive) {
      res.status(403).json({ error: "Forbidden: no active staff profile" });
      return;
    }
    const permitted = (profile as Record<string, any>)[permissionKey];
    if (!permitted) {
      res.status(403).json({ error: `Forbidden: requires ${permissionKey} permission` });
      return;
    }
    (req as AuthedRequest).clerkUserId = clerkUserId;
    (req as AuthedRequest).dbUser = user;
    next();
  };
}

/**
 * Like requirePermission, but passes if the user has ANY of the listed permission keys.
 * Super-admins always pass. Staff/scoped-admins need at least one matching flag set to true.
 */
export function requireAnyPermission(permissionKeys: string[]) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const auth = getAuth(req);
    const clerkUserId = auth?.userId;
    if (!clerkUserId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const [user] = await db.select().from(usersTable).where(eq(usersTable.clerkId, clerkUserId));
    if (!user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    if (user.role === "admin" && (user as any).adminLevel !== "scoped") {
      (req as AuthedRequest).clerkUserId = clerkUserId;
      (req as AuthedRequest).dbUser = user;
      next();
      return;
    }
    if (user.role !== "admin" && user.role !== "staff") {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    const [profile] = await db.select().from(staffProfilesTable).where(eq(staffProfilesTable.userId, user.id));
    if (!profile || !profile.isActive) {
      res.status(403).json({ error: "Forbidden: no active staff profile" });
      return;
    }
    const hasAny = permissionKeys.some((key) => !!(profile as Record<string, any>)[key]);
    if (!hasAny) {
      res.status(403).json({ error: `Forbidden: requires one of [${permissionKeys.join(", ")}]` });
      return;
    }
    (req as AuthedRequest).clerkUserId = clerkUserId;
    (req as AuthedRequest).dbUser = user;
    next();
  };
}
