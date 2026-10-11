import Box from "@mui/material/Box";
import MuiLink from "@mui/material/Link";
import Typography from "@mui/material/Typography";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { unstable_rethrow } from "next/navigation";
import { formatDay } from "@/i18n/dates";
import { getPathname } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { datedOrNull } from "@/modules/events/domain/dated";
import { groupSeries, seriesLookup } from "@/modules/events/domain/series";
import { membersOnlyEventsFor } from "@/modules/events/members-only";
import EventCard from "@/modules/events/ui/EventCard";
import CardMembershipIcon from "@mui/icons-material/CardMembership";
import { cachedUpcomingEvents } from "@/modules/public-cache/reads";
import { isDatabaseAwayError } from "@/modules/resilience/domain/database-away";
import { DENSITY } from "@/theme/density";
import ZoneFrame, { frameParts, openZone } from "../zone";

type Props = { params: Promise<{ locale: string }> };

/** Reads the session, so it is never prerendered or cached (AGENTS.md §14.5). */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  // Behind the sign-in: never indexed. The proxy says so as a header too (`private-paths.ts`).
  robots: { index: false, follow: false },
};

/**
 * The club's events for its members alone (§552): read here, per request, behind the account this
 * page asked for — live, never through the public cache, which is shared by everybody. Empty while
 * the database is away, like «Următoarele alergări».
 */
async function membersOnlyOrNone(account: Parameters<typeof membersOnlyEventsFor>[0], locale: Locale, now: Date) {
  try {
    return await membersOnlyEventsFor(account, locale, now);
  } catch (error) {
    unstable_rethrow(error);
    if (!isDatabaseAwayError(error)) throw error;
    return [];
  }
}

/** How many of the next runs the zone lists; the listing, one press away, has the rest. */
const UPCOMING_SHOWN = 5;

/**
 * «Următoarele alergări» (§524): the next published events, soonest first — the public listing's own
 * cached read (§333), so the zone costs the database nothing the listing has not already paid, and
 * shows nothing a stranger could not see. Empty while the database is away.
 */
async function upcomingOrNone(locale: Locale, now: Date) {
  try {
    const events = await cachedUpcomingEvents(locale, now);
    return [...events].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime()).slice(0, UPCOMING_SHOWN);
  } catch (error) {
    unstable_rethrow(error);
    if (!isDatabaseAwayError(error)) throw error;
    return [];
  }
}

/**
 * The members' zone, tab «Alergări» (§715, §524, §552): the events for members alone and the next
 * runs, at `/members-area/runs`. The club's words for members are the frame's, above the tabs
 * (`zone.tsx`); the door is `openZone`, asserted here as on every tab (BR-REQ-060-01).
 *
 * The door is the account, never the staff session: a member (`MEMBER`) and every colleague open it
 * (`canOpenMembersZone`). Signed out, the visitor is sent to the sign-in in the members' words
 * (`?to=members`), which lands back on the zone; where this deployment has no sign-in at all, the
 * answer is 404, the backoffice's rule — announcing a door with no lock invites looking for one.
 * The zone shows no way into the backoffice, not even to a colleague (§684).
 *
 * **Why here and not under `/admin` (§524).** The zone is a public-tree route with the site's own
 * header and footer, not a page inside the backoffice's shell: everything under `/admin` sits
 * behind `requireStaff` in its layout and is the area a member must never be let into. Here the
 * door is the account (`getCurrentAccount`), the page is `force-dynamic`, `noindex`, listed in
 * `private-paths.ts` and `robots.txt`.
 *
 * «Următoarele alergări»: the next published events, from the listing's own cached read (§333).
 */
export default async function MembersAreaPage({ params }: Props) {
  const opened = await openZone((await params).locale);
  if ("resting" in opened) return opened.resting;
  const { locale, account } = opened;

  const t = await getTranslations("Members");
  const now = new Date();
  const [parts, upcoming, membersEvents] = await Promise.all([frameParts(account, locale, now), upcomingOrNone(locale, now), membersOnlyOrNone(account, locale, now)]);
  /*
    A repeated members' run is one card with its dates, as on the listing (§113, §486): the dated
    ones grouped, those whose date is to be announced after them one by one — §533 refuses a series
    those, and `listMembersOnlyEvents` already puts them last.
  */
  const datedMembers = membersEvents.flatMap((event) => {
    const dated = datedOrNull(event);
    return dated ? [dated] : [];
  });
  const membersSeriesOf = seriesLookup(datedMembers);
  const membersCards = [
    ...groupSeries(datedMembers).map((series) => ({ key: series.key, event: series.members[0], dates: membersSeriesOf(series.members[0]) })),
    ...membersEvents.filter((event) => event.startsAt === null).map((event) => ({ key: event.id, event, dates: undefined })),
  ];

  return (
    <ZoneFrame t={t} locale={locale} account={account} active="runs" parts={parts}>
      {/*
        «Evenimente pentru membri» (§552): the club's events for its members alone, upcoming first,
        on the listing's own card with its door — the register button included. Nowhere else on the
        site. Nothing when there is none.
      */}
      {membersEvents.length > 0 && (
        <Box component="section" aria-labelledby="members-events-title" sx={{ mb: { xs: DENSITY.sectionGap, sm: 3 } }} data-testid="members-events">
          <Typography id="members-events-title" variant="h2" sx={{ fontSize: "1.25rem", mb: 1, display: "flex", alignItems: "center", gap: 0.75 }}>
            <CardMembershipIcon aria-hidden="true" sx={{ fontSize: 22 }} />
            {t("eventsTitle")}
          </Typography>
          <Box sx={{ display: "grid", gap: 2, gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" } }}>
            {membersCards.map((card, index) => (
              <EventCard key={card.key} event={card.event} index={index} now={now} seriesDates={card.dates} />
            ))}
          </Box>
        </Box>
      )}

      <Box component="section" aria-labelledby="members-upcoming-title" sx={{ mb: { xs: DENSITY.sectionGap, sm: 3 } }} data-testid="members-upcoming">
        <Typography id="members-upcoming-title" variant="h2" sx={{ fontSize: "1.25rem", mb: 1 }}>
          {t("upcomingTitle")}
        </Typography>
        {upcoming.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            {t("upcomingEmpty")}
          </Typography>
        ) : (
          <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
            {upcoming.map((event) => (
              <Box component="li" key={event.id} sx={{ mb: 0.5 }}>
                <MuiLink
                  href={getPathname({ locale, href: { pathname: "/events/[slug]", params: { slug: event.slug } } })}
                  sx={{ display: "inline-flex", alignItems: "center", minHeight: 44, fontWeight: 600 }}
                >
                  {event.title}
                </MuiLink>
                <Typography component="span" variant="body2" color="text.secondary">
                  {" · "}
                  {formatDay(event.startsAt, { locale, timeZone: event.timezone, withTime: true })}
                </Typography>
              </Box>
            ))}
          </Box>
        )}
        <MuiLink href={getPathname({ locale, href: "/events" })} sx={{ display: "inline-flex", alignItems: "center", minHeight: 44 }}>
          {t("upcomingAll")}
        </MuiLink>
      </Box>
    </ZoneFrame>
  );
}
