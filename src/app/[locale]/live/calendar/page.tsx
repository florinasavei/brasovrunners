import CalendarPage from "../../calendar/page";

/**
 * The calendar's live twin (§549, amending §333): the same page, rendered per request, for a visit
 * to the bare calendar that names a filter (`?type=RACE`) — which the static calendar, this month
 * for everyone, cannot answer from the CDN. A month, a year or the list is a path of its own since
 * §NNN (`/ro/calendar/2026-10`), and the old `?month=`, `?year=` and `?view=list` are a 308 there
 * from the proxy before this is asked; a filter on a period's path is
 * `live/calendar/[...period]/page.tsx`. The proxy
 * rewrites such a visit here and the address is unchanged (`i18n/live-twin.ts`). Its metadata is the
 * calendar's own, canonical to the bare calendar (§342).
 */
export const dynamic = "force-dynamic";

export { generateMetadata } from "../../calendar/page";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default function LiveCalendarPage({ params, searchParams }: Props) {
  return <CalendarPage params={params} query={searchParams} />;
}
