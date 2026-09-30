import { getDb } from "@/db/client";
import { inReadOnlyTransaction } from "@/db/read-only";
import type { EmailActionTokenPurpose } from "@/db/schema/email-action-tokens";
import type { Locale } from "@/i18n/routing";
import { TOKEN_NOT_FOUND, type TokenRejectionReason } from "@/modules/action-tokens/domain/token-state";
import {
  consumeActionToken,
  readActionTokenContext,
  readSpentActionTokenScope,
} from "@/modules/action-tokens/repository";
import { tokenAttemptAllowed } from "@/modules/action-tokens/throttle";
import { currentDeadlines } from "@/modules/deadlines/deadlines";
import { selfCheckinOpensAt } from "@/modules/deadlines/domain/deadlines";
import { findEventForRegistrationById, findEventNotificationDetails } from "@/modules/events/repository";
import { DomainError } from "@/shared/errors/domain-error";
import {
  describeActionLink,
  mayReportState,
  type SpentLinkMessage,
  type SpentLinkNext,
  type SpentLinkStep,
  stepForSpentLink,
} from "./domain/link-status";
import {
  checkIn,
  confirmEmailOnAddress,
  type EventForRegistration,
  signDeclaration,
  unregister,
} from "./service";
import { CLUB_TIME_ZONE } from "@/i18n/dates";
import { findRegistrationById, findRegistrationsByEventAndParticipant } from "./repository";
import {
  confirmFamilyEntry,
  declineFamilyEntry,
  type FamilyConfirmation,
  type FamilyDecline,
  type FamilyEntryLink,
  readFamilyEntryLink,
} from "./family-confirm";
import {
  confirmFamilySitting,
  type FamilySittingLink,
  type FamilySittingRefusal,
  readFamilySittingLink,
} from "./family-sitting-confirm";
import {
  type FamilyPassBase,
  familyPassHolds,
  type FamilySigningPass,
  familyStepsOfPass,
  listFamilySigningRows,
  nextFamilyPass,
  passBase,
} from "./family-signing";
import { listManagedPeople, managedRegistration } from "./manage-family";
import { currentFamilyStep, type FamilyStep, familySigningSteps, isFamilyWizard, isSignable } from "./domain/family-signing";
import { readMyRegistrations } from "./my-registrations";
import { isUuid } from "@/shared/ids";
import { isActiveStatus } from "./domain/state-machine";
import type { CancelReason } from "./domain/cancel-reason";
import { familyOf } from "./family-marker";

/**
 * Wiring the email-token boundary (§13.2) to the registration lifecycle (§15).
 *
 * Every consuming function opens exactly one transaction that both spends the token and
 * performs the resulting state change — `consumeActionToken`'s single UPDATE and
 * `confirmEmail`/`signDeclaration`/`unregister`'s own `db.transaction()` nest as a savepoint,
 * so a token is never burned without its effect landing, and never left live if the effect
 * fails. The three routes under `app/[locale]/registrations/*` are thin wrappers over these.
 *
 * This is also the one place a presented token is throttled (§19.4, `action-tokens/throttle.ts`).
 * It goes here rather than in the repository because this is the boundary where one request is
 * one attempt: `consumeAndSignDeclaration` below tries two purposes for a single click, and a
 * throttle any deeper would charge that participant twice. A refusal returns `TOKEN_NOT_FOUND`,
 * which is what §13.2 requires anyway — one generic invalid-or-expired answer, never a hint
 * about which defence was tripped.
 */

async function loadEventForRegistration(
  db: Parameters<typeof findEventForRegistrationById>[0],
  eventId: string,
): Promise<EventForRegistration> {
  const event = await findEventForRegistrationById(db, eventId);
  if (!event) throw new DomainError("NOT_FOUND", "no such event");
  return {
    id: event.id,
    eventStatus: event.eventStatus,
    registrationMode: event.registrationMode,
    startsAt: event.startsAt,
    registrationOpensAt: event.registrationOpensAt,
    registrationOpensSoon: event.registrationOpensSoon,
    dateToBeAnnounced: event.dateToBeAnnounced,
    timeToBeAnnounced: event.timeToBeAnnounced,
    registrationClosesAt: event.registrationClosesAt,
    confirmationOpensDaysBefore: event.confirmationOpensDaysBefore,
    confirmationDeadlineDaysBefore: event.confirmationDeadlineDaysBefore,
    capacity: event.capacity,
    raceId: event.raceId,
    publishedAt: null,
    // The zone the participant's own page reads the event's instants in (§349).
    timezone: event.timezone,
  };
}

