import { and, asc, count, eq, gt, isNull, isNotNull, sql } from "drizzle-orm";
import { z } from "zod";
import { eventRsvps, eventRsvpTokens, type EventRsvp } from "@/db/schema/event-rsvps";
import { eventTranslations, events } from "@/db/schema/events";
import { inReadOnlyTransaction } from "@/db/read-only";
import type { Database, Transaction } from "@/db/types";
import { generateTokenSecret, hashTokenSecret, isWellFormedTokenSecret } from "@/modules/action-tokens/domain/token-secret";
import { findPublishedEventById } from "@/modules/events/repository";
import { findCurrentApprovedDocument, noticeDescribesRsvp } from "@/modules/legal-documents/repository";
import { enqueueEmail } from "@/modules/notifications/outbox";
import { canonicalizeEmail } from "@/modules/participants/domain/canonical-email";
import { revalidatePublicContent } from "@/modules/public-cache/cache";
import { consumeRateLimit } from "@/modules/rate-limit/service";
import { emailBucketKey } from "@/modules/rate-limit/domain/key";
import { DomainError } from "@/shared/errors/domain-error";
import { cleanDisplayName, isConsistent, type RsvpIdentity } from "./domain/identity";
import { RSVP_CONFIRM_HOURS } from "./domain/link-life";
import { rsvpOffered } from "./domain/offered";
import { publicRsvpName } from "./domain/public-name";

/**
 * «Vin!» (§811, «Vin!» part 1; the owner, 2026-10-18: «how do I mark myself as "Going"?») — a person's answer «I am coming»
 * to a turn-up event the club ticked: an address, optionally a name to show, and — once the address is proved — a place in
 * the count «Vin (N)».
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

/** A withdraw link outlives the start it was sent with by this much; the event's start at the press decides (a moved event keeps its links). */
const WITHDRAW_LINK_GRACE_DAYS = 60;

/** One message per address and event in this window — the form answers the same sentence either way. */
const CONFIRM_THROTTLE_SCOPE = "rsvp-confirm" as const;
const EVENT_THROTTLE_SCOPE = "rsvp-event" as const;

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
        const [updated] = await tx
          .update(eventRsvps)
          .set(
            owned
              ? {
                  showName: identity.showName || existing.showName,
                  displayName: displayName ?? existing.displayName,
                  deliveryEmail: who.deliveryEmail,
                  ...(identity.showName ? { privacyNoticeVersion: notice.version } : {}),
                }
              : {
                  confirmedAt: now,
                  showName: identity.showName,
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
            locale,
            privacyNoticeVersion: notice.version,
            createdAt: now,
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
    .where(and(eq(eventRsvps.eventId, eventId), eq(eventRsvps.canonicalEmail, who.canonicalEmail)))
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
 */
export async function mintRsvpLinks<T extends Record<string, unknown>>(
  db: Database<T>,
  params: { rsvpId: string; startsAt: Date; confirm: boolean; now: Date },
): Promise<{ confirm: string | null; withdraw: string } | null> {
  if (params.startsAt.getTime() <= params.now.getTime()) return null;
  const confirmExpires = new Date(Math.min(params.now.getTime() + RSVP_CONFIRM_HOURS * 3_600_000, params.startsAt.getTime()));
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
    return {
      confirm: params.confirm ? await mint("RSVP_CONFIRM", confirmExpires) : null,
      // The start can move after the message left: the link lives generously and `consumeRsvpToken` asks the event's start as it is then.
      withdraw: await mint("RSVP_WITHDRAW", new Date(params.startsAt.getTime() + WITHDRAW_LINK_GRACE_DAYS * 86_400_000)),
    };
  });
}

/** What a link's page needs: the answer's event, in the language the answer was given in, and what the link would do. */
export type RsvpLink = {
  purpose: EventRsvpTokenPurpose;
  /**
   * `live`: pressing the button would act. `used`: spent, or replaced by a newer email. `expired`: the link's own life ran out while
   * the event is still ahead (the person can answer again from the page). `over`: the event has started, so no answer is taken.
   */
  state: "live" | "used" | "expired" | "over";
  rsvpId: string;
  eventId: string;
  locale: "ro" | "en";
  title: string;
  slug: string;
  startsAt: Date | null;
  /** The answer is already counted (a confirm link opened after another route confirmed it). */
  confirmed: boolean;
  /**
   * The answer was made by the «Vii?» email (§NNN) and nobody has pressed yet: the page of its two links offers the optional name
   * under the «Vin» button, and says «Bine, nu te numărăm» after «Nu vin». False for an answer typed on the event's page and for one
   * already counted.
   */
  asked: boolean;
  /** The answer has a name already (typed on the page): the box is then not offered, and the press changes nothing about it. */
  named: boolean;
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
    if (!row) return null;
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
    } satisfies RsvpLink;
  });
}

