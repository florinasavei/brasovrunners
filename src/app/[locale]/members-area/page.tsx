import LogoutIcon from "@mui/icons-material/Logout";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Container from "@mui/material/Container";
import MuiLink from "@mui/material/Link";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound, redirect, unstable_rethrow } from "next/navigation";
import { getDb } from "@/db/client";
import { formatDay } from "@/i18n/dates";
import { getPathname } from "@/i18n/navigation";
import { routing, type Locale } from "@/i18n/routing";
import { readMembersZone } from "@/modules/content/members/page-settings";
import { listDiscountCodesForMembers, type MembersDiscountCode } from "@/modules/content/member-codes/repository";
import MemberCodes from "@/modules/content/member-codes/ui/MemberCodes";
import { datedOrNull } from "@/modules/events/domain/dated";
import { groupSeries, seriesLookup } from "@/modules/events/domain/series";
import { membersOnlyEventsFor } from "@/modules/events/members-only";
import EventCard from "@/modules/events/ui/EventCard";
import CardMembershipIcon from "@mui/icons-material/CardMembership";
import type { RichTextDoc } from "@/modules/content/rich-text/domain/schema";
import RichText from "@/modules/content/rich-text/ui/RichText";
import { cachedUpcomingEvents } from "@/modules/public-cache/reads";
import { isDatabaseAwayError } from "@/modules/resilience/domain/database-away";
import { canOpenMembersZone } from "@/modules/staff-identity/domain/roles";
import { getCurrentAccount } from "@/modules/staff-identity/session";
import { env } from "@/shared/config/env";
import { glyphSx, WITH_GLYPH_SX } from "@/shared/ui/button-glyph";
import { TAP_TARGET } from "@/shared/ui/tap-target";
import { PAGE_WIDTH } from "@/theme/brand";
import { DENSITY } from "@/theme/density";
import { headingRule } from "@/theme/surfaces";
import { signOutAction } from "../admin/actions";
import MembersShop from "./MembersShop";
import { listOrdersOfMember, listProductsForMembers, type MemberOrder, type MembersShopProduct } from "@/modules/content/shop/repository";
import { paymentWordsFor, readShopSettings } from "@/modules/content/shop/settings";
import { readShopOutcome, readShopOutcomeAtOrders } from "@/modules/content/shop/zone-outcome";
import { noticeDescribesMembersShop } from "@/modules/legal-documents/repository";

type Props = { params: Promise<{ locale: string }>; searchParams?: Promise<{ shop?: string | string[]; shopAt?: string | string[] }> };

/** Reads the session, so it is never prerendered or cached (AGENTS.md §14.5). */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  // Behind the sign-in: never indexed. The proxy says so as a header too (`private-paths.ts`).
  robots: { index: false, follow: false },
};

/** The zone's words, or `"away"` while the database is (§447) — the page then says so, and keeps the sign-out. */
async function zoneOrAway(locale: Locale): Promise<RichTextDoc | null | "away"> {
  try {
    return await readMembersZone(getDb(), locale);
  } catch (error) {
    unstable_rethrow(error);
    if (!isDatabaseAwayError(error)) throw error;
    console.error("[members-area] the database is away; the zone rests", error);
    return "away";
  }
}

/**
 * The club's events for its members alone (§552), and its discount codes (§552): read here, per
 * request, behind the account this page asked for — live, never through the public cache, which is
 * shared by everybody. Empty while the database is away, like «Următoarele alergări».
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

async function codesOrNone(now: Date): Promise<MembersDiscountCode[]> {
  try {
    return await listDiscountCodesForMembers(getDb(), now);
  } catch (error) {
    unstable_rethrow(error);
    if (!isDatabaseAwayError(error)) throw error;
    return [];
  }
}

/**
 * «Magazinul clubului» and «Comenzile mele» (§683): read here, per request, behind the account — the
 * products only while the privacy notice in force names `{{membersShop}}` in every language, the
 * member's own orders always. Nothing while the database is away, like the codes.
 */
