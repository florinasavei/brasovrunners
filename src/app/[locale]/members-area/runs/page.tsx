import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import MuiLink from "@mui/material/Link";
import Typography from "@mui/material/Typography";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { unstable_rethrow } from "next/navigation";
import { formatDay } from "@/i18n/dates";
import { getDb } from "@/db/client";
import { getPathname } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { datedOrNull } from "@/modules/events/domain/dated";
import { groupSeries, seriesLookup } from "@/modules/events/domain/series";
import { membersOnlyEventsFor } from "@/modules/events/members-only";
import EventCard from "@/modules/events/ui/EventCard";
import CardMembershipIcon from "@mui/icons-material/CardMembership";
import type { PublicEvent } from "@/modules/events/repository";
import { cachedUpcomingEvents } from "@/modules/public-cache/reads";
import { isDatabaseAwayError } from "@/modules/resilience/domain/database-away";
import { answeredByAccount, type AccountAnswer } from "@/modules/rsvp/counts";
import { accountPublicName } from "@/modules/rsvp/domain/account-identity";
import { isNameZoneOutcome, isRefusedZoneOutcome, parseZoneRsvpOutcome, ZONE_RSVP_OUTCOME_ANCHOR, zoneRsvpTitleId } from "@/modules/rsvp/domain/zone-outcome";
import { readPublicComing } from "@/modules/rsvp/public-page";
import ZoneRsvp from "@/modules/rsvp/ui/ZoneRsvp";
import { DENSITY } from "@/theme/density";
import ZoneFrame, { frameParts, openZone } from "../zone";

type Props = { params: Promise<{ locale: string }>; searchParams?: Promise<{ vin?: string | string[] }> };

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
 * «Următoarele alergări» (§524): the published events ahead, soonest first — the public listing's own
 * cached read (§333), so the zone costs the database nothing the listing has not already paid, and
 * shows nothing a stranger could not see. The page shows the first `UPCOMING_SHOWN`; «Vin!»'s gate and counts are read over all of
 * them, the same list the listing reads, so they share its cache entry (§822). Empty while the database is away.
 */
async function upcomingOrNone(locale: Locale, now: Date) {
  try {
    const events = await cachedUpcomingEvents(locale, now);
    return [...events].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  } catch (error) {
    unstable_rethrow(error);
    if (!isDatabaseAwayError(error)) throw error;
    return [];
  }
}

/** One run's row: how many come and whether this account does. */
type ZoneRsvpFacts = { count: number; going: boolean } & AccountAnswer;

/**
 * «Vin!» on the runs the zone lists (§822): which of the shown runs take answers and how many come — the public pages' one gate and
 * cached counts (`readPublicComing`, §815), so a members' event is never in it (`couldBeOffered`: its page draws no «Confirmă prezența (opțional)», and the
 * service refuses an answer to it) — and, live and for this account alone, which of those it has answered (one query,
 * `answeredByAccount`). A run absent from the map takes no answers and gets no row. Nothing at all while the database is away: a
 * «Vin!» that cannot be told from «Tu vii» is worse than none.
 */
async function rsvpsOrNone(account: { email: string }, all: readonly PublicEvent[], shown: readonly PublicEvent[], now: Date): Promise<ReadonlyMap<string, ZoneRsvpFacts>> {
  try {
    const coming = await readPublicComing(all, now);
    const ids = shown.filter((event) => coming.has(event.id)).map((event) => event.id);
    if (ids.length === 0) return new Map();
    const answered = await answeredByAccount(getDb(), account.email, ids);
    return new Map(ids.map((id) => [id, { count: coming.get(id) ?? 0, going: answered.has(id), showName: answered.get(id)?.showName ?? false, name: answered.get(id)?.name ?? null, clubMember: answered.get(id)?.clubMember ?? null }]));
  } catch (error) {
    unstable_rethrow(error);
    if (!isDatabaseAwayError(error)) throw error;
    return new Map();
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
export default async function MembersAreaPage({ params, searchParams }: Props) {
  const opened = await openZone((await params).locale);
  if ("resting" in opened) return opened.resting;
  const { locale, account } = opened;

  const t = await getTranslations("Members");
  // The name tick's sentences are the event page's own words (§827): one wording for the three doors.
  const tEvent = await getTranslations("Event");
  const now = new Date();
  const [parts, upcomingAll, membersEvents] = await Promise.all([frameParts(account, locale, now), upcomingOrNone(locale, now), membersOnlyOrNone(account, locale, now)]);
  const upcoming = upcomingAll.slice(0, UPCOMING_SHOWN);
  // «Vin!» (§822): the account's own answers are read live after the list, over the runs shown; what a press said is the address's `?vin=`.
  const rsvps = await rsvpsOrNone(account, upcomingAll, upcoming, now);
  const publicName = accountPublicName(account);
  const vin = parseZoneRsvpOutcome((await searchParams)?.vin);
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
        {vin !== null && (
          <Alert id={ZONE_RSVP_OUTCOME_ANCHOR} severity={isRefusedZoneOutcome(vin) ? "warning" : "success"} role="status" sx={{ mb: 1.5, scrollMarginTop: 16 }} data-testid="zone-rsvp-outcome">
            {isNameZoneOutcome(vin) ? tEvent(`rsvp.nameOutcome.${vin}`) : t(`rsvp.outcome.${vin}`)}
          </Alert>
        )}
        {upcoming.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            {t("upcomingEmpty")}
          </Typography>
        ) : (
          <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
            {upcoming.map((event) => (
              <Box component="li" key={event.id} sx={{ mb: 0.5 }}>
                <MuiLink
                  id={zoneRsvpTitleId(event.id)}
                  href={getPathname({ locale, href: { pathname: "/events/[slug]", params: { slug: event.slug } } })}
                  sx={{ display: "inline-flex", alignItems: "center", minHeight: 44, fontWeight: 600 }}
                >
                  {event.title}
                </MuiLink>
                <Typography component="span" variant="body2" color="text.secondary">
                  {" · "}
                  {formatDay(event.startsAt, { locale, timeZone: event.timezone, withTime: true })}
                </Typography>
                {/* «Vin!» (§825): only a run that takes answers, with this account's own state; a members' event has none (its page draws no «Confirmă prezența (opțional)»). */}
                {rsvps.has(event.id) && <ZoneRsvp locale={locale} eventId={event.id} titleId={zoneRsvpTitleId(event.id)} going={rsvps.get(event.id)!.going} count={rsvps.get(event.id)!.count} publicName={publicName} showName={rsvps.get(event.id)!.showName} name={rsvps.get(event.id)!.name} clubMember={rsvps.get(event.id)!.clubMember} />}
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
