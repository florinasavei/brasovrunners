import EventsPage from "../../events/page";

/**
 * The listing's live twin (§549, amending §333): the same page, rendered per request, for a visit
 * whose address asks something — a filter (`?type=RACE`, §413), `?view=` — which the static
 * listing cannot answer from the CDN. The proxy rewrites such a visit here; the address the
 * visitor sees is `/ro/evenimente?type=RACE` as before (`i18n/live-twin.ts`). Its metadata is the
 * listing's own, canonical to the bare listing (§342).
 */
export const dynamic = "force-dynamic";

export { generateMetadata } from "../../events/page";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default function LiveEventsPage({ params, searchParams }: Props) {
  return <EventsPage params={params} query={searchParams} />;
}
