import { and, count, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { events } from "@/db/schema/events";
import { registrationInterests } from "@/db/schema/registration-interests";
import type { Database } from "@/db/types";
import { registrationState, type RegistrationWindowInput } from "@/modules/events/domain/registration-window";
import { findCurrentApprovedDocument } from "@/modules/legal-documents/repository";
import { wakeJobs } from "@/modules/jobs/schedule-cache";
import { interestAction } from "@/modules/notifications/domain/automatic-sends";
import { enqueueEmail } from "@/modules/notifications/outbox";
import { canonicalizeEmail } from "@/modules/participants/domain/canonical-email";
import { DomainError } from "@/shared/errors/domain-error";
import { looksLikeSpam } from "./service";

/**
 * "Anunță-mă când se deschid înscrierile" (`DECISIONS.md` §146; BR-REQ-011-01 criterion 13).
 *
 * The club advertises a race weeks before it takes entries. The event's page says when
 * registration opens; this is the box under that sentence — one address, one message on the
 * maintenance run that first sees the window open, and the address gone the moment the
 * message is queued. It is not a registration and creates no participant: nothing is held,
 * nothing is promised, the message only points at the ordinary registration page.
 *
 * Three rules carried over from the registration form, because this is a public form too:
 * the address goes through the versioned canonicalizer (AGENTS.md §10.4) and the UNIQUE
 * constraint is on that identity; the spam defences are the form's own — the honeypot, the
 * timing check (`looksLikeSpam`) and Turnstile at the action — answered with the same
 * silence; and no address is taken while no approved privacy notice describes what happens to
 * it (BR-REQ-053-01, the rule the participant list follows too, §32) — the page hides the box
 * in that state, and the service refuses whoever posts past the page.
 */

const interestSchema = z.object({
  // Trimmed first, like the canonicalizer: a trailing space on a phone keyboard is not a typo.
  email: z.string().trim().max(320).pipe(z.email()),
  locale: z.enum(["ro", "en"]),
  honeypot: z.string().max(2000).optional(),
  renderedAt: z.iso.datetime().optional(),
});

export type InterestEvent = RegistrationWindowInput & { id: string };

/**
 * Keep an address for one event while its window is ahead.
 *
 * Answers nothing, whatever it found: a new row, an address already on the list, a bot —
 * the page says "we'll tell you" in every case (the resend-oracle rule, BR-REQ-031-01
 * criterion 3), so the form cannot be used to ask whether somebody signed up. The two things
 * it does say are a malformed address, which is the person's own typo to fix, and a window
 * that is no longer ahead, which the page answers by showing the button instead — and a
 * missing privacy notice, answered the same way, since the page shows no box then either.
 */
export async function registerInterest<T extends Record<string, unknown>>(
  db: Database<T>,
  event: InterestEvent,
  rawInput: unknown,
  now: Date,
): Promise<void> {
  if (registrationState(event, now) !== "NOT_YET_OPEN") {
    throw new DomainError("CONFLICT", "registration is not ahead for this event");
  }
  const parsed = interestSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new DomainError("VALIDATION_ERROR", "the interest form is malformed", ["email"]);
  }
  const input = parsed.data;
  if (looksLikeSpam(input, now)) return;

  // The same gate the registration form has (`submitRegistration`): an address is personal
  // data, and the consent it is taken under is described by the notice — no notice, no row.
  if (!(await findCurrentApprovedDocument(db, "PRIVACY_NOTICE", input.locale, now))) {
    throw new DomainError("CONFLICT", "no approved privacy notice exists yet; the interest form is closed");
  }

  let identity;
  try {
    identity = canonicalizeEmail(input.email);
  } catch {
    throw new DomainError("VALIDATION_ERROR", "the address is not valid", ["email"]);
  }

  await db
    .insert(registrationInterests)
    .values({
      eventId: event.id,
      deliveryEmail: identity.deliveryEmail,
      canonicalEmail: identity.canonicalEmail,
      canonicalizationVersion: identity.canonicalizationVersion,
      locale: input.locale,
      createdAt: now,
    })
    .onConflictDoNothing({ target: [registrationInterests.eventId, registrationInterests.canonicalEmail] });
  // The announcement is due when the window opens; the job is told if that is soon (§334).
  wakeJobs("registration-maintenance", event.registrationOpensAt ?? event.publishedAt ?? now, now);
}

