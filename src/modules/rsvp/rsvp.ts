import { and, asc, count, eq, gt, isNull, isNotNull, sql } from "drizzle-orm";
import { z } from "zod";
import { eventRsvps, eventRsvpTokens, type EventRsvp } from "@/db/schema/event-rsvps";
import { eventTranslations, events } from "@/db/schema/events";
import { inReadOnlyTransaction } from "@/db/read-only";
import type { Database, Transaction } from "@/db/types";
import { generateTokenSecret, hashTokenSecret, isWellFormedTokenSecret } from "@/modules/action-tokens/domain/token-secret";
import { findPublishedEventById } from "@/modules/events/repository";
import { findCurrentApprovedDocument, noticeDescribesRsvp, noticeDescribesRsvpMember } from "@/modules/legal-documents/repository";
import { enqueueEmail } from "@/modules/notifications/outbox";
import { canonicalizeEmail } from "@/modules/participants/domain/canonical-email";
import { revalidatePublicContent } from "@/modules/public-cache/cache";
import { consumeRateLimit } from "@/modules/rate-limit/service";
import { emailBucketKey } from "@/modules/rate-limit/domain/key";
import { DomainError } from "@/shared/errors/domain-error";
import { cleanDisplayName, identityClubMember, isConsistent, type RsvpIdentity } from "./domain/identity";
import { RSVP_CONFIRM_HOURS, RSVP_LINK_GRACE_DAYS } from "./domain/link-life";
import { readRefuseLink } from "./ask-refusal";
import { rsvpOffered } from "./domain/offered";
import { publicRsvpName } from "./domain/public-name";
import { type ClubMemberKind, mergeClubMember, parseClubMember, publicRsvpMember } from "./domain/public-member";

/**
 * «Vin!» (§811, «Vin!» part 1; the owner, 2026-10-18: «how do I mark myself as "Going"?») — a person's answer «I am coming»
 * to a turn-up event the club ticked: an address, optionally a name to show, and — once the address is proved — a place in
 * the count «Cine vine (N)».
 *
 * **Not a registration.** No place is held, no declaration is signed, no participant exists; the allocator, the
 * registrations' states, the desk and the capacity formula are untouched, and nothing here reads `kind`. The model is the
 * interest box (`registrations/interest.ts`, §146): one row per event and canonical identity (the versioned canonicalizer,
 * AGENTS.md §10.4; the form never says whether an address is already here), the same spam defences at the action, and the
 * email links of AGENTS.md §12.8 (hashed at rest, single use, a GET never mutates).
 *
 * **An identity with a source and a verified flag**, never a bare address (`domain/identity.ts`): the typed form (`page`)
 * proves nothing and waits for the emailed link; a remembered browser, a signed-in member and a personal link in an
 * email (`remembered`, `account`, `link`) have proved the address and are counted at once. The services below take that
 * identity, so the members' zone (lane 59) and the «Vii?» message (lane 58) call the same functions.
 *
 *   answerRsvp         the answer: upsert by canonical identity; unverified → one `RSVP_CONFIRM` message, verified → counted.
 *   confirmRsvp        the «Da, vin» link's POST: spends the token, counts the answer, returns the identity to remember.
 *   withdrawRsvp       «Nu vin» / «Nu mai vin»: by a `RSVP_WITHDRAW` token, or by a verified identity. Deletes the row.
 *   requestWithdrawLink the small fold's address: the withdraw link by email, never saying whether the address is on the list.
 *   readPublicRsvps    how many come and the names of those who ticked «Vreau să apar cu numele» (a disclosure, §143, §396).
 *
 * Nothing here writes an audit row: nothing is something the staff did.
 */

export { RSVP_CONFIRM_HOURS };

/** One message per address and event in this window — the form answers the same sentence either way. */
const CONFIRM_THROTTLE_SCOPE = "rsvp-confirm" as const;
const EVENT_THROTTLE_SCOPE = "rsvp-event" as const;

/**
 * An answer the «Vii?» email made and nobody has pressed yet (§818): `asked_at` set, `confirmed_at` empty. It is data held (the
 * person's data view lists it) but **not an answer**: the editor's fold and counts leave it out, and «Nu mai vin» on the page
 * finds nothing in it — an address nobody typed on the page has said nothing, so no withdraw link is mailed for it.
 */
const ASKED_UNANSWERED = sql`(${eventRsvps.askedAt} IS NOT NULL AND ${eventRsvps.confirmedAt} IS NULL)`;

const answerSchema = z.object({
  // Trimmed first, like the canonicalizer: a trailing space on a phone keyboard is not a typo.
  email: z.string().trim().max(320).pipe(z.email()),
  locale: z.enum(["ro", "en"]),
});

/** What `answerRsvp` tells its caller. The page says the same sentence whatever it is (BR-REQ-031-01 criterion 3). */
export type RsvpAnswer = {
  /** The answer is counted now (a verified identity). False: it waits for the emailed «Da, vin». */
  counted: boolean;
};

function canonicalOf(email: string) {
  try {
    return canonicalizeEmail(email);
  } catch {
    throw new DomainError("VALIDATION_ERROR", "the address is not valid", ["email"]);
  }
}

/** The 10-minute bucket a confirm message's idempotency key belongs to, so a retried queueing is one row. */
function messageWindow(now: Date): number {
  return Math.floor(now.getTime() / (10 * 60_000));
}

/** Kill the row's live «Da, vin» links: what they would confirm is no longer what their email showed. */
async function invalidateConfirmLinks<T extends Record<string, unknown>>(tx: Transaction<T>, rsvpId: string, now: Date): Promise<void> {
  await tx
    .update(eventRsvpTokens)
    .set({ invalidatedAt: now })
    .where(and(eq(eventRsvpTokens.rsvpId, rsvpId), eq(eventRsvpTokens.purpose, "RSVP_CONFIRM"), isNull(eventRsvpTokens.usedAt), isNull(eventRsvpTokens.invalidatedAt)));
}

