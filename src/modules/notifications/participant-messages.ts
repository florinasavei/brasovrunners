import { raceDayCondition } from "@/modules/registrations/admin-repository";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { auditLogs } from "@/db/schema/audit-logs";
import { emailOutbox } from "@/db/schema/email-outbox";
import { participants } from "@/db/schema/participants";
import { registrationReconfirmations } from "@/db/schema/registration-reconfirmations";
import { ACTIVE_REGISTRATION_STATUSES, type RegistrationStatus, registrations } from "@/db/schema/registrations";
import type { StaffUser } from "@/db/schema/staff-users";
import { staffUsers } from "@/db/schema/staff-users";
import type { Database } from "@/db/types";
import { formatDay } from "@/i18n/dates";
import { getPathname } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { recordAuditEvent } from "@/modules/audit/repository";
import { replyToInForce } from "@/modules/contact/shown-address";
import { offeredRouteGpx } from "@/modules/content/events/route-gpx";
import { placeToBeAnnouncedWords } from "@/modules/events/calendar-labels";
import { routeGpxFileName } from "@/modules/events/domain/route-gpx";
import { findEventNotificationDetails } from "@/modules/events/repository";
import { getStorage } from "@/modules/media/storage";
import { eventDay, howItWentOpen, howItWentUrl } from "@/modules/feedback/links";
import { lockEventForCapacity } from "@/modules/registrations/repository";
import { canMessageParticipants } from "@/modules/staff-identity/domain/roles";
import { env } from "@/shared/config/env";
import { DomainError } from "@/shared/errors/domain-error";
import { isReconfirmStatus, RECONFIRM_STATUSES } from "./domain/cannot-come";
import { EMAIL_SAMPLE } from "./domain/email-sample";
import { fillPlaceholders } from "./domain/email-copy";
import {
  AUDIENCE_RACE_DAY,
  AUDIENCE_STATUSES,
  checkOrganizerMessage,
  CHOSEN_AUDIENCE,
  chosenRegistrationIds,
  isMessageReach,
  isOrganizerQrStatus,
  isOrganizerSignStatus,
  type MessageReach,
  type OrganizerMessage,
  PARTICIPANT_MESSAGE_AUDIENCES,
  type ParticipantMessageAudience,
  readOrganizerMessagePayload,
  typedCountMatches,
  unknownOrganizerPlaceholders,
} from "./domain/organizer-message";
import { emailEventFacts } from "./event-facts-row";
import { enqueueBulkClubCopies, enqueueEmail } from "./outbox";
import { drainOutboxRowsAfterResponse } from "./drain";
import { type DeliveryChoice, markedForNow, sendNowSplit } from "./domain/send-at-once";
import { assertRoomToSendNow, clubCopyTypesFor, outboxIdsForKey } from "./send-at-once";
import { renderBilingual, type TemplateData } from "./templates";

/**
 * "Trimite un mesaj participanților" (`DECISIONS.md` §364): the organizer writes to the people
 * registered for one event, in both languages, and chooses which of them hear it.
 *
 * The same kind of message as the §331 notices — operational, about the event the person
 * registered for, needing no consent of its own (§9) — and sent the same way: one outbox row per
 * registration, in the registration's own language, inside one transaction, so the send and its
 * messages commit together or not at all (BR-REQ-080-02). The provider is called afterwards by
 * the outbox, and a spent Mailgun allowance defers the rest to the reset rather than dropping it
 * (§40) — which is why nothing here refuses a send for being larger than today's allowance: the
 * composer says how much of it waits, and the outbox makes it true.
 *
 * Test registrations are written to exactly as §331 writes to them: like a real one (their
 * `@test.invalid` address goes nowhere, and they cannot exist in production, §12.6), and counted
 * apart in every number returned here. The club's copy is one per send since §419 — the words and
 * how many real participants received them, no names (`enqueueBulkClubCopies`) — where it was one
 * per registration under §320.
 */

export type AudienceCounts = Readonly<Record<ParticipantMessageAudience, { real: number; test: number }>>;

/** How many registrations each choice reaches right now — real ones for the number shown, test ones apart. */
export async function countParticipantMessageAudiences<T extends Record<string, unknown>>(
  db: Database<T>,
  eventId: string,
): Promise<AudienceCounts> {
  const rows = await db
    .select({ status: registrations.status, kind: registrations.kind, count: sql<number>`count(*)::int` })
    .from(registrations)
    .where(and(eq(registrations.eventId, eventId), inArray(registrations.status, [...AUDIENCE_STATUSES.ALL_ACTIVE])))
    .groupBy(registrations.status, registrations.kind);
  const counts = Object.fromEntries(PARTICIPANT_MESSAGE_AUDIENCES.map((audience) => [audience, { real: 0, test: 0 }])) as Record<
    ParticipantMessageAudience,
    { real: number; test: number }
  >;
  for (const row of rows) {
    for (const audience of PARTICIPANT_MESSAGE_AUDIENCES) {
      if (AUDIENCE_RACE_DAY[audience]) continue;
      if (!AUDIENCE_STATUSES[audience].includes(row.status)) continue;
      if (row.kind === "TEST") counts[audience].test += row.count;
      else counts[audience].real += row.count;
    }
  }
  // The two groups of the day after (§1055): their own count, by «Ziua cursei»'s definition.
  for (const audience of PARTICIPANT_MESSAGE_AUDIENCES) {
    const raceDay = AUDIENCE_RACE_DAY[audience];
    if (!raceDay) continue;
    const byKind = await db
      .select({ kind: registrations.kind, count: sql<number>`count(*)::int` })
      .from(registrations)
      .where(and(eq(registrations.eventId, eventId), inArray(registrations.status, [...AUDIENCE_STATUSES[audience]]), raceDayCondition(raceDay)))
      .groupBy(registrations.kind);
    for (const row of byKind) {
      if (row.kind === "TEST") counts[audience].test += row.count;
      else counts[audience].real += row.count;
    }
  }
  return counts;
}

/**
 * One line of the composer's list under «Doar anumiți participanți» (§945): a registration that can be ticked — its name
 * of record, its state and whether it is a test one. No address, no number and nothing else about the person: the list
 * is for finding somebody by name, which is all the race-day desk shows of a person too.
 */
export type ChoosableRecipient = { id: string; name: string; status: RegistrationStatus; test: boolean };

/**
 * Everybody who can be ticked: this event's registrations in a state `ALL_ACTIVE` holds — the very rows a send to the
 * ticked chooses among (`sendParticipantMessage`) — by name, as Romanian sorts it (Ș after S and before T: «Ștefan»
 * after «Stela», never after «Zoe»), whichever language the backoffice is read in: the names are the club's runners'.
 */
