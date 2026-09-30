import CalendarPage from "../page";

/**
 * A period of the calendar at its own path (§NNN, amending §116, §137, §549): `/ro/calendar/2026-10`
 * is October, `/ro/calendar/2026-10/list` October as a list, `/ro/calendar/2026` the year. The same
 * page as the bare calendar, told its period by the path instead of the query
 * (`events/domain/calendar-path.ts` says why the query could not carry it).
 *
 * Static like the bare calendar: made on its first visit, kept by the CDN, expired by a write to
 * the events it shows and held to Brașov's midnight (§549) — so stepping a month is a CDN answer,
 * where the old `?month=` was the live twin's render per visit. Nothing is made at build. A filter
 * on a period (`?type=RACE`) is its live twin, `live/calendar/[...period]/page.tsx`; a malformed or
 * too distant period is a 404.
 */
export const revalidate = 86400;

export function generateStaticParams() {
  return [];
}

export { generateMetadata } from "../page";

type Props = {
  params: Promise<{ locale: string; period: string[] }>;
  /** The filters — passed only by the live twin, never read from Next's own props here (§549). */
  query?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function CalendarPeriodPage({ params, query }: Props) {
  const { period } = await params;
  return <CalendarPage params={params} query={query} period={period} />;
}
