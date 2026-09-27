import { and, eq, sql } from "drizzle-orm";
import { emailOutbox } from "@/db/schema/email-outbox";
import { STARTS_DEADLINE } from "@/modules/notifications/domain/deadline-rebase";
import type { TestDatabase } from "./db";

/**
 * The declaration emails that start their holds, as sent at `at` (§513): what the drain does within
 * seconds of the request under the `immediate` timing, and the scheduler's tick under `scheduled`.
 *
 * A test about what happens once a hold lapses calls this first. A hold whose first email is still
 * in the queue has not started (`registrations/repository.ts#awaitingItsFirstEmail`), and the tests
 * written before that rule queued the email and never sent it — the world they describe is the one
 * in which it left. Only the marked rows, so every other message a test counts or sends is as it was.
 */
export async function sendHoldEmails(db: TestDatabase, at: Date): Promise<void> {
  await db
    .update(emailOutbox)
    .set({ status: "SENT", sentAt: at })
    .where(
      and(
        eq(emailOutbox.status, "PENDING"),
        eq(emailOutbox.messageType, "COMPLETE_DECLARATION"),
        sql`(${emailOutbox.payloadJson} ->> ${STARTS_DEADLINE}) = 'true'`,
      ),
    );
}