/**
 * Take the answer «Vin!» of `identity` for event `eventId`, as of `now`.
 *
 * Refuses (`CONFLICT`) when `rsvpOffered` says no — the event is not a published, upcoming turn-up event the club ticked, or the
 * notice in force does not describe «Vin!» — and never says which; the page shows no box then either. A malformed address is the
 * person's own typo (`VALIDATION_ERROR`).
 *
 * - **Unverified** (`page`): the row is written or refreshed and stays unconfirmed; ONE `RSVP_CONFIRM` message is queued to the
 *   address (its links are minted when it is sent, §14.5), at most one per address and event per ten minutes. A row that is
 *   already confirmed is left exactly as it is — whoever types an address cannot rename its owner or change what is shown — and
 *   the message then only offers to take the answer back.
 * - **Verified** (`remembered`, `account`, `link`): the row is confirmed at once, no email, the public cache expired.
 *
 * **The member mark** (§829, amending §812 and §796): `identityClubMember` says which — `DECLARED` for the person's own tick on the page, the
 * remembered browser or the link, `ACCOUNT` for an account whose role is at least a member (read from the session on the server, never from a
 * posted box, and winning over any tick) — and it is **kept only while the notice in force describes the mark** (`noticeDescribesRsvpMember`): a tick
 * posted to a form that was drawn before the notice, or forged, stores nothing, so the data is never collected without the sentence that says so.
 * An answer already counted keeps what it held unless this press is stronger (`mergeClubMember`); a press that changes it records the notice
 * in force on the row, as the name's tick does, because that version is what the public mark is read against.
 */
export async function answerRsvp<T extends Record<string, unknown>>(
  db: Database<T>,
  eventId: string,
  identity: RsvpIdentity,
  now: Date,
): Promise<RsvpAnswer> {
  if (!isConsistent(identity)) throw new DomainError("VALIDATION_ERROR", "the identity claims more than its source proves");
  const parsed = answerSchema.safeParse({ email: identity.email, locale: identity.locale });
  if (!parsed.success) throw new DomainError("VALIDATION_ERROR", "the address is not valid", ["email"]);
  const locale = parsed.data.locale;
  const who = canonicalOf(parsed.data.email);
  const displayName = cleanDisplayName(identity.displayName);

  const event = await findPublishedEventById(db, locale, eventId);
  if (!event || !rsvpOffered(event, now, await noticeDescribesRsvp(db, now))) {
    throw new DomainError("CONFLICT", "answers are not taken for this event");
  }
  const notice = await findCurrentApprovedDocument(db, "PRIVACY_NOTICE", locale, now);
  if (!notice) throw new DomainError("CONFLICT", "no approved privacy notice exists yet; answers are not taken");
  const askedMember = identityClubMember(identity);
  const clubMember: ClubMemberKind | null = askedMember !== null && (await noticeDescribesRsvpMember(db, now)) ? askedMember : null;

  // The message throttle is spent before the write, outside the transaction, so a rollback cannot give it back.
  const mail = identity.verified
    ? false
    : (await consumeRateLimit(db, CONFIRM_THROTTLE_SCOPE, emailBucketKey(CONFIRM_THROTTLE_SCOPE, `${who.canonicalEmail}:${eventId}`), now)).allowed &&
      (await consumeRateLimit(db, EVENT_THROTTLE_SCOPE, eventId, now)).allowed;

  await db.transaction(async (tx) => {
    const values = {
      eventId,
      deliveryEmail: who.deliveryEmail,
      canonicalEmail: who.canonicalEmail,
      canonicalizationVersion: who.canonicalizationVersion,
      displayName,
      showName: identity.showName,
      clubMember,
      locale,
      privacyNoticeVersion: notice.version,
      confirmedAt: identity.verified ? now : null,
      createdAt: now,
    };
    const [inserted] = await tx.insert(eventRsvps).values(values).onConflictDoNothing({ target: [eventRsvps.eventId, eventRsvps.canonicalEmail] }).returning();
    let row: EventRsvp | undefined = inserted;
    if (!row) {
      const [existing] = await tx
        .select()
        .from(eventRsvps)
        .where(and(eq(eventRsvps.eventId, eventId), eq(eventRsvps.canonicalEmail, who.canonicalEmail)))
        .for("update");
      if (!existing) throw new DomainError("CONFLICT", "the answer could not be written");
      row = existing;
      if (identity.verified) {
        /*
          The person's own press. A row already confirmed is theirs: keep what they showed before unless this press shows more.
          A row still UNCONFIRMED is not theirs — it holds whatever a stranger typed for this address, a name and a tick the owner
          never gave — so the verified identity's own values replace it whole (§143, §396): a name is public only for the person who
          ticked it.
        */
        const owned = existing.confirmedAt !== null;
        const heldMember = parseClubMember(existing.clubMember);
        const nextMember = mergeClubMember(heldMember, clubMember);
        const [updated] = await tx
          .update(eventRsvps)
          .set(
            owned
              ? {
                  showName: identity.showName || existing.showName,
                  displayName: displayName ?? existing.displayName,
                  deliveryEmail: who.deliveryEmail,
                  clubMember: nextMember,
                  ...(identity.showName || nextMember !== heldMember ? { privacyNoticeVersion: notice.version } : {}),
                }
              : {
                  confirmedAt: now,
                  showName: identity.showName,
                  clubMember,
                  displayName,
                  locale,
                  deliveryEmail: who.deliveryEmail,
                  privacyNoticeVersion: notice.version,
                },
          )
          .where(eq(eventRsvps.id, existing.id))
          .returning();
        row = updated;
        if (!owned) await invalidateConfirmLinks(tx, existing.id, now);
      } else if (existing.confirmedAt === null && mail) {
        /*
          Not yet public, not yet the owner's: a later typing refreshes it (and the request's moment) — but only when it sends a
          new message, whose links replace the old ones. Inside the throttle the first email stays the one the person has, so the
          row must keep what that email showed. And the live «Da, vin» link of the old message dies here, so it cannot confirm a
          name and a tick it never named.
        */
        const [updated] = await tx
          .update(eventRsvps)
          .set({
            deliveryEmail: who.deliveryEmail,
            displayName,
            showName: identity.showName,
            clubMember,
            locale,
            privacyNoticeVersion: notice.version,
            createdAt: now,
            // The address was typed on the page: the answer is the page's now, not the email's question (its links open the plain wording).
            askedAt: null,
          })
          .where(eq(eventRsvps.id, existing.id))
          .returning();
        row = updated;
        await invalidateConfirmLinks(tx, existing.id, now);
      }
      // else: confirmed, typed by whoever — or unconfirmed inside the throttle: nothing changes.
    }
    if (!identity.verified && mail) {
      await enqueueEmail(tx, {
        participantId: null,
        registrationId: null,
        messageType: "RSVP_CONFIRM",
        locale,
        recipientEmail: row.deliveryEmail,
        payload: { rsvpId: row.id, eventId, request: "confirm" },
        idempotencyKey: `rsvp:${row.id}:confirm:${messageWindow(now)}`,
        now,
      });
    }
  });
  if (identity.verified) revalidatePublicContent("places");
  return { counted: identity.verified };
}

