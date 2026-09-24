"use client";

import HelpOutlineIcon from "@mui/icons-material/HelpOutlineOutlined";
import Tooltip from "@mui/material/Tooltip";
import IconButton from "@mui/material/IconButton";
import { readingTimeMs, TOOLTIP_TEXT_SX } from "./tooltip-text";

/**
 * A "?" beside a label, holding the explanation of what the label names (`DECISIONS.md` §189,
 * §200, §341).
 *
 * The owner, of "Sunt membru al grupului Brașov Runners": "cu un semn de întrebare cu tooltip
 * care să zică «am fost la cel puțin 3 alergări de grup în ultimul an»". The claim needs a
 * definition — it decides nothing on its own (§48) but the club reads it — and a definition
 * printed under every tick would lengthen a form whose length is already the thing people
 * complain about.
 *
 * ## What the text may be
 *
 * More than one sentence (§341; the owner: "tooltipurile trebuie să fie mai lungi … cu liniuță,
 * frumos descris"): what the thing is, how to read it, what to do about it, with a list written
 * as one `\n– item` per line. The tooltip keeps those lines (`TOOLTIP_TEXT_SX`, the style
 * `InfoTip` shares), and on a touch screen it stays up for as long as the text takes to read
 * (`readingTimeMs`) rather than a fixed six seconds.
 *
 * ## Why a client island for a tooltip
 *
 * A `title` attribute is the server-only version and it is not good enough here: it never appears
 * on a touch screen, which is most of this form's traffic, and it is not reachable from a
 * keyboard. MUI's `Tooltip` opens on hover, on focus and — with `enterTouchDelay={0}` — on a tap.
 * The same text is the button's accessible name, so a screen reader hears it without the hover.
 *
 * The icon is imported **inside this island**. A Server Component that passed
 * `<HelpOutlineIcon />` as a prop would be passing a React element across the boundary, which is
 * the defect `shared/ui/CheckboxField.tsx` documents at length: past a certain tree depth React
 * outlines the subtree and the client component receives a lazy reference with no `props`. The
 * text crosses as a plain string, which is always safe.
 */
export default function Hint({ text }: { text: string }) {
  return (
    <Tooltip
      title={text}
      enterTouchDelay={0}
      leaveTouchDelay={readingTimeMs(text)}
      arrow
      slotProps={{ tooltip: { sx: TOOLTIP_TEXT_SX } }}
    >
      <IconButton
        // `button` with no form action: it must never submit the form it sits in.
        type="button"
        size="small"
        aria-label={text}
        // 44 by 44 for a thumb (BR-REQ-041-01 criterion 6: the register form is a participant
        // journey), and the negative margin gives the height back, so the label's line — a
        // table heading, a tick's label — is no taller than it was with the small button.
        sx={{ ml: 0.25, my: -1.25, minWidth: 44, minHeight: 44, color: "text.secondary" }}
      >
        <HelpOutlineIcon fontSize="small" />
      </IconButton>
    </Tooltip>
  );
}
