import DescriptionOutlinedIcon from "@mui/icons-material/DescriptionOutlined";
import LeaderboardIcon from "@mui/icons-material/Leaderboard";
import PhotoLibraryOutlinedIcon from "@mui/icons-material/PhotoLibraryOutlined";
import Box from "@mui/material/Box";
import type { ReactNode } from "react";
import { DENSITY } from "@/theme/density";

/** The event page's tabs, in their order; each key is its panel's anchor (`#clasament`, the address the listing's card already links). */
export const EVENT_TAB_KEYS = ["descriere", "clasament", "galerie"] as const;
export type EventTabKey = (typeof EVENT_TAB_KEYS)[number];

/** The row of tabs: each tab drawn, in order, with its word. */
export type EventTabLinks = readonly { key: EventTabKey; label: string }[];

const TAB_GLYPH: Record<EventTabKey, typeof LeaderboardIcon> = {
  descriere: DescriptionOutlinedIcon,
  clasament: LeaderboardIcon,
  galerie: PhotoLibraryOutlinedIcon,
};

/**
 * Which panel shows (§NNN). The first, «Descriere», unless the address's fragment names another panel or something inside one —
 * `:target`, read by the browser before any script, so `…#clasament` opens on the results with JavaScript off and on the first paint —
 * and, once the page's one fragment island ran (`OpenFoldFromHash` → `showTabsAround`), the panel it chose (`data-tab-active`), which
 * also answers a client-side navigation `:target` never sees. No commas inside a pseudo-class: one rule each.
 */
const TABS_SX = {
  "& > [data-tab-panel]:not([data-tab-panel='descriere'])": { display: "none" },
  "& > [data-tab-panel]:target": { display: "block" },
  "& > [data-tab-panel]:has(:target)": { display: "block" },
  "&:has([data-tab-panel]:not([data-tab-panel='descriere']):target) > [data-tab-panel='descriere']": { display: "none" },
  "&:has([data-tab-panel]:not([data-tab-panel='descriere']) :target) > [data-tab-panel='descriere']": { display: "none" },
  "&[data-tab-active] > [data-tab-panel]": { display: "none" },
  "&[data-tab-active='descriere'] > [data-tab-panel='descriere']": { display: "block" },
  "&[data-tab-active='clasament'] > [data-tab-panel='clasament']": { display: "block" },
  "&[data-tab-active='galerie'] > [data-tab-panel='galerie']": { display: "block" },
} as const;

/**
 * **«Descriere | Clasament | Galerie foto»** — the event page's tabs (§NNN; the owner, 2026-11-22, of the race's page the day after:
 * «aici vreau așa: tab-uri: Descriere, Clasament și Galerie Foto»). Server-rendered and plain links, no JavaScript of their own.
 *
 * Each panel (`EventTabPanel`) starts with the row of tabs, its own drawn current (`aria-current`), and carries its key as its `id`: a
 * tab is a link to its panel, so the browser's own jump lands on the row of tabs, which stays in view, and `#clasament` — the address
 * the listing's card, the home page and the emails already use — opens the results. A tab is drawn only when it has something (the
 * caller decides); with the description alone there is no row at all and the page is drawn as before.
 */
export default function EventTabs({ tabs, children }: { tabs: EventTabLinks; children?: ReactNode }) {
  if (tabs.length < 2) return <>{children}</>;
  return (
    <Box data-tabs="" data-testid="event-tabs" sx={TABS_SX}>
      {children}
    </Box>
  );
}

/** One panel of `EventTabs`: the row of tabs with this one current, then what it holds — or, with one tab alone, what it holds. */
export function EventTabPanel({ tab, tabs, label, children }: { tab: EventTabKey; tabs: EventTabLinks; label: string; children?: ReactNode }) {
  if (tabs.length < 2) return <>{children}</>;
  return (
    <Box component="section" id={tab} data-tab-panel={tab} data-testid={`event-tab-panel-${tab}`} sx={{ mt: { xs: DENSITY.gapSm, sm: 2 } }}>
      <Box component="nav" aria-label={label} sx={{ display: "flex", gap: 0.5, borderBottom: 1, borderColor: "divider", mb: { xs: DENSITY.gapSm, sm: 2 }, overflowX: "auto" }}>
        {tabs.map((link) => {
          const Glyph = TAB_GLYPH[link.key];
          const current = link.key === tab;
          return (
            <Box
              key={link.key}
              component="a"
              href={`#${link.key}`}
              aria-current={current ? "true" : undefined}
              data-testid="event-tab"
              data-tab={link.key}
              sx={{
                display: "inline-flex",
                alignItems: "center",
                gap: 0.75,
                minHeight: 44,
                px: 1.5,
                mb: "-1px",
                whiteSpace: "nowrap",
                textDecoration: "none",
                fontWeight: 600,
                color: current ? "primary.main" : "text.secondary",
                borderBottom: 2,
                borderColor: current ? "primary.main" : "transparent",
                "&:hover": { color: "primary.main" },
              }}
            >
              <Glyph aria-hidden="true" sx={{ fontSize: 20 }} />
              {link.label}
            </Box>
          );
        })}
      </Box>
      {children}
    </Box>
  );
}
