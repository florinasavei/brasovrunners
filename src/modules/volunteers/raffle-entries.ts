import { and, eq, ne } from "drizzle-orm";
import { type Registration, registrations } from "@/db/schema/registrations";
import { eventEliteEntries } from "@/db/schema/event-elite-entries";
import { eventRaffleEntries, RAFFLE_TYPED_NAME_MAX, type RaffleEntryMethod } from "@/db/schema/event-raffle-entries";
import { eventVolunteers } from "@/db/schema/event-volunteers";
import type { StaffUser } from "@/db/schema/staff-users";
import type { Database } from "@/db/types";
import type { Locale } from "@/i18n/routing";
import { TOKEN_NOT_FOUND, type TokenRejection } from "@/modules/action-tokens/domain/token-state";
import { readActionTokenContext } from "@/modules/action-tokens/repository";
import { tokenAttemptAllowed } from "@/modules/action-tokens/throttle";
import { recordAuditEvent } from "@/modules/audit/repository";
import { signedTextHash } from "@/modules/legal-documents/domain/signed-text";
import { type SignatureTrace, traceColumns } from "@/modules/legal-documents/domain/signature-trace";
import { findCurrentApprovedDocument } from "@/modules/legal-documents/repository";
import { emailBucketKey } from "@/modules/rate-limit/domain/key";
import { consumeRateLimit } from "@/modules/rate-limit/service";
import { anotherAdultOnTheLink, managedRegistration } from "@/modules/registrations/manage-family";
import { findRegistrationById } from "@/modules/registrations/repository";
import { looksLikeSpam } from "@/modules/registrations/service";
import { canReadRaffle } from "@/modules/staff-identity/domain/roles";
import { DomainError } from "@/shared/errors/domain-error";
import { isUuid } from "@/shared/ids";
import { type RaffleGateFacts, type RaffleKind, type RaffleSettings, raffleNumberOf, raffleSignUpClosedFor, typedNameMatches, typedNameOf } from "./domain/raffle";
import { canTakeRaffleList } from "./raffle-list";
import { entryColumnOf, findRaffleEntry, raffleEligible, type RafflePersonFacts, type RafflePersonRef, readRaffleGateFacts, readRafflePerson, readRaffleRules } from "./raffle-roster";

/*
  «Înscrierea la tombolă» (§984; the owner, 2026-11-18: «Tot pentru ziua cursei vreau să am un tab de tombolă unde să văd toți
  participanții la tombolă» — «Dar pentru tombolă trebuie să am o înscriere separată» — and, asked: in the sign-up mode only those
  who sign up are in; they sign up three ways — a tick on their own registration's page, a public form on the site, at the desk on
  race day — and they accept a «Regulamentul tombolei» approved by the club, without which the sign-up does not open).

  **One gate** (`domain/raffle.ts#raffleSignUpClosedFor`), read uncached at every press (`raffle-roster.ts#readRaffleGateFacts`): the
  event's settings, its facts and the two legal texts in force. Closed, every door below refuses with `RAFFLE_SIGN_UP_CLOSED` and
  writes nothing.

  **One writer** (`signUp`): the row, with the rules' acceptance as the volunteer agreement keeps one (§758, §771) — the version in
  force in the sign-up's language, the moment, the language, the SHA-256 of the exact text read with its blanks filled (§556) and the
  blanks — the privacy notice's version, the typed name (FORM), the trace (LINK, FORM) or the recorder (DESK, STAFF); one audit row
  with the door and the group, never a name. A second sign-up finds the first (the person's column is unique) and writes nothing.
  Nobody is emailed — not at a sign-up, not at a withdrawal — and no public cache is expired: no public page reads a sign-up.

  **The doors.** LINK — the person's own «Gestionează înscrierea», POST only, the token read and never spent, the house's rule for
  who acts on a link (§547, §421: another adult on the address may be taken out, never signed up). FORM — the event's public page: a
  race number and a name, matched to a confirmed real registration of a ticked group (or, with «Sunt voluntar», a confirmed
  volunteer), every typed word among the registered name's; honeypot, timing, Turnstile at the action, two throttles; a refusal is
  one neutral answer that reveals neither half. DESK — every desk role (`canReadRaffle`, the desk's roles), for a registration whose
  person accepted the rules on paper or aloud: on the desk's list, a scanned person's view and, since §1014, the «Tombolă» tab. STAFF —
  the organizers (`canTakeRaffleList`), for any of the three kinds of person, a line of the elite list included.
*/

