CREATE TABLE IF NOT EXISTS "staff_invites" (
  "id" serial PRIMARY KEY NOT NULL,
  "token" text NOT NULL UNIQUE,
  "email" text NOT NULL,
  "role" text NOT NULL,
  "created_by" text NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "expires_at" timestamptz NOT NULL,
  "used_at" timestamptz,
  "used_by" text,
  "revoked_at" timestamptz
);

CREATE INDEX IF NOT EXISTS "staff_invites_token_idx" ON "staff_invites" ("token");
CREATE INDEX IF NOT EXISTS "staff_invites_email_idx" ON "staff_invites" ("email");
