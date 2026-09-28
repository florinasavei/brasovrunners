import { NextResponse } from "next/server";
import { getTranslations } from "next-intl/server";
import { getDb } from "@/db/client";
import { CLUB_TIME_ZONE } from "@/i18n/dates";
import { routing, type Locale } from "@/i18n/routing";
import { recordAuditEvent } from "@/modules/audit/repository";
import { parseSubscriberListQuery } from "@/modules/newsletter/domain/subscriber-list";
import { buildSubscribersCsv, subscribersCsvFileName } from "@/modules/newsletter/subscribers-csv";
import { listNewsletterSubscribers } from "@/modules/newsletter/subscribers";
import { topicWords } from "@/modules/newsletter/topic-words";
import { canSendNewsletter } from "@/modules/staff-identity/domain/roles";
import { requireStaff } from "@/modules/staff-identity/session";
import { isDomainError } from "@/shared/errors/domain-error";

/** Every subscriber under the filter, not the table's first rows: the file is the whole answer. */
const CSV_LIMIT = 100_000;

/**
 * «Descarcă CSV» on the newsletter's «Abonați» card (§NNN, amending §445): the filter the list shows
 * (`q`, `topic`, `state`), in the reader's language (`lang`), as a UTF-8 file with a BOM.
 *
 * Whoever reads the list may take it — `canSendNewsletter`, the page's own gate, asserted here
 * again (BR-REQ-060-01): a volunteer, the Redactor, Tehnic and a member are refused whatever the
 * link. Nothing is written on the server; the response is the file. The download is recorded as the
 * registrations export is (§322) — who, the filter's shape and how many rows, never an address —
 * because a file that leaves the site is the one copy an unsubscribe cannot reach.
 */
export async function GET(request: Request): Promise<Response> {
  let actor;
  try {
    actor = await requireStaff();
  } catch (error) {
    if (isDomainError(error)) return NextResponse.json({ error: error.code }, { status: 401 });
    throw error;
  }
  if (!canSendNewsletter(actor.role)) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  const url = new URL(request.url);
  const lang = url.searchParams.get("lang");
  const locale: Locale = (routing.locales as readonly string[]).includes(lang ?? "") ? (lang as Locale) : routing.defaultLocale;
  const query = parseSubscriberListQuery(Object.fromEntries(url.searchParams));
  const now = new Date();
  const db = getDb();
  const list = await listNewsletterSubscribers(db, query, now, CSV_LIMIT);

  const t = await getTranslations({ locale, namespace: "Admin" });
  const words = topicWords(locale);
  const csv = buildSubscribersCsv(
    {
      email: t("newsletter.subscribers.columns.email"),
      language: t("newsletter.subscribers.columns.language"),
      topics: t("newsletter.subscribers.columns.topics"),
      state: t("newsletter.subscribers.columns.state"),
      subscribed: t("newsletter.subscribers.columns.since"),
      confirmed: t("newsletter.subscribers.columns.confirmedOn"),
    },
    list.rows.map((row) => ({
      email: row.email,
      language: row.locale.toUpperCase(),
      topics: row.topics.map((topic) => words[topic]).join("; "),
      state: t(row.confirmedAt ? "newsletter.subscribers.states.confirmed" : "newsletter.subscribers.states.pending"),
      subscribedAt: row.createdAt,
      confirmedAt: row.confirmedAt,
    })),
  );

  await recordAuditEvent(db, {
    actorStaffUserId: actor.id,
    action: "newsletter.subscribers_exported",
    entityType: "newsletter",
    entityId: null,
    metadata: { searched: query.q !== "", topic: query.topic, state: query.state, rowCount: list.rows.length },
    now,
  });

  const day = new Intl.DateTimeFormat("en-CA", { timeZone: CLUB_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${subscribersCsvFileName(day)}"`,
      "X-Robots-Tag": "noindex",
      "Cache-Control": "private, no-store",
    },
  });
}
