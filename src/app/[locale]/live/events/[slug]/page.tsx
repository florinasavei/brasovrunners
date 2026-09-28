import { unstable_rethrow } from "next/navigation";
import type { Metadata } from "next";
import EventDetailPage, { generateMetadata as eventMetadata } from "../../../events/[slug]/page";
import { absoluteUrl } from "@/modules/events/share-links";
import { SHARE_SHAPES } from "@/modules/events/share-image";
import { canEditTexts } from "@/modules/staff-identity/domain/roles";
import { getCurrentStaffUser } from "@/modules/staff-identity/session";
import { env } from "@/shared/config/env";

/**
 * An event page's live twin (§NNN, amending §333): the same page, rendered per request, for a
 * visit the static copy cannot answer — an address that asks something (`?lista=2`, `?interest=1`,
 * `?declaratie=…`) or a reader with a session cookie, who may be staff and get the "edit in the
 * backoffice" button (§135). The proxy rewrites such a visit here; the address is unchanged
 * (`i18n/live-twin.ts`). Its metadata is the event page's own, canonical to the bare address (§342).
 */
export const dynamic = "force-dynamic";

/**
 * The event page's own metadata, plus its Open Graph picture: Next writes `og:image` only for the
 * segment that holds the `opengraph-image` file, and this twin is a segment of its own — without
 * the line below a link shared as `?lista=2` or read by a crawler with a cookie would carry the
 * locale's picture, not the event's.
 */
export async function generateMetadata(props: MetadataProps): Promise<Metadata> {
  const metadata = await eventMetadata(props);
  if (!metadata.openGraph) return metadata;
  const { locale, slug } = await props.params;
  return {
    ...metadata,
    openGraph: {
      ...metadata.openGraph,
      images: [{ url: absoluteUrl(env.APP_BASE_URL, `/${locale}/events/${slug}/opengraph-image`), ...SHARE_SHAPES.og, type: "image/png" }],
    },
  };
}

type MetadataProps = Parameters<typeof eventMetadata>[0];

type Props = {
  params: Promise<{ locale: string; slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function LiveEventDetailPage({ params, searchParams }: Props) {
  const staffUser = env.STAFF_AUTH_MODE === "disabled" ? null : await readStaffUserOrNone();
  return <EventDetailPage params={params} query={searchParams} canEdit={staffUser !== null && canEditTexts(staffUser.role)} />;
}

/**
 * Who is signed in, or nobody, when the answer needs a database that is not there (§281).
 *
 * The session read is what puts "edit in the backoffice" on the page for staff. During an outage
 * a visitor must still get the page, and a staff member losing a shortcut for a few minutes is
 * not a failure worth a blank screen — they can reach the editor from `/admin`, which is not
 * served from a copy and will tell them plainly that the database is away.
 */
async function readStaffUserOrNone(): Promise<Awaited<ReturnType<typeof getCurrentStaffUser>> | null> {
  try {
    return await getCurrentStaffUser();
  } catch (error) {
    unstable_rethrow(error);
    return null;
  }
}
