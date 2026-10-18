import LocalOfferIcon from "@mui/icons-material/LocalOffer";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import Box from "@mui/material/Box";
import MuiLink from "@mui/material/Link";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { getTranslations } from "next-intl/server";
import { formatCalendarDay } from "@/i18n/dates";
import type { Locale } from "@/i18n/routing";
import TierBadge from "@/modules/content/member-tiers/ui/TierBadge";
import type { TierView } from "@/modules/content/member-tiers/repository";
import type { MembersDiscountCode } from "../repository";
import CopyCodeButton from "./CopyCodeButton";

/**
 * The members' discount codes as cards (§552), on the members' zone alone — the page that asked for
 * the account (`canOpenMembersZone`) before it read them. Each card: the partner, the code in a
 * monospace box with «Copiază codul», what it gives in the reader's language, the link, and «valabil
 * până …» through the one date helper (§349). The read already left out a hidden code and one past
 * its last day. Nothing when there is none: the zone says nothing about codes it does not have.
 */
export default async function MemberCodes({
  codes,
  tiers = [],
  locale,
}: {
  codes: readonly MembersDiscountCode[];
  /** The levels' names in the reader's language (§NNN): a code limited to some levels wears one small chip for each. */
  tiers?: readonly TierView[];
  locale: Locale;
}) {
  if (codes.length === 0) return null;
  const t = await getTranslations("Members");
  const tierById = new Map(tiers.map((tier) => [tier.id, tier]));
  return (
    <Box component="section" aria-labelledby="members-codes-title" sx={{ mb: 3 }} data-testid="members-codes">
      <Typography id="members-codes-title" variant="h2" sx={{ fontSize: "1.25rem", mb: 1, display: "flex", alignItems: "center", gap: 0.75 }}>
        <LocalOfferIcon aria-hidden="true" sx={{ fontSize: 22 }} />
        {t("codesTitle")}
      </Typography>
      <Box component="ul" sx={{ listStyle: "none", m: 0, p: 0, display: "grid", gap: 1.5, gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" } }}>
        {codes.map((code) => {
          const description = locale === "ro" ? code.descriptionRo : code.descriptionEn;
          return (
            <Box component="li" key={code.id} sx={{ border: 1, borderColor: "divider", borderRadius: 2, p: 2, minWidth: 0 }} data-testid="member-code">
              <Typography variant="subtitle1" component="h3" sx={{ fontWeight: 700, overflowWrap: "anywhere" }}>
                {code.partnerName}
              </Typography>
              {/* «Pentru nivelul …» (§NNN): a code limited to some levels names them, one small chip each; a code for everyone says nothing. */}
              {(code.tierIds ?? []).length > 0 && (
                <Stack direction="row" role="group" aria-label={t("codeForTiers")} sx={{ alignItems: "center", gap: 0.5, mt: 0.5, flexWrap: "wrap" }} data-testid="member-code-tiers">
                  {(code.tierIds ?? []).flatMap((id) => {
                    const tier = tierById.get(id);
                    return tier ? [<TierBadge key={id} tier={tier} help={false} color="default" testId="member-code-tier" />] : [];
                  })}
                </Stack>
              )}
              <Stack direction="row" sx={{ alignItems: "center", gap: 1, mt: 1, flexWrap: "wrap" }}>
                <Box
                  component="code"
                  sx={{ fontFamily: "monospace", fontSize: "1.05rem", px: 1.25, py: 0.75, borderRadius: 1, bgcolor: "action.hover", overflowWrap: "anywhere", userSelect: "all" }}
                >
                  {code.code}
                </Box>
                <CopyCodeButton code={code.code} label={t("copyCode")} copiedLabel={t("codeCopied")} />
              </Stack>
              {description && (
                <Typography variant="body2" sx={{ mt: 1, whiteSpace: "pre-line" }}>
                  {description}
                </Typography>
              )}
              {code.validUntil && (
                <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                  {t("codeValidUntil", { day: formatCalendarDay(code.validUntil, { locale, position: "inline" }) })}
                </Typography>
              )}
              {code.link && (
                <MuiLink
                  href={code.link}
                  target="_blank"
                  rel="noopener noreferrer"
                  sx={{ display: "inline-flex", alignItems: "center", gap: 0.5, minHeight: 44 }}
                >
                  <OpenInNewIcon aria-hidden="true" sx={{ fontSize: 18 }} />
                  {t("codeLink")}
                </MuiLink>
              )}
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}
