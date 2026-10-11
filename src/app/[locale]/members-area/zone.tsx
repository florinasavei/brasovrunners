import DirectionsRunIcon from "@mui/icons-material/DirectionsRun";
import LocalOfferIcon from "@mui/icons-material/LocalOffer";
import LogoutIcon from "@mui/icons-material/Logout";
import StorefrontIcon from "@mui/icons-material/Storefront";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Container from "@mui/material/Container";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound, redirect, unstable_rethrow } from "next/navigation";
import type { ReactNode } from "react";
import { getDb } from "@/db/client";
import { getPathname } from "@/i18n/navigation";
import { routing, type Locale } from "@/i18n/routing";
import { canOpenMembersZone } from "@/modules/staff-identity/domain/roles";
import { getCurrentAccount } from "@/modules/staff-identity/session";
import { isDatabaseAwayError } from "@/modules/resilience/domain/database-away";
import { readMembersZone } from "@/modules/content/members/page-settings";
import type { RichTextDoc } from "@/modules/content/rich-text/domain/schema";
import RichText from "@/modules/content/rich-text/ui/RichText";
import { memberHasOrders } from "@/modules/content/shop/repository";
import { noticeDescribesMembersShop } from "@/modules/legal-documents/repository";
import { env } from "@/shared/config/env";
import SubNav from "@/shared/ui/SubNav";
import SubmitButton from "@/shared/ui/SubmitButton";
import { PAGE_WIDTH } from "@/theme/brand";
import { DENSITY } from "@/theme/density";
import { headingRule } from "@/theme/surfaces";
import { signOutAction } from "../admin/actions";

/**
 * The members' zone's three parts (§NNN), in the owner's order: the partners' codes, the club's shop,
 * the runs. The zone drew all of it on one long page, and a member after the shop scrolled past the
 * codes and the runs. «Coduri de reducere» is the zone's own address (`/members-area`), drawn
 * directly: every link made before the tabs — the sign-in's landing, the members' page's button —
 * arrives at the first tab, and the runs have an address of their own.
 */
export const ZONE_TABS = ["codes", "shop", "runs"] as const;
export type ZoneTab = (typeof ZONE_TABS)[number];

const TAB_ROUTE = {
  codes: "/members-area",
  shop: "/members-area/shop",
  runs: "/members-area/runs",
} as const satisfies Record<ZoneTab, string>;

/** The «Members» words, read by the page that draws the frame, which needs them too. */
type MembersWords = Awaited<ReturnType<typeof getTranslations<"Members">>>;

type Account = NonNullable<Awaited<ReturnType<typeof getCurrentAccount>>>;

/**
 * The door, asserted by every one of the three pages and never by the frame around them (§524,
 * BR-REQ-060-01): a layout is not re-run when a member moves between tabs, so each page asks for the
 * account itself. Signed out, the visitor goes to the sign-in in the members' words, which lands
 * back on the zone; a deployment with no sign-in at all answers 404; an account that may not open
 * the zone, 404. While the database is away (§447) the answer is `{ resting }`, a page to return as
 * it is: the zone cannot say who is signed in, so it says that, and keeps the sign-out.
 */
export async function openZone(rawLocale: string): Promise<{ locale: Locale; account: Account } | { locale: Locale; resting: ReactNode }> {
  if (!hasLocale(routing.locales, rawLocale)) notFound();
  const locale: Locale = rawLocale;
  setRequestLocale(locale);
  if (env.STAFF_AUTH_MODE === "disabled") notFound();
  let account: Awaited<ReturnType<typeof getCurrentAccount>>;
  try {
    account = await getCurrentAccount();
  } catch (error) {
    unstable_rethrow(error);
    if (!isDatabaseAwayError(error)) throw error;
    return { locale, resting: <Resting locale={locale} /> };
  }
  if (!account) redirect(getPathname({ locale, href: { pathname: "/sign-in", query: { to: "members" } } }));
  if (!canOpenMembersZone(account.role)) notFound();
  return { locale, account };
}