/** Spend a link of `purpose` inside the caller's transaction: the answer it named, or null when it was not live. One UPDATE, one winner. */
async function consumeRsvpToken<T extends Record<string, unknown>>(
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
 * **The «Vii?» email's «Vin» (§NNN) is this press.** The link was minted for the subscriber's own address and nobody else holds it, so
 * the press is a verified one (the `link` source of `identity.ts`): counted at once, no second email. That row has no name — the
 * newsletter's row never had one, and a name nobody typed is never made up — so the page offers the optional `name` and the tick
 * `showName` under the one button, and they are taken here **only** for a row the email made (`asked_at`), still unconfirmed and
 * still nameless: a name typed by whoever typed an address on the page is never replaced, and a counted row is never renamed by a
 * second press. The tick counts only beside a name, and a name shows publicly only under the notice that described it (`public-name.ts`),
 * so the row takes the version in force.
 */
export async function confirmRsvp<T extends Record<string, unknown>>(
  db: Database<T>,
  secret: string,
  now: Date,
  options: { displayName?: string | null; showName?: boolean } = {},
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
    const takesName = before !== undefined && typedName !== null && before.askedAt !== null && before.confirmedAt === null && before.displayName === null;
    const notice = takesName ? await findCurrentApprovedDocument(tx, "PRIVACY_NOTICE", before.locale, now) : undefined;
    const [row] = await tx
      .update(eventRsvps)
      .set({
        confirmedAt: sql`coalesce(${eventRsvps.confirmedAt}, ${now})`,
        ...(takesName ? { displayName: typedName, showName: options.showName === true, ...(notice ? { privacyNoticeVersion: notice.version } : {}) } : {}),
      })
      .where(eq(eventRsvps.id, rsvpId))
      .returning();
    return row ? { eventId: row.eventId, locale: row.locale, slug: await slugOf(tx, row.eventId, row.locale), email: row.deliveryEmail, displayName: row.displayName } : null;
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
      return row ? { eventId: row.eventId, locale: row.locale, slug: await slugOf(tx, row.eventId, row.locale), email: row.deliveryEmail, displayName: row.displayName } : null;
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

/** How many confirmed answers an event has: the count «Vin (N)» says. */
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

/** What the page's card «Vin (N)» draws: the count, the names that may be shown, and how many are only counted. */
export type PublicRsvps = {
  count: number;
  names: string[];
  /** `count` less the names shown: «și încă N». */
  others: number;
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
  options: { firstRsvpNoticeVersion: number | null },
): Promise<PublicRsvps> {
  const rows = await db
    .select({ displayName: eventRsvps.displayName, showName: eventRsvps.showName, privacyNoticeVersion: eventRsvps.privacyNoticeVersion })
    .from(eventRsvps)
    .where(and(eq(eventRsvps.eventId, eventId), isNotNull(eventRsvps.confirmedAt)))
    .orderBy(asc(eventRsvps.confirmedAt), asc(eventRsvps.id));
  const names: string[] = [];
  for (const row of rows) {
    const name = publicRsvpName({ confirmed: true, showName: row.showName, displayName: row.displayName, privacyNoticeVersion: row.privacyNoticeVersion, firstRsvpNoticeVersion: options.firstRsvpNoticeVersion });
    if (name !== null && names.length < RSVP_NAMES_SHOWN) names.push(name);
  }
  return { count: rows.length, names, others: rows.length - names.length };
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

/** One event's answers for the backoffice's fold (Administrator and Organizer see addresses; the others only the count). */
export type RsvpAdminRow = { email: string; displayName: string | null; showName: boolean; confirmedAt: Date | null; createdAt: Date };

export async function listRsvpsForAdmin<T extends Record<string, unknown>>(db: Database<T>, eventId: string): Promise<RsvpAdminRow[]> {
  return db
    .select({ email: eventRsvps.deliveryEmail, displayName: eventRsvps.displayName, showName: eventRsvps.showName, confirmedAt: eventRsvps.confirmedAt, createdAt: eventRsvps.createdAt })
    .from(eventRsvps)
    .where(eq(eventRsvps.eventId, eventId))
    .orderBy(asc(eventRsvps.createdAt), asc(eventRsvps.id));
}

/** How many answers an event has, confirmed and not (the backoffice's fold title). */
export async function countRsvpsForAdmin<T extends Record<string, unknown>>(db: Database<T>, eventId: string): Promise<{ confirmed: number; unconfirmed: number }> {
  const rows = await db
    .select({ confirmed: sql<boolean>`${eventRsvps.confirmedAt} IS NOT NULL`, n: count() })
    .from(eventRsvps)
    .where(eq(eventRsvps.eventId, eventId))
    .groupBy(sql`${eventRsvps.confirmedAt} IS NOT NULL`);
  return { confirmed: rows.find((row) => row.confirmed)?.n ?? 0, unconfirmed: rows.find((row) => !row.confirmed)?.n ?? 0 };
}