/** What the GET page may show before anything is consumed (BR-REQ-036-02 criterion 4). */
export async function readRegistrationTokenContext(
  secret: string,
  purpose: "VERIFY_REGISTRATION_EMAIL" | "COMPLETE_DECLARATION" | "MANAGE_REGISTRATION" | "WAITLIST_OFFER",
  options: { charge?: boolean } = {},
) {
  const db = getDb();
  const now = new Date();

  /*
    One request, one attempt (§202, found in review).

    The declaration page reads the same token twice — once as a declaration link and once as a
    waiting-list offer, because one link serves both purposes (§15.7) — and each read used to
    spend one of the ten attempts an hour the throttle allows. So a person reloading a spent
    link five times exhausted the bucket, and an exhausted bucket answers `TOKEN_NOT_FOUND`,
    which is not eligible for the status page: the screen fell back to exactly the "this link is
    no longer valid" the status page exists to replace.

    The throttle is there to bound guessing, and a second read of a secret already presented in
    the same request guesses nothing. `charge: false` is for that second read, and for nothing
    else — the first read of any request still pays.
  */
  if (options.charge !== false && !(await tokenAttemptAllowed(db, secret, now))) return TOKEN_NOT_FOUND;

  return readActionTokenContext(db, { secret, purpose, now });
}

/** What a page shows instead of "this link is no longer valid" (`domain/link-status.ts`). */
export type SpentRegistrationLink = {
  message: SpentLinkMessage;
  next: SpentLinkNext;
  /** Which step of the journey to light up, or null when the journey is over. */
  step: SpentLinkStep | null;
  /** The event the link already named. Null when it has no translation in this locale. */
  eventTitle: string | null;
  /** For the "ask for it again" and "register again" links; both fall back to the listing. */
  eventSlug: string | null;
};

/**
 * Where a person stands, when the link they pressed was already spent (BR-REQ-036-02).
 *
 * Returns null whenever the page must fall back to §13.2's one generic refusal, which is every
 * case but `ALREADY_USED` on a registration-scoped purpose — `link-status.ts` argues each one.
 *
 * Nothing here consumes, mints or extends anything, and it is reached from a GET: the two
 * reads are a read-only-transaction scope lookup and the registration's own row.
 *
 * `refusals` is a list because the declaration page presents one link against two purposes
 * (`COMPLETE_DECLARATION`, then `WAITLIST_OFFER` — §15.7), and only one of them can be the
 * token's real purpose; the other comes back as `PURPOSE_MISMATCH`, which is never eligible.
 * The first eligible entry wins, and `readSpentActionTokenScope` re-checks it against the row
 * rather than trusting what the caller passed.
 *
 * No throttle charge of its own: the route already charged one attempt for this request, and
 * charging a second would halve the allowance of the one person whose link this is.
 */
export async function readSpentRegistrationLink(
  secret: string,
  refusals: readonly { purpose: EmailActionTokenPurpose; reason: TokenRejectionReason }[],
  locale: Locale,
  now: Date,
): Promise<SpentRegistrationLink | null> {
  const eligible = refusals.find((refusal) => mayReportState(refusal.purpose, refusal.reason));
  if (!eligible) return null;

  /*
    All three reads inside one read-only transaction (§202, found in review).

    This runs on a GET, and "GET never mutates" is structural here rather than a promise:
    PostgreSQL refuses any write inside a `READ ONLY` transaction (`db/read-only.ts`). Only
    the token read used to be inside one; the registration and the event were bare selects on
    the pool, which is the same guarantee held by convention instead of by the database. One
    transaction also means the three reads see one snapshot, so the state reported and the
    event named cannot come from either side of a concurrent change.
  */
  return inReadOnlyTransaction(getDb(), async (tx) => {
    const scope = await readSpentActionTokenScope(tx, { secret, purpose: eligible.purpose, now });
    if (!scope?.registrationId) return null;

    const registration = await findRegistrationById(tx, scope.registrationId);
    // Erased under §67, or gone with its event: there is no state to report, so the generic
    // refusal is the honest answer rather than a sentence about a row that no longer exists.
    if (!registration) return null;

    const view = describeActionLink({
      purpose: eligible.purpose,
      reason: eligible.reason,
      status: registration.status,
    });
    if (view.view !== "ALREADY_DONE") return null;

    const event = await findEventNotificationDetails(tx, registration.eventId, locale);

    return {
      message: view.message,
      next: view.next,
      step: stepForSpentLink(view.message),
      /*
        This locale's own words, or none (§202). `findEventNotificationDetails` falls back to
        the other language's row when the asked-for one is missing — right for an email, which
        must go out with something — and wrong here, because the slug is built into a link for
        *this* locale. A foreign slug would produce an address that 404s. No translation in
        this language means no event link, and the page falls back to the listing.
      */
      eventTitle: event?.locale === locale ? event.title : null,
      eventSlug: event?.locale === locale ? event.slug : null,
    };
  });
}