/**
 * The small fold «Nu mai vin» on the page (the address typed, no proof): the withdraw link by email — and nothing said about
 * whether the address was on the list (BR-REQ-031-01 criterion 3). Never gated by the notice or the tick: a person may always
 * take an answer back. Throttled with the confirm message, so one mailbox gets at most one message per event per ten minutes.
 */
export async function requestWithdrawLink<T extends Record<string, unknown>>(
  db: Database<T>,
  eventId: string,
  input: { email: string; locale: "ro" | "en" },
  now: Date,
): Promise<void> {
  const parsed = answerSchema.safeParse(input);
  if (!parsed.success) throw new DomainError("VALIDATION_ERROR", "the address is not valid", ["email"]);
  const who = canonicalOf(parsed.data.email);
  // The throttle is spent before the lookup whether or not the address answered, and the lookup is the same one statement: an
  // address on the list and one that is not cost the same work, so the response's timing says nothing (BR-REQ-031-01 criterion 3).
  const allowed =
    (await consumeRateLimit(db, CONFIRM_THROTTLE_SCOPE, emailBucketKey(CONFIRM_THROTTLE_SCOPE, `${who.canonicalEmail}:${eventId}`), now)).allowed &&
    (await consumeRateLimit(db, EVENT_THROTTLE_SCOPE, eventId, now)).allowed;
  const [row] = await db
    .select()
    .from(eventRsvps)
    .where(and(eq(eventRsvps.eventId, eventId), eq(eventRsvps.canonicalEmail, who.canonicalEmail), sql`NOT ${ASKED_UNANSWERED}`))
    .limit(1);
  if (!row || !allowed) return;
  await db.transaction(async (tx) => {
    await enqueueEmail(tx, {
      participantId: null,
      registrationId: null,
      messageType: "RSVP_CONFIRM",
      locale: parsed.data.locale,
      // Where the answer was given from, not where it was asked: the typed address is the person's, and it is the one on the row.
      recipientEmail: row.deliveryEmail,
      payload: { rsvpId: row.id, eventId, request: "withdraw" },
      idempotencyKey: `rsvp:${row.id}:withdraw:${messageWindow(now)}`,
      now,
    });
  });
}

type EventRsvpTokenPurpose = (typeof eventRsvpTokens.$inferSelect)["purpose"];

/**
 * Mint the links of one `RSVP_CONFIRM` message, at the send (§14.5): the secret goes into that email and nowhere else, and a
 * newer link of the same purpose supersedes the older. `confirm` is minted only when asked (the "confirm" message of a row
 * still unconfirmed); `withdraw` always, valid until the event's start. Null when the event has started: nothing to answer.
 *
 * `confirmUntilStart` (§823) is the «Vii?» question's «Vin»: the club may now send the question up to seven days ahead, so its button lives
 * until the event's start instead of the 48 hours of a confirmation message — a person who presses it the evening before is counted by
 * the one tap the question exists for, not sent to type their address again. (The refusal link is not minted here: `ask-refusal.ts`,
 * a table of its own, so it outlives the answer.)
 */
export async function mintRsvpLinks<T extends Record<string, unknown>>(
  db: Database<T>,
  params: { rsvpId: string; startsAt: Date; confirm: boolean; confirmUntilStart?: boolean; now: Date },
): Promise<{ confirm: string | null; withdraw: string } | null> {
  if (params.startsAt.getTime() <= params.now.getTime()) return null;
  const confirmExpires = params.confirmUntilStart
    ? params.startsAt
    : new Date(Math.min(params.now.getTime() + RSVP_CONFIRM_HOURS * 3_600_000, params.startsAt.getTime()));
  return db.transaction(async (tx) => {
    const mint = async (purpose: EventRsvpTokenPurpose, expiresAt: Date): Promise<string> => {
      const secret = generateTokenSecret();
      await tx
        .update(eventRsvpTokens)
        .set({ invalidatedAt: params.now })
        .where(and(eq(eventRsvpTokens.rsvpId, params.rsvpId), eq(eventRsvpTokens.purpose, purpose), isNull(eventRsvpTokens.usedAt), isNull(eventRsvpTokens.invalidatedAt)));
      await tx.insert(eventRsvpTokens).values({ rsvpId: params.rsvpId, purpose, tokenHash: hashTokenSecret(secret), expiresAt, createdAt: params.now });
      return secret;
    };
    const lives = new Date(params.startsAt.getTime() + RSVP_LINK_GRACE_DAYS * 86_400_000);
    return {
      confirm: params.confirm ? await mint("RSVP_CONFIRM", confirmExpires) : null,
      // The start can move after the message left: the link lives generously and `consumeRsvpToken` asks the event's start as it is then.
      withdraw: await mint("RSVP_WITHDRAW", lives),
    };
  });
}

/** What a link's page needs: the answer's event, in the language the answer was given in, and what the link would do. */
export type RsvpLink = {
  /** `RSVP_REFUSE` (§823) is the question's «Nu mă mai întreba la seria aceasta»: not an answer's link (`rsvp_refuse_tokens`), so no answer row stands behind it. */
  purpose: EventRsvpTokenPurpose | "RSVP_REFUSE";
  /**
   * `live`: pressing the button would act. `used`: spent, or replaced by a newer email. `expired`: the link's own life ran out while
   * the event is still ahead (the person can answer again from the page). `over`: the event has started, so no answer is taken.
   */
  state: "live" | "used" | "expired" | "over";
  rsvpId: string | null;
  eventId: string;
  locale: "ro" | "en";
  title: string;
  slug: string;
  startsAt: Date | null;
  /** The answer is already counted (a confirm link opened after another route confirmed it). */
  confirmed: boolean;
  /**
   * The answer was made by the «Vii?» email (§818) and nobody has pressed yet: the page of its two links offers the optional name
   * under the «Vin» button, and says «Bine, nu te numărăm» after «Nu vin». False for an answer typed on the event's page and for one
   * already counted.
   */
  asked: boolean;
  /** The answer has a name already (typed on the page): the box is then not offered, and the press changes nothing about it. */
  named: boolean;
  /**
   * The person's tick «Numele meu apare la „Cine vine"» as it stands (§827): the row's `show_name` AND a name to show. A tick with no name
   * (the page's form lets one be ticked with the box empty) shows nothing, so the page does not draw it ticked either.
   */
  showName: boolean;
  /**
   * The name the row holds — the person's own link, so the page may draw it: the tick would show exactly this, and the box is prefilled
   * with it, so a name is never published that the person was not shown (§827, §812).
   */
  name: string | null;
  /**
   * The member mark the answer holds (§829): `DECLARED`, `ACCOUNT` or null — what the page of a counted answer's link draws ticked, and says when it
   * is an account's (not the tick's to take away). Absent on the question's refusal link, which has no answer behind it.
   */
  clubMember?: ClubMemberKind | null;
};

