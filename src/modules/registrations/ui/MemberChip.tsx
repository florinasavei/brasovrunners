"use client";

import Chip from "@mui/material/Chip";
import Tooltip from "@mui/material/Tooltip";
import type { Membership } from "../domain/membership";

/**
 * «Membru (verificat)» / «Membru (declarat)» (§662, amending §650): one chip, on a registration's row and
 * page, with what it means in one sentence as its tooltip. Verified is filled — the club knows it —,
 * declared is outlined, the person's own word.
 *
 * Its own small island because MUI's `Tooltip` is a client component and wraps the chip it explains;
 * it receives strings only. The chip takes the keyboard's focus so the tooltip opens without a pointer,
 * and a touch opens it at once; the sentence describes the chip (`describeChild`), whose name stays its words.
 */
export default function MemberChip({ membership, label, hint }: { membership: Membership; label: string; hint: string }) {
  return (
    <Tooltip title={hint} describeChild enterTouchDelay={0} arrow>
      <Chip
        size="small"
        color="info"
        variant={membership === "verified" ? "filled" : "outlined"}
        label={label}
        tabIndex={0}
        data-testid="member-chip"
        data-membership={membership}
      />
    </Tooltip>
  );
}