export async function consumeAndConfirmEmail(secret: string, now: Date) {
  const db = getDb();

  if (!(await tokenAttemptAllowed(db, secret, now))) return TOKEN_NOT_FOUND;

  return db.transaction(async (tx) => {
    const consumed = await consumeActionToken(tx, { secret, purpose: "VERIFY_REGISTRATION_EMAIL", now });
    if (!consumed.ok) return consumed;

    const registration = await findRegistrationById(tx, consumed.token.registrationId ?? "");
    if (!registration) throw new DomainError("NOT_FOUND", "no such registration");
    const event = await loadEventForRegistration(tx, registration.eventId);

    // One click proves the inbox (§NNN): the address's other waiting registrations at the event move on with it.
    const { registration: updated } = await confirmEmailOnAddress(tx, event, registration.id, now);
    return { ok: true as const, token: consumed.token, registration: updated };
  });
}

/** What the page after the click says (§NNN): each person on the address at the event, and their next step. */
export type ConfirmedOnAddress = { name: string; status: "PENDING_DECLARATION" | "WAITLISTED" | "WAITLIST_OFFERED" | "CONFIRMED" };

/**
 * Everybody the spent verification link's address holds at its event past the address step, in the
 * order they were submitted — read-only, on the GET after the press (§12.8), and only for a link
 * already spent: the secret is the proof, and it names only its own address's people (§39).
 */
export async function readConfirmedOnAddress(secret: string, now: Date): Promise<ConfirmedOnAddress[]> {
  const db = getDb();
  const scope = await readSpentActionTokenScope(db, { secret, purpose: "VERIFY_REGISTRATION_EMAIL", now });
  if (!scope?.registrationId) return [];
  return inReadOnlyTransaction(db, async (tx) => {
    const clicked = await findRegistrationById(tx, scope.registrationId ?? "");
    if (!clicked) return [];
    const rows = await findRegistrationsByEventAndParticipant(tx, clicked.eventId, clicked.participantId);
    return rows
      .filter((row): row is typeof row & { status: ConfirmedOnAddress["status"] } => CONFIRMED_ON_ADDRESS.has(row.status))
      .sort((a, b) => a.submittedAt.getTime() - b.submittedAt.getTime())
      .map((row) => ({ name: row.registeredName, status: row.status }));
  });
}

const CONFIRMED_ON_ADDRESS: ReadonlySet<string> = new Set(["PENDING_DECLARATION", "WAITLISTED", "WAITLIST_OFFERED", "CONFIRMED"]);