/**
 * What a GET of the link may do, in a read-only transaction (BR-REQ-036-02 criterion 4): name the event and say whether the link
 * is live, used or expired — so a spent link can point at the event's page. Null for a link that is malformed or unknown (or
 * whose answer was taken back, which deletes it). It shows the event's title and slug to whoever holds the link, which they
 * already have in the email.
 */
export async function readRsvpLink<T extends Record<string, unknown>>(
  db: Database<T>,
  secret: string,
  now: Date,
): Promise<RsvpLink | null> {
  if (!isWellFormedTokenSecret(secret)) return null;
  return inReadOnlyTransaction(db, async (tx) => {
    const [row] = await tx
      .select({
        rsvpId: eventRsvps.id,
        eventId: eventRsvps.eventId,
        locale: eventRsvps.locale,
        confirmedAt: eventRsvps.confirmedAt,
        askedAt: eventRsvps.askedAt,
        displayName: eventRsvps.displayName,
        showName: eventRsvps.showName,
        clubMember: eventRsvps.clubMember,
        title: eventTranslations.title,
        slug: eventTranslations.slug,
        startsAt: events.startsAt,
        purpose: eventRsvpTokens.purpose,
        usedAt: eventRsvpTokens.usedAt,
        invalidatedAt: eventRsvpTokens.invalidatedAt,
        expiresAt: eventRsvpTokens.expiresAt,
      })
      .from(eventRsvpTokens)
      .innerJoin(eventRsvps, eq(eventRsvps.id, eventRsvpTokens.rsvpId))
      .innerJoin(events, eq(events.id, eventRsvps.eventId))
      .innerJoin(eventTranslations, and(eq(eventTranslations.eventId, events.id), eq(eventTranslations.locale, eventRsvps.locale)))
      .where(eq(eventRsvpTokens.tokenHash, hashTokenSecret(secret)))
      .limit(1);
    // Not one of the answer's links: perhaps the question's refusal link, which has a table of its own (§823).
    if (!row) return readRefuseLink(tx, secret, now);
    const over = row.startsAt !== null && row.startsAt.getTime() <= now.getTime();
    const state = row.usedAt !== null || row.invalidatedAt !== null ? "used" : over ? "over" : row.expiresAt.getTime() <= now.getTime() ? "expired" : "live";
    return {
      purpose: row.purpose,
      state,
      rsvpId: row.rsvpId,
      eventId: row.eventId,
      locale: row.locale,
      title: row.title,
      slug: row.slug,
      startsAt: row.startsAt,
      confirmed: row.confirmedAt !== null,
      asked: row.askedAt !== null && row.confirmedAt === null,
      named: row.displayName !== null,
      showName: row.showName && row.displayName !== null,
      name: row.displayName,
      clubMember: parseClubMember(row.clubMember),
    } satisfies RsvpLink;
  });
}

/** Spend a link of `purpose` inside the caller's transaction: the answer it named, or null when it was not live. One UPDATE, one winner. */
export async function consumeRsvpToken<T extends Record<string, unknown>>(
  tx: Transaction<T>,
  secret: string,
  purpose: EventRsvpTokenPurpose,
  now: Date,
): Promise<string | null> {
  if (!isWellFormedTokenSecret(secret)) return null;
  if (purpose === "RSVP_WITHDRAW") {
    // «Nu mai vin» works until the event's start as it is now — not as it was when the email left (a moved event moves its links).
    const [event] = await tx
      .select({ startsAt: events.startsAt })
      .from(eventRsvpTokens)
      .innerJoin(eventRsvps, eq(eventRsvps.id, eventRsvpTokens.rsvpId))
      .innerJoin(events, eq(events.id, eventRsvps.eventId))
      .where(eq(eventRsvpTokens.tokenHash, hashTokenSecret(secret)))
      .limit(1);
    if (event?.startsAt && event.startsAt.getTime() <= now.getTime()) return null;
  }
  const [spent] = await tx
    .update(eventRsvpTokens)
    .set({ usedAt: now })
    .where(
      and(
        eq(eventRsvpTokens.tokenHash, hashTokenSecret(secret)),
        eq(eventRsvpTokens.purpose, purpose),
        isNull(eventRsvpTokens.usedAt),
        isNull(eventRsvpTokens.invalidatedAt),
        gt(eventRsvpTokens.expiresAt, now),
      ),
    )
    .returning({ rsvpId: eventRsvpTokens.rsvpId });
  return spent?.rsvpId ?? null;
}

/** Who a used link proved: the address and name on the answer, for the caller to remember the browser as. */
export type RsvpProved = {
  eventId: string;
  locale: "ro" | "en";
  /** The event page's slug in the answer's language, for the redirect that lands on `#vin`; null if the translation is gone. */
  slug: string | null;
  email: string;
  displayName: string | null;
  /**
   * The row this press used was the «Vii?» email's question, still unanswered (§818): read from the row itself, never from the
   * page's form. A person who only declined a question they never started is not "recognised" for a year by it.
   */
  unanswered: boolean;
};

async function slugOf<T extends Record<string, unknown>>(tx: Database<T>, eventId: string, locale: "ro" | "en"): Promise<string | null> {
  const [row] = await tx
    .select({ slug: eventTranslations.slug })
    .from(eventTranslations)
    .where(and(eq(eventTranslations.eventId, eventId), eq(eventTranslations.locale, locale)))
    .limit(1);
  return row?.slug ?? null;
}

