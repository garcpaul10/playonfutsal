import { pgTable, text, serial, timestamp, date, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const usersTable = pgTable("users", {
  id: serial("id").primaryKey(),
  clerkId: text("clerk_id").notNull().unique(),
  email: text("email").notNull().unique(),
  firstName: text("first_name"),
  lastName: text("last_name"),
  phone: text("phone"),
  dateOfBirth: date("date_of_birth"),
  role: text("role"), // player | parent | ref | coach | scorekeeper | staff | admin — nullable; new users have no role until onboarding completes
  roles: text("roles").array().notNull().default([]), // multi-identity: player, parent, ref, coach, scorekeeper
  /**
   * Two-level admin system:
   *   "super"  — full unrestricted access (legacy default for all existing admins)
   *   "scoped" — limited to the features toggled on in their staff_profiles row
   * Only applies when role === "admin". Ignored for non-admin roles.
   */
  adminLevel: text("admin_level"),
  playonId: text("playon_id").unique(),
  qrCode: text("qr_code"),
  emergencyContactName: text("emergency_contact_name"),
  emergencyContactPhone: text("emergency_contact_phone"),
  avatarUrl: text("avatar_url"),
  /** Address fields — populated from ID scan (AAMVA) or manual entry */
  addressLine1: text("address_line1"),
  addressLine2: text("address_line2"),
  city: text("city"),
  state: text("state"),
  zip: text("zip"),
  /** ID verification — set when account is created via barcode scan */
  idVerified: boolean("id_verified").notNull().default(false),
  idVerifiedAt: timestamp("id_verified_at", { withTimezone: true }),
  /**
   * Encrypted ID data — AES-256-GCM ciphertext of verified identity fields.
   * Stored separately from profile fields so raw license data is never in plaintext at rest.
   * Used to auto-fill waiver forms and pre-populate the profile after scan.
   * Format per field: <iv_hex>:<authTag_hex>:<ciphertext_hex>
   */
  idFirstName: text("id_first_name"),
  idLastName: text("id_last_name"),
  idDob: text("id_dob"),
  idAddress: text("id_address"),
  /**
   * ID photo — stored in private object storage bucket (not publicly accessible).
   * Contains the GCS object path (e.g. "id-photos/<uuid>"). Admin can generate
   * a time-limited signed URL to view the photo.
   */
  idPhotoUrl: text("id_photo_url"),
  /** Gender — collected during onboarding, nullable */
  gender: text("gender"),
  /** Stripe Customer ID — set when user first creates a subscription */
  stripeCustomerId: text("stripe_customer_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertUserSchema = createInsertSchema(usersTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof usersTable.$inferSelect;
