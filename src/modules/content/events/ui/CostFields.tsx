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
 * (`DECISIONS.md` §343; the owner, of "Cu taxă" showing no box for the money: "usually nothing
 * is paid; the exception is Wings for Life, where a donation is made on another site").
 *
 * One `RecallField` per column, not two — a second pair with the same `name` would post twice —
 * so this watches `event.costType` the way `OnlyForType` does and relabels rather than
 * duplicates. Hidden, not removed, while the kind is `FREE` or not stated: whatever was typed
 * for a `PAID` event is still there if the club tries `DONATION` and comes back, the same rule
 * `PlaceToBeAnnounced` keeps for the meeting point (§328).
 *
 * `required` follows the chosen kind — the amount exactly while `PAID` is chosen, the link
 * exactly while `DONATION` is — the same discipline `PlaceToBeAnnounced` keeps for the meeting
 * point (§328): a box is `required` only while it is also shown, so a browser never refuses a
 * submit over a box hidden by `display: none` with nothing to focus. Unlike the meeting point,
 * neither column carries `required` from the schema itself (`content/events/fields.ts` leaves
 * both optional, refusing a blank one only through `costRule`'s cross-field check), so there is
 * no schema-level `required` on `slotProps.htmlInput` for the conditional prop to fight —
 * setting `required` on the field is the whole answer, where `PlaceToBeAnnounced` also has to
 * override `slotProps.htmlInput.required` to win against the schema's own. The rule that a paid
 * event must say how much, and a donation where, is still the server's
 * (`content/events/fields.ts#costRule`) — the browser now refuses a blank box exactly when the
 * server would.
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
          required={current === "PAID"}
          sx={{ flex: 1 }}
        />
        <RecallField
          name="event.costUrl"
          label={isDonation ? labels.donationUrl : labels.paidUrl}
          helperText={isDonation ? labels.donationUrlHelp : labels.paidUrlHelp}
          defaultValue={costUrl.defaultValue}
          {...costUrl.box}
          required={isDonation}
          sx={{ flex: 1 }}
        />
      </Stack>
    </Box>
  );
}