export async function listChoosableRecipients<T extends Record<string, unknown>>(db: Database<T>, eventId: string): Promise<ChoosableRecipient[]> {
  const rows = await db
    .select({ id: registrations.id, name: registrations.registeredName, status: registrations.status, kind: registrations.kind })
    .from(registrations)
    .where(and(eq(registrations.eventId, eventId), inArray(registrations.status, [...AUDIENCE_STATUSES.ALL_ACTIVE])));
  const byName = new Intl.Collator("ro");
  return rows
    .map((row) => ({ id: row.id, name: row.name, status: row.status, test: row.kind === "TEST" }))
    .sort((a, b) => byName.compare(a.name, b.name) || a.id.localeCompare(b.id));
}

export type SendParticipantMessageInput = {
  eventId: string;
  /** As posted; anything but one of the five choices — the four groups, or the people ticked — is refused. */
  audience: string;
  /**
   * «Doar anumiți participanți» (§945): the registrations ticked on the composer, as posted. Read only when `audience` is
   * `CHOSEN_AUDIENCE`, and only as far as each is a registration of this event in a state `ALL_ACTIVE` holds — a tick on
   * anybody else (cancelled since the page was drawn, another event's, no registration at all) writes to nobody.
   */
  registrationIds?: readonly unknown[];
  /**
   * «Scrie la câți trimiți» (§945; the owner, 2026-11-13: «si vreau extra extra confirmare»): the number of recipients,
   * as the organizer typed it beside «Trimite mesajul». The send goes only when it is exactly the number of real
   * registrations it is about to write to, counted under the lock from the rows themselves; anything else — another
   * number, nothing typed, a caller that forgot it — queues nothing. Required, so that it is the send's rule and not
   * the form's: whoever calls this has to say how many they mean to write to.
   */
  confirmCount: string;
  subject: { ro?: string | null; en?: string | null };
  body: { ro?: string | null; en?: string | null };
  /**
   * The form's own id, minted when the page was drawn. A second press of the same form — a double
   * click, a retried request, the back button and Send again — carries the same id and queues
   * nothing: every row's key names it, and the audit row that records the send is looked for first.
   */
  sendId: string;
  /**
   * «now» sends every row of this press after the response, past the scheduled pass and inside the
   * day's allowance (§540); «queue», the default, leaves it to «Când pleacă emailurile».
   */
  delivery?: DeliveryChoice;
  /**
   * «Cere reconfirmarea» (the decision «Cere reconfirmarea»): each registration of this send in `RECONFIRM_STATUSES`
   * gets an ask row, and its email alone carries the flag that draws «Vin» beside «Nu mai pot ajunge». Optional for the
   * participant: nothing in a state, a place, a deadline, the allocator or the capacity formula reads the answer.
   */
  askReconfirm?: boolean;
  /**
   * «Trimite și numărul de concurs și codul QR» (§943; the owner, 2026-11-12: «trebuie să le și reamintesc oamenilor care
   * e numărul lor de concurs și să le retrimit QR»): each confirmed registration of this send gets, under the organizers'
   * words, its own race number, QR and desk code — the confirmation's own block. Only those rows carry the flag, and the
   * renderer asks the registration's state again when the email leaves; everybody else gets the message as it was.
   * Nothing in a state, a place, a deadline, the allocator or the capacity formula reads it.
   */
  sendQr?: boolean;
  /**
   * «Trimite și linkul pentru semnarea declarației» (§947; the owner, 2026-11-16: «vreau ca cei care nu au semnat
   * declaratia sa o poata semna»): each registration of this send that owes its declaration gets, under the organizers'
   * words, «Semnează declarația» — its own link to the declaration. Only those rows carry the flag — never a link, which
   * the renderer mints when the email leaves, and only if the declaration is owed still; everybody else gets the message
   * as it was. Nothing in a state, a place, a deadline, the allocator or the capacity formula reads it.
   */
  signLink?: boolean;
  /**
   * «Include programul evenimentului» (§958; the owner, 2026-11-17: «Vreau încă o bifă in acel eveniment de "include
   * program"»): under the organizers' words, the event's programme — its timed rows, the «Program» row of the facts block
   * the confirmation carries. About nobody in particular, so **every** row of the send carries the flag, whatever the
   * registration's state, and the club's copy with them — never the rows themselves, which the renderer reads off the
   * event when the email leaves. Nothing in a state, a place, a deadline, the allocator or the capacity formula reads it.
   */
  includeProgramme?: boolean;
  /**
   * «Atașează traseul (GPX)» (§987; the owner, 2026-11-19: «vreau să pot pune în mail și traseul cursei GPX»): the event's
   * GPX attached to every email of the send, with a line and its link under the organizers' words — the twin of
   * `includeProgramme`: **every** row and the club's copy carry the flag, never the file, which the renderer reads from
   * the store when each email leaves. Ignored for an event that has no GPX when the send queues it, whatever was posted.
   * Nothing in a state, a place, a deadline, the allocator or the capacity formula reads it.
   */
  includeRouteGpx?: boolean;
};

export type SendParticipantMessageResult =
  /**
   * `sentNow` / `later` (§540): under «Trimite acum», how many recipients' rows this press sends
   * after the response (at most `SEND_NOW_ROW_LIMIT`) and how many wait for the scheduled pass;
   * absent for «Pune la coadă».
   */
  | { kind: "queued"; real: number; test: number; sentNow?: number; later?: number }
  /** This form was sent already: nothing was queued a second time. */
  | { kind: "duplicate" }
  /** Nobody is in the chosen group right now, or nobody ticked can be written to. Nothing was queued, and nothing was audited. */
  | { kind: "nobody" }
  /**
   * The number typed at «Scrie la câți trimiți» is not the number of real registrations the send would have written to
   * (§945): nothing was queued, and nothing was audited. `real` is that number now, for the refusal's sentence.
   */
  | { kind: "miscounted"; real: number };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The boxes a refused message names, in the order the form shows them (§47). */
export function refusedBoxes(message: ReturnType<typeof checkOrganizerMessage>): string[] {
  return message.issues.map((issue) => issue.box);
}

