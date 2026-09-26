import { eq } from "drizzle-orm";
import { newsletterSends, newsletterSubscribers } from "@/db/schema/newsletter";
import { formatDay } from "@/i18n/dates";
import { getPathname } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import type { OutgoingEmail } from "@/infrastructure/email/adapter";
import { currentDeadlines } from "@/modules/deadlines/deadlines";
import { placeToBeAnnouncedWords } from "@/modules/events/calendar-labels";
import { type EventNotificationRow, eventNotificationDetailsIn } from "@/modules/events/repository";
import { DEFAULT_TOKEN_HOURS } from "@/modules/notifications/domain/token-lifetime";
import { readEmailCopyForSending } from "@/modules/notifications/email-copy";
import type { EmailRenderer, OutboxRow } from "@/modules/notifications/outbox";
import { buildOutgoingEmail, type TemplateData } from "@/modules/notifications/templates";
import { env } from "@/shared/config/env";
import { readNewsletterWords } from "./domain/message";
import { normalizeTopics } from "./domain/topics";
import { topicsPhrase } from "./topic-words";
import { issueNewsletterToken, NEWSLETTER_MANAGE_LINK_DAYS } from "./tokens";

type RendererDb = Parameters<EmailRenderer>[1];

/**
 * The newsletter's three messages as they leave (§NNN): `render.ts` hands every row of these types
 * here. None is about a registration and none has a participant: the row names its subscriber —
 * and the send, and the event — by id in the payload, and the links are minted now, at send time,
 * like every link (§14.5): a fresh one per message, the secret in this message alone.
 *
 * A subscriber gone by the time the row is sent (unsubscribed while it was being claimed — their
 * waiting rows are deleted with them) has nobody to write to: the render fails and the row is
 * marked so, and nothing leaves.
 */
export async function renderNewsletterRow(
  row: OutboxRow,
  db: RendererDb,
  now: Date,
  eventRows: (db: RendererDb, eventId: string) => Promise<readonly EventNotificationRow[]>,
): Promise<OutgoingEmail> {
  const locale = row.locale as Locale;
  const other: Locale = locale === "ro" ? "en" : "ro";
  const payload = (row.payloadJson ?? {}) as { subscriberId?: unknown; sendId?: unknown; eventId?: unknown };
  const subscriberId = typeof payload.subscriberId === "string" ? payload.subscriberId : null;
  const [subscriber] = subscriberId
    ? await db.select().from(newsletterSubscribers).where(eq(newsletterSubscribers.id, subscriberId)).limit(1)
    : [];
  if (!subscriber) throw new Error("newsletter: the subscriber is no longer on the list");

  const settings = await currentDeadlines(db);
  const topics = normalizeTopics(subscriber.topics);
  const data: TemplateData = {
    participantName: "",
    newsletterTopics: topicsPhrase(locale, topics),
    newsletterTopicsOther: topicsPhrase(other, topics),
    replyTo: env.EMAIL_REPLY_TO ?? undefined,
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
  const manageUrl = async () => {
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
    if (subscriber.confirmedAt !== null) {
      // Already subscribed: nothing to confirm, and the owner of the address changes things there.
      data.newsletterAlready = true;
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
    if (subscriber.confirmedAt === null) throw new Error("newsletter: the address never confirmed");
    const sendId = typeof payload.sendId === "string" ? payload.sendId : null;
    const [send] = sendId ? await db.select().from(newsletterSends).where(eq(newsletterSends.id, sendId)).limit(1) : [];
    const words = send ? readNewsletterWords(send.subject, send.body) : null;
    if (!words) throw new Error("newsletter: the send's words cannot be read");
    data.newsletterSubject = words.subject[locale];
    data.newsletterSubjectOther = words.subject[other];
    data.newsletterBody = words.body[locale];
    data.newsletterBodyOther = words.body[other];
    data.newsletterManageUrl = await manageUrl();
  } else {
    if (subscriber.confirmedAt === null) throw new Error("newsletter: the address never confirmed");
    const eventId = typeof payload.eventId === "string" ? payload.eventId : null;
    const texts = eventId ? await eventRows(db, eventId) : [];
    const details = eventNotificationDetailsIn(texts, locale);
    if (!details) throw new Error("newsletter: the event cannot be read");
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
    data.eventUrl = details.slug
      ? `${env.APP_BASE_URL}${getPathname({ locale, href: { pathname: "/events/[slug]", params: { slug: details.slug } } })}`
      : undefined;
    actionUrl = data.eventUrl;
    data.newsletterManageUrl = await manageUrl();
  }

  return buildOutgoingEmail({
    to: row.recipientEmail,
    locale,
    idempotencyKey: row.idempotencyKey,
    messageType: row.messageType,
    data,
    actionUrl,
    overrides: await readEmailCopyForSending(db, now),
  });
}
