import { eq } from "drizzle-orm";
import { events } from "@/db/schema/events";
import { newsletterSends, newsletterSubscribers } from "@/db/schema/newsletter";
import { formatDay } from "@/i18n/dates";
import { getPathname } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import type { OutgoingEmail } from "@/infrastructure/email/adapter";
import { currentDeadlines } from "@/modules/deadlines/deadlines";
import { placeToBeAnnouncedWords } from "@/modules/events/calendar-labels";
import { type EventNotificationRow, eventNotificationDetailsIn } from "@/modules/events/repository";
import { bulkCopyRecipients, isClubCopy } from "@/modules/notifications/domain/club-notices";
import { DEFAULT_TOKEN_HOURS } from "@/modules/notifications/domain/token-lifetime";
import { emailEventFacts } from "@/modules/notifications/event-facts-row";
import { readEmailCopyForSending } from "@/modules/notifications/email-copy";
import { renderCalendarPart } from "@/modules/notifications/calendar-part";
import { type EmailRenderer, OutboxMessageWithdrawn, type OutboxRow } from "@/modules/notifications/outbox";
import { checkRsvpAsk, makeRsvpAsk, type PreparedRsvpAsk } from "@/modules/rsvp/ask";
import { buildOutgoingEmail, type TemplateData } from "@/modules/notifications/templates";
import { env } from "@/shared/config/env";
import { readNewsletterWords } from "./domain/message";
import { normalizeTopics } from "./domain/topics";
import { topicsPhrase } from "./topic-words";
import { issueNewsletterToken, NEWSLETTER_MANAGE_LINK_DAYS, NEWSLETTER_MANAGE_REQUEST } from "./tokens";

type RendererDb = Parameters<EmailRenderer>[1];

/**
 * The newsletter's three messages as they leave (§445): `render.ts` hands every row of these types
 * here. None is about a registration and none has a participant: the row names its subscriber —
 * and the send, and the event — by id in the payload, and the links are minted now, at send time,
 * like every link (§14.5): a fresh one per message, the secret in this message alone.
 *
 * A subscriber gone by the time the row is sent (unsubscribed while it was being claimed — their
 * waiting rows are deleted with them) has nobody to write to: the render fails and the row is
 * marked so, and nothing leaves.
 *
 * A new-event alert is read against its event again as it leaves: a bulk row may wait a day or a
 * month for the allowance, and an event cancelled, taken down or started in the meantime is no
 * news — the row is withdrawn (`OutboxMessageWithdrawn`), not failed (§331: a cancelled event goes quiet).
 *
 * **«Vii mâine la …?» (§NNN)** is the fourth message here: to a subscriber, about an event, with two personal links instead of one
 * button. The renderer makes the subscriber's «Vin!» row and mints both links (`prepareRsvpAsk`, §14.5), writes the event's facts as
 * the alert does, and carries the event's calendar file as the confirmation of an answer does. It has no club copy and no allowance
 * rule: it is the question of one day, and a send that arrives after the start is withdrawn.
 *
 * The club's one copy of a send (`clubCopy`, §419's shape) has no subscriber: the same words, the
 * count, no topics line and no link of anybody's.
 *
 * `replyTo` is the Reply-To in force (§442, «Adresa de contact afișată»), the one the outbox's
 * renderer hands every message; absent, `EMAIL_REPLY_TO`.
 */
