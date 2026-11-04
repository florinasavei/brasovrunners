import { newsletterSends } from "@/db/schema/newsletter";
import type { Database } from "@/db/types";
import { recordAuditEvent } from "@/modules/audit/repository";

/**
 * «Anunță abonații newsletterului» unticked at a publication (the design «telling the owner about every email a staff
 * press sends», 2026-11-03, slice 4): the event is marked seen for the new-event alert — its `newsletter_sends`
 * `EVENT_ALERT` row with no recipients, the marker `queueNewEventAlerts` already writes for an event nobody would be told
 * of, which it skips ever after and «Trimise» hides — so the job never announces it; one `event.new_event_alert_skipped`
 * audit row says who chose so (`emailSkipped`, never a subscriber). No new column: the row is the «once» the unique
 * index already keeps.
 *
 * Called inside the publication's own transaction, so the job can never find the event published and not yet marked.
 * An event already announced or already seen has its row: nothing is written, and false says so.
 */
export async function skipNewEventAlert<T extends Record<string, unknown>>(
  db: Database<T>,
  input: { actorStaffUserId: string; eventId: string; now: Date },
): Promise<boolean> {
  const [marked] = await db
    .insert(newsletterSends)
    .values({ kind: "EVENT_ALERT", topics: ["ALL"], eventId: input.eventId, recipients: 0, createdAt: input.now })
    .onConflictDoNothing({ target: newsletterSends.eventId })
    .returning({ id: newsletterSends.id });
  if (!marked) return false;
  await recordAuditEvent(db, {
    actorStaffUserId: input.actorStaffUserId,
    action: "event.new_event_alert_skipped",
    entityType: "event",
    entityId: input.eventId,
    metadata: { emailSkipped: true },
    now: input.now,
  });
  return true;
}
