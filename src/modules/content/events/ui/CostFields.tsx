"use client";

import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import type { ReactNode } from "react";
import RecallField from "@/shared/forms/recall";
import type { textFieldConstraints } from "@/shared/forms/constraints";
import { useSelectedValue } from "./OnlyForType";

/** The two boxes' constraints read off the schema (§315): plain data, never zod. */
type BoxProps = ReturnType<typeof textFieldConstraints>;

/**
 * One pair of columns (`cost_amount`, `cost_url`) relabelled by the chosen cost kind — amount and
 * where to pay, or donation link and suggested sum (§343). One `RecallField` per column (a second
 * with the same `name` would post twice), hidden not removed while FREE, so typed values survive a
 * kind change (as `PlaceToBeAnnounced`, §328). A box is `required` only while shown, so the browser
 * never refuses over a hidden box; the rule itself is the server's (`fields.ts#costRule`).
 */
export default function CostFields({
  initialCostType,
  initialMode,
  costAmount,
  costUrl,
  labels,
  children,
}: {
  initialCostType: string;
  /** The registration mode select's initial answer (`event.registrationMode`), for the discount note's own watch. */
  initialMode: string;
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
  /**
   * The discount note, per language, rendered by the caller (§394). `children`, because a Server
   * Component may pass a client component no other element-valued prop (§370).
   */
  children: ReactNode;
}) {
  const current = useSelectedValue("event.costType", initialCostType);
  const mode = useSelectedValue("event.registrationMode", initialMode);
  const isDonation = current === "DONATION";
  const shown = current === "PAID" || isDonation;
  // The discount applies only where the fee is paid at another organizer's form (§394); hidden,
  // not removed, like the boxes above.
  const showDiscount = current === "PAID" && mode === "EXTERNAL";

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
        {/* Hidden (not removed) while the discount note applies: on EXTERNAL + PAID the site ignores
            `costUrl` (§394), so an editable box would vanish from the page unexplained. */}
        <Box sx={{ display: showDiscount ? "none" : "block", flex: 1 }}>
          <RecallField
            name="event.costUrl"
            label={isDonation ? labels.donationUrl : labels.paidUrl}
            helperText={isDonation ? labels.donationUrlHelp : labels.paidUrlHelp}
            defaultValue={costUrl.defaultValue}
            {...costUrl.box}
            required={isDonation}
            fullWidth
          />
        </Box>
      </Stack>
      <Box sx={{ display: showDiscount ? "block" : "none", mt: 2 }}>{children}</Box>
    </Box>
  );
}
