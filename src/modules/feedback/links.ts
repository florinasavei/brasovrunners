import type { Database } from "@/db/types";
import { getPathname } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { toWallTimeInput } from "@/modules/events/domain/zoned-time";
import { noticeDescribesFeedbackForms } from "@/modules/legal-documents/repository";
import { contactSmtpRoadExists } from "@/modules/contact/delivery";
import { env } from "@/shared/config/env";
import { feedbackQueryFor, offeredBranches } from "./domain/branches";
import { readFeedbackSettingsMemo } from "./settings";

/**
 * The ways into «Cum a fost» (§676): the thank-you email's button, the organizer's `{feedbackLink}`
 * and the event page's button after the end — each only while the branch is offered (switched on,
 * a recipient, the notice in force describing the forms), each with the event and its day filled in.
 * Read at send time, as every message reads its facts then.
 */

/** Half a minute: a batch of thank-yous asks once, not once per runner. */
const MEMO_MS = 30_000;
const memo = new WeakMap<object, { at: number; open: boolean }>();

/** Whether «Cum a fost» is open right now — the setting and the notice, memoized per database. */
export async function howItWentOpen<T extends Record<string, unknown>>(db: Database<T>, now: Date): Promise<boolean> {
  const held = memo.get(db);
  if (held && now.getTime() - held.at >= 0 && now.getTime() - held.at < MEMO_MS) return held.open;
  const [settings, described] = await Promise.all([readFeedbackSettingsMemo(db, now), noticeDescribesFeedbackForms(db, now)]);
  const open = offeredBranches(settings, described, contactSmtpRoadExists()).includes("howItWent");
  memo.set(db, { at: now.getTime(), open });
  return open;
}

/** Forget the memo — a test that switches the branch in one database, or a save on this instance. */
export function forgetFeedbackLinkMemo<T extends Record<string, unknown>>(db: Database<T>): void {
  memo.delete(db);
}

/** The event's day on its own clock, `YYYY-MM-DD` — the run of a series a person means. */
export function eventDay(startsAt: Date | null | undefined, timeZone: string): string | null {
  if (!(startsAt instanceof Date) || Number.isNaN(startsAt.getTime())) return null;
  return toWallTimeInput(startsAt, timeZone).slice(0, 10) || null;
}

/** «Cum a fost» for one event and day, absolute from `APP_BASE_URL` (AGENTS.md §8), in one language. */
export function howItWentUrl(locale: Locale, eventSlug: string | null, date: string | null): string {
  return `${env.APP_BASE_URL}${getPathname({ locale, href: { pathname: "/contact/feedback", query: feedbackQueryFor(eventSlug, date) } })}`;
}
