"use client";

import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import RecallField from "@/shared/forms/recall";
import type { textFieldConstraints } from "@/shared/forms/constraints";
import { useSelectedValue } from "./OnlyForType";

/** The two boxes' constraints as `EventFieldsForm` read them off the schema (§315): plain data, never zod. */
type BoxProps = ReturnType<typeof textFieldConstraints>;

/**
 * "Suma" and "Unde se plătește", or "Link pentru donație" and "Suma sugerată" — one pair of
 * columns (`cost_amount`, `cost_url`) wearing whichever pair of labels the chosen kind needs
 * (`DECISIONS.md` §NNN; the owner, of "Cu taxă" showing no box for the money: "usually nothing
 * is paid; the exception is Wings for Life, where a donation is made on another site").
 *
 * One `RecallField` per column, not two — a second pair with the same `name` would post twice —
 * so this watches `event.costType` the way `OnlyForType` does and relabels rather than
 * duplicates. Hidden, not removed, while the kind is `FREE` or not stated: whatever was typed
 * for a `PAID` event is still there if the club tries `DONATION` and comes back, the same rule
 * `PlaceToBeAnnounced` keeps for the meeting point (§328).
 *
 * Neither box is marked HTML `required`: a box hidden by `display: none` that still carries
 * `required` blocks a browser's submit with nothing focusable to blame, which is why
 * `GuardianForMinor`'s conditional field carries none either. The rule that a paid event must
 * say how much, and a donation where, is the server's (`content/events/fields.ts#costRule`) —
 * named on the box, values kept, the same discipline §328's place rule follows.
 */
export default function CostFields({
  initialCostType,
  costAmount,
  costUrl,
  labels,
}: {
  initialCostType: string;
  costAmount: { defaultValue: string; box: BoxProps };
  costUrl: { defaultValue: string; box: BoxProps };
  labels: {
    paidAmount: string;
    paidAmountHelp: string;
    paidUrl: string;
    paidUrlHelp: string;
    donationUrl: string;
    donationUrlHelp: string;
    donationAmount: string;
    donationAmountHelp: string;
  };
}) {
  const current = useSelectedValue("event.costType", initialCostType);
  const isDonation = current === "DONATION";
  const shown = current === "PAID" || isDonation;

  return (
    <Box sx={{ display: shown ? "block" : "none" }}>
      <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
        <RecallField
          name="event.costAmount"
          label={isDonation ? labels.donationAmount : labels.paidAmount}
          helperText={isDonation ? labels.donationAmountHelp : labels.paidAmountHelp}
          defaultValue={costAmount.defaultValue}
          {...costAmount.box}
          sx={{ flex: 1 }}
        />
        <RecallField
          name="event.costUrl"
          label={isDonation ? labels.donationUrl : labels.paidUrl}
          helperText={isDonation ? labels.donationUrlHelp : labels.paidUrlHelp}
          defaultValue={costUrl.defaultValue}
          {...costUrl.box}
          sx={{ flex: 1 }}
        />
      </Stack>
    </Box>
  );
}