/** The zone's words, or `"away"` while the database is (§447): read per request, never through the shared public cache (`page-settings.ts`). */
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
 * Whether «Magazin» is among the tabs (§NNN, §683): while the privacy notice in force names
 * `{{membersShop}}` in every language, or the member has orders of their own — the zone draws no shop
 * before the notice describes it (BR-REQ-053-01). False while the database is away.
 */
async function shopTabShown(accountId: string, now: Date): Promise<boolean> {
  try {
    const db = getDb();
    if (await noticeDescribesMembersShop(db, now)) return true;
    return await memberHasOrders(db, accountId);
  } catch (error) {
    unstable_rethrow(error);
    if (!isDatabaseAwayError(error)) throw error;
    return false;
  }
}

/** What the frame shows around a part: the club's words above the tabs, and whether «Magazin» is one of them. */
export type FrameParts = { words: RichTextDoc | null | "away"; shop: boolean };

/**
 * Read once per page, by the page, because the frame is drawn synchronously: the club's words for
 * its members (every tab shows them) and the tab list. The shop's own page passes `shop`: it reads
 * what decides the tab itself, in the same round as these (§NNN), so the frame does not ask twice.
 */
export async function frameParts(account: Pick<Account, "id">, locale: Locale, now: Date, shop?: boolean): Promise<FrameParts> {
  const [words, shown] = await Promise.all([zoneOrAway(locale), shop ?? shopTabShown(account.id, now)]);
  return { words, shop: shown };
}

/** The zone's title, the greeting, the club's words, the tabs, then the part, then the sign-out. */
export default function ZoneFrame({
  t,
  locale,
  account,
  active,
  parts,
  children,
}: {
  t: MembersWords;
  locale: Locale;
  account: Account;
  active: ZoneTab;
  parts: FrameParts;
  children: ReactNode;
}) {
  const glyphs = { codes: <LocalOfferIcon />, shop: <StorefrontIcon />, runs: <DirectionsRunIcon /> } as const;
  const tabs = ZONE_TABS.filter((tab) => tab !== "shop" || parts.shop);
  return (
    <Container id="main" component="main" maxWidth={PAGE_WIDTH} sx={{ py: { xs: DENSITY.pagePadY, sm: 3 } }}>
      <Typography variant="h1" gutterBottom sx={headingRule}>
        {t("zoneTitle")}
      </Typography>
      <Typography variant="body1" color="text.secondary" sx={{ mb: 1 }} data-testid="members-greeting">
        {t("zoneGreeting", { name: account.displayName })}
      </Typography>
      {parts.words === "away" ? null : parts.words ? (
        // The club's words, through the renderer's allowlist, never markup the club did not type (§11.3).
        <Box sx={{ mb: { xs: DENSITY.sectionGap, sm: 3 }, "& > :last-child": { mb: 0 } }} data-testid="members-zone">
          <RichText body={parts.words} />
        </Box>
      ) : (
        <Typography variant="body1" sx={{ mb: { xs: DENSITY.sectionGap, sm: 3 } }} data-testid="members-zone-empty">
          {t("zoneEmpty")}
        </Typography>
      )}
      <Box sx={{ mb: { xs: DENSITY.sectionGap, sm: 3 } }} data-testid="members-tabs">
        <SubNav
          label={t("tabsLabel")}
          items={tabs.map((tab) => ({
            href: getPathname({ locale, href: TAB_ROUTE[tab] }),
            label: t(`tabs.${tab}`),
            active: tab === active,
            glyph: glyphs[tab],
          }))}
        />
      </Box>
      {children}
      <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} sx={{ alignItems: { sm: "center" } }}>
        <SignOut locale={locale} t={t} />
      </Stack>
    </Container>
  );
}

/** The sign-out, landing on «Beneficiile membrilor» rather than the team's door (§524). */
function SignOut({ locale, t }: { locale: Locale; t: MembersWords }) {
  return (
    <form action={signOutAction}>
      <input type="hidden" name="uiLocale" value={locale} />
      <input type="hidden" name="from" value="members" />
      <Box data-testid="members-sign-out" sx={{ display: "inline-block" }}>
        <SubmitButton label={t("signOut")} pendingLabel={t("signOutPending")} variant="text" size="medium">
          <LogoutIcon />
        </SubmitButton>
      </Box>
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
      <SignOut locale={locale} t={t} />
    </Container>
  );
}