/**
 * Queue the message to everybody in the chosen group — or, for «Doar anumiți participanți» (§945), to the people ticked:
 * the same send in every other respect (the lock, one row a registration in its language, each flag on its own rows, the
 * club's one copy, the audit row), reaching those of the ticked the widest group would reach and nobody else.
 *
 * Asserted on the server (BR-REQ-060-01): `canMessageParticipants`, whatever the page showed. The
 * words are checked again here — both languages of both texts, the ceilings, no placeholder this
 * message cannot fill — because a POST does not have to come from the form.
 *
 * Under the event row's lock, the one every allocation takes (`AGENTS.md` §10.6): the recipients
 * are one consistent reading of the queue, and two presses of one form serialize, so the second
 * finds the first's audit row and queues nothing. The outbox keys (`organizer-message:<send
 * id>:registration:<id>`) would refuse the same rows a second time anyway; the lock is what keeps
 * a registration that arrived between the two presses from being sent a message nobody pressed
 * Send for.
 */
export async function sendParticipantMessage<T extends Record<string, unknown>>(
  db: Database<T>,
  actor: Pick<StaffUser, "id" | "role">,
  input: SendParticipantMessageInput,
  now: Date,
): Promise<SendParticipantMessageResult> {
  if (!canMessageParticipants(actor.role)) {
    throw new DomainError("FORBIDDEN", `role ${actor.role} may not write to an event's participants`);
  }
  if (!isMessageReach(input.audience)) {
    throw new DomainError("VALIDATION_ERROR", "audience: choose who receives the message", ["audience"]);
  }
  if (!UUID.test(input.sendId)) {
    // Not the page's form: the id is minted when the composer is drawn, and without it a retried
    // press could not be told from a new one.
    throw new DomainError("VALIDATION_ERROR", "sendId: the form carries no id of its own; reload the page");
  }
  const checked = checkOrganizerMessage({ subject: input.subject, body: input.body });
  if (!checked.message) {
    throw new DomainError(
      "VALIDATION_ERROR",
      checked.issues.map((issue) => `${issue.box}: ${issue.problem}`).join("; "),
      refusedBoxes(checked),
    );
  }
  const message: OrganizerMessage = checked.message;
  const audience: MessageReach = input.audience;
  // «Doar anumiți participanți» (§945): the ticked, as ids; null for a group. They narrow the widest group, never widen it.
  const chosen = audience === CHOSEN_AUDIENCE ? new Set(chosenRegistrationIds(input.registrationIds ?? [])) : null;
  const group: ParticipantMessageAudience = audience === CHOSEN_AUDIENCE ? "ALL_ACTIVE" : audience;
  // A posted id that is not a uuid names no event; asking Postgres would be a syntax error, not an answer.
  if (!UUID.test(input.eventId)) throw new DomainError("NOT_FOUND", "no such event");
  const delivery: DeliveryChoice = input.delivery ?? "queue";

  const result: SendParticipantMessageResult = await db.transaction(async (tx) => {
    const event = await lockEventForCapacity(tx, input.eventId);
    if (!event) throw new DomainError("NOT_FOUND", "no such event");

    const [already] = await tx
      .select({ id: auditLogs.id })
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.entityType, "event"),
          eq(auditLogs.entityId, input.eventId),
          eq(auditLogs.action, "event.participant_message_sent"),
          sql`${auditLogs.metadataJson}->>'sendId' = ${input.sendId}`,
        ),
      )
      .limit(1);
    if (already) return { kind: "duplicate" } as const;

    const inGroup = await tx
      .select({
        registrationId: registrations.id,
        participantId: registrations.participantId,
        kind: registrations.kind,
        status: registrations.status,
        locale: registrations.locale,
        recipientEmail: participants.deliveryEmail,
      })
      .from(registrations)
      .innerJoin(participants, eq(participants.id, registrations.participantId))
      .where(
        and(
          eq(registrations.eventId, input.eventId),
          inArray(registrations.status, [...AUDIENCE_STATUSES[group]]),
          AUDIENCE_RACE_DAY[group] ? raceDayCondition(AUDIENCE_RACE_DAY[group]) : undefined,
        ),
      );
    /*
      «Doar anumiți participanți» (§945): of this event's active registrations, read under the lock as for a group, the
      ticked ones. Matched here rather than in the query, so a posted list of any length is never a statement's
      parameters, and an id that is not one of these rows — cancelled since, another event's, made up — matches nothing.
    */
    const rows = chosen ? inGroup.filter((row) => chosen.has(row.registrationId)) : inGroup;
    if (rows.length === 0) return { kind: "nobody" } as const;
    /*
      «Scrie la câți trimiți» (§945): the number the organizer typed against the rows this send is about to write — the
      real ones, as the page counts them (§12.6) — compared here, under the lock, so it is true of this very send:
      somebody who believes they write to two and has «Toți cei înscriși» chosen is stopped, and so is a press whose
      group changed since the page was drawn. Before any row, ask or audit is written, and before the allowance is asked.
    */
    const expected = rows.filter((row) => row.kind !== "TEST").length;
    if (!typedCountMatches(input.confirmCount, expected)) return { kind: "miscounted", real: expected } as const;
    /*
      «Trimite acum» (§540): every message of this send inside the day's allowance, asked before any
      row is written — refused with the allowance's sentence and nothing queued, never a silent
      defer (§80). Test rows are sent too, so they are counted here too.
    */
    /*
      A long list (§540 review): only the first `SEND_NOW_ROW_LIMIT` recipients leave now, and the
      club's copy only when the whole send fits; the rest wait for the scheduled pass, unmarked, so
      neither the queue panel nor the toast says «acum» for them. Only what leaves now is asked of
      the allowance.
    */
    let split = { now: 0, later: 0, copiesNow: false };
    if (delivery === "now") {
      // The club's one copy per address rides with a send that reaches a real participant (§419).
      const copies = await clubCopyTypesFor(tx, { messageType: "ORGANIZER_MESSAGE", recipientEmail: "", real: rows.some((row) => row.kind === "REAL"), perSend: true });
      split = sendNowSplit({ recipients: rows.length, copies: copies.length });
      await assertRoomToSendNow(tx, rows.slice(0, split.now).map(() => "ORGANIZER_MESSAGE" as const), now, split.copiesNow ? copies : []);
    }
    const askReconfirm = input.askReconfirm === true;
    const sendQr = input.sendQr === true;
    const signLink = input.signLink === true;
    const includeProgramme = input.includeProgramme === true;
    /*
      «Atașează traseul (GPX)» (§987): only for an event that has a GPX now, under the lock, as its page offers it — a tick
      posted for an event without one (a forged post, a file removed since the page was drawn) flags nothing.
    */
    const includeRouteGpx = input.includeRouteGpx === true && offeredRouteGpx(event.routeGpx) !== null;
    const typed = { subject: { ro: message.subject.ro, en: message.subject.en }, body: { ro: message.body.ro, en: message.body.en } };
    /*
      «Include programul evenimentului» (§958): the one flag that is the send's and not a row's — the programme is about
      nobody in particular, so it rides beside the words on every row this send queues, whatever the registration's
      state, and on the club's copy, which shows what the participants got. A flag, never the rows: the renderer reads
      the programme off the event when each email leaves. Unticked, the words alone, as they always were.

      «Atașează traseul (GPX)» (§987) is the second such flag, and rides the same way: a flag, never the file, which the
      renderer reads from the store when each email leaves.
    */
    const words = {
      ...typed,
      ...(includeProgramme ? { includeProgramme: true } : {}),
      ...(includeRouteGpx ? { includeRouteGpx: true } : {}),
    };

    let real = 0;
    let test = 0;
    let sentNow = 0;
    // The registrations this send asks (the decision «Cere reconfirmarea»), test ones counted apart as every number here.
    const asked: string[] = [];
    let askedTest = 0;
    // The confirmed registrations whose email carries the number and the QR (§943), test ones apart likewise.
    let withQr = 0;
    let withQrTest = 0;
    // The registrations owing their declaration whose email carries the link to sign it (§947), test ones apart likewise.
    let withSignLink = 0;
    let withSignLinkTest = 0;
    for (const [index, row] of rows.entries()) {
      const leavesNow = delivery === "now" && index < split.now;
      /*
        «Cere reconfirmarea» (the decision «Cere reconfirmarea»): the flag rides on a row, never on the send — only the rows
        whose registration this send asks (`isReconfirmStatus` at queue time, the very test that fills `asked`) carry it,
        beside the words, so the renderer draws «Vin» only where an ask row exists. A flag, never a token.

        «Trimite și numărul de concurs și codul QR» (§943) rides the same way: `sendQr` only on the rows whose registration
        is confirmed as the send queues them (`isOrganizerQrStatus`) — a flag, never the code, which the renderer reads off
        the registration when the email leaves, and only if it is confirmed still.

        «Trimite și linkul pentru semnarea declarației» (§947) the same way again: `signLink` only on the rows whose
        registration owes its declaration as the send queues them (`isOrganizerSignStatus`) — a flag, never the link,
        which the renderer mints when the email leaves, and only if the declaration is owed still.
      */
      const asks = askReconfirm && isReconfirmStatus(row.status);
      const carriesQr = sendQr && isOrganizerQrStatus(row.status);
      const carriesSignLink = signLink && isOrganizerSignStatus(row.status);
      // The words (and, when ticked, the send's own flag for the programme, §958), and each of the three flags only on
      // its own rows: a row none concerns carries the words alone, as it always did.
      const own =
        asks || carriesQr || carriesSignLink
          ? { ...words, ...(asks ? { askReconfirm: true } : {}), ...(carriesQr ? { sendQr: true } : {}), ...(carriesSignLink ? { signLink: true } : {}) }
          : words;
      // Marked for the queue panel's «Pleacă acum» (§540) — only a row this press sends now.
      const payload = leavesNow ? markedForNow(own, delivery) : own;
      const inserted = await enqueueEmail(tx, {
        participantId: row.participantId,
        registrationId: row.registrationId,
        messageType: "ORGANIZER_MESSAGE",
        locale: row.locale,
        recipientEmail: row.recipientEmail,
        // The words, both languages of both, and nothing about anybody (§14.5): no token, no body
        // rendered, no address beyond the row's own.
        payload,
        idempotencyKey: `organizer-message:${input.sendId}:registration:${row.registrationId}`,
        requestedByStaffUserId: actor.id,
        now,
        // Sent now by the press's own drain after the transaction (§540), not one per row.
        drainAfter: delivery !== "now",
      });
      if (!inserted) continue;
      if (leavesNow) sentNow += 1;
      if (row.kind === "TEST") test += 1;
      else real += 1;
      if (asks) {
        asked.push(row.registrationId);
        if (row.kind === "TEST") askedTest += 1;
      }
      if (carriesQr) {
        if (row.kind === "TEST") withQrTest += 1;
        else withQr += 1;
      }
      if (carriesSignLink) {
        if (row.kind === "TEST") withSignLinkTest += 1;
        else withSignLink += 1;
      }
    }
    if (real + test === 0) return { kind: "duplicate" } as const;
    /*
      The asks (the decision «Cere reconfirmarea»): one row per registration this send asked, in the send's own
      transaction — so the send, its messages and its asks commit together. The answer changes nothing about the
      registration; the backoffice alone reads it.
    */
    if (asked.length > 0) {
      await tx
        .insert(registrationReconfirmations)
        .values(asked.map((registrationId) => ({ registrationId, eventId: input.eventId, sendId: input.sendId, askedAt: now })))
        .onConflictDoNothing();
    }
    // The club's one copy of this send (§419): the words and how many real participants it reached — never a row's
    // flag: it asks nobody, and it carries nobody's number, QR, desk code or link to a declaration (§320, §943, §947). Marked like a row when it leaves now.
    // The send's own flag is in `words` (§958): the copy draws the event's programme as the participants' emails do — it is on the public page, and nobody's.
    // So is «Atașează traseul (GPX)» (§987): the copy says the route's link, which names nobody, and carries no file (§320).
    await enqueueBulkClubCopies(tx, {
      messageType: "ORGANIZER_MESSAGE",
      eventId: input.eventId,
      payload: split.copiesNow ? markedForNow(words, delivery) : words,
      sendKey: `organizer-message:${input.sendId}`,
      realRecipients: real,
      requestedByStaffUserId: actor.id,
      now,
      drainAfter: delivery !== "now",
    });

    await recordAuditEvent(tx, {
      actorStaffUserId: actor.id,
      action: "event.participant_message_sent",
      entityType: "event",
      entityId: input.eventId,
      // Who (the actor), the group, the counts and the subject — never who received it, and never
      // the body (§12.12). The send's id is what makes a second press find this row.
      // `delivery: "now"` — sent at once, past the scheduled pass (§540): the trail says which press it was.
      metadata: {
        sendId: input.sendId,
        audience,
        recipients: real,
        test,
        subject: { ro: message.subject.ro, en: message.subject.en },
        ...(delivery === "now" ? { delivery: "now", bypassedSchedule: true } : {}),
        // «Cere reconfirmarea» (the decision «Cere reconfirmarea»): the tick, and how many were asked — real and test apart.
        ...(askReconfirm ? { askReconfirm: true, asked: asked.length - askedTest, askedTest } : {}),
        // «Trimite și numărul de concurs și codul QR» (§943): the tick, and in how many confirmed registrations' emails —
        // real and test apart; «Mesaje trimise» reads both. Never who, and never a code.
        ...(sendQr ? { sendQr: true, withQr, withQrTest } : {}),
        // «Trimite și linkul pentru semnarea declarației» (§947): the tick, and in how many emails of registrations owing
        // the declaration — real and test apart; «Mesaje trimise» reads both. Never who, and never a link.
        ...(signLink ? { signLink: true, withSignLink, withSignLinkTest } : {}),
        // «Include programul evenimentului» (§958): the tick alone — every email of the send carries it, so there is no
        // number of its own to count, and never the programme's rows, which are the event's.
        ...(includeProgramme ? { includeProgramme: true } : {}),
        // «Atașează traseul (GPX)» (§987): the tick alone, the same way — never the file, and nothing for a tick the event had no GPX for.
        ...(includeRouteGpx ? { includeRouteGpx: true } : {}),
      },
      now,
    });
    return delivery === "now"
      ? ({ kind: "queued", real, test, sentNow, later: real + test - sentNow } as const)
      : ({ kind: "queued", real, test } as const);
  });
  // The rows this press marked (at most `SEND_NOW_ROW_LIMIT`), after this response, whatever «Când pleacă emailurile» says.
  if (delivery === "now" && result.kind === "queued") drainOutboxRowsAfterResponse(await outboxIdsForKey(db, `organizer-message:${input.sendId}`, { markedOnly: true }));
  return result;
}

