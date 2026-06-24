import { db, accountCreditsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

/**
 * Restore credits that were pre-reserved during checkout creation.
 * Called when a Stripe session expires OR when session creation itself fails
 * (so credits are never stranded without a compensating restore).
 *
 * @param reservedJson - JSON string: Array<{ id: number; consumed: number }>
 */
export async function restoreReservedCredits(reservedJson: string): Promise<void> {
  let reserved: Array<{ id: number; consumed: number }> = [];
  try { reserved = JSON.parse(reservedJson); } catch { return; }
  for (const { id, consumed } of reserved) {
    if (!id || !consumed) continue;
    const [credit] = await db.select().from(accountCreditsTable).where(eq(accountCreditsTable.id, id));
    if (!credit) continue;
    await db.update(accountCreditsTable)
      .set({ remainingAmount: String(Number(credit.remainingAmount) + consumed), updatedAt: new Date() } as any)
      .where(eq(accountCreditsTable.id, id));
  }
}