/** How many addresses wait for one event's announcement — the count the organizer sees. */
export async function countInterests<T extends Record<string, unknown>>(db: Database<T>, eventId: string): Promise<number> {
  const [row] = await db.select({ n: count() }).from(registrationInterests).where(eq(registrationInterests.eventId, eventId));
  return row?.n ?? 0;
}

/**
 * Withdrawal (the notice: "pe care îl poți retrage oricând înainte de trimitere, scriindu-ne"):
 * an Administrator types the address the person wrote from and the row goes, found by the
 * versioned canonical identity — `Ana.Pop+x@gmail.com` finds the row left as `ana.pop@`.
 * Says whether a row went, because the person asking is staff, not the public.
 */
export async function withdrawInterest<T extends Record<string, unknown>>(
  db: Database<T>,
  eventId: string,
  email: string,
): Promise<boolean> {
  let identity;
  try {
    identity = canonicalizeEmail(email);
  } catch {
    throw new DomainError("VALIDATION_ERROR", "the address is not valid", ["email"]);
  }
  const gone = await db
    .delete(registrationInterests)
    .where(and(eq(registrationInterests.eventId, eventId), eq(registrationInterests.canonicalEmail, identity.canonicalEmail)))
    .returning({ id: registrationInterests.id });
  return gone.length > 0;
}

/**
 * The job's step (AGENTS.md §16.2): for every event whose window has opened since the
 * addresses were left, one `REGISTRATION_OPENED` per address — key `interest:<id>:opened`,
 * no participant, the event's id in the payload so a renamed event renders right — and the
 * row deleted in the same transaction. An event whose window is no longer *ahead* but is not
 * open either — cancelled, completed, started, closed, moved to another form or to no form —
 * loses its rows with no message: there is nothing to announce, and the address was kept
 * for one purpose only. Rows of an event still ahead are left where they are.
 *
 * Publication is asked for the message and not for the drop: an unpublished event's page
 * cannot be registered on, so its addresses wait; an archived race that has started is
 * still over.
 */
export async function queueRegistrationOpenedMessages<T extends Record<string, unknown>>(
  db: Database<T>,
  now: Date,
): Promise<{ queued: number; dropped: number }> {
  const candidates = await db
    .selectDistinct({
      id: events.id,
      registrationMode: events.registrationMode,
      eventStatus: events.eventStatus,
      editorialStatus: events.editorialStatus,
      startsAt: events.startsAt,
      registrationOpensAt: events.registrationOpensAt,
      registrationClosesAt: events.registrationClosesAt,
      publishedAt: events.publishedAt,
    })
    .from(events)
    .innerJoin(registrationInterests, eq(registrationInterests.eventId, events.id));

  let queued = 0;
  let dropped = 0;
  for (const event of candidates) {
    // Ahead, or open but not published — taken off the site for a while, so it cannot be
    // registered on either: the addresses wait for the window, the page to come back, or the
    // start to pass. One formula with the forecast on `/admin/emails` (`interestAction`, §NNN).
    const action = interestAction(event, now);
    if (action === "wait") continue;
    const announce = action === "announce";
    await db.transaction(async (tx) => {
      const rows = await tx
        .select({ id: registrationInterests.id, deliveryEmail: registrationInterests.deliveryEmail, locale: registrationInterests.locale })
        .from(registrationInterests)
        .where(eq(registrationInterests.eventId, event.id));
      if (rows.length === 0) return;
      if (announce) {
        for (const row of rows) {
          const inserted = await enqueueEmail(tx, {
            participantId: null,
            registrationId: null,
            messageType: "REGISTRATION_OPENED",
            locale: row.locale,
            recipientEmail: row.deliveryEmail,
            payload: { eventId: event.id },
            idempotencyKey: `interest:${row.id}:opened`,
            now,
          });
          if (inserted) queued += 1;
        }
      } else {
        dropped += rows.length;
      }
      await tx.delete(registrationInterests).where(
        inArray(
          registrationInterests.id,
          rows.map((row) => row.id),
        ),
      );
    });
  }
  return { queued, dropped };
}
