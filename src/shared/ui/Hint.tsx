"use client";

import HelpOutlineIcon from "@mui/icons-material/HelpOutlineOutlined";
import Tooltip from "@mui/material/Tooltip";
import IconButton from "@mui/material/IconButton";

/**
 * A "?" beside a label, holding one sentence of explanation (`DECISIONS.md` §189).
 *
 * The owner, of "Sunt membru al grupului Brașov Runners": "cu un semn de întrebare cu tooltip
 * care să zică «am fost la cel puțin 3 alergări de grup în ultimul an»". The claim needs a
 * definition — it decides nothing on its own (§48) but the club reads it — and a definition
 * printed under every tick would lengthen a form whose length is already the thing people
 * complain about.
 *
 * ## Why a client island for a tooltip
 *
 * A `title` attribute is the server-only version and it is not good enough here: it never appears
 * on a touch screen, which is most of this form's traffic, and it is not reachable from a
 * keyboard. MUI's `Tooltip` opens on hover, on focus and — with `enterTouchDelay={0}` — on a tap.
 *
 * The icon is imported **inside this island**. A Server Component that passed
 * `<HelpOutlineIcon />` as a prop would be passing a React element across the boundary, which is
 * the defect `shared/ui/CheckboxField.tsx` documents at length: past a certain tree depth React
 * outlines the subtree and the client component receives a lazy reference with no `props`. The
 * text crosses as a plain string, which is always safe.
 */
export default function Hint({ text }: { text: string }) {
  return (
    <Tooltip title={text} enterTouchDelay={0} leaveTouchDelay={6000} arrow>
      <IconButton
        // `button` with no form action: it must never submit the form it sits in.
        type="button"
        size="small"
        aria-label={text}
        sx={{ ml: 0.5, color: "text.secondary" }}
      >
        <HelpOutlineIcon fontSize="small" />
      </IconButton>
    </Tooltip>
  );
}
