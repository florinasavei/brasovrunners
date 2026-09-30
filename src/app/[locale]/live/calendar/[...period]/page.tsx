import CalendarPeriodPage from "../../../calendar/[...period]/page";

/**
 * A calendar period's live twin (§549, §NNN): the same page, rendered per request, for a visit to a
 * period's path that names a filter (`/ro/calendar/2026-10?type=RACE`) — which the static period
 * page, the same for everyone, cannot answer from the CDN. The proxy rewrites such a visit here and
 * the address is unchanged (`i18n/live-twin.ts`). Its metadata is the calendar's own, canonical to
 * the bare calendar (§342).
 */
export const dynamic = "force-dynamic";

export { generateMetadata } from "../../../calendar/page";

type Props = {
  params: Promise<{ locale: string; period: string[] }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default function LiveCalendarPeriodPage({ params, searchParams }: Props) {
  return <CalendarPeriodPage params={params} query={searchParams} />;
}