/**
 * The «Da, vin» button's POST: spends the `RSVP_CONFIRM` link and counts the answer, in one transaction — and expires the
 * event's public count. Returns who the link proved, so the caller can remember the browser (`person-session/`); null when the
 * link was not live (a second press, an expired or superseded link). A link spent after the event started changes nothing.
 *
 * **The «Vii?» email's «Vin» (§818) is this press.** The link was minted for the subscriber's own address and nobody else holds it, so
 * the press is a verified one: counted at once, no second email (it calls this function with the token's own proof, not `answerRsvp`, so
 * the `link` source of `identity.ts` stays free for a later surface). That row has no name — the
 * newsletter's row never had one, and a name nobody typed is never made up — so the page offers the optional `name` and the tick
 * `showName` above the one button, and they are taken here **only** for a row the email made (`asked_at`), still unconfirmed and
 * still nameless: a name typed by whoever typed an address on the page is never replaced, and a counted row is never renamed by a
 * second press. The tick counts only beside a name, and a name shows publicly only under the notice that described it (`public-name.ts`),
 * so the row takes the version in force.
 */
export async function confirmRsvp<T extends Record<string, unknown>>(
  db: Database<T>,
  secret: string,
  now: Date,
  options: { displayName?: string | null; showName?: boolean; clubMember?: boolean } = {},
): Promise<RsvpProved | null> {
  if (!isWellFormedTokenSecret(secret)) return null;
  const proved = await db.transaction(async (tx) => {
    /*
      The event as it is now, before the link is spent: an organizer may have cancelled the event or moved its start since the
      message left, and a link to an event that is no longer ahead counts nobody (and is not spent, so the page can still say why).
    */
    const [event] = await tx
      .select({ status: events.eventStatus, startsAt: events.startsAt, mode: events.registrationMode, enabled: events.rsvpEnabled })
      .from(eventRsvpTokens)
      .innerJoin(eventRsvps, eq(eventRsvps.id, eventRsvpTokens.rsvpId))
      .innerJoin(events, eq(events.id, eventRsvps.eventId))
      .where(eq(eventRsvpTokens.tokenHash, hashTokenSecret(secret)))
      .limit(1);
    if (!event || event.status !== "SCHEDULED" || event.startsAt === null || event.startsAt.getTime() <= now.getTime()) return null;
    // The club may have switched the tick off, or given the event a registration, since the message left: nothing is counted then.
    if (event.mode !== "NONE" || !event.enabled) return null;
    const rsvpId = await consumeRsvpToken(tx, secret, "RSVP_CONFIRM", now);
    if (!rsvpId) return null;
    const [before] = await tx.select().from(eventRsvps).where(eq(eventRsvps.id, rsvpId)).for("update");
    const typedName = cleanDisplayName(options.displayName);
    const asked = before !== undefined && before.askedAt !== null && before.confirmedAt === null;
    const takesName = asked && typedName !== null && before.displayName === null;
    // The member tick of the question's page (§829): taken only for the row the email made, still unconfirmed, and only under a notice that describes it.
    const takesMember = asked && options.clubMember === true && before.clubMember === null && (await noticeDescribesRsvpMember(tx, now));
    const notice = takesName || takesMember ? await findCurrentApprovedDocument(tx, "PRIVACY_NOTICE", before.locale, now) : undefined;
    const [row] = await tx
      .update(eventRsvps)
      .set({
        confirmedAt: sql`coalesce(${eventRsvps.confirmedAt}, ${now})`,
        ...(takesName ? { displayName: typedName, showName: options.showName === true } : {}),
        ...(takesMember ? { clubMember: "DECLARED" } : {}),
        ...(notice ? { privacyNoticeVersion: notice.version } : {}),
      })
      .where(eq(eventRsvps.id, rsvpId))
      .returning();
    return row
      ? { eventId: row.eventId, locale: row.locale, slug: await slugOf(tx, row.eventId, row.locale), email: row.deliveryEmail, displayName: row.displayName, unanswered: false }
      : null;
  });
  if (proved) revalidatePublicContent("places");
  return proved;
}

/**
 * «Nu vin» / «Nu mai vin»: delete the answer — by a `RSVP_WITHDRAW` link (the link's POST), or by a verified identity (the one
 * tap of a remembered browser, a signed-in member). Never gated by the notice or the tick. Returns who the link proved (a
 * token) or whether a row went (an identity); expires the public count.
 */
export async function withdrawRsvp<T extends Record<string, unknown>>(db: Database<T>, who: { token: string }, now: Date): Promise<RsvpProved | null>;
export async function withdrawRsvp<T extends Record<string, unknown>>(db: Database<T>, who: { eventId: string; identity: RsvpIdentity }, now: Date): Promise<boolean>;
export async function withdrawRsvp<T extends Record<string, unknown>>(
  db: Database<T>,
  who: { token: string } | { eventId: string; identity: RsvpIdentity },
  now: Date,
): Promise<RsvpProved | boolean | null> {
  if ("token" in who) {
    const proved = await db.transaction(async (tx) => {
      const rsvpId = await consumeRsvpToken(tx, who.token, "RSVP_WITHDRAW", now);
      if (!rsvpId) return null;
      const [row] = await tx.delete(eventRsvps).where(eq(eventRsvps.id, rsvpId)).returning();
      return row
        ? {
            eventId: row.eventId,
            locale: row.locale,
            slug: await slugOf(tx, row.eventId, row.locale),
            email: row.deliveryEmail,
            displayName: row.displayName,
            // From the deleted row: the email's question, declined without ever having been answered.
            unanswered: row.askedAt !== null && row.confirmedAt === null,
          }
        : null;
    });
    if (proved) revalidatePublicContent("places");
    return proved;
  }
  if (!who.identity.verified || !isConsistent(who.identity)) throw new DomainError("FORBIDDEN", "an unverified address cannot take an answer back");
  const identity = canonicalOf(who.identity.email);
  const gone = await db
    .delete(eventRsvps)
    .where(and(eq(eventRsvps.eventId, who.eventId), eq(eventRsvps.canonicalEmail, identity.canonicalEmail)))
    .returning({ id: eventRsvps.id });
  if (gone.length > 0) revalidatePublicContent("places");
  return gone.length > 0;
}

/**
 * The person's own CONFIRMED answer, locked for update, for a tick they flip (`setRsvpShowName`, `setRsvpClubMember`): by the identity's address, or
 * by the live `RSVP_WITHDRAW` link of this event — read, never spent. A token proves only the answer it was minted for, and only while it is live (not
 * used, not replaced, not expired, the event not started) and `eventId` is that answer's event; the life is the one `consumeRsvpToken` gives «Nu mai vin»,
 * until the event's start as it is now. Undefined when there is none: nothing is touched.
 */