export async function consumeAndSignDeclaration(
  secret: string,
  input: {
    accepted: boolean;
    typedName: string;
    idDocument?: string;
    /**
     * A minor's own signature and document, beside the parent's (§330): absent for an adult, and
     * for a minor under a declaration that does not ask the minor to sign — `signDeclaration`
     * decides which from the text it binds to, never from what was posted.
     */
    minorTypedName?: string;
    minorIdDocument?: string;
    documentId: string;
    contentSha256: string;
    /** «Vreau să primesc oferte și beneficii», ticked while signing (§562); the service decides whether it is kept. */
    promoConsent?: boolean;
  },
  now: Date,
) {
  const db = getDb();

  if (!(await tokenAttemptAllowed(db, secret, now))) return TOKEN_NOT_FOUND;

  return db.transaction(async (tx) => {
    // Accepting a waiting-list offer is signing the declaration (§15.7): the same token
    // purpose is checked for either, in the order a live offer is more likely.
    let consumed = await consumeActionToken(tx, { secret, purpose: "COMPLETE_DECLARATION", now });
    if (!consumed.ok) {
      consumed = await consumeActionToken(tx, { secret, purpose: "WAITLIST_OFFER", now });
    }
    if (!consumed.ok) return consumed;

    const registration = await findRegistrationById(tx, consumed.token.registrationId ?? "");
    if (!registration) throw new DomainError("NOT_FOUND", "no such registration");
    const event = await loadEventForRegistration(tx, registration.eventId);

    const updated = await signDeclaration(tx, event, registration.id, input, now);
    return { ok: true as const, token: consumed.token, registration: updated };
  });
}

/**
 * The next declaration of a family on one address, signed through the wizard's pass (§471).
 *
 * What authorizes it is the secret the pass is bound to — the opened link, spent by its own
 * signature or put off with «Semnez mai târziu», or the «Înscrierile mele» link it was exchanged
 * for — together with the pass itself (`family-signing.ts`, AGENTS.md §13.2 step 4). The
 * registration must be one of the pass's own people, and everything after that is
 * `signDeclaration`, unchanged: the event's lock, the state, the
 * approved text by id and hash, the names, the identity documents, the allocator, one acceptance
 * and one confirmation with its own PDF.
 *
 * Only the step that is current may be signed: the pass's own people (`eligibleIds`, fixed when it
 * was issued), neither signed nor put off, re-read from the rows — a `done` pass signs nobody.
 *
 * The throttle (§19.4, §202): a press whose pass holds beside this very secret guesses nothing and
 * is not charged — a family of four walks the page and presses it eight or nine times in a few
 * minutes, which the link's ten attempts an hour would not survive. A press whose pass does not
 * hold, or that carries none, is charged one attempt, as any other press of this link. A refusal of
 * the pass or of the registration is the generic token refusal: it says nothing about which.
 */
export async function consumeAndSignFamilyDeclaration(
  secret: string,
  pass: FamilySigningPass | null,
  registrationId: string,
  input: Parameters<typeof consumeAndSignDeclaration>[1],
  now: Date,
) {
  const db = getDb();

  const holds = pass !== null && !pass.done && (await familyPassHolds(db, secret, pass, now));
  if (!pass || !holds) {
    await tokenAttemptAllowed(db, secret, now);
    return TOKEN_NOT_FOUND;
  }
  // A posted id that is not one answers like a wrong one, never as the database's parse error (§376).
  if (!isUuid(registrationId)) return TOKEN_NOT_FOUND;
  const current = currentFamilyStep(await familyStepsOfPass(db, pass));
  if (!current || current.id !== registrationId) return TOKEN_NOT_FOUND;

  const registration = await findRegistrationById(db, registrationId);
  if (!registration || registration.participantId !== pass.participantId || registration.eventId !== pass.eventId) {
    return TOKEN_NOT_FOUND;
  }
  const event = await loadEventForRegistration(db, registration.eventId);
  const updated = await signDeclaration(db, event, registration.id, input, now);
  return { ok: true as const, registration: updated };
}

/**
 * «Semnez mai târziu» (§471): the current person is put off — shown on the list, never current
 * again in this pass — and the wizard moves on. Nothing is written to any registration, token or
 * table: the answer is the pass's next state, which the caller writes. The person's own emailed
 * link is untouched and still signs them.
 *
 * With a pass that holds beside this secret, the step put off must be the current one. Without
 * one, the secret must be a live declaration or offer link and the person its own registration:
 * that press both starts the wizard (the address's other people, fixed now) and puts the link's
 * person off, so the pass is bound to a live link whose own person it names as skipped.
 * One throttled attempt then, as any read of the link.
 */