/**
 * What the people a send asked did since (the decision «Cere reconfirmarea»), real registrations only (§12.6). The first
 * that matches wins, per ask: «Au anulat» — cancelled at or after the ask, by the person or by an Administrator (decided
 * for the owner: any cancellation after the ask); «Au reconfirmat» — still registered and pressed «Vin» on any ask of
 * the registration, this send's or another's; «N-au răspuns» — in a state that can answer (`RECONFIRM_STATUSES`: confirmed,
 * owing the declaration, on the waiting list) and answered none. A waiting-list offer has no button: silent, it is in
 * neither «Au reconfirmat» nor «N-au răspuns» (one that answered before its offer stays under «Au reconfirmat»). An expired
 * registration is in none of the three. Information for the organizers, never a state.
 */
export type ReconfirmAnswers = { yes: number; cancelled: number; none: number };

/**
 * How far a send has left (the decision «Cere reconfirmarea», part two): its rows to the real registrations, read from
 * the outbox — sent, bounced or complained count as left; pending or being sent, as waiting; failed apart. All zero
 * once the sent rows were swept by the retention job, and the line is not drawn then.
 */
export type SendProgress = { left: number; waiting: number; failed: number };

export type SentParticipantMessage = {
  at: Date;
  /** The send's own id, from its audit row; null for a hand-made row that carries none. */
  sendId: string | null;
  subject: { ro: string; en: string };
  /** The group, or `CHOSEN_AUDIENCE` for a send to the people ticked (§945) — never who they were. */
  audience: MessageReach | null;
  recipients: number;
  test: number;
  /** The sender's name, or null when their staff account has since been removed. */
  senderName: string | null;
  /** «Cere reconfirmarea» was ticked on this send. */
  askReconfirm: boolean;
  /** The three numbers of a send that asked; null for one that did not. */
  answers: ReconfirmAnswers | null;
  /** «Trimite și numărul de concurs și codul QR» was ticked on this send (§943). */
  sendQr: boolean;
  /**
   * In how many confirmed registrations' emails the send queued the number and the QR, as its audit row counted them
   * then — test registrations left out; 0 for a send that did not tick.
   */
  withQr: number;
  /** «Trimite și linkul pentru semnarea declarației» was ticked on this send (§947). */
  signLink: boolean;
  /**
   * In how many emails of registrations owing their declaration the send queued the link to sign it, as its audit row
   * counted them then — test registrations left out; 0 for a send that did not tick.
   */
  withSignLink: number;
  progress: SendProgress;
};

