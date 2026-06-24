import { Router, type IRouter, type Request, type Response } from "express";
import { Webhook } from "svix";
import { db, usersTable, auditLogTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";

const router: IRouter = Router();

router.post("/webhooks/clerk", async (req: Request, res: Response): Promise<void> => {
  const secret = process.env.CLERK_WEBHOOK_SECRET;
  if (!secret) {
    console.error("[clerk-webhook] CLERK_WEBHOOK_SECRET is not set");
    res.status(500).json({ error: "Webhook secret not configured" });
    return;
  }

  const svixId = req.headers["svix-id"] as string | undefined;
  const svixTimestamp = req.headers["svix-timestamp"] as string | undefined;
  const svixSignature = req.headers["svix-signature"] as string | undefined;

  if (!svixId || !svixTimestamp || !svixSignature) {
    res.status(400).json({ error: "Missing Svix headers" });
    return;
  }

  const rawBody: Buffer = (req as any).rawBody;
  if (!rawBody) {
    res.status(400).json({ error: "Missing raw body" });
    return;
  }

  let event: { type: string; data: Record<string, any> };
  try {
    const wh = new Webhook(secret);
    event = wh.verify(rawBody.toString("utf-8"), {
      "svix-id": svixId,
      "svix-timestamp": svixTimestamp,
      "svix-signature": svixSignature,
    }) as any;
  } catch (err: any) {
    console.error("[clerk-webhook] Signature verification failed:", err.message);
    res.status(400).json({ error: "Invalid webhook signature" });
    return;
  }

  if (event.type === "user.created") {
    const clerkId: string = event.data.id;
    const emailAddresses: Array<{ email_address: string; id: string }> = event.data.email_addresses ?? [];
    const primaryEmailId: string | null = event.data.primary_email_address_id ?? null;

    const primaryEmail = primaryEmailId
      ? (emailAddresses.find((e) => e.id === primaryEmailId)?.email_address ?? null)
      : (emailAddresses[0]?.email_address ?? null);

    if (primaryEmail) {
      try {
        const normalizedEmail = primaryEmail.trim().toLowerCase();

        // Link any guest spots. Only runs when the local users row already exists
        // (the WHERE clause includes a NOT NULL guard on the subquery). If the row
        // hasn't been created yet, 0 rows match — GET /me will retry reliably.
        const linked = await db.execute(sql`
          UPDATE spots
          SET user_id = (SELECT id FROM users WHERE clerk_id = ${clerkId}),
              updated_at = NOW()
          WHERE LOWER(guest_email) = ${normalizedEmail}
            AND user_id IS NULL
            AND status = 'reserved'
            AND (SELECT id FROM users WHERE clerk_id = ${clerkId}) IS NOT NULL
        `);
        const count = (linked as any).rowCount ?? 0;
        if (count > 0) {
          console.log(`[clerk-webhook] Linked ${count} guest spot(s) to new Clerk user ${clerkId} (${normalizedEmail})`);
          try {
            const [newUser] = await db.select().from(usersTable).where(eq(usersTable.clerkId, clerkId));
            if (newUser) {
              await db.insert(auditLogTable).values({
                actorClerkId: "clerk-webhook",
                action: "guest_spots_linked",
                entityType: "user",
                entityId: String(newUser.id),
                after: JSON.stringify({ linkedSpots: count, email: normalizedEmail }),
                notes: "Guest spots linked to new account on signup",
              });
            }
          } catch {}
        } else {
          console.log(`[clerk-webhook] user.created for ${clerkId} — 0 guest spots linked (local user row may not exist yet; GET /me will pick them up on first login)`);
        }
      } catch (linkErr: any) {
        console.error("[clerk-webhook] Failed to link guest spots:", linkErr.message);
      }
    }
  }

  if (event.type === "user.deleted") {
    const clerkId: string = event.data.id;
    if (!clerkId) {
      res.status(400).json({ error: "Missing user ID in webhook payload" });
      return;
    }

    try {
      const [existing] = await db.select().from(usersTable).where(eq(usersTable.clerkId, clerkId));

      if (existing) {
        await db.delete(usersTable).where(eq(usersTable.clerkId, clerkId));

        try {
          await db.insert(auditLogTable).values({
            actorClerkId: "clerk-webhook",
            action: "user.deleted",
            entityType: "user",
            entityId: String(existing.id),
            before: JSON.stringify({ clerkId: existing.clerkId, email: existing.email, role: existing.role }),
            after: JSON.stringify(null),
            notes: "Deleted via Clerk user.deleted webhook",
          });
        } catch {
          // Non-blocking
        }

        console.log(`[clerk-webhook] Deleted local DB row for Clerk user ${clerkId}`);
      } else {
        console.log(`[clerk-webhook] user.deleted for ${clerkId} — no local DB row found (already clean)`);
      }
    } catch (err: any) {
      console.error("[clerk-webhook] Failed to delete user from DB:", err);
      res.status(500).json({ error: "Failed to process user deletion" });
      return;
    }
  }

  res.json({ received: true });
});

export default router;