type Actor = Pick<StaffUser, "id" | "role">;

/** The gate asked for one group; throws, writing nothing, while it is shut. */
function assertOpen(facts: RaffleGateFacts | null, now: Date, kind: RaffleKind): asserts facts is RaffleGateFacts {
  const closed = facts ? raffleSignUpClosedFor(facts, now, kind) : "noRaffle";
  if (closed) throw new DomainError("RAFFLE_SIGN_UP_CLOSED", `the raffle's sign-up is closed (${closed})`);
}

/** What every sign-up writes of the acceptance, in one shape. */
type AcceptanceColumns = {
  rulesDocumentId: string;
  rulesAcceptedAt: Date;
  rulesLocale: Locale;
  rulesTextHash: string;
  rulesFacts: Record<string, string>;
  privacyNoticeVersion: number;
};

/** One acceptance of the rules in force, as the row keeps it — §556's fingerprint over the text with its blanks filled. */
async function acceptanceColumns<T extends Record<string, unknown>>(db: Database<T>, eventId: string, settings: RaffleSettings, locale: Locale, now: Date): Promise<AcceptanceColumns> {
  const [rules, notice] = await Promise.all([readRaffleRules(db, eventId, settings, locale, now), findCurrentApprovedDocument(db, "PRIVACY_NOTICE", locale, now)]);
  if (!rules || !notice) throw new DomainError("RAFFLE_SIGN_UP_CLOSED", "no raffle rules or privacy notice in force in this language");
  return {
    rulesDocumentId: rules.documentId,
    rulesAcceptedAt: now,
    rulesLocale: locale,
    rulesTextHash: signedTextHash({ title: rules.title, body: rules.body, values: rules.values }),
    rulesFacts: rules.values as Record<string, string>,
    privacyNoticeVersion: notice.version,
  };
}

function personColumns(ref: RafflePersonRef): { registrationId: string | null; volunteerId: string | null; eliteEntryId: string | null } {
  return {
    registrationId: ref.table === "registration" ? ref.id : null,
    volunteerId: ref.table === "volunteer" ? ref.id : null,
    eliteEntryId: ref.table === "elite" ? ref.id : null,
  };
}

export type RaffleSignUpOutcome = "created" | "already";

/**
 * The person's sign-up, written once: the rules' tick given, the gate asked again for the person's group, the person eligible
 * (confirmed, real, a number; a line of the elite list always), then the row and its audit row — or nothing, when the person is in
 * already. Refusals write nothing: `RAFFLE_RULES_NOT_ACCEPTED`, `RAFFLE_SIGN_UP_CLOSED`, `RAFFLE_NOT_ELIGIBLE`.
 */
async function signUp<T extends Record<string, unknown>>(
  db: Database<T>,
  input: { person: RafflePersonFacts; method: RaffleEntryMethod; accepted: boolean; locale: Locale; typedName?: string | null; trace?: SignatureTrace; recordedBy?: string | null },
  now: Date,
): Promise<RaffleSignUpOutcome> {
  if (!input.accepted) throw new DomainError("RAFFLE_RULES_NOT_ACCEPTED", "a raffle sign-up needs the rules accepted", ["accept"]);
  const facts = await readRaffleGateFacts(db, input.person.eventId, now);
  assertOpen(facts, now, input.person.kind);
  if (!raffleEligible(input.person.person)) throw new DomainError("RAFFLE_NOT_ELIGIBLE", "the raffle takes confirmed people with a number");
  if (await findRaffleEntry(db, input.person.ref)) return "already";

  const acceptance = await acceptanceColumns(db, input.person.eventId, facts.settings, input.locale, now);
  const electronic = input.method === "LINK" || input.method === "FORM";
  const trace = traceColumns(input.trace, electronic);
  const recorder = electronic ? null : (input.recordedBy ?? null);
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(eventRaffleEntries)
      .values({
        eventId: input.person.eventId,
        ...personColumns(input.person.ref),
        method: input.method,
        ...acceptance,
        typedName: input.method === "FORM" ? (input.typedName ?? null) : null,
        ip: trace.ip,
        userAgent: trace.userAgent,
        recordedByStaffUserId: recorder,
        createdAt: now,
      })
      .onConflictDoNothing()
      .returning({ id: eventRaffleEntries.id });
    // Two presses at once: the person's column is unique, and the second finds the first.
    if (!row) return "already" as const;
    await recordAuditEvent(tx, {
      actorStaffUserId: recorder,
      action: "event_raffle.entry_created",
      entityType: "event",
      entityId: input.person.eventId,
      metadata: { entryId: row.id, method: input.method, kind: input.person.kind },
      now,
    });
    return "created" as const;
  });
}