export async function skipFamilyDeclaration(
  secret: string,
  pass: FamilySigningPass | null,
  registrationId: string,
  now: Date,
): Promise<{ ok: true; pass: FamilySigningPass; steps: FamilyStep[] } | typeof TOKEN_NOT_FOUND> {
  const db = getDb();
  if (!isUuid(registrationId)) return TOKEN_NOT_FOUND;

  if (pass && !pass.done && (await familyPassHolds(db, secret, pass, now))) {
    const current = currentFamilyStep(await familyStepsOfPass(db, pass));
    if (!current || current.id !== registrationId) return TOKEN_NOT_FOUND;
    return { ok: true, ...(await nextFamilyPass(db, { ...passBase(pass), skippedIds: [...pass.skippedIds, registrationId] }, now)) };
  }

  const declaration = await readRegistrationTokenContext(secret, "COMPLETE_DECLARATION");
  // The same secret, already presented in this request: no second attempt (§202).
  const context = declaration.ok ? declaration : await readRegistrationTokenContext(secret, "WAITLIST_OFFER", { charge: false });
  if (!context.ok || context.token.registrationId !== registrationId) return TOKEN_NOT_FOUND;
  const registration = await findRegistrationById(db, registrationId);
  if (!registration || registration.participantId !== context.token.participantId) return TOKEN_NOT_FOUND;

  const fresh = familySigningSteps(await listFamilySigningRows(db, registration.participantId, registration.eventId), {
    originId: registration.id,
    originSignable: true,
    signedIds: [],
  });
  if (!isFamilyWizard(fresh) || currentFamilyStep(fresh)?.id !== registration.id) return TOKEN_NOT_FOUND;
  const next = await nextFamilyPass(
    db,
    {
      binding: "link",
      participantId: registration.participantId,
      eventId: registration.eventId,
      originId: registration.id,
      eligibleIds: fresh.map((step) => step.id),
      signedIds: [],
      skippedIds: [registration.id],
    },
    now,
  );
  return { ok: true, ...next };
}

/**
 * Why «Semnează declarațiile» was refused (§471, nit found in review): the link itself (dead,
 * spent, throttled — the page says so, as for every other press there), or the address no longer
 * has declarations to walk at the event — nobody left to sign, or one person alone, who signs
 * from their own emailed link. The last two land on «Înscrierile mele» with a toast naming them.
 */
export type FamilySigningStartRefusal = "LINK" | "NOTHING_LEFT" | "ONE_LEFT";

/**
 * «Semnează declarațiile» on «Înscrierile mele» (§471, over §77): the address's live link to its
 * own registrations, exchanged on the server for the wizard's pass over that event's declarations
 * still to sign — never a new token in the URL. The link is read, not spent (one throttled attempt,
 * `readMyRegistrations`), and the pass is bound to it: cancelling from that page spends it, and the
 * pass stops holding with it. Refused, with its reason, unless a wizard with somebody to sign opens.
 */
export async function startFamilySigningFromMine(
  secret: string,
  eventId: string,
  now: Date,
): Promise<{ ok: true; pass: FamilySigningPass } | { ok: false; reason: FamilySigningStartRefusal }> {
  const db = getDb();
  const context = await readMyRegistrations(db, secret, "ro", now);
  if (!context.ok) return { ok: false, reason: "LINK" };
  // A posted id that is not one answers like an event with nothing to sign, never as a parse error (§376).
  if (!isUuid(eventId)) return { ok: false, reason: "NOTHING_LEFT" };
  const steps = familySigningSteps(await listFamilySigningRows(db, context.participantId, eventId), {
    originId: null,
    originSignable: false,
    signedIds: [],
  });
  if (!currentFamilyStep(steps)) return { ok: false, reason: "NOTHING_LEFT" };
  if (!isFamilyWizard(steps)) return { ok: false, reason: "ONE_LEFT" };
  const { pass } = await nextFamilyPass(
    db,
    {
      binding: "mine",
      participantId: context.participantId,
      eventId,
      originId: null,
      eligibleIds: steps.map((step) => step.id),
      signedIds: [],
      skippedIds: [],
    },
    now,
  );
  return { ok: true, pass };
}

/**
 * Whether a spent declaration link's address still holds other declarations to sign at its event
 * (§471, nit found in review): the page then says each person's own emailed link still works, where
 * the wizard's pass has lapsed or was never on this device. Reads only; charges nothing — the page
 * already charged this request's one attempt.
 */