async function shopOrNone(
  account: { id: string },
  locale: Locale,
  now: Date,
): Promise<{ open: boolean; products: MembersShopProduct[]; orders: MemberOrder[]; payment: string | null }> {
  try {
    const db = getDb();
    const open = await noticeDescribesMembersShop(db, now);
    const [products, orders, settings] = await Promise.all([
      open ? listProductsForMembers(db, locale) : Promise.resolve([]),
      listOrdersOfMember(db, account.id),
      readShopSettings(db),
    ]);
    return { open, products, orders, payment: paymentWordsFor(settings, locale) };
  } catch (error) {
    unstable_rethrow(error);
    if (!isDatabaseAwayError(error)) throw error;
    return { open: false, products: [], orders: [], payment: null };
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
 * The members' zone (§524): one page of the club's words for its members alone, behind the sign-in.
 *
 * The door is the account, never the staff session: a member (`MEMBER`) and every colleague open it
 * (`canOpenMembersZone`). Signed out, the visitor is sent to the sign-in in the members' words
 * (`?to=members`), which lands back here; where this deployment has no sign-in at all, the answer
 * is 404, the backoffice's rule — announcing a door with no lock invites looking for one.
 *
 * The words are read here, per request, from the members' setting — never through the public cache,
 * which is shared by everybody (`page-settings.ts`). Both languages or neither (§352): a zone written
 * in one language shows the catalogue's sentence on both pages rather than the other language's text.
 *
 * Everybody, a colleague included, sees only the zone and the sign-out, which lands on «Beneficiile
 * membrilor». The zone shows no way into the backoffice, not even to a colleague (§NNN): a colleague
 * goes to `/admin` directly, and the backoffice's own layout is the lock either way.
 *
 * **Why here and not under `/admin` (§524).** The zone is a public-tree route with the site's own
 * header and footer, not a page inside the backoffice's shell: everything under `/admin` sits
 * behind `requireStaff` in its layout, loads the backoffice's client islands and words, and is the
 * area a member must never be let into — putting the member's page there would mean a hole in the
 * one line `getCurrentStaffUser` draws. Here the door is the account (`getCurrentAccount`), the
 * page is `force-dynamic`, `noindex`, listed in `private-paths.ts` (a `no-store`, `noindex` header)
 * and `robots.txt`. A member who types `/admin` is redirected here by the backoffice's layout.
 *
 * Under the club's words, «Următoarele alergări»: the next published events, from the listing's
 * own cached read (§333) — nothing a stranger could not see, and no query of its own.
 */
export default async function MembersAreaPage({ params, searchParams }: Props) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  if (env.STAFF_AUTH_MODE === "disabled") notFound();
  let account: Awaited<ReturnType<typeof getCurrentAccount>>;
  try {
    account = await getCurrentAccount();
  } catch (error) {
    unstable_rethrow(error);
    if (!isDatabaseAwayError(error)) throw error;
    return <Resting locale={locale} />;
  }
  if (!account) redirect(getPathname({ locale, href: { pathname: "/sign-in", query: { to: "members" } } }));
  if (!canOpenMembersZone(account.role)) notFound();

  const t = await getTranslations("Members");
  const now = new Date();
  const [zone, upcoming, membersEvents, codes, shop] = await Promise.all([
    zoneOrAway(locale),
    upcomingOrNone(locale, now),
    membersOnlyOrNone(account, locale, now),
    codesOrNone(now),
    shopOrNone(account, locale, now),
  ]);
  const shopQuery = await searchParams;
  const shopOutcome = readShopOutcome(shopQuery?.shop);
  const shopOutcomeAtOrders = readShopOutcomeAtOrders(shopQuery?.shopAt);
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
    <Container id="main" component="main" maxWidth={PAGE_WIDTH} sx={{ py: { xs: DENSITY.pagePadY, sm: 3 } }}>
      <Typography variant="h1" gutterBottom sx={headingRule}>
        {t("zoneTitle")}
      </Typography>
      <Typography variant="body1" color="text.secondary" sx={{ mb: { xs: DENSITY.sectionGap, sm: 3 } }} data-testid="members-greeting">
        {t("zoneGreeting", { name: account.displayName })}
      </Typography>

      {zone === "away" ? (
        <Alert severity="info" sx={{ mb: 3 }}>
          {t("zoneAway")}
        </Alert>
      ) : zone ? (
        // The club's words, through the renderer's allowlist, never markup the club did not type (§11.3).
        <Box sx={{ mb: { xs: DENSITY.sectionGap, sm: 3 }, "& > :last-child": { mb: 0 } }} data-testid="members-zone">
          <RichText body={zone} />
        </Box>
      ) : (
        <Typography variant="body1" sx={{ mb: { xs: DENSITY.sectionGap, sm: 3 } }} data-testid="members-zone-empty">
          {t("zoneEmpty")}
        </Typography>
      )}

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

      {/* «Coduri de reducere» (§552): the partners' codes, for the members alone (§517). */}
      {codes.length > 0 && <MemberCodes codes={codes} locale={locale} />}

      {/* «Magazinul clubului» and «Comenzile mele» (§683): behind the notice, paid outside the site. */}
      {((shop.open && shop.products.length > 0) || shop.orders.length > 0) && (
        <MembersShop products={shop.products} orders={shop.orders} payment={shop.payment} shopOpen={shop.open} outcome={shopOutcome} outcomeAtOrders={shopOutcomeAtOrders} locale={locale} />
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

      <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} sx={{ alignItems: { sm: "center" } }}>
        <SignOut locale={locale} label={t("signOut")} />
      </Stack>
    </Container>
  );
}

/** The sign-out, landing on «Beneficiile membrilor» rather than the team's door (§524). */
function SignOut({ locale, label }: { locale: Locale; label: string }) {
  return (
    <form action={signOutAction}>
      <input type="hidden" name="uiLocale" value={locale} />
      <input type="hidden" name="from" value="members" />
      <Button type="submit" variant="text" sx={{ ...TAP_TARGET, ...WITH_GLYPH_SX }} data-testid="members-sign-out">
        <LogoutIcon aria-hidden="true" sx={glyphSx("medium")} />
        {label}
      </Button>
    </form>
  );
}

/** The database is away (§447): the zone cannot say who is signed in, so it says that, and offers the sign-out. */
async function Resting({ locale }: { locale: Locale }) {
  const t = await getTranslations("Members");
  return (
    <Container id="main" component="main" maxWidth={PAGE_WIDTH} sx={{ py: { xs: DENSITY.pagePadY, sm: 3 } }}>
      <Typography variant="h1" gutterBottom sx={headingRule}>
        {t("zoneTitle")}
      </Typography>
      <Alert severity="info" sx={{ mb: 3 }}>
        {t("zoneAway")}
      </Alert>
      <SignOut locale={locale} label={t("signOut")} />
    </Container>
  );
}