/** Takes a person's sign-up away, audited; false when there was none. Who and why is the caller's (`by`). */
async function withdraw<T extends Record<string, unknown>>(
  db: Database<T>,
  entry: { id: string; eventId: string; kind: RaffleKind; method: RaffleEntryMethod },
  by: "person" | "staff",
  actorId: string | null,
  now: Date,
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [gone] = await tx.delete(eventRaffleEntries).where(eq(eventRaffleEntries.id, entry.id)).returning({ id: eventRaffleEntries.id });
    if (!gone) return false;
    await recordAuditEvent(tx, {
      actorStaffUserId: actorId,
      action: "event_raffle.entry_withdrawn",
      entityType: "event",
      entityId: entry.eventId,
      // The door the sign-up had come by, beside the group and who took it away — never a name.
      metadata: { entryId: entry.id, method: entry.method, kind: entry.kind, by },
      now,
    });
    return true;
  });
}

// ---------------------------------------------------------------------------------------------
// LINK — the person's own «Gestionează înscrierea»
// ---------------------------------------------------------------------------------------------

type LinkTarget = { rejected: TokenRejection } | { own: Registration; target: Registration };

/** The registration a manage link names for this press — its own, or another of the same address at the same event (§547). */
async function linkTarget<T extends Record<string, unknown>>(db: Database<T>, secret: string, now: Date, registrationId?: string): Promise<LinkTarget> {
  if (!(await tokenAttemptAllowed(db, secret, now))) return { rejected: TOKEN_NOT_FOUND };
  const context = await readActionTokenContext(db, { secret, purpose: "MANAGE_REGISTRATION", now });
  if (!context.ok) return { rejected: context };
  if (!context.token.registrationId) return { rejected: TOKEN_NOT_FOUND };
  const own = await findRegistrationById(db, context.token.registrationId);
  const target = own ? await managedRegistration(db, own, registrationId) : null;
  if (!own || !target) throw new DomainError("NOT_FOUND", "not a registration this link manages");
  return { own, target };
}

/**
 * «Particip la tombolă» from the person's own registration page (LINK): the `MANAGE_REGISTRATION` token read, never spent; POST
 * only. Another adult on the address may be taken out from this link, never signed up (§421): the rules are theirs to accept.
 */
export async function signUpForRaffleByLink<T extends Record<string, unknown>>(
  db: Database<T>,
  input: { secret: string; accepted: boolean; locale: Locale; registrationId?: string; trace?: SignatureTrace },
  now: Date,
): Promise<{ ok: true; outcome: RaffleSignUpOutcome } | TokenRejection> {
  const found = await linkTarget(db, input.secret, now, input.registrationId);
  if ("rejected" in found) return found.rejected;
  if (anotherAdultOnTheLink(found.own, found.target, now)) throw new DomainError("FORBIDDEN", "another adult on the address signs up for the raffle themselves");
  const person = await readRafflePerson(db, { table: "registration", id: found.target.id });
  if (!person) throw new DomainError("NOT_FOUND", "no such registration");
  const outcome = await signUp(db, { person, method: "LINK", accepted: input.accepted, locale: input.locale, trace: input.trace }, now);
  return { ok: true, outcome };
}

/**
 * «Nu mai particip» from the person's own registration page (LINK): the sign-up taken away, audited; the token read, never spent.
 * Behind the same gate as the sign-up: the card that offers it is drawn only while the gate is open.
 */
