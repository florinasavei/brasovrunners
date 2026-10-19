import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
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
import { readOrWhileAway } from "@/modules/resilience/optional-read";
import { answeredByAccount, type AccountAnswer } from "@/modules/rsvp/counts";
import { accountPublicName } from "@/modules/rsvp/domain/account-identity";
import { isNameZoneOutcome, isRefusedZoneOutcome, parseZoneRsvpOutcome, ZONE_RSVP_OUTCOME_ANCHOR, zoneRsvpTitleId } from "@/modules/rsvp/domain/zone-outcome";
import type { PublicRsvps } from "@/modules/rsvp/rsvp";
import { readPublicComing, readPublicRsvpsFor } from "@/modules/rsvp/public-page";
import RsvpCount from "@/modules/rsvp/ui/RsvpCount";
import ZoneRsvp from "@/modules/rsvp/ui/ZoneRsvp";
import { DENSITY } from "@/theme/density";
import { featuredCard } from "@/theme/surfaces";
import ZoneFrame, { frameParts, openZone } from "./zone";

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
    return new Map(ids.map((id) => [id, { count: coming.get(id) ?? 0, going: answered.has(id), showName: answered.get(id)?.showName ?? false, name: answered.get(id)?.name ?? null }]));
  } catch (error) {
    unstable_rethrow(error);
    if (!isDatabaseAwayError(error)) throw error;
    return new Map();
  }
}

/**
 * «Cine vine» for the runs that take answers (§715 amended; §143, §812): one gathering for the whole page — the notice's version once and each
 * run's cached public read (`readPublicRsvpsFor`), never a read per card — handed to each card's open list. Shows exactly what the event page
 * shows: names only for a confirmed answer whose person ticked, under a notice that describes «Vin!»; being a member widens nothing. Empty
 * while the database is away (`readOrWhileAway`): a card with no list rather than a list of zero.
 */
async function whoComesOrNone(runIds: readonly string[]): Promise<ReadonlyMap<string, PublicRsvps>> {
  return readOrWhileAway(() => readPublicRsvpsFor(runIds), new Map<string, PublicRsvps>());
}

/**
 * The members' zone, tab «Alergări» (§715, §524, §552) — the zone's own address, `/members-area` (the zone opens on the runs; the owner,
 * 2026-10-19: «And it should be a lot easier for BVR members to see this»): the next runs, each on a card with «Vin!» and «Cine vine (N)» open,
 * then the events for members alone. The old `/members-area/runs` is a permanent redirect here (`runs/page.tsx`). The club's words for members
 * are the frame's, above the tabs (`zone.tsx`); the door is `openZone`, asserted here as on every tab (BR-REQ-060-01).
 *
 * **The next run first and larger**: the soonest run that takes answers is drawn first, on the listing's lead-event frame (`featuredCard`,
 * §470) with a larger title and «Următoarea alergare» over it, so a member who opens the zone reads «Luni, 18:30 · 12 vin · Tu vii ✓» at a
 * glance; the others follow by date. With no run taking answers, no card is featured and the order is the date's.
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
  // «Cine vine» (§715 amended): the one gathering for the page, over the runs that take answers.
  const who = await whoComesOrNone([...rsvps.keys()]);
  // The next run: the soonest one that takes answers, first and featured; `upcoming` is already by date.
  const nextRun = upcoming.find((event) => rsvps.has(event.id)) ?? null;
  const runs = nextRun ? [nextRun, ...upcoming.filter((event) => event.id !== nextRun.id)] : upcoming;
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
          /*
            One card per run (the listing's `Card`, outlined): the title as a link to the run's page and its day, then «Vin!» and the name tick
            (`ZoneRsvp`, §822, §827) and, directly under them, «Cine vine (N)» open (`RsvpCount` with `open`, §715 amended) — a run that
            takes no answers is the title and the day alone. The next run is the first card, in the lead event's frame and a larger title.
          */
          <Box component="ul" sx={{ listStyle: "none", m: 0, p: 0, display: "grid", gap: { xs: 1.5, sm: 2 }, mb: 1 }}>
            {runs.map((event) => {
              const next = event.id === nextRun?.id;
              const facts = rsvps.get(event.id);
              return (
                <Card
                  key={event.id}
                  component="li"
                  variant="outlined"
                  data-testid={next ? "members-next-run" : "members-run"}
                  data-featured={next ? "true" : undefined}
                  sx={{ p: { xs: 1.5, sm: next ? 2.5 : 2 }, ...(next ? featuredCard : {}) }}
                >
                  {next && (
                    <Typography component="p" variant="overline" color="primary" sx={{ lineHeight: 1.5 }} data-testid="members-next-run-label">
                      {t("nextRun")}
                    </Typography>
                  )}
                  <Typography variant="h3" component="h3" sx={{ fontSize: next ? { xs: "1.25rem", sm: "1.5rem" } : "1.0625rem", fontWeight: 700, lineHeight: 1.3 }}>
                    <MuiLink
                      id={zoneRsvpTitleId(event.id)}
                      href={getPathname({ locale, href: { pathname: "/events/[slug]", params: { slug: event.slug } } })}
                      sx={{ display: "inline-flex", alignItems: "center", minHeight: 44 }}
                    >
                      {event.title}
                    </MuiLink>
                  </Typography>
                  <Typography variant={next ? "body1" : "body2"} color="text.secondary" sx={{ fontWeight: next ? 600 : 400 }}>
                    {formatDay(event.startsAt, { locale, timeZone: event.timezone, withTime: true })}
                  </Typography>
                  {/* «Vin!» (§825): only a run that takes answers, with this account's own state; a members' event has none (its page draws no «Confirmă prezența (opțional)»). */}
                  {facts && <ZoneRsvp locale={locale} eventId={event.id} titleId={zoneRsvpTitleId(event.id)} going={facts.going} count={facts.count} publicName={publicName} showName={facts.showName} name={facts.name} />}
                  {facts && who.has(event.id) && <RsvpCount eventId={event.id} rsvps={who.get(event.id)} open />}
                </Card>
              );
            })}
          </Box>
        )}
        <MuiLink href={getPathname({ locale, href: "/events" })} sx={{ display: "inline-flex", alignItems: "center", minHeight: 44 }}>
          {t("upcomingAll")}
        </MuiLink>
      </Box>

      {/*
        «Evenimente pentru membri» (§552): the club's events for its members alone, upcoming first,
        on the listing's own card with its door — the register button included. Nowhere else on the
        site. Nothing when there is none. Under the runs since the zone opens on them (§715 amended).
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
    </ZoneFrame>
  );
}