/** The registration states that still stand — «Au reconfirmat» reads them. */
const STANDING = sql.raw(ACTIVE_REGISTRATION_STATUSES.map((status) => `'${status}'`).join(", "));
/**
 * The states that can answer (`RECONFIRM_STATUSES`) — «N-au răspuns» reads only them: a waiting-list offer has no button
 * and is not silent. The same set as the list's filter (`admin-repository.ts#reconfirmCondition`).
 */
const ANSWERING = sql.raw(RECONFIRM_STATUSES.map((status) => `'${status}'`).join(", "));

/**
 * "Mesaje trimise": the event's sends, newest first, read from their audit rows — the date, the
 * subject, the group, how many and who. Nothing here says who received one; the rows never did.
 *
 * Two grouped reads for the whole history, never one per send (the decision «Cere reconfirmarea»): the answers of the
 * sends that asked, and each send's progress through the outbox — test registrations left out of both.
 */
export async function listParticipantMessages<T extends Record<string, unknown>>(
  db: Database<T>,
  eventId: string,
  limit = 20,
): Promise<SentParticipantMessage[]> {
  const rows = await db
    .select({ at: auditLogs.createdAt, metadata: auditLogs.metadataJson, senderName: staffUsers.displayName })
    .from(auditLogs)
    .leftJoin(staffUsers, eq(staffUsers.id, auditLogs.actorStaffUserId))
    .where(and(eq(auditLogs.entityType, "event"), eq(auditLogs.entityId, eventId), eq(auditLogs.action, "event.participant_message_sent")))
    .orderBy(desc(auditLogs.createdAt))
    .limit(limit);
  const read = rows.map((row) => {
    const metadata = (row.metadata ?? {}) as {
      sendId?: unknown;
      audience?: unknown;
      recipients?: unknown;
      test?: unknown;
      subject?: { ro?: unknown; en?: unknown };
      askReconfirm?: unknown;
      sendQr?: unknown;
      withQr?: unknown;
      signLink?: unknown;
      withSignLink?: unknown;
    };
    const words = (value: unknown) => (typeof value === "string" ? value : "");
    return {
      at: row.at,
      sendId: typeof metadata.sendId === "string" && UUID.test(metadata.sendId) ? metadata.sendId : null,
      subject: { ro: words(metadata.subject?.ro), en: words(metadata.subject?.en) },
      audience: isMessageReach(metadata.audience) ? metadata.audience : null,
      recipients: typeof metadata.recipients === "number" ? metadata.recipients : 0,
      test: typeof metadata.test === "number" ? metadata.test : 0,
      senderName: row.senderName ?? null,
      askReconfirm: metadata.askReconfirm === true,
      // «Trimite și numărul de concurs și codul QR» (§943): the tick and its count, as the send's own audit row wrote them.
      sendQr: metadata.sendQr === true,
      withQr: metadata.sendQr === true && typeof metadata.withQr === "number" ? metadata.withQr : 0,
      // «Trimite și linkul pentru semnarea declarației» (§947): the same two, from the same row.
      signLink: metadata.signLink === true,
      withSignLink: metadata.signLink === true && typeof metadata.withSignLink === "number" ? metadata.withSignLink : 0,
    };
  });
  const sendIds = read.flatMap((entry) => (entry.sendId ? [entry.sendId] : []));
  const askingIds = read.flatMap((entry) => (entry.sendId && entry.askReconfirm ? [entry.sendId] : []));
  const [answers, progress] = await Promise.all([readReconfirmAnswers(db, eventId, askingIds), readSendProgress(db, sendIds)]);
  return read.map((entry) => ({
    ...entry,
    answers: entry.askReconfirm ? (answers.get(entry.sendId ?? "") ?? { yes: 0, cancelled: 0, none: 0 }) : null,
    progress: progress.get(entry.sendId ?? "") ?? { left: 0, waiting: 0, failed: 0 },
  }));
}