export async function withdrawFromRaffleByLink<T extends Record<string, unknown>>(db: Database<T>, input: { secret: string; registrationId?: string }, now: Date): Promise<{ ok: true; changed: boolean } | TokenRejection> {
  const found = await linkTarget(db, input.secret, now, input.registrationId);
  if ("rejected" in found) return found.rejected;
  const person = await readRafflePerson(db, { table: "registration", id: found.target.id });
  if (!person) throw new DomainError("NOT_FOUND", "no such registration");
  assertOpen(await readRaffleGateFacts(db, person.eventId, now), now, person.kind);
  const entry = await findRaffleEntry(db, person.ref);
  if (!entry) return { ok: true, changed: false };
  return { ok: true, changed: await withdraw(db, { id: entry.id, eventId: entry.eventId, kind: person.kind, method: entry.method }, "person", null, now) };
}

// ---------------------------------------------------------------------------------------------
// FORM — the event's public page
// ---------------------------------------------------------------------------------------------

export type RaffleFormInput = {
  number: string;
  name: string;
  /** «Sunt voluntar»: the number is a volunteer's. */
  volunteer: boolean;
  accepted: boolean;
  locale: Locale;
  honeypot?: string;
  renderedAt?: string;
};

/** The form's answer: `done` (signed up, or in already — the same sentence), `noMatch` (one neutral sentence) or `limited`. */
export type RaffleFormOutcome = "done" | "noMatch" | "limited";

/**
 * The public form (FORM): a number and a name matched to one person of a ticked group, then the one writer. The boxes' shape is the
 * person's to fix (`VALIDATION_ERROR` naming `number`, `name` or `accept`); a spam-looking post answers like a success and keeps
 * nothing; a closed gate is `RAFFLE_SIGN_UP_CLOSED`. Then two throttles — the number at the event, and the event — and the match: a
 * confirmed real registration with that number (or, with «Sunt voluntar», a confirmed volunteer), of a group the event ticks, whose
 * registered name holds every word typed (`typedNameMatches`). Anything else is `noMatch`, the one sentence that says neither which
 * half was wrong nor whether the number exists. No email is queued.
 */
export async function signUpForRaffleByForm<T extends Record<string, unknown>>(db: Database<T>, eventId: string, input: RaffleFormInput, now: Date, trace?: SignatureTrace): Promise<RaffleFormOutcome> {
  const number = raffleNumberOf(input.number);
  const name = typedNameOf(input.name);
  const refused = [...(number === null ? ["number"] : []), ...(name === "" || name.length > RAFFLE_TYPED_NAME_MAX ? ["name"] : []), ...(input.accepted ? [] : ["accept"])];
  if (refused.length > 0 || number === null) throw new DomainError("VALIDATION_ERROR", "the raffle form is malformed", refused);
  // The spam defences answer like a success: nothing is kept, nothing says so.
  if (looksLikeSpam({ honeypot: input.honeypot, renderedAt: input.renderedAt }, now)) return "done";

  const facts = await readRaffleGateFacts(db, eventId, now);
  if (!facts) throw new DomainError("RAFFLE_SIGN_UP_CLOSED", "the raffle's sign-up is closed (noRaffle)");
  const closed = raffleSignUpClosedFor(facts, now, input.volunteer ? "VOLUNTEER" : ["RUNNER", "ELITE"]);
  // «Sunt voluntar» ticked where the event takes no volunteers, or the reverse: no match, never a closed page — it is open for the others.
  if (closed === "groupNotAllowed") return "noMatch";
  if (closed) throw new DomainError("RAFFLE_SIGN_UP_CLOSED", `the raffle's sign-up is closed (${closed})`);

  // The person being defended is the number at the event: a script trying names for one number, or numbers for one event.
  const byNumber = await consumeRateLimit(db, "raffle-signup", emailBucketKey("raffle-signup", `${eventId}:${input.volunteer ? "v" : "r"}${number}`), now);
  const byEvent = await consumeRateLimit(db, "raffle-event", eventId, now);
  if (!byNumber.allowed || !byEvent.allowed) return "limited";

  const ref = await matchRafflePerson(db, eventId, number, input.volunteer, name);
  const person = ref ? await readRafflePerson(db, ref) : null;
  if (!person || raffleSignUpClosedFor(facts, now, person.kind) !== null || !raffleEligible(person.person)) return "noMatch";
  await signUp(db, { person, method: "FORM", accepted: true, locale: input.locale, typedName: name, trace }, now);
  return "done";
}

