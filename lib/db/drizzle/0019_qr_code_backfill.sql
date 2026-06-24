-- Backfill qr_code for all existing users that were created before
-- the getOrCreateUser fix (which now sets qr_code on INSERT).
-- Format matches the mobile QR payload: playon:player:{clerk_id}
UPDATE "users"
SET "qr_code" = 'playon:player:' || "clerk_id"
WHERE "qr_code" IS NULL;
