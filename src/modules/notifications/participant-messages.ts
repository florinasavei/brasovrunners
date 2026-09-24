import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { auditLogs } from "@/db/schema/audit-logs";
import { participants } from "@/db/schema/participants";
import { registrations } from "@/db/schema/registrations";
import type { StaffUser } from "@/db/schema/staff-users";
import { staffUsers } from "@/db/schema/staff-users";
import type { Database } from "@/db/types";
import { formatDay } from "@/i18n/dates";
import { getPathname } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { recordAuditEvent } from "@/modules/audit/repository";
import { placeToBeAnnouncedWords } from "@/modules/events/calendar-labels";
import { findEventNotificationDetails } from "@/modules/events/repository";
import { lockEventForCapacity } from "@/modules/registrations/repository";
import { canMessageParticipants } from "@/modules/staff-identity/domain/roles";
import { env } from "@/shared/config/env";
import { DomainError } from "@/shared/errors/domain-error";
import {
  AUDIENCE_STATUSES,
  checkOrganizerMessage,
  isParticipantMessageAudience,
  type OrganizerMessage,
  PARTICIPANT_MESSAGE_AUDIENCES,
  type ParticipantMessageAudience,
  unknownOrganizerPlaceholders,
} from "./domain/organizer-message";
import { enqueueEmail } from "./outbox";
import { renderBilingual, type TemplateData } from "./templates";

/**
 * "Trimite un mesaj participanților" (`DECISIONS.md` §NNN): the organizer writes to the people
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
 * apart in every number returned here. The club's copies follow the club's list for participant
 * messages (§320) because `enqueueEmail` does that for every participant message — nothing here
 * decides it.
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
      if (!AUDIENCE_STATUSES[audience].includes(row.status)) continue;
      if (row.kind === "TEST") counts[audience].test += row.count;
      else counts[audience].real += row.count;
    }
  }
  return counts;
}

export type SendParticipantMessageInput = {
  eventId: string;
  /** As posted; anything but one of the four choices is refused. */
  audience: string;
  subject: { ro?: string | null; en?: string | null };
  body: { ro?: string | null; en?: string | null };
  /**
   * The form's own id, minted when the page was drawn. A second press of the same form — a double
   * click, a retried request, the back button and Send again — carries the same id and queues
   * nothing: every row's key names it, and the audit row that records the send is looked for first.
   */
  sendId: string;
};

export type SendParticipantMessageResult =
  | { kind: "queued"; real: number; test: number }
  /** This form was sent already: nothing was queued a second time. */
  | { kind: "duplicate" }
  /** Nobody is in the chosen group right now. Nothing was queued, and nothing was audited. */
  | { kind: "nobody" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The boxes a refused message names, in the order the form shows them (§47). */
export function refusedBoxes(message: ReturnType<typeof checkOrganizerMessage>): string[] {
  return message.issues.map((issue) => issue.box);
}

/**
 * Queue the message to everybody in the chosen group.
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
  if (!isParticipantMessageAudience(input.audience)) {
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
  const audience = input.audience;
  // A posted id that is not a uuid names no event; asking Postgres would be a syntax error, not an answer.
  if (!UUID.test(input.eventId)) throw new DomainError("NOT_FOUND", "no such event");

  return db.transaction(async (tx) => {
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

    const rows = await tx
      .select({
        registrationId: registrations.id,
        participantId: registrations.participantId,
        kind: registrations.kind,
        locale: registrations.locale,
        recipientEmail: participants.deliveryEmail,
      })
      .from(registrations)
      .innerJoin(participants, eq(participants.id, registrations.participantId))
      .where(and(eq(registrations.eventId, input.eventId), inArray(registrations.status, [...AUDIENCE_STATUSES[audience]])));
    if (rows.length === 0) return { kind: "nobody" } as const;

    let real = 0;
    let test = 0;
    for (const row of rows) {
      const inserted = await enqueueEmail(tx, {
        participantId: row.participantId,
        registrationId: row.registrationId,
        messageType: "ORGANIZER_MESSAGE",
        locale: row.locale,
        recipientEmail: row.recipientEmail,
        // The words, both languages of both, and nothing about anybody (§14.5): no token, no body
        // rendered, no address beyond the row's own.
        payload: { subject: { ro: message.subject.ro, en: message.subject.en }, body: { ro: message.body.ro, en: message.body.en } },
        idempotencyKey: `organizer-message:${input.sendId}:registration:${row.registrationId}`,
        requestedByStaffUserId: actor.id,
        now,
      });
      if (!inserted) continue;
      if (row.kind === "TEST") test += 1;
      else real += 1;
    }
    if (real + test === 0) return { kind: "duplicate" } as const;

    await recordAuditEvent(tx, {
      actorStaffUserId: actor.id,
      action: "event.participant_message_sent",
      entityType: "event",
      entityId: input.eventId,
      // Who (the actor), the group, the counts and the subject — never who received it, and never
      // the body (§12.12). The send's id is what makes a second press find this row.
      metadata: { sendId: input.sendId, audience, recipients: real, test, subject: { ro: message.subject.ro, en: message.subject.en } },
      now,
    });
    return { kind: "queued", real, test } as const;
  });
}

export type SentParticipantMessage = {
  at: Date;
  subject: { ro: string; en: string };
  audience: ParticipantMessageAudience | null;
  recipients: number;
  test: number;
  /** The sender's name, or null when their staff account has since been removed. */
  senderName: string | null;
};

