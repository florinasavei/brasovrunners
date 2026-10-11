import Typography from "@mui/material/Typography";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { unstable_rethrow } from "next/navigation";
import { getDb } from "@/db/client";
import { listDiscountCodesForMembers, type MembersDiscountCode } from "@/modules/content/member-codes/repository";
import MemberCodes from "@/modules/content/member-codes/ui/MemberCodes";
import { isDatabaseAwayError } from "@/modules/resilience/domain/database-away";
import ZoneFrame, { openZone } from "../zone";

type Props = { params: Promise<{ locale: string }> };

/** Reads the session, so it is never prerendered or cached (AGENTS.md §14.5). */
export const dynamic = "force-dynamic";

export const metadata: Metadata = { robots: { index: false, follow: false } };

/** The partners' codes (§552): read here, per request, behind the account — never through the shared public cache. Empty while the database is away. */
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
 * The members' zone, tab «Coduri de reducere» (§709, §552): the partners' codes for the members
 * alone (§517), at `/members-area/codes`. The door is asserted here, on this page, as on every tab
 * (`openZone`, BR-REQ-060-01): a hidden tab is not a lock.
 */
export default async function MembersCodesPage({ params }: Props) {
  const opened = await openZone((await params).locale);
  if ("resting" in opened) return opened.resting;
  const { locale, account } = opened;
  const t = await getTranslations("Members");
  const codes = await codesOrNone(new Date());
  return (
    <ZoneFrame t={t} locale={locale} account={account} active="codes">
      {codes.length > 0 ? (
        <MemberCodes codes={codes} locale={locale} />
      ) : (
        <Typography variant="body1" sx={{ mb: 3 }} data-testid="members-codes-empty">
          {t("codesEmpty")}
        </Typography>
      )}
    </ZoneFrame>
  );
}