/**
 * What the composer's boxes hold again after a send to the people ticked (§945): the words in both languages and the
 * three ticks, as that send carried them — and `includeProgramme` (§958), present only when that send ticked «Include
 * programul evenimentului»: a trial with the programme under its words is followed by the same message to everybody,
 * not by one that has silently lost it. `includeRouteGpx` (§987) the same, for «Atașează traseul (GPX)».
 */
export type KeptMessage = OrganizerMessage & { askReconfirm: boolean; sendQr: boolean; signLink: boolean; includeProgramme?: true; includeRouteGpx?: true };

/**
 * The words of a send to the people ticked, read back for the composer (§945): such a send is a trial as often as not,
 * and the same message to everybody must not have to be typed a second time — four boxes, in two languages. Read from
 * what the send itself wrote, and from nothing new: the three ticks from its audit row — and «Include programul
 * evenimentului» (§958) and «Atașează traseul (GPX)» (§987) when they were ticked — the words from the payload of one of
 * its own outbox rows — the one text an outbox row keeps (§364) — for as long as those rows are kept.
 *
 * `null` — and the boxes empty, as after any other send — for an id that names no send of this event, for a send to a
 * group (§364: after one, the next press is a new message), and once the rows are gone.
 */
export async function readKeptMessage<T extends Record<string, unknown>>(db: Database<T>, eventId: string, sendId: string): Promise<KeptMessage | null> {
  if (!UUID.test(eventId) || !UUID.test(sendId)) return null;
  const [sent] = await db
    .select({ metadata: auditLogs.metadataJson })
    .from(auditLogs)
    .where(
      and(
        eq(auditLogs.entityType, "event"),
        eq(auditLogs.entityId, eventId),
        eq(auditLogs.action, "event.participant_message_sent"),
        sql`${auditLogs.metadataJson}->>'sendId' = ${sendId}`,
      ),
    )
    .limit(1);
  const metadata = (sent?.metadata ?? null) as {
    audience?: unknown;
    askReconfirm?: unknown;
    sendQr?: unknown;
    signLink?: unknown;
    includeProgramme?: unknown;
    includeRouteGpx?: unknown;
  } | null;
  if (metadata?.audience !== CHOSEN_AUDIENCE) return null;
  const [row] = await db
    .select({ payload: emailOutbox.payloadJson })
    .from(emailOutbox)
    .where(and(eq(emailOutbox.messageType, "ORGANIZER_MESSAGE"), sql`${emailOutbox.idempotencyKey} like ${`organizer-message:${sendId}:registration:%`}`))
    .limit(1);
  const words = readOrganizerMessagePayload(row?.payload);
  if (!words) return null;
  return {
    ...words,
    askReconfirm: metadata.askReconfirm === true,
    sendQr: metadata.sendQr === true,
    signLink: metadata.signLink === true,
    // «Include programul evenimentului» (§958): named only by a send that ticked it, from the same audit row.
    ...(metadata.includeProgramme === true ? { includeProgramme: true as const } : {}),
    // «Atașează traseul (GPX)» (§987): the same — only a send that flagged its rows names it.
    ...(metadata.includeRouteGpx === true ? { includeRouteGpx: true as const } : {}),
  };
}

/** The three numbers of each asking send, one grouped read (the decision «Cere reconfirmarea»). Real registrations only. */
async function readReconfirmAnswers<T extends Record<string, unknown>>(
  db: Database<T>,
  eventId: string,
  sendIds: readonly string[],
): Promise<Map<string, ReconfirmAnswers>> {
  if (sendIds.length === 0) return new Map();
  const cancelledAfter = sql`(${registrations.status} = 'CANCELLED' and ${registrations.cancelledAt} >= ${registrationReconfirmations.askedAt})`;
  const standing = sql`(${registrations.status} in (${STANDING}))`;
  const answering = sql`(${registrations.status} in (${ANSWERING}))`;
  /*
    One rule on every screen (the decision «Cere reconfirmarea»): a registration has re-confirmed when ANY of its asks is
    answered — the list's chip, its filter and the export read the same. So a person who pressed «Vin» after one send and
    stays silent after the next counts under «Au reconfirmat» on both rows. «N-au răspuns» counts only a registration that
    can answer (`RECONFIRM_STATUSES`): one holding a waiting-list offer has no button and is in neither. A correlated
    EXISTS inside the FILTER keeps it one grouped read.
  */
  const answeredAny = sql`exists (select 1 from ${registrationReconfirmations} as answered where answered.registration_id = ${registrations.id} and answered.reconfirmed_at is not null)`;
  const rows = await db
    .select({
      sendId: registrationReconfirmations.sendId,
      yes: sql<number>`count(*) filter (where ${standing} and ${answeredAny})::int`,
      cancelled: sql<number>`count(*) filter (where ${cancelledAfter})::int`,
      none: sql<number>`count(*) filter (where ${answering} and not ${answeredAny})::int`,
    })
    .from(registrationReconfirmations)
    .innerJoin(registrations, eq(registrations.id, registrationReconfirmations.registrationId))
    .where(
      and(
        eq(registrationReconfirmations.eventId, eventId),
        inArray(registrationReconfirmations.sendId, [...sendIds]),
        eq(registrations.kind, "REAL"),
      ),
    )
    .groupBy(registrationReconfirmations.sendId);
  return new Map(rows.map((row) => [row.sendId, { yes: Number(row.yes), cancelled: Number(row.cancelled), none: Number(row.none) }]));
}