/**
 * "Mesaje trimise": the event's sends, newest first, read from their audit rows — the date, the
 * subject, the group, how many and who. Nothing here says who received one; the rows never did.
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
  return rows.map((row) => {
    const metadata = (row.metadata ?? {}) as { audience?: unknown; recipients?: unknown; test?: unknown; subject?: { ro?: unknown; en?: unknown } };
    const words = (value: unknown) => (typeof value === "string" ? value : "");
    return {
      at: row.at,
      subject: { ro: words(metadata.subject?.ro), en: words(metadata.subject?.en) },
      audience: isParticipantMessageAudience(metadata.audience) ? metadata.audience : null,
      recipients: typeof metadata.recipients === "number" ? metadata.recipients : 0,
      test: typeof metadata.test === "number" ? metadata.test : 0,
      senderName: row.senderName ?? null,
    };
  });
}

/** The made-up runner every preview is addressed to, and the number she holds. */
export const PREVIEW_PARTICIPANT = { name: "Ana Popescu", bibNumber: 42 } as const;

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
 * now, in both languages, and a made-up runner (`PREVIEW_PARTICIPANT`); nothing is queued and no
 * token exists, so nothing in it can be acted on. Empty boxes preview as the platform's fallback
 * subject and an absent body, which is what a send would refuse.
 */
export async function previewParticipantMessage<T extends Record<string, unknown>>(
  db: Database<T>,
  actor: Pick<StaffUser, "id" | "role">,
  input: { eventId: string; locale: Locale; subject: { ro?: string | null; en?: string | null }; body: { ro?: string | null; en?: string | null } },
): Promise<ParticipantMessagePreview> {
  if (!canMessageParticipants(actor.role)) {
    throw new DomainError("FORBIDDEN", `role ${actor.role} may not write to an event's participants`);
  }
  if (!UUID.test(input.eventId)) throw new DomainError("NOT_FOUND", "no such event");
  const locale = input.locale;
  const other: Locale = locale === "ro" ? "en" : "ro";
  const [details, otherDetails] = await Promise.all([
    findEventNotificationDetails(db, input.eventId, locale),
    findEventNotificationDetails(db, input.eventId, other),
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

  const data: TemplateData = {
    participantName: PREVIEW_PARTICIPANT.name,
    bibNumber: PREVIEW_PARTICIPANT.bibNumber,
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
    replyTo: env.EMAIL_REPLY_TO ?? undefined,
    ...(words.subject[locale] ? { organizerSubject: words.subject[locale] } : {}),
    ...(words.subject[other] ? { organizerSubjectOther: words.subject[other] } : {}),
    ...(words.body[locale] ? { organizerBody: words.body[locale] } : {}),
    ...(words.body[other] ? { organizerBodyOther: words.body[other] } : {}),
  };
  const rendered = renderBilingual("ORGANIZER_MESSAGE", locale, data, eventUrl);
  const unknown = [
    ...new Set([words.subject.ro, words.subject.en, words.body.ro, words.body.en].flatMap((value) => unknownOrganizerPlaceholders(value))),
  ];
  return { subject: rendered.subject, html: rendered.html, unknown };
}
