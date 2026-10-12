"use client";

import WatchIcon from "@mui/icons-material/Watch";
import Box from "@mui/material/Box";
import { type KeyboardEvent, type ReactNode, useRef, useState } from "react";
import SocialIcon from "@/shared/ui/SocialIcon";
import type { RouteMapProvider } from "../domain/route-maps";

/** One tab: the provider (its mark is chosen here, by name — §370), its words, and its panel's id. */
export type RouteMapTab = { provider: RouteMapProvider; label: string; tabId: string; panelId: string };

/**
 * The tabs of «Traseul»'s maps (§718; the owner, 2026-10-11: «so I will have Garmin Connect / Strava
 * in tabs and GPX file at the bottom of them»): one tab per service, Strava first (§NNN), each with its
 * mark, 44 pixels tall (BR-REQ-041-01 criterion 6).
 *
 * The one client island of the section, and a small one: the panels are the server's, passed as
 * `children` (each a `role="tabpanel"` carrying `data-route-map-panel` with its provider), and this
 * only chooses which one shows — by CSS on that attribute, so nothing is re-rendered and neither map
 * is touched. A tab switch never loads a map: each panel's map waits behind its own press (the
 * `<details>` of `RouteMapPanel`). Rendered on the server with the first tab chosen, so with scripts
 * off the first panel shows with its link, and the GPX below the tabs still downloads.
 *
 * The WAI-ARIA tabs pattern: `role="tablist"` named by the section's words, `role="tab"` with
 * `aria-selected` and `aria-controls`, a roving `tabIndex`, and the arrow keys, Home and End move
 * the choice. The marks are drawn here from the provider's name, never handed over as elements
 * (§370): Strava's own mark (§61), and a watch for Garmin Connect — a glyph, not Garmin's logo,
 * which the site does not copy.
 */
export default function RouteMapTabs({ label, tabs, children }: { label: string; tabs: readonly RouteMapTab[]; children: ReactNode }) {
  const [selected, setSelected] = useState(0);
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);

  const choose = (index: number) => {
    const next = (index + tabs.length) % tabs.length;
    setSelected(next);
    buttons.current[next]?.focus();
  };
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const moves: Record<string, number> = { ArrowRight: index + 1, ArrowLeft: index - 1, Home: 0, End: tabs.length - 1 };
    if (!(event.key in moves)) return;
    event.preventDefault();
    choose(moves[event.key]);
  };
  // Every panel but the chosen one is hidden by its provider's name: the server's markup, untouched.
  const shown = Object.fromEntries(
    tabs.map((tab, index) => [`& > [data-route-map-panel="${tab.provider}"]`, { display: index === selected ? "block" : "none" }]),
  );

  return (
    <Box data-testid="route-map-tabs">
      <Box role="tablist" aria-label={label} sx={{ display: "flex", gap: 0.5, borderBottom: 1, borderColor: "divider", mb: 1.5, flexWrap: "wrap" }}>
        {tabs.map((tab, index) => {
          const active = index === selected;
          return (
            <Box
              key={tab.provider}
              component="button"
              type="button"
              role="tab"
              id={tab.tabId}
              aria-selected={active}
              aria-controls={tab.panelId}
              tabIndex={active ? 0 : -1}
              ref={(element: HTMLButtonElement | null) => {
                buttons.current[index] = element;
              }}
              onClick={() => setSelected(index)}
              onKeyDown={(event: KeyboardEvent<HTMLButtonElement>) => onKeyDown(event, index)}
              data-route-map-tab={tab.provider}
              sx={{
                display: "inline-flex",
                alignItems: "center",
                gap: 0.75,
                minHeight: 44,
                px: 1.5,
                py: 0.5,
                border: 0,
                borderBottom: 2,
                borderColor: active ? "primary.main" : "transparent",
                bgcolor: "transparent",
                color: active ? "text.primary" : "text.secondary",
                font: "inherit",
                fontWeight: active ? 700 : 500,
                cursor: "pointer",
                mb: "-1px",
                "&:focus-visible": { outline: 2, outlineColor: "primary.main", outlineOffset: "2px" },
              }}
            >
              {tab.provider === "strava" ? <SocialIcon network="strava" size={20} /> : <WatchIcon aria-hidden="true" sx={{ fontSize: 20 }} />}
              {tab.label}
            </Box>
          );
        })}
      </Box>
      <Box sx={shown}>{children}</Box>
    </Box>
  );
}