async function lockOwnConfirmedRsvp<T extends Record<string, unknown>>(
  tx: Transaction<T>,
  eventId: string,
  who: { canonicalEmail: string } | { token: string },
  now: Date,
): Promise<EventRsvp | undefined> {
  if ("token" in who) {
    const [link] = await tx
      .select({ rsvpId: eventRsvpTokens.rsvpId, eventId: eventRsvps.eventId, startsAt: events.startsAt })
      .from(eventRsvpTokens)
      .innerJoin(eventRsvps, eq(eventRsvps.id, eventRsvpTokens.rsvpId))
      .innerJoin(events, eq(events.id, eventRsvps.eventId))
      .where(
        and(
          eq(eventRsvpTokens.tokenHash, hashTokenSecret(who.token)),
          eq(eventRsvpTokens.purpose, "RSVP_WITHDRAW"),
          isNull(eventRsvpTokens.usedAt),
          isNull(eventRsvpTokens.invalidatedAt),
          gt(eventRsvpTokens.expiresAt, now),
        ),
      )
      .limit(1);
    if (!link || link.eventId !== eventId || (link.startsAt && link.startsAt.getTime() <= now.getTime())) return undefined;
    const [row] = await tx.select().from(eventRsvps).where(and(eq(eventRsvps.id, link.rsvpId), isNotNull(eventRsvps.confirmedAt))).for("update");
    return row;
  }
  const [row] = await tx
    .select()
    .from(eventRsvps)
    .where(and(eq(eventRsvps.eventId, eventId), eq(eventRsvps.canonicalEmail, who.canonicalEmail), isNotNull(eventRsvps.confirmedAt)))
    .for("update");
  return row;
}

/**
 * What `setRsvpShowName` tells its caller: the tick as it stands now, or why nothing was written — each reason is a sentence of the
 * caller's own, never an error page.
 *   `none`    the person has no confirmed answer here (taken back, never confirmed, a link that is not live): nothing is touched.
 *   `name`    the tick was turned ON and there is no name to show — none stored, none posted.
 *   `closed`  the tick was turned ON and the event no longer takes «Vin!» or the notice in force no longer describes it: a name is
 *             not made public under a notice that does not describe it (§143, §396). Turning OFF is never refused for this.
 */
export type RsvpNameSwitch = { ok: true; showName: boolean } | { ok: false; reason: "none" | "name" | "closed" };

/**
 * «Numele meu apare la „Cine vine"» (§827, amending §812; the owner, 2026-10-19: «oamenii să poată ușor să zică „afișează / ascunde"
 * numele meu public») — the person flips their own tick on a «Vin!» answer, any time, from where they already see it: the remembered
 * browser (`remembered`), the members' zone (`account`) or the «Nu mai vin» link's page (`token`). §186's shape for «Vin!»: one write,
 * reversible, low-stakes, never audited with the name.
 *
 * **Who is read here, never taken from the form** (BR-REQ-060-01): a verified identity the caller built from the cookie or the session,
 * or a token — an `RSVP_WITHDRAW` link, **read and not spent** (BR-REQ-036-02: the same link must still take the answer back; the
 * choice is reversible and low-stakes, the §186 precedent). A token proves only the answer it was minted for, and only while it is live
 * (not used, not replaced, not expired, the event not started) and `eventId` is that answer's event. Only a CONFIRMED row of that person is
 * touched: a name is public only for a counted answer (`publicRsvpName`), and an unconfirmed or «Vii?»-asked row is not the person's yet.
 *
 * - **ON** needs a name to show, and it is **the one posted now** (`displayName`, cleaned like every typed name) — or, only when the row
 *   holds none, `defaultName` (the signed-in account's own, which the zone offers only for the person's tick and names beside it). A name
 *   already on the row is never published unposted: it may be one a stranger typed on the page with the tick off (§812: an unconfirmed
 *   row never lends a stranger's typed name to a verified press), so every door shows it, prefilled and editable, and posts it. The
 *   press records the privacy notice in force on the row (`privacy_notice_version`): the tick is a fresh consent, under the notice that
 *   describes it, and it needs the event to take «Vin!» (`rsvpOffered`: published, ahead, ticked, the notice describing «Vin!»).
 * - **OFF** clears `show_name` and keeps the name stored — it is the person's, used again if they turn it back on. It needs no notice and
 *   no open event: a person may always stop being named.
 *
 * The public cache is told once, only when something changed. No audit row: nothing here is something the staff did.
 */
export async function setRsvpShowName<T extends Record<string, unknown>>(
  db: Database<T>,
  eventId: string,
  who: { identity: RsvpIdentity } | { token: string },
  input: { showName: boolean; displayName?: string | null; defaultName?: string | null },
  now: Date,
): Promise<RsvpNameSwitch> {
  let canonicalEmail: string | null = null;
  if ("identity" in who) {
    if (!who.identity.verified || !isConsistent(who.identity)) throw new DomainError("FORBIDDEN", "an unverified address cannot change what is shown");
    canonicalEmail = canonicalOf(who.identity.email).canonicalEmail;
  } else if (!isWellFormedTokenSecret(who.token)) {
    return { ok: false, reason: "none" };
  }
  const result = await db.transaction(async (tx): Promise<RsvpNameSwitch & { changed?: boolean }> => {
    // The answer: by the identity's address, or by the live withdraw link of this event — read, never spent.
    const row = await lockOwnConfirmedRsvp(tx, eventId, "token" in who ? { token: who.token } : { canonicalEmail: canonicalEmail ?? "" }, now);
    if (!row) return { ok: false, reason: "none" };

    if (!input.showName) {
      if (!row.showName) return { ok: true, showName: false };
      await tx.update(eventRsvps).set({ showName: false }).where(eq(eventRsvps.id, row.id));
      return { ok: true, showName: false, changed: true };
    }

    const name = cleanDisplayName(input.displayName) ?? (cleanDisplayName(row.displayName) === null ? cleanDisplayName(input.defaultName) : null);
    if (name === null) return { ok: false, reason: "name" };
    const event = await findPublishedEventById(tx, row.locale, row.eventId);
    const notice = event ? await findCurrentApprovedDocument(tx, "PRIVACY_NOTICE", row.locale, now) : undefined;
    if (!event || !notice || !rsvpOffered(event, now, await noticeDescribesRsvp(tx, now))) return { ok: false, reason: "closed" };
    await tx.update(eventRsvps).set({ showName: true, displayName: name, privacyNoticeVersion: notice.version }).where(eq(eventRsvps.id, row.id));
    return { ok: true, showName: true, changed: true };
  });
  if (result.ok && result.changed) revalidatePublicContent("places");
  return result.ok ? { ok: true, showName: result.showName } : result;
}

