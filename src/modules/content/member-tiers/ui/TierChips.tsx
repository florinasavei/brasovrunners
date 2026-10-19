"use client";

import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import { type ChangeEvent, useId } from "react";
import { useRecall } from "@/shared/forms/recall";
import { useFormOwner } from "@/shared/forms/form-owner";
import { CHOICE_CARD_SX, CHOICE_INPUT_SX } from "@/shared/ui/choice-card";
import { TAP_TARGET } from "@/shared/ui/tap-target";

/**
 * «Pentru cine e codul» (§811, amended by §828): who a discount code is for, as chips — first «Toți membrii», then one pill per
 * level, the native checkbox visible in each (`CHOICE_CARD_SX` and `CHOICE_INPUT_SX`, the house's selectable pill that the
 * volunteers' role chips draw, §780): the tick is the state, never the colour alone, and the whole pill is its label, 44
 * pixels tall.
 *
 * The choice is explicit and **exclusive**: «Toți membrii» (members with or without a level) posts `allName` once; a level
 * posts `name` once per ticked chip; **none ticked is no answer**, and both is not one either — the server refuses each on
 * this box and the line under the chips says which (`noneMessage`, `bothMessage`). With scripts on, ticking «Toți membrii»
 * clears the levels and ticking a level clears «Toți membrii», so the refusal is only what a page without script can post.
 *
 * A client island for that clearing and for the refusal's recall (§315): after a refused save the chips come back as they
 * were ticked. It takes strings and booleans — ids and words — never an element. A tier is a label and its benefits: ticking
 * one limits which codes a member of that level sees, and gives nobody a right.
 */
export default function TierChips({
  name,
  allName,
  legend,
  hint,
  allLabel,
  noneMessage,
  bothMessage,
  tiers,
  checkedIds,
  allChecked,
}: {
  /** The levels' posted name: one value, the tier's id, per ticked level chip. */
  name: string;
  /** «Toți membrii»' posted name: `1` when its chip is ticked, kept out of the id list. */
  allName: string;
  legend: string;
  hint: string;
  /** «Toți membrii», in the reader's language. */
  allLabel: string;
  /** What the line says after a refusal that posted nothing chosen. */
  noneMessage: string;
  /** What the line says after a refusal that posted «Toți membrii» with levels. */
  bothMessage: string;
  /** The levels in the club's order, in the reader's language; a hidden one is marked in `label` by the caller. */
  tiers: readonly { id: string; label: string }[];
  /** The ids the code is limited to now (none when the code is for «Toți membrii», or is new). */
  checkedIds: readonly string[];
  /** Whether the code is for «Toți membrii» now (a new code starts with nothing ticked: the club must choose). */
  allChecked: boolean;
}) {
  const recall = useRecall();
  const owner = useFormOwner();
  const hintId = useId();
  const postedLevels = recall.all(name);
  const postedAll = (recall.all(allName)?.length ?? 0) > 0;
  const refused = recall.named(name);
  const refusal = !refused ? "" : postedAll && (postedLevels?.length ?? 0) > 0 ? bothMessage : !postedAll && (postedLevels?.length ?? 0) === 0 ? noneMessage : recall.fieldError;

  // «Toți membrii» and the levels exclude each other: the one just ticked clears the other side (a page with no script is the server's refusal).
  function exclude(event: ChangeEvent<HTMLFieldSetElement>) {
    const target = event.target;
    if (!(target instanceof HTMLInputElement) || target.type !== "checkbox" || !target.checked) return;
    for (const box of event.currentTarget.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')) {
      if (box !== target && (target.name === allName ? box.name === name : box.name === allName)) box.checked = false;
    }
  }

  function pill(key: string, input: { name: string; value: string; checked: boolean; label: string; testId: string }) {
    return (
      <Box
        key={key}
        sx={{ ...CHOICE_CARD_SX, border: 1, borderRadius: "999px", minWidth: 0, maxWidth: "100%", "&:has(input:checked)": { ...CHOICE_CARD_SX["&:has(input:checked)"], boxShadow: "inset 0 0 0 1px var(--mui-palette-primary-main)" } }}
      >
        <Box
          component="label"
          sx={{ ...TAP_TARGET, display: "flex", alignItems: "center", gap: 1.25, py: 0.75, pl: 1.5, pr: 2, cursor: "pointer", boxSizing: "border-box", "& input": { ...CHOICE_INPUT_SX } }}
        >
          <input type="checkbox" name={input.name} value={input.value} defaultChecked={input.checked} form={owner?.id} data-testid={input.testId} />
          <Box component="span" sx={{ minWidth: 0, overflowWrap: "anywhere", fontWeight: 600 }}>
            {input.label}
          </Box>
        </Box>
      </Box>
    );
  }

  return (
    <Box
      component="fieldset"
      id={recall.idOf(name)}
      tabIndex={-1}
      onChange={exclude}
      sx={{ border: 0, m: 0, p: 0, minWidth: 0, outline: "none" }}
      data-testid="tier-chips"
      aria-describedby={hintId}
    >
      <Typography component="legend" variant="body2" sx={{ fontWeight: 600, p: 0, mb: 0.5 }}>
        {legend}
      </Typography>
      {/* «Toți membrii» stands on its own line above the levels: it is the other answer, not one more level. */}
      <Box key={recall.generation} sx={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 1 }}>
        {pill("all", { name: allName, value: "1", checked: recall.has ? postedAll : allChecked, label: allLabel, testId: "tier-chip-all" })}
        <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1 }}>
          {tiers.map((tier) =>
            pill(tier.id, { name, value: tier.id, checked: recall.has ? (postedLevels?.includes(tier.id) ?? false) : checkedIds.includes(tier.id), label: tier.label, testId: "tier-chip" }),
          )}
        </Box>
      </Box>
      <Typography id={hintId} variant="caption" color={refused ? "error" : "text.secondary"} sx={{ display: "block", mt: 0.5 }} data-testid={refused ? "tier-chips-refusal" : undefined}>
        {refusal ? `${refusal} ` : ""}
        {hint}
      </Typography>
    </Box>
  );
}
