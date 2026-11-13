import { and, eq, inArray } from "drizzle-orm";
import { registrations } from "@/db/schema/registrations";
import { AUDIENCE_STATUSES, CHOSEN_AUDIENCE, chosenRegistrationIds, isMessageReach } from "@/modules/notifications/domain/organizer-message";
import type { SendParticipantMessageInput } from "@/modules/notifications/participant-messages";
import { isUuid } from "@/shared/ids";
import type { TestDatabase } from "./db";

/**
 * What a careful organizer types at «Scrie la câți trimiți» on «Trimite un mesaj participanților» (§945): the number of
 * real registrations a send to `audience` writes to right now — the number the page has just shown them.
 *
 * For the tests that are about something else than that box: each sends as somebody who read the number off the
 * screen and typed it. The box's own tests type their numbers themselves. A send that is refused before anybody is
 * counted — no such choice, no such event — types «0».
 */
export async function typedCountFor(db: TestDatabase, eventId: string, audience: string, ticked: readonly unknown[] = []): Promise<string> {
  if (!isUuid(eventId) || !isMessageReach(audience)) return "0";
  const rows = await db
    .select({ id: registrations.id })
    .from(registrations)
    .where(
      and(
        eq(registrations.eventId, eventId),
        eq(registrations.kind, "REAL"),
        inArray(registrations.status, [...AUDIENCE_STATUSES[audience === CHOSEN_AUDIENCE ? "ALL_ACTIVE" : audience]]),
      ),
    );
  if (audience !== CHOSEN_AUDIENCE) return String(rows.length);
  const chosen = new Set(chosenRegistrationIds(ticked));
  return String(rows.filter((row) => chosen.has(row.id)).length);
}

/** A send's input before the number is typed: everything the form posts but that box, or with a number of the test's own. */
export type UnconfirmedSend = Omit<SendParticipantMessageInput, "confirmCount"> & { confirmCount?: string };

/** The send's input as that organizer posts it: the number typed right, unless the test typed its own. */
export async function confirmed(db: TestDatabase, input: UnconfirmedSend): Promise<SendParticipantMessageInput> {
  return { ...input, confirmCount: input.confirmCount ?? (await typedCountFor(db, input.eventId, input.audience, input.registrationIds)) };
}