/**
 * What `setRsvpClubMember` tells its caller: the tick as it stands now, or why nothing was written.
 *   `none`    the person has no confirmed answer here (taken back, never confirmed, a link that is not live): nothing is touched.
 *   `closed`  the tick was turned ON and the event no longer takes «Vin!» or the notice in force does not describe the member mark: a membership is not
 *             recorded under a notice that does not say so (§829). Turning OFF is never refused for this.
 */
export type RsvpMemberSwitch = { ok: true; clubMember: boolean } | { ok: false; reason: "none" | "closed" };

/**
 * «Sunt membru al grupului …» (§829, amending §812 and §796; the owner, 2026-10-19: «Și aici, la „Cine vine", trebuie să pot trece dacă sunt
 * membru BVR») — the person flips their own declared tick on a «Vin!» answer, any time, from where they already see it: the remembered browser
 * (`remembered`) or the «Nu mai vin» link's page (`token`). `setRsvpShowName`'s shape and rules, for the other tick: one write, reversible, low-stakes,
 * never audited, the row found the same way (`lockOwnConfirmedRsvp`, **never from the form**, BR-REQ-060-01), only a CONFIRMED row of that person.
 *
 * - **ON** records `DECLARED` and the notice in force on the row (`privacy_notice_version`) — the tick is a fresh declaration under the notice that
 *   describes the mark, and the mark and the member count read exactly that version (`publicRsvpMember`, the §421 line) — and needs the event to take
 *   «Vin!» (`rsvpOffered`) and that notice to describe the mark (`noticeDescribesRsvpMember`).
 * - **OFF** clears it. It needs no notice and no open event: a person may always stop being counted as a member.
 * - **An `ACCOUNT` row is not the person's tick**: it comes from the role of the account the answer was given from, so neither ticking nor unticking
 *   changes it (the answer says `clubMember: true`, and the island shows a fact, not a box). A signed-in account has no tick at all, so an `account`
 *   identity is refused here: its mark is made by `answerRsvp` from its role.
 *
 * The public cache is told once, only when something changed. No audit row: nothing here is something the staff did.
 */
export async function setRsvpClubMember<T extends Record<string, unknown>>(
  db: Database<T>,
  eventId: string,
  who: { identity: RsvpIdentity } | { token: string },
  input: { clubMember: boolean },
  now: Date,
): Promise<RsvpMemberSwitch> {
  let canonicalEmail: string | null = null;
  if ("identity" in who) {
    if (!who.identity.verified || !isConsistent(who.identity)) throw new DomainError("FORBIDDEN", "an unverified address cannot change what is shown");
    if (who.identity.source === "account") throw new DomainError("FORBIDDEN", "an account's mark comes from its role, not from a tick");
    canonicalEmail = canonicalOf(who.identity.email).canonicalEmail;
  } else if (!isWellFormedTokenSecret(who.token)) {
    return { ok: false, reason: "none" };
  }
  const result = await db.transaction(async (tx): Promise<RsvpMemberSwitch & { changed?: boolean }> => {
    const row = await lockOwnConfirmedRsvp(tx, eventId, "token" in who ? { token: who.token } : { canonicalEmail: canonicalEmail ?? "" }, now);
    if (!row) return { ok: false, reason: "none" };
    const held = parseClubMember(row.clubMember);
    if (held === "ACCOUNT") return { ok: true, clubMember: true };
    if (!input.clubMember) {
      if (held === null) return { ok: true, clubMember: false };
      await tx.update(eventRsvps).set({ clubMember: null }).where(eq(eventRsvps.id, row.id));
      return { ok: true, clubMember: false, changed: true };
    }
    const event = await findPublishedEventById(tx, row.locale, row.eventId);
    const notice = event ? await findCurrentApprovedDocument(tx, "PRIVACY_NOTICE", row.locale, now) : undefined;
    if (!event || !notice || !rsvpOffered(event, now, await noticeDescribesRsvp(tx, now)) || !(await noticeDescribesRsvpMember(tx, now))) return { ok: false, reason: "closed" };
    // Already ticked under this very notice: nothing to write. Ticked under an older one, the press is the fresh declaration and moves the version (§421).
    if (held === "DECLARED" && row.privacyNoticeVersion === notice.version) return { ok: true, clubMember: true };
    await tx.update(eventRsvps).set({ clubMember: "DECLARED", privacyNoticeVersion: notice.version }).where(eq(eventRsvps.id, row.id));
    return { ok: true, clubMember: true, changed: true };
  });
  if (result.ok && result.changed) revalidatePublicContent("places");
  return result.ok ? { ok: true, clubMember: result.clubMember } : result;
}

/** How many confirmed answers an event has: the count «Cine vine (N)» says. */
export async function countRsvps<T extends Record<string, unknown>>(db: Database<T>, eventId: string): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(eventRsvps)
    .where(and(eq(eventRsvps.eventId, eventId), isNotNull(eventRsvps.confirmedAt)));
  return row?.n ?? 0;
}

/** Whether an address has a confirmed answer for an event — the remembered browser's own state, «Tu vii». */
export async function hasConfirmedRsvp<T extends Record<string, unknown>>(db: Database<T>, eventId: string, canonicalEmail: string): Promise<boolean> {
  const [row] = await db
    .select({ id: eventRsvps.id })
    .from(eventRsvps)
    .where(and(eq(eventRsvps.eventId, eventId), eq(eventRsvps.canonicalEmail, canonicalEmail), isNotNull(eventRsvps.confirmedAt)))
    .limit(1);
  return row !== undefined;
}

/**
 * The person's own confirmed answer, as the tick «Numele meu apare la „Cine vine"» needs it (§827): whether the name shows (the tick AND a
 * name) and the name the row holds, which the tick would show — handed only to the browser the cookie proves is the person's, never the
 * address. Null when there is no confirmed answer of this address. The remembered browser's state. And, since §829, the member mark the answer holds
 * (`clubMember`, present only when it holds one): what the island draws ticked, or as a fact when it is an account's.
 */