/**
 * Each send's progress through the outbox (the decision «Cere reconfirmarea», part two): its rows keyed
 * `organizer-message:<send id>:registration:<id>`, grouped by the send, the club's copy and test registrations left out.
 */
async function readSendProgress<T extends Record<string, unknown>>(db: Database<T>, sendIds: readonly string[]): Promise<Map<string, SendProgress>> {
  if (sendIds.length === 0) return new Map();
  const send = sql<string>`split_part(${emailOutbox.idempotencyKey}, ':', 2)`;
  const rows = await db
    .select({
      sendId: send,
      left: sql<number>`count(*) filter (where ${emailOutbox.status} in ('SENT', 'BOUNCED', 'COMPLAINED'))::int`,
      waiting: sql<number>`count(*) filter (where ${emailOutbox.status} in ('PENDING', 'PROCESSING'))::int`,
      failed: sql<number>`count(*) filter (where ${emailOutbox.status} = 'FAILED')::int`,
    })
    .from(emailOutbox)
    .leftJoin(registrations, eq(registrations.id, emailOutbox.registrationId))
    .where(
      and(
        eq(emailOutbox.messageType, "ORGANIZER_MESSAGE"),
        sql`${emailOutbox.idempotencyKey} like 'organizer-message:%:registration:%'`,
        inArray(send, [...sendIds]),
        sql`coalesce(${registrations.kind}::text, 'REAL') <> 'TEST'`,
      ),
    )
    .groupBy(send);
  return new Map(rows.map((row) => [row.sendId, { left: Number(row.left), waiting: Number(row.waiting), failed: Number(row.failed) }]));
}

export type ParticipantMessagePreview = {
  subject: string;
  html: string;
  /** Every `{name}` in the four boxes this message cannot fill: the send would refuse them. */
  unknown: string[];
};

/**
 * The message as a registrant in `locale` would receive it, from the words as they stand in the
 * boxes — the composer's live preview.
 *
 * The same template the outbox renders with (`renderBilingual`), over the event's own facts read
 * now, in both languages, and the made-up runner every `/admin/emails` preview is addressed to —
 * her name and her number read from `EMAIL_SAMPLE`, the one constant the composer's help line
 * names her from too, so the line and the preview cannot disagree (§364). Nothing is queued and no
 * token exists, so nothing in it can be acted on. Empty boxes preview as the platform's fallback
 * subject and an absent body, which is what a send would refuse.
 */
