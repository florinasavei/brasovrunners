import Alert from "@mui/material/Alert";
import Typography from "@mui/material/Typography";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { unstable_rethrow } from "next/navigation";
import { getDb } from "@/db/client";
import { listDiscountCodesForMembers, type MembersDiscountCode } from "@/modules/content/member-codes/repository";
import MemberCodes from "@/modules/content/member-codes/ui/MemberCodes";
import { listAllMemberTiers, type TierView, tierViewOf } from "@/modules/content/member-tiers/repository";
import type { Locale } from "@/i18n/routing";
import { isDatabaseAwayError } from "@/modules/resilience/domain/database-away";
import ZoneFrame, { frameParts, openZone } from "./zone";

type Props = { params: Promise<{ locale: string }> };

/** Reads the session, so it is never prerendered or cached (AGENTS.md §14.5). */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  // Behind the sign-in: never indexed. The proxy says so as a header too (`private-paths.ts`).
  robots: { index: false, follow: false },
};

/**
 * The partners' codes (§552) for this member's level (§NNN): read here, per request, behind the account — never through the shared
 * public cache. The codes for everyone and those limited to the member's level (`tierId`; none, the first alone), and the levels'
 * names the limited ones' chips say. `"away"` while the database is (§447).
 */
async function codesOrAway(now: Date, tierId: string | null, locale: Locale): Promise<{ codes: MembersDiscountCode[]; tiers: TierView[] } | "away"> {
  try {
    const db = getDb();
    const [codes, tiers] = await Promise.all([listDiscountCodesForMembers(db, now, tierId), listAllMemberTiers(db)]);
    return { codes, tiers: tiers.map((tier) => tierViewOf(tier, locale)) };
  } catch (error) {
    unstable_rethrow(error);
    if (!isDatabaseAwayError(error)) throw error;
    return "away";
  }
}

/**
 * The members' zone (§524) and its first tab, «Coduri de reducere» (§715, §552): the partners' codes
 * for the members alone (§517), at the zone's own address `/members-area`. The shop and the runs are
 * `shop/page.tsx` and `runs/page.tsx`; the frame, the door (`openZone`) and the sign-out are `zone.tsx`.
 *
 * The door is asserted here, on this page, as on every tab (`openZone`, BR-REQ-060-01): a hidden tab
 * is not a lock. The account, never the staff session: a member (`MEMBER`) and every colleague open
 * it (`canOpenMembersZone`). Signed out, the visitor is sent to the sign-in in the members' words
 * (`?to=members`), which lands back here; where this deployment has no sign-in at all, the answer is
 * 404, the backoffice's rule. The page is `force-dynamic`, `noindex`, listed in `private-paths.ts`
 * (a `no-store`, `noindex` header) and `robots.txt`; a member who types `/admin` is redirected here
 * by the backoffice's layout.
 */
export default async function MembersAreaPage({ params }: Props) {
  const opened = await openZone((await params).locale);
  if ("resting" in opened) return opened.resting;
  const { locale, account } = opened;
  const t = await getTranslations("Members");
  const now = new Date();
  const [found, parts] = await Promise.all([codesOrAway(now, account.memberTierId, locale), frameParts(account, locale, now)]);
  return (
    <ZoneFrame t={t} locale={locale} account={account} active="codes" parts={parts}>
      {found === "away" ? (
        <Alert severity="info" sx={{ mb: 3 }}>
          {t("zoneAway")}
        </Alert>
      ) : found.codes.length > 0 ? (
        <MemberCodes codes={found.codes} tiers={found.tiers} locale={locale} />
      ) : (
        <Typography variant="body1" sx={{ mb: 3 }} data-testid="members-codes-empty">
          {t("codesEmpty")}
        </Typography>
      )}
    </ZoneFrame>
  );
}