export async function readOwnRsvpName<T extends Record<string, unknown>>(
  db: Database<T>,
  eventId: string,
  canonicalEmail: string,
): Promise<{ showName: boolean; name: string | null; clubMember?: ClubMemberKind } | null> {
  const [row] = await db
    .select({ showName: eventRsvps.showName, displayName: eventRsvps.displayName, clubMember: eventRsvps.clubMember })
    .from(eventRsvps)
    .where(and(eq(eventRsvps.eventId, eventId), eq(eventRsvps.canonicalEmail, canonicalEmail), isNotNull(eventRsvps.confirmedAt)))
    .limit(1);
  if (!row) return null;
  const clubMember = parseClubMember(row.clubMember);
  return { showName: row.showName && row.displayName !== null, name: row.displayName, ...(clubMember !== null ? { clubMember } : {}) };
}

/** What the page's card «Cine vine (N)» draws: the count, the names that may be shown, and how many are only counted. */
export type PublicRsvps = {
  count: number;
  names: string[];
  /** `count` less the names shown: «și încă N». */
  others: number;
  /**
   * How many of the confirmed answers are a member's (§829), named or not — what the lines «N vin · M membri» say. Present only when there is at
   * least one: a count the page has no member for is not a count of zero members, it says nothing (`publicRsvpMember`).
   */
  members?: number;
  /**
   * Which of the shown `names` carry the mark «BVR»: the same length as `names`, present only when at least one does. **A mark is only ever
   * beside a name** — an answer shown as «și încă N» has none, whatever it said (§143, §812).
   */
  memberMarks?: boolean[];
};

/** The most names the card lists; the rest are «și încă N». */
export const RSVP_NAMES_SHOWN = 60;

/**
 * The count and the names (`publicRsvpName`, §143, §396): a name only for a confirmed answer whose person ticked «Vreau să apar
 * cu numele» under a notice that described «Vin!» or a later one. Oldest answer first, so the list does not reshuffle when
 * somebody joins. Names, never addresses.
 */
export async function readPublicRsvps<T extends Record<string, unknown>>(
  db: Database<T>,
  eventId: string,
  options: { firstRsvpNoticeVersion: number | null; firstMemberNoticeVersion?: number | null },
): Promise<PublicRsvps> {
  const rows = await db
    .select({ displayName: eventRsvps.displayName, showName: eventRsvps.showName, clubMember: eventRsvps.clubMember, privacyNoticeVersion: eventRsvps.privacyNoticeVersion })
    .from(eventRsvps)
    .where(and(eq(eventRsvps.eventId, eventId), isNotNull(eventRsvps.confirmedAt)))
    .orderBy(asc(eventRsvps.confirmedAt), asc(eventRsvps.id));
  const names: string[] = [];
  const marks: boolean[] = [];
  let members = 0;
  for (const row of rows) {
    const name = publicRsvpName({ confirmed: true, showName: row.showName, displayName: row.displayName, privacyNoticeVersion: row.privacyNoticeVersion, firstRsvpNoticeVersion: options.firstRsvpNoticeVersion });
    // A member (§829): counted whether or not the name shows; the mark is the name's, never a row's of its own.
    const member = publicRsvpMember({ confirmed: true, clubMember: parseClubMember(row.clubMember), privacyNoticeVersion: row.privacyNoticeVersion, firstMemberNoticeVersion: options.firstMemberNoticeVersion ?? null });
    if (member) members += 1;
    if (name !== null && names.length < RSVP_NAMES_SHOWN) {
      names.push(name);
      marks.push(member);
    }
  }
  return {
    count: rows.length,
    names,
    others: rows.length - names.length,
    ...(members > 0 ? { members } : {}),
    ...(marks.some(Boolean) ? { memberMarks: marks } : {}),
  };
}

/**
 * How many upcoming turn-up events the club ticked «Acceptă răspunsuri „Vin!”» on: published, scheduled, asking no registration and
 * not yet started. What `/admin/tasks` reads for its row `rsvpNotice`, which waits only while there is one.
 */
export async function countRsvpEvents<T extends Record<string, unknown>>(db: Database<T>, now: Date): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(events)
    .where(
      and(
        eq(events.rsvpEnabled, true),
        eq(events.registrationMode, "NONE"),
        eq(events.eventStatus, "SCHEDULED"),
        eq(events.editorialStatus, "PUBLISHED"),
        eq(events.membersOnly, false),
        gt(events.startsAt, now),
      ),
    );
  return row?.n ?? 0;
}

/** One event's answers for the backoffice's fold (Administrator and Organizer see addresses; the others only the count) — not the «Vii?» email's unanswered questions. */
export type RsvpAdminRow = { email: string; displayName: string | null; showName: boolean; clubMember: ClubMemberKind | null; confirmedAt: Date | null; createdAt: Date };

export async function listRsvpsForAdmin<T extends Record<string, unknown>>(db: Database<T>, eventId: string): Promise<RsvpAdminRow[]> {
  const rows = await db
    .select({ email: eventRsvps.deliveryEmail, displayName: eventRsvps.displayName, showName: eventRsvps.showName, clubMember: eventRsvps.clubMember, confirmedAt: eventRsvps.confirmedAt, createdAt: eventRsvps.createdAt })
    .from(eventRsvps)
    .where(and(eq(eventRsvps.eventId, eventId), sql`NOT ${ASKED_UNANSWERED}`))
    .orderBy(asc(eventRsvps.createdAt), asc(eventRsvps.id));
  return rows.map((row) => ({ ...row, clubMember: parseClubMember(row.clubMember) }));
}

/** How many answers an event has, confirmed and not (the backoffice's fold title) — the «Vii?» email's unanswered questions are neither (`ASKED_UNANSWERED`). */
export async function countRsvpsForAdmin<T extends Record<string, unknown>>(db: Database<T>, eventId: string): Promise<{ confirmed: number; unconfirmed: number; members?: number }> {
  const rows = await db
    .select({ confirmed: sql<boolean>`${eventRsvps.confirmedAt} IS NOT NULL`, n: count(), members: sql<number>`count(*) FILTER (WHERE ${eventRsvps.clubMember} IS NOT NULL)`.mapWith(Number) })
    .from(eventRsvps)
    .where(and(eq(eventRsvps.eventId, eventId), sql`NOT ${ASKED_UNANSWERED}`))
    .groupBy(sql`${eventRsvps.confirmedAt} IS NOT NULL`);
  // `members` (§829, present only when there is one): the confirmed answers that say they are a member, declared or from an account — the editor's «M membri confirmați», whatever notice they were given under.
  const members = rows.find((row) => row.confirmed)?.members ?? 0;
  return { confirmed: rows.find((row) => row.confirmed)?.n ?? 0, unconfirmed: rows.find((row) => !row.confirmed)?.n ?? 0, ...(members > 0 ? { members } : {}) };
}