export async function spentLinkHasFamilyLeft(secret: string, now: Date): Promise<boolean> {
  const db = getDb();
  const scope =
    (await readSpentActionTokenScope(db, { secret, purpose: "COMPLETE_DECLARATION", now })) ??
    (await readSpentActionTokenScope(db, { secret, purpose: "WAITLIST_OFFER", now }));
  if (!scope?.registrationId) return false;
  const registration = await findRegistrationById(db, scope.registrationId);
  if (!registration) return false;
  const rows = await listFamilySigningRows(db, registration.participantId, registration.eventId);
  return rows.some((row) => row.id !== registration.id && isSignable(row.status));
}

/**
 * Another person on a registered address, confirmed from the inbox (§446, amending §389): the page
 * behind the emailed button reads the link (`readFamilyEntryLink`, one throttled attempt, a
 * read-only transaction — GET never mutates) and the press spends it (`confirmFamilyEntry`, the
 * registration created and the address confirmed in the same transaction). Both live in
 * `family-confirm.ts`, over any database, so the concurrency suite can press them together; these
 * are the application's doors to them.
 */
export async function readFamilyEntryLinkPage(secret: string, locale: Locale, now: Date): Promise<FamilyEntryLink> {
  return readFamilyEntryLink(getDb(), secret, locale, now);
}

export async function consumeAndConfirmFamilyEntry(
  secret: string,
  input: { fitnessAcknowledged: boolean },
  now: Date,
): Promise<FamilyConfirmation> {
  return confirmFamilyEntry(getDb(), secret, input, now);
}

/**
 * A family's one link (§519, `family-sitting-confirm.ts`): the page's read, uncharged when the page
 * already charged this request's one attempt reading the link as one person's (§446).
 */
export async function readFamilySittingLinkPage(secret: string, locale: Locale, now: Date, options: { charge: boolean }): Promise<FamilySittingLink> {
  return readFamilySittingLink(getDb(), secret, locale, now, options);
}

export type FamilySittingPress =
  | {
      ok: true;
      /** Why somebody on the list did not join, as markers (`FamilySittingRefusal`), one each. */
      refused: FamilySittingRefusal[];
      /** How many people of the list joined (a place or the waiting list); 0 when every kept form was unticked or refused. */
      joined: number;
      /** The wizard's pass over the address's declarations to sign, bound to this spent link; null with nobody to sign. */
      pass: FamilySigningPass | null;
    }
  | { ok: false };

/**
 * The press (§519): the family confirmed in one transaction, then the wizard's pass (§471) over every
 * declaration the address has to sign at the event — the family just confirmed first among them, in
 * the order registered — bound to this link, which the press has spent (`binding: "family"`). No
 * new token: the wizard runs on the declaration page under this same secret.
 */
export async function consumeAndConfirmFamilySitting(
  secret: string,
  input: { includedKeys: readonly string[]; fitnessAcknowledged: boolean },
  now: Date,
): Promise<FamilySittingPress> {
  const db = getDb();
  const result = await confirmFamilySitting(db, secret, input, now);
  if (!result.ok) return { ok: false };
  const steps = familySigningSteps(await listFamilySigningRows(db, result.participantId, result.eventId), {
    originId: null,
    originSignable: false,
    signedIds: [],
  });
  const joined = result.registrations.length;
  if (!currentFamilyStep(steps)) return { ok: true, refused: result.refused, joined, pass: null };
  const { pass } = await nextFamilyPass(
    db,
    {
      binding: "family",
      participantId: result.participantId,
      eventId: result.eventId,
      originId: null,
      eligibleIds: steps.map((step) => step.id),
      signedIds: [],
      skippedIds: [],
    },
    now,
  );
  return { ok: true, refused: result.refused, joined, pass };
}

/** «Nu înscriu această persoană» (§468): the token spent, the kept form deleted, nobody registered. */
export async function consumeAndDeclineFamilyEntry(secret: string, now: Date): Promise<FamilyDecline> {
  return declineFamilyEntry(getDb(), secret, now);
}