export async function previewParticipantMessage<T extends Record<string, unknown>>(
  db: Database<T>,
  actor: Pick<StaffUser, "id" | "role">,
  input: {
    eventId: string;
    locale: Locale;
    subject: { ro?: string | null; en?: string | null };
    body: { ro?: string | null; en?: string | null };
    /** «Cere reconfirmarea» as the box stands: the preview draws «Vin» beside «Nu mai pot ajunge» (the decision «Cere reconfirmarea»). */
    askReconfirm?: boolean;
    /** «Trimite și numărul de concurs și codul QR» as the box stands: the preview draws the example runner's block under the words (§943). */
    sendQr?: boolean;
    /** «Trimite și linkul pentru semnarea declarației» as the box stands: the preview draws «Semnează declarația» under the words (§947). */
    signLink?: boolean;
    /** «Include programul evenimentului» as the box stands: the preview draws the event's programme under the words, from its rows as they are now (§958). */
    includeProgramme?: boolean;
    /** «Atașează traseul (GPX)» as the box stands: the preview draws the line that says the route is attached, with its link (§987). */
    includeRouteGpx?: boolean;
  },
): Promise<ParticipantMessagePreview> {
  if (!canMessageParticipants(actor.role)) {
    throw new DomainError("FORBIDDEN", `role ${actor.role} may not write to an event's participants`);
  }
  if (!UUID.test(input.eventId)) throw new DomainError("NOT_FOUND", "no such event");
  const locale = input.locale;
  const other: Locale = locale === "ro" ? "en" : "ro";
  const [details, otherDetails, replyTo] = await Promise.all([
    findEventNotificationDetails(db, input.eventId, locale),
    findEventNotificationDetails(db, input.eventId, other),
    // The Reply-To the send sets (§442), so the preview's reply line matches the sent message.
    replyToInForce(db),
  ]);
  if (!details) throw new DomainError("NOT_FOUND", "no such event");

  const text = (value: string | null | undefined) => (value ?? "").replace(/\r\n?/g, "\n").trim();
  const words = { subject: { ro: text(input.subject.ro), en: text(input.subject.en) }, body: { ro: text(input.body.ro), en: text(input.body.en) } };
  const placeLater = details.locationToBeAnnounced === true;
  const when = (language: Locale) =>
    formatDay(details.startsAt, { locale: language, timeZone: details.timezone, style: "long", withTime: true, position: "inline" });
  const eventUrl = details.slug
    ? `${env.APP_BASE_URL}${getPathname({ locale, href: { pathname: "/events/[slug]", params: { slug: details.slug } } })}`
    : undefined;
  // The other language's page, as the renderer hands it to that half's facts (§392).
  const otherEventUrl = otherDetails?.slug
    ? `${env.APP_BASE_URL}${getPathname({ locale: other, href: { pathname: "/events/[slug]", params: { slug: otherDetails.slug } } })}`
    : null;
  // `{feedbackLink}` (§676) as the send will fill it: «Cum a fost» while that branch is open, the contact page
  // otherwise — and always for a members' event (§552), whose slug the public form neither lists nor names.
  const feedbackOpen = !details.membersOnly && (await howItWentOpen(db, new Date()));
  const day = eventDay(details.startsAt, details.timezone);
  const contactOf = (language: Locale) => `${env.APP_BASE_URL}${getPathname({ locale: language, href: "/contact" })}`;
  /*
    «Atașează traseul (GPX)» (§987) when the box is ticked and the event has a GPX now: the line a participant's email
    carries, the file said attached — what a send this minute would carry — with the link to the same file the event page
    offers. Nothing is attached to a preview and nothing is read from the store. Unticked, or no GPX, the preview is what it was.
  */
  const routeGpx = input.includeRouteGpx === true ? offeredRouteGpx(details.routeGpx) : null;

  const data: TemplateData = {
    participantName: EMAIL_SAMPLE[locale].participantName,
    bibNumber: EMAIL_SAMPLE[locale].bibNumber,
    eventTitle: details.title,
    eventTitleOther: otherDetails?.title || undefined,
    eventLocationName: placeLater ? placeToBeAnnouncedWords(locale) : (details.locationName ?? undefined),
    eventLocationNameOther: placeLater ? placeToBeAnnouncedWords(other) : (otherDetails?.locationName ?? undefined),
    eventStartsAtFormatted: when(locale),
    eventStartsAtFormattedOther: when(other),
    eventChecklist: details.checklist ?? undefined,
    eventChecklistOther: otherDetails?.checklist ?? undefined,
    eventMapUrl: details.mapUrl ?? undefined,
    eventStravaEventUrl: details.stravaEventUrl ?? undefined,
    eventUrl,
    eventRulesUrl: eventUrl && details.hasRules ? `${eventUrl}#rules` : undefined,
    eventScheduleUrl: eventUrl && details.hasSchedule ? `${eventUrl}#schedule` : undefined,
    eventsUrl: `${env.APP_BASE_URL}${getPathname({ locale, href: "/events" })}`,
    contactUrl: `${env.APP_BASE_URL}${getPathname({ locale, href: "/contact" })}`,
    myRegistrationsUrl: `${env.APP_BASE_URL}${getPathname({ locale, href: "/registrations/mine" })}`,
    replyTo,
    feedbackLink: feedbackOpen ? howItWentUrl(locale, details.slug ?? null, day) : contactOf(locale),
    feedbackLinkOther: feedbackOpen ? howItWentUrl(other, otherDetails?.slug ?? null, day) : contactOf(other),
    /*
      The buttons a registrant's copy carries (§558; the decision «Cere reconfirmarea»): «Nu mai pot ajunge» always, «Vin»
      when the box is ticked — both on an inert example link, as every `/admin/emails` preview's (`email-copy-fields.ts`):
      no token is minted, so nothing in the preview can be acted on.
    */
    cannotComeUrl: `${env.APP_BASE_URL}/${locale}/EXAMPLE#cancel`,
    ...(input.askReconfirm === true ? { reconfirmUrl: `${env.APP_BASE_URL}/${locale}/EXAMPLE#reconfirm` } : {}),
    /*
      The block a confirmed runner's copy carries when the box is ticked (§943): the example runner is confirmed — her
      number is in the line above the preview — so she is shown her number, the QR's place and the sample's desk code, as
      the confirmation's preview on «Setări» → «Emailuri» shows them (`emailSampleData`). The code is the sample's, nobody's:
      its picture's address answers with an example QR (§946, `SAMPLE_CHECKIN_CODES`), which the desk reads as unknown.
    */
    ...(input.sendQr === true
      ? { organizerQr: { checkinCode: EMAIL_SAMPLE[locale].checkinCode, qrUrl: `${env.APP_BASE_URL}/api/registrations/qr/${EMAIL_SAMPLE[locale].checkinCode}.png` } }
      : {}),
    /*
      The button somebody who owes the declaration gets when the box is ticked (§947), on an inert example link like the
      two above: no token is minted, so nothing in the preview can be signed. The example runner is confirmed and would
      not get it — the tick's help line says who does; the preview shows what the button looks like.
    */
    ...(input.signLink === true ? { signDeclarationUrl: `${env.APP_BASE_URL}/${locale}/EXAMPLE#declaration` } : {}),
    /*
      The programme under the words when the box is ticked (§958): the flag the send would write, and the event's facts
      for each half, read through the renderer's own `emailEventFacts` from the rows as they are now — what a message
      sent this minute would draw, in the tab's language first. The template draws the «Program» row alone, and nothing
      when the event has no timed row. Unticked, neither is set and the preview is what it was.
    */
    ...(input.includeProgramme === true
      ? {
          organizerProgramme: true,
          eventFacts: emailEventFacts(details, eventUrl ?? null),
          // The other language's own row only: an event written in one language has both halves read that one, as a send does.
          ...(otherDetails && otherDetails.locale !== details.locale ? { eventFactsOther: emailEventFacts(otherDetails, otherEventUrl) } : {}),
        }
      : {}),
    ...(routeGpx ? { organizerRouteGpx: { url: getStorage().publicUrl(routeGpx.key), fileName: routeGpxFileName(routeGpx.key), attached: true } } : {}),
    ...(words.subject[locale] ? { organizerSubject: words.subject[locale] } : {}),
    ...(words.subject[other] ? { organizerSubjectOther: words.subject[other] } : {}),
    ...(words.body[locale] ? { organizerBody: words.body[locale] } : {}),
    ...(words.body[other] ? { organizerBodyOther: words.body[other] } : {}),
  };
  const rendered = renderBilingual("ORGANIZER_MESSAGE", locale, data, eventUrl);
  const unknown = [
    ...new Set([
      ...[words.subject.ro, words.subject.en].flatMap((value) => unknownOrganizerPlaceholders(value, "subject")),
      ...[words.body.ro, words.body.en].flatMap((value) => unknownOrganizerPlaceholders(value, "body")),
    ]),
  ];
  return { subject: rendered.subject, html: rendered.html, unknown };
}

/**
 * A sent message's subject as «Mesaje trimise» draws it: the event's own fields filled — `{eventTitle}`,
 * `{eventStartsAtFormatted}`, `{eventLocationName}` — in the reader's language, by the one filler the email and its preview use
 * (`fillPlaceholders`). The fields of one participant (`{participantName}`, `{bibNumber}`) and the checklist stay as the
 * organizer typed them: a whole send has no one person. The audit row keeps the typed text; only the drawing changes.
 */
export function subjectAsDrawn(
  subject: string,
  details: { title: string; startsAt: Date; timezone: string; locationName?: string | null; locationToBeAnnounced?: boolean | null },
  locale: Locale,
): string {
  const kept = (name: string) => `{${name}}`;
  return fillPlaceholders(subject, {
    participantName: kept("participantName"),
    bibNumber: kept("bibNumber"),
    eventChecklist: kept("eventChecklist"),
    eventTitle: details.title,
    eventStartsAtFormatted: formatDay(details.startsAt, { locale, timeZone: details.timezone, style: "long", withTime: true, position: "inline" }),
    eventLocationName: details.locationToBeAnnounced === true ? placeToBeAnnouncedWords(locale) : (details.locationName ?? undefined),
  });
}