export async function renderNewsletterRow(
  row: OutboxRow,
  db: RendererDb,
  now: Date,
  eventRows: (db: RendererDb, eventId: string) => Promise<readonly EventNotificationRow[]>,
  replyTo: string | undefined = env.EMAIL_REPLY_TO ?? undefined,
): Promise<OutgoingEmail> {
  const locale = row.locale as Locale;
  const other: Locale = locale === "ro" ? "en" : "ro";
  const payload = (row.payloadJson ?? {}) as { subscriberId?: unknown; sendId?: unknown; eventId?: unknown };
  let attachments: OutgoingEmail["attachments"];
  const clubCopy = isClubCopy(row.payloadJson) && row.messageType !== "NEWSLETTER_CONFIRM";
  const eventId = typeof payload.eventId === "string" ? payload.eventId : null;

  if (row.messageType === "NEW_EVENT_ALERT") {
    const [event] = eventId
      ? await db
          .select({ editorialStatus: events.editorialStatus, eventStatus: events.eventStatus, startsAt: events.startsAt, dateToBeAnnounced: events.dateToBeAnnounced, timeToBeAnnounced: events.timeToBeAnnounced, membersOnly: events.membersOnly })
          .from(events)
          .where(eq(events.id, eventId))
          .limit(1)
      : [];
    if (!event) throw new OutboxMessageWithdrawn("newsletter: the event is gone");
    if (event.editorialStatus !== "PUBLISHED" || event.eventStatus !== "SCHEDULED" || event.startsAt.getTime() <= now.getTime()) {
      throw new OutboxMessageWithdrawn("newsletter: the event is no longer news");
    }
    // Queued while it had a date, and the date was since held back (§533): the alert would say a date
    // the club withdrew. Withdrawn; the event is announced again once its date is.
    if (event.dateToBeAnnounced || event.timeToBeAnnounced) throw new OutboxMessageWithdrawn("newsletter: the event's start is to be announced");
    // Queued while it was public, and made the members' alone since (§552): withdrawn, never sent.
    if (event.membersOnly) throw new OutboxMessageWithdrawn("newsletter: the event is for the club's members alone");
  }

  const subscriberId = typeof payload.subscriberId === "string" ? payload.subscriberId : null;
  const asking = row.messageType === "RSVP_ASK";
  if (asking && (!eventId || !subscriberId)) throw new Error("rsvp ask: the message names no event or no subscriber");
  const [subscriber] = !clubCopy && subscriberId
    ? await db.select().from(newsletterSubscribers).where(eq(newsletterSubscribers.id, subscriberId)).limit(1)
    : [];
  // A question for a subscriber who has gone since is no question (§331: withdrawn, not failed).
  if (!clubCopy && !subscriber) {
    if (asking) throw new OutboxMessageWithdrawn("rsvp ask: the subscriber is no longer on the list");
    throw new Error("newsletter: the subscriber is no longer on the list");
  }

  const settings = await currentDeadlines(db);
  const overrides = await readEmailCopyForSending(db, now);
  const topics = subscriber ? normalizeTopics(subscriber.topics) : [];
  const data: TemplateData = {
    participantName: "",
    ...(subscriber ? { newsletterTopics: topicsPhrase(locale, topics), newsletterTopicsOther: topicsPhrase(other, topics) } : {}),
    replyTo,
    eventsUrl: `${env.APP_BASE_URL}${getPathname({ locale, href: "/events" })}`,
    contactUrl: `${env.APP_BASE_URL}${getPathname({ locale, href: "/contact" })}`,
    timings: {
      confirmationHours: settings.confirmationHours,
      holdMinutes: settings.holdMinutes,
      offerHours: settings.offerHours,
      reminderHours: settings.reminderHours,
      linkDays: DEFAULT_TOKEN_HOURS / 24,
    },
  };
  if (clubCopy) {
    data.clubCopy = true;
    const count = bulkCopyRecipients(row.payloadJson);
    if (count !== null) data.clubCopyRecipients = count;
  }
  // No link of anybody's on the club's copy (§320): the manage link is minted for a subscriber alone.
  const manageUrl = async (): Promise<string | undefined> => {
    if (!subscriber) return undefined;
    const secret = await issueNewsletterToken(db, {
      subscriberId: subscriber.id,
      purpose: "MANAGE",
      expiresAt: new Date(now.getTime() + NEWSLETTER_MANAGE_LINK_DAYS * 24 * 60 * 60_000),
      now,
    });
    return `${env.APP_BASE_URL}${getPathname({ locale, href: { pathname: "/newsletter/manage/[token]", params: { token: secret } } })}`;
  };

  let actionUrl: string | undefined;
  if (row.messageType === "NEWSLETTER_CONFIRM") {
    if (!subscriber) throw new Error("newsletter: a confirmation has a subscriber");
    if (subscriber.confirmedAt !== null) {
      // Already subscribed: nothing to confirm, and the owner of the address changes things there.
      data.newsletterAlready = true;
      // Asked for from «Vreau să mă dezabonez» (§550): the same link, words that say what was asked.
      if ((payload as { request?: unknown }).request === NEWSLETTER_MANAGE_REQUEST) data.newsletterManageRequest = true;
      actionUrl = await manageUrl();
    } else {
      // The double opt-in's link, for the club's email-link window (§377), superseding the last one.
      const secret = await issueNewsletterToken(db, {
        subscriberId: subscriber.id,
        purpose: "CONFIRM",
        expiresAt: new Date(now.getTime() + settings.confirmationHours * 60 * 60_000),
        now,
      });
      actionUrl = `${env.APP_BASE_URL}${getPathname({ locale, href: { pathname: "/newsletter/confirm/[token]", params: { token: secret } } })}`;
    }
  } else if (row.messageType === "NEWSLETTER") {
    // Never to an address that has not confirmed, whatever a hand-made row says.
    if (subscriber && subscriber.confirmedAt === null) throw new Error("newsletter: the address never confirmed");
    const sendId = typeof payload.sendId === "string" ? payload.sendId : null;
    const [send] = sendId ? await db.select().from(newsletterSends).where(eq(newsletterSends.id, sendId)).limit(1) : [];
    const words = send ? readNewsletterWords(send.subject, send.body) : null;
    if (!words) throw new Error("newsletter: the send's words cannot be read");
    data.newsletterSubject = words.subject[locale];
    data.newsletterSubjectOther = words.subject[other];
    // The editor's document since §550, or the plain text an older send stored — each half its own.
    const mine = words.body[locale];
    const theirs = words.body[other];
    if (typeof mine === "string") data.newsletterBody = mine;
    else data.newsletterBodyDoc = mine;
    if (typeof theirs === "string") data.newsletterBodyOther = theirs;
    else data.newsletterBodyDocOther = theirs;
    data.newsletterManageUrl = await manageUrl();
  } else {
    if (subscriber && subscriber.confirmedAt === null) throw new Error("newsletter: the address never confirmed");
    // «Vii mâine la …?»: every reason to drop the message is read first, with nothing written (`rsvp/ask.ts`); the writing is the last step.
    const checked = asking && eventId && subscriberId ? await checkRsvpAsk(db, { eventId, subscriberId, recipientEmail: row.recipientEmail, now }) : null;
    const texts = eventId ? await eventRows(db, eventId) : [];
    const details = eventNotificationDetailsIn(texts, locale);
    if (!details) {
      if (asking) throw new OutboxMessageWithdrawn("rsvp ask: the event cannot be read");
      throw new Error("newsletter: the event cannot be read");
    }
    const otherDetails = texts.find((candidate) => candidate.locale === other);
    const placeLater = details.locationToBeAnnounced === true;
    const when = (language: Locale) =>
      formatDay(details.startsAt, { locale: language, timeZone: details.timezone, style: "long", withTime: true, position: "inline" });
    data.eventTitle = details.title;
    if (otherDetails) data.eventTitleOther = otherDetails.title;
    data.eventStartsAtFormatted = when(locale);
    data.eventStartsAtFormattedOther = when(other);
    data.eventLocationName = placeLater ? placeToBeAnnouncedWords(locale) : (details.locationName ?? undefined);
    data.eventLocationNameOther = placeLater ? placeToBeAnnouncedWords(other) : (otherDetails?.locationName ?? details.locationNames[other] ?? undefined);
    data.eventChecklist = details.checklist ?? undefined;
    if (otherDetails) data.eventChecklistOther = otherDetails.checklist ?? null;
    data.eventMapUrl = details.mapUrl ?? undefined;
    data.eventStravaEventUrl = details.stravaEventUrl ?? undefined;
    const pageOf = (language: Locale, slug: string | null | undefined) =>
      slug ? `${env.APP_BASE_URL}${getPathname({ locale: language, href: { pathname: "/events/[slug]", params: { slug } } })}` : null;
    data.eventUrl = pageOf(locale, details.slug) ?? undefined;
    /*
      The event's facts block (§392), as the confirmed email and the reminder carry it: Când, Unde,
      Program, Traseu, Cost, Linkuri — each half from its own language's row and page, through the
      one function those messages use, so an alert cannot describe the event differently. It takes
      the place of the bold date-and-place line (`templates.ts`, `EVENT_FACTS_MESSAGES`).
    */
    data.eventFacts = emailEventFacts(details, data.eventUrl ?? null);
    if (otherDetails) data.eventFactsOther = emailEventFacts(otherDetails, pageOf(other, otherDetails.slug));
    actionUrl = data.eventUrl;
    data.newsletterManageUrl = await manageUrl();
    if (checked) {
      // The event in the person's calendar, the same file the event's page offers (§174): so the day is there whichever they answer.
      if (details.slug) {
        const carried = await renderCalendarPart(db, {
          part: "file",
          locale,
          slug: details.slug,
          now,
          rsvpTo: null,
          sequence: details.calendarSequence,
          attendee: { email: row.recipientEmail },
        });
        attachments = carried.attachments;
      }
      /*
        LAST, once every other read has succeeded: this writes the person's «Vin!» row and mints the two links (`rsvp/ask.ts`, AGENTS.md
        §14.5), and a failure after it would leave live hashes that no email carries. The reasons to drop the message were read first
        (`checkRsvpAsk`), so the reads that can find the subscriber or the event gone drop it too, not fail it.
      */
      const asked: PreparedRsvpAsk = await makeRsvpAsk(db, checked);
      // The two buttons are the answer's own links: «Vin» (the confirm link) and, under it, «Nu vin» (the withdraw link).
      const tokenPage = (secret: string) => `${env.APP_BASE_URL}${getPathname({ locale, href: { pathname: "/vin/[token]", params: { token: secret } } })}`;
      actionUrl = tokenPage(asked.confirm);
      data.rsvpWithdrawUrl = tokenPage(asked.withdraw);
    }
  }

  return buildOutgoingEmail({
    to: row.recipientEmail,
    locale,
    idempotencyKey: row.idempotencyKey,
    messageType: row.messageType,
    data,
    actionUrl,
    attachments,
    overrides,
  });
}