/**
 * What the participant's own page shows about race day (BR-REQ-037-08): the desk code and
 * whether the self check-in window is open. The manage token is read, never spent — the same
 * link still has to cancel — and this reads nothing else.
 *
 * Per person since §547: `people` is the link's registration and the address's other active ones
 * at the event (`listManagedPeople`), each with whether "I am here" is open for them — the page
 * draws one card each, the QR with the name and the number beside it.
 */
export async function readRaceDayContext(secret: string, now: Date) {
  const db = getDb();
  if (!(await tokenAttemptAllowed(db, secret, now))) return TOKEN_NOT_FOUND;
  const context = await readActionTokenContext(db, { secret, purpose: "MANAGE_REGISTRATION", now });
  if (!context.ok) return context;

  const registration = await findRegistrationById(db, context.token.registrationId ?? "");
  if (!registration) throw new DomainError("NOT_FOUND", "no such registration");
  const event = await loadEventForRegistration(db, registration.eventId);
  // How long before the start a participant may say "I am here" from their own link: the club's
  // hours (§377), a day unless changed.
  const deadlines = await currentDeadlines(db);
  const opensAt = selfCheckinOpensAt(event.startsAt, deadlines);
  // A cancelled race has no race day (§331): the page says so, and offers no desk code or "I am here".
  const eventCancelled = event.eventStatus === "CANCELLED";
  const checkinOpenFor = (status: string) => status === "CONFIRMED" && !eventCancelled && now >= opensAt;
  const people = (await listManagedPeople(db, registration)).map((person) => ({ ...person, selfCheckinOpen: checkinOpenFor(person.status) }));
  return {
    ok: true as const,
    registration,
    eventCancelled,
    selfCheckinOpen: checkinOpenFor(registration.status),
    selfCheckinOpensAt: opensAt,
    /** How many hours before the start that is, for the sentence that says so (§377). */
    selfCheckinHours: deadlines.selfCheckinHours,
    /** The zone that instant is read in on the page — the event's own. */
    eventTimezone: event.timezone ?? CLUB_TIME_ZONE,
    /**
     * The family marker (§543): the other people on this address at the event, names only — behind the
     * address's own link, the one place the names on it may be read (§389).
     */
    family: ((await familyOf(db, [registration])).get(registration.id) ?? []).map((member) => member.name),
    /** Everybody the page manages, the link's own first in the family's order (§547). */
    people,
  };
}

/**
 * Self check-in from the participant's own link (BR-REQ-037-08). Not a consuming action: the
 * token authorizes the person, check-in is idempotent, and spending the manage link on it
 * would cost them the ability to cancel. Only from the club's hours before the start (a day
 * unless changed, §377) — an "I am here" a week early is not information.
 *
 * `registrationId` (§547): another person of the page — the same address at the same event,
 * checked on the server (`managedRegistration`); absent, the link's own.
 */
export async function checkInSelf(secret: string, now: Date, registrationId?: string) {
  const context = await readRaceDayContext(secret, now);
  if (!context.ok) return context;
  const person = registrationId ? context.people.find((candidate) => candidate.id === registrationId) : context.people.find((candidate) => candidate.own);
  if (!person) throw new DomainError("NOT_FOUND", "not a registration this link manages");
  if (!person.selfCheckinOpen) {
    throw new DomainError("VALIDATION_ERROR", "self check-in is not open yet: it opens the club's check-in lead before the start");
  }
  const registration = await checkIn(getDb(), person.id, null, now);
  return { ok: true as const, registration };
}

/**
 * «Anulează înscrierea» from the manage link (BR-REQ-036-01). Spends the link (§12.8: an action
 * link is used once), as «Înscrierile mele» spends its own (§77) — whichever person it cancels.
 *
 * `registrationId` (§547): the person the press names, the link's own or another registration of
 * the same address at the same event (`managedRegistration`). Anything else throws NOT_FOUND inside
 * the transaction, so the link is not spent and nobody is cancelled. `family` says whether the page
 * listed more than one person, for the outcome page's one extra sentence — never who.
 */
