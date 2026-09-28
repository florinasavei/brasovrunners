import CalendarPage from "../../calendar/page";

/**
 * The calendar's live twin (§NNN, amending §333): the same page, rendered per request, for a visit
 * that names a month, a year, a layout or a filter (`?month=2026-11`, `?view=list`, `?type=RACE`) —
 * which the static calendar, this month for everyone, cannot answer from the CDN. The proxy
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