/** The person a number and a name name at the event: a confirmed real registration, or a confirmed volunteer — or nobody. */
async function matchRafflePerson<T extends Record<string, unknown>>(db: Database<T>, eventId: string, number: number, volunteer: boolean, typed: string): Promise<RafflePersonRef | null> {
  if (volunteer) {
    const rows = await db
      .select({ id: eventVolunteers.id, name: eventVolunteers.name })
      .from(eventVolunteers)
      .where(and(eq(eventVolunteers.eventId, eventId), eq(eventVolunteers.bibNumber, number), eq(eventVolunteers.state, "CONFIRMED")));
    const match = rows.find((row) => typedNameMatches(typed, row.name));
    return match ? { table: "volunteer", id: match.id } : null;
  }
  const rows = await db
    .select({ id: registrations.id, name: registrations.registeredName })
    .from(registrations)
    .where(and(eq(registrations.eventId, eventId), eq(registrations.bibNumber, number), eq(registrations.status, "CONFIRMED"), eq(registrations.kind, "REAL")));
  const match = rows.find((row) => typedNameMatches(typed, row.name));
  return match ? { table: "registration", id: match.id } : null;
}

// ---------------------------------------------------------------------------------------------
// DESK and STAFF
// ---------------------------------------------------------------------------------------------

/**
 * «Înscrie la tombolă» at the race-day desk (DESK), for every desk role (`canReadRaffle`, which is `canWorkTheDesk`, §1014): a
 * registration whose person accepted the rules on paper or aloud — the press's own tick says so (`accepted`) —, pressed on the desk's
 * list, a scanned person's view or the «Tombolă» tab. The rules' version is the one in force in the registration's language; the desk
 * member is the recorder.
 */
export async function signUpForRaffleAtDesk<T extends Record<string, unknown>>(db: Database<T>, actor: Actor, input: { registrationId: string; accepted: boolean }, now: Date): Promise<RaffleSignUpOutcome> {
  if (!canReadRaffle(actor.role)) throw new DomainError("FORBIDDEN", `role ${actor.role} does not work the desk`);
  const person = await readRafflePerson(db, { table: "registration", id: input.registrationId });
  if (!person) throw new DomainError("NOT_FOUND", "no such registration");
  return signUp(db, { person, method: "DESK", accepted: input.accepted, locale: person.locale, recordedBy: actor.id }, now);
}

/**
 * «Înscrie la tombolă» by the organizers (STAFF), on a volunteer's page or the «Tombolă» tab (`canTakeRaffleList`): any of the three
 * kinds of person — a line of the elite list included, which has no other door — whose person accepted the rules. NOT_FOUND for a
 * person of another event than the one the press names.
 */
export async function signUpForRaffleByStaff<T extends Record<string, unknown>>(db: Database<T>, actor: Actor, input: { person: RafflePersonRef; accepted: boolean; eventId?: string }, now: Date): Promise<RaffleSignUpOutcome> {
  if (!canTakeRaffleList(actor.role)) throw new DomainError("FORBIDDEN", `role ${actor.role} may not sign people up for the raffle`);
  const person = await readRafflePerson(db, input.person);
  if (!person || (input.eventId !== undefined && person.eventId !== input.eventId)) throw new DomainError("NOT_FOUND", "no such person at this event");
  return signUp(db, { person, method: "STAFF", accepted: input.accepted, locale: person.locale, recordedBy: actor.id }, now);
}

/**
 * «Șterge înscrierea» on the «Tombolă» tab (`canTakeRaffleList`): one sign-up taken off, whichever door it came by, audited as a
 * withdrawal by the staff. At any time — a correction of the organizers', not a door of the sign-up. NOT_FOUND for another event's.
 */
