"use client";

import HelpOutlineIcon from "@mui/icons-material/HelpOutlineOutlined";
import Tooltip from "@mui/material/Tooltip";

/**
 * The discreet «?» after the event page's weather line (§NNN; the owner, 2026-09-26: "un mic ?
 * cu tooltip ... că poate varia și că datele sunt furnizate de open-meteo.com, dar foarte
 * discret"). A small muted glyph; the words are the tooltip and the accessible name. A client
 * island because `Tooltip` needs a ref on its child; the page hands it a string, never an element.
 * The glyph is 14 px, the button's hit area 44 px through an invisible overlay span (BR-REQ-041-01
 * criterion 6), so the line keeps its height.
 */
export default function WeatherHelp({ text }: { text: string }) {
  return (
    <Tooltip title={text} arrow enterTouchDelay={0} leaveTouchDelay={4000}>
      <button
        type="button"
        aria-label={text}
        data-testid="event-weather-help"
        style={{
          position: "relative",
          display: "inline-flex",
          verticalAlign: "-2px",
          marginLeft: 6,
          padding: 0,
          border: 0,
          background: "none",
          color: "inherit",
          cursor: "help",
          opacity: 0.55,
        }}
      >
        <HelpOutlineIcon aria-hidden="true" sx={{ fontSize: 14 }} />
        <span aria-hidden="true" style={{ position: "absolute", inset: -15 }} />
      </button>
    </Tooltip>
  );
}
