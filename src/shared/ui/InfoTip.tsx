"use client";

import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";

/**
 * An "i" that says a sentence on hover, on focus, or while a thumb rests on it — for the
 * explanation that is worth having and not worth a line (`DECISIONS.md` §139; the owner:
 * "this info should be in a tooltip"). The sentence is also the button's accessible name, so
 * a screen reader gets it without the hover. A client island because `Tooltip` needs a ref
 * on its child.
 */
export default function InfoTip({ text }: { text: string }) {
  return (
    <Tooltip title={text} arrow enterTouchDelay={0} leaveTouchDelay={6_000}>
      <IconButton aria-label={text} size="small" sx={{ minHeight: 44, minWidth: 44 }}>
        <InfoOutlinedIcon fontSize="small" />
      </IconButton>
    </Tooltip>
  );
}
