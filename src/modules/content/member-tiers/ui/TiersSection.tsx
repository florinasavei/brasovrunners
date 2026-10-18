import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import { getTranslations } from "next-intl/server";
import { DENSITY } from "@/theme/density";
import type { TierView } from "../repository";
import TierBadge from "./TierBadge";

/**
 * «Nivelurile de membru» on the public members' page (§NNN): the levels the club named, visible ones
 * in the club's order, each with its glyph, its name and its description in the reader's language. After
 * «Beneficiile membrilor», before the door. Nothing when the club named no level: the page then says
 * nothing about levels it does not have.
 *
 * A Server Component with no state. A label and its benefits — the section lists what each level is,
 * and grants nothing.
 */
export default async function TiersSection({ tiers }: { tiers: readonly TierView[] }) {
  if (tiers.length === 0) return null;
  const t = await getTranslations("Members");
  return (
    <Box component="section" aria-labelledby="members-tiers-title" sx={{ mb: { xs: DENSITY.sectionGap, sm: 3 } }} data-testid="members-tiers">
      <Typography id="members-tiers-title" variant="h2" sx={{ fontSize: { xs: "1.125rem", sm: "1.375rem" }, mb: 1 }}>
        {t("tiersTitle")}
      </Typography>
      <Box component="ul" sx={{ listStyle: "none", m: 0, p: 0, display: "grid", gap: 1.5 }}>
        {tiers.map((tier) => (
          <Box component="li" key={tier.id} data-testid="members-tier" sx={{ display: "grid", gap: 0.5, justifyItems: "start" }}>
            <TierBadge tier={tier} help={false} testId="members-tier-chip" />
            {tier.description && (
              <Typography variant="body2" sx={{ whiteSpace: "pre-line" }}>
                {tier.description}
              </Typography>
            )}
          </Box>
        ))}
      </Box>
    </Box>
  );
}
