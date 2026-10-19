import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { notFound } from "next/navigation";
import { permanentRedirect } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { parseZoneRsvpOutcome } from "@/modules/rsvp/domain/zone-outcome";

type Props = { params: Promise<{ locale: string }>; searchParams?: Promise<{ vin?: string | string[] }> };

/** Reads its address's query, so it is never prerendered (AGENTS.md §14.5). */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  // Behind the sign-in, like the zone itself: never indexed. The proxy says so as a header too (`private-paths.ts`).
  robots: { index: false, follow: false },
};

/**
 * The runs' old address (§715), kept so no link made before the zone opened on «Alergări» breaks: a permanent redirect (308) to the
 * zone's own address, `/members-area`, which now draws the runs (`page.tsx`). It says nothing and asks nothing of the visitor — the zone
 * asserts its own door (`openZone`, BR-REQ-060-01) — and carries the one thing an address of this kind may carry, the code of what a
 * press said (`?vin=`, `zone-outcome.ts`), so a page left open on the old address still lands on its sentence. The anchor (`#vin-…`)
 * is the browser's own and survives the redirect.
 */
export default async function MembersRunsMovedPage({ params, searchParams }: Props) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  const vin = parseZoneRsvpOutcome((await searchParams)?.vin);
  permanentRedirect({ locale, href: vin === null ? "/members-area" : { pathname: "/members-area", query: { vin } } });
}
