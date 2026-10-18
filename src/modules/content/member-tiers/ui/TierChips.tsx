"use client";

import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import { useId } from "react";
import { useRecall } from "@/shared/forms/recall";
import { useFormOwner } from "@/shared/forms/form-owner";
import { CHOICE_CARD_SX, CHOICE_INPUT_SX } from "@/shared/ui/choice-card";
import { TAP_TARGET } from "@/shared/ui/tap-target";

/**
 * «Pentru nivelurile» (§NNN): a discount code's limit to some member tiers, as chips — one pill per level,
 * the native checkbox visible in it (`CHOICE_CARD_SX` and `CHOICE_INPUT_SX`, the house's selectable pill that
 * the volunteers' role chips draw, §780): the tick is the state, never the colour alone, and the whole pill is
 * its label, 44 pixels tall. Posts `name` once per ticked chip; **none ticked is every member**, which the line
 * under the chips says in words.
 *
 * A client island only for the refusal's recall (§315): after a refused save the chips come back as they were
 * ticked. It takes strings — ids and words — never an element. A tier is a label and its benefits: ticking one
 * limits which codes a member of that level sees, and gives nobody a right.
 */
export default function TierChips({
  name,
  legend,
  hint,
  tiers,
  checkedIds,
}: {
  name: string;
  legend: string;
  hint: string;
  /** The levels in the club's order, in the reader's language; a hidden one is marked in `label` by the caller. */
  tiers: readonly { id: string; label: string }[];
  /** The ids the code is limited to now (none: every member). */
  checkedIds: readonly string[];
}) {
  const recall = useRecall();
  const owner = useFormOwner();
  const hintId = useId();
  const posted = recall.all(name);
  return (
    <Box component="fieldset" sx={{ border: 0, m: 0, p: 0, minWidth: 0 }} data-testid="tier-chips" aria-describedby={hintId}>
      <Typography component="legend" variant="body2" sx={{ fontWeight: 600, p: 0, mb: 0.5 }}>
        {legend}
      </Typography>
      <Box key={recall.generation} sx={{ display: "flex", flexWrap: "wrap", gap: 1 }}>
        {tiers.map((tier) => (
          <Box
            key={tier.id}
            sx={{ ...CHOICE_CARD_SX, border: 1, borderRadius: "999px", minWidth: 0, maxWidth: "100%", "&:has(input:checked)": { ...CHOICE_CARD_SX["&:has(input:checked)"], boxShadow: "inset 0 0 0 1px var(--mui-palette-primary-main)" } }}
          >
            <Box
              component="label"
              sx={{ ...TAP_TARGET, display: "flex", alignItems: "center", gap: 1.25, py: 0.75, pl: 1.5, pr: 2, cursor: "pointer", boxSizing: "border-box", "& input": { ...CHOICE_INPUT_SX } }}
            >
              <input
                type="checkbox"
                name={name}
                value={tier.id}
                defaultChecked={recall.has ? (posted?.includes(tier.id) ?? false) : checkedIds.includes(tier.id)}
                form={owner?.id}
                data-testid="tier-chip"
              />
              <Box component="span" sx={{ minWidth: 0, overflowWrap: "anywhere", fontWeight: 600 }}>
                {tier.label}
              </Box>
            </Box>
          </Box>
        ))}
      </Box>
      <Typography id={hintId} variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.5 }}>
        {hint}
      </Typography>
    </Box>
  );
}