export async function consumeAndCancel(secret: string, now: Date, reason: CancelReason, registrationId?: string) {
  const db = getDb();

  if (!(await tokenAttemptAllowed(db, secret, now))) return TOKEN_NOT_FOUND;

  return db.transaction(async (tx) => {
    const consumed = await consumeActionToken(tx, { secret, purpose: "MANAGE_REGISTRATION", now });
    if (!consumed.ok) return consumed;

    const own = await findRegistrationById(tx, consumed.token.registrationId ?? "");
    if (!own) throw new DomainError("NOT_FOUND", "no such registration");
    const registration = await managedRegistration(tx, own, registrationId);
    if (!registration) throw new DomainError("NOT_FOUND", "not a registration this link manages");
    // A sibling already cancelled is not on the page's list: refuse it rather than spend the link on a false «Gata».
    if (registration.id !== own.id && !isActiveStatus(registration.status)) throw new DomainError("NOT_FOUND", "not an active registration of this family");
    const family = (await listManagedPeople(tx, own)).length > 1;
    const event = await loadEventForRegistration(tx, registration.eventId);

    const updated = await unregister(tx, event, registration.id, "PARTICIPANT", now, { via: "MANAGE_LINK", reason });
    return { ok: true as const, token: consumed.token, registration: updated, family };
  });
}

/**
 * «Renunț la înscrierea pentru <nume>» on a family's step of the declarations wizard (§547, amending
 * §471; the owner, 2026-09-28: a person registered by mistake had no way out from the wizard). The
 * step's person is cancelled — the place released through the allocator (`unregister`, under the
 * event's lock, the waiting list served), the audit row with no staff actor, and the cancellation
 * email to the address with its club copy (§320), as every cancellation queues it — and the wizard
 * moves on: the person is put off in the pass like «Semnez mai târziu», so the list shows them as
 * «înscriere anulată» and the next person, or the end, follows.
 *
 * Only the step the page is on, and only through what may sign it: the pass beside the link it is
 * bound to (the person must be its current step), or, with no pass, the live declaration or offer
 * link of that very person on a family's page — the same two roads `skipFamilyDeclaration` takes.
 * The declaration link is not spent: it signs nobody any more, and the pass keeps walking beside it.
 */
export async function withdrawFromFamilyWizard(
  secret: string,
  pass: FamilySigningPass | null,
  registrationId: string,
  now: Date,
  reason: CancelReason,
): Promise<{ ok: true; pass: FamilySigningPass; steps: FamilyStep[] } | typeof TOKEN_NOT_FOUND> {
  const db = getDb();
  if (!isUuid(registrationId)) return TOKEN_NOT_FOUND;

  let base: FamilyPassBase;
  if (pass && !pass.done && (await familyPassHolds(db, secret, pass, now))) {
    const current = currentFamilyStep(await familyStepsOfPass(db, pass));
    if (!current || current.id !== registrationId) return TOKEN_NOT_FOUND;
    base = { ...passBase(pass), skippedIds: [...pass.skippedIds, registrationId] };
  } else {
    const declaration = await readRegistrationTokenContext(secret, "COMPLETE_DECLARATION");
    // The same secret, already presented in this request: no second attempt (§202).
    const context = declaration.ok ? declaration : await readRegistrationTokenContext(secret, "WAITLIST_OFFER", { charge: false });
    if (!context.ok || context.token.registrationId !== registrationId) return TOKEN_NOT_FOUND;
    const registration = await findRegistrationById(db, registrationId);
    if (!registration || registration.participantId !== context.token.participantId) return TOKEN_NOT_FOUND;
    const fresh = familySigningSteps(await listFamilySigningRows(db, registration.participantId, registration.eventId), {
      originId: registration.id,
      originSignable: true,
      signedIds: [],
    });
    if (!isFamilyWizard(fresh) || currentFamilyStep(fresh)?.id !== registration.id) return TOKEN_NOT_FOUND;
    base = {
      binding: "link",
      participantId: registration.participantId,
      eventId: registration.eventId,
      originId: registration.id,
      eligibleIds: fresh.map((step) => step.id),
      signedIds: [],
      skippedIds: [registration.id],
    };
  }

  const registration = await findRegistrationById(db, registrationId);
  if (!registration || !isSignable(registration.status)) return TOKEN_NOT_FOUND;
  const event = await loadEventForRegistration(db, registration.eventId);
  await unregister(db, event, registration.id, "PARTICIPANT", now, { via: "FAMILY_WIZARD", reason });
  return { ok: true, ...(await nextFamilyPass(db, base, now)) };
}