export async function deleteRaffleEntry<T extends Record<string, unknown>>(db: Database<T>, actor: Actor, input: { entryId: string; eventId: string }, now: Date): Promise<{ eventId: string }> {
  if (!canTakeRaffleList(actor.role)) throw new DomainError("FORBIDDEN", `role ${actor.role} may not change the raffle's sign-ups`);
  if (!isUuid(input.entryId) || !isUuid(input.eventId)) throw new DomainError("NOT_FOUND", "no such sign-up");
  const [entry] = await db.select().from(eventRaffleEntries).where(and(eq(eventRaffleEntries.id, input.entryId), eq(eventRaffleEntries.eventId, input.eventId))).limit(1);
  if (!entry) throw new DomainError("NOT_FOUND", "no such sign-up");
  const ref: RafflePersonRef = entry.registrationId ? { table: "registration", id: entry.registrationId } : entry.volunteerId ? { table: "volunteer", id: entry.volunteerId } : { table: "elite", id: entry.eliteEntryId as string };
  const person = await readRafflePerson(db, ref);
  await withdraw(db, { id: entry.id, eventId: entry.eventId, kind: person?.kind ?? "RUNNER", method: entry.method }, "staff", actor.id, now);
  return { eventId: entry.eventId };
}

/**
 * A person's sign-up moved to the row they became (§984): «Transformă în voluntar» and «Transformă în alergător» (§948) cancel one row
 * and enter another for the same person at the same event, so the sign-up follows them, as the organizers' exclusion does (§953) —
 * the same row, its door, its acceptance of the same rules for the same event and its trace unchanged; a press about something else
 * neither drops a person who signed up nor asks them to sign up again. Inside the caller's transaction, which asked the role (the
 * transform's, `canManageRegistrations`); the moved entry's id, for the transform's own trail row, or null when the person had none —
 * or when the row they became holds a sign-up already (a staff entry may restart a cancelled registration that kept its own): that one
 * stands, and the other stays with its cancelled row until the sweep.
 */
export async function moveRaffleEntry<T extends Record<string, unknown>>(tx: Database<T>, from: RafflePersonRef, to: RafflePersonRef): Promise<string | null> {
  if (!isUuid(from.id) || !isUuid(to.id) || (await findRaffleEntry(tx, to))) return null;
  const [moved] = await tx.update(eventRaffleEntries).set(personColumns(to)).where(eq(entryColumnOf(from), from.id)).returning({ id: eventRaffleEntries.id });
  return moved?.id ?? null;
}

/** A line of the elite list's two raffle ticks: «Participă la tombolă» and «Prezent». */
export type EliteRaffleTick = "inRaffle" | "present";

export function isEliteRaffleTick(value: unknown): value is EliteRaffleTick {
  return value === "inRaffle" || value === "present";
}

/**
 * A line of the elite list's raffle tick (§984), on the «Tombolă» tab (`canTakeRaffleList`): taken out or put back, ticked present
 * or not, at any time. One statement that changes the tick only where it says otherwise; audited by the line's id, never its name.
 * No public page reads either tick: nothing is expired.
 */
export async function setEliteLineRaffleTick<T extends Record<string, unknown>>(db: Database<T>, actor: Actor, input: { entryId: string; eventId: string; tick: EliteRaffleTick; on: boolean }, now: Date): Promise<{ changed: boolean }> {
  if (!canTakeRaffleList(actor.role)) throw new DomainError("FORBIDDEN", `role ${actor.role} may not change the raffle`);
  if (!isUuid(input.entryId) || !isUuid(input.eventId)) throw new DomainError("NOT_FOUND", "no such line");
  const column = input.tick === "inRaffle" ? eventEliteEntries.inRaffle : eventEliteEntries.present;
  return db.transaction(async (tx) => {
    const [changed] = await tx
      .update(eventEliteEntries)
      .set(input.tick === "inRaffle" ? { inRaffle: input.on } : { present: input.on })
      .where(and(eq(eventEliteEntries.id, input.entryId), eq(eventEliteEntries.eventId, input.eventId), ne(column, input.on)))
      .returning({ id: eventEliteEntries.id });
    if (!changed) {
      const [exists] = await tx.select({ id: eventEliteEntries.id }).from(eventEliteEntries).where(and(eq(eventEliteEntries.id, input.entryId), eq(eventEliteEntries.eventId, input.eventId))).limit(1);
      if (!exists) throw new DomainError("NOT_FOUND", "no such line");
      return { changed: false };
    }
    const action = input.tick === "inRaffle" ? (input.on ? "event_elite.in_raffle" : "event_elite.out_of_raffle") : input.on ? "event_elite.present" : "event_elite.absent";
    await recordAuditEvent(tx, { actorStaffUserId: actor.id, action, entityType: "event", entityId: input.eventId, metadata: { entryId: input.entryId, [input.tick]: input.on }, now });
    return { changed: true };
  });
}
