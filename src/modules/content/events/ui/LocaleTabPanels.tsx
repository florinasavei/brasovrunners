"use client";

import Box from "@mui/material/Box";
import Tab from "@mui/material/Tab";
import Tabs from "@mui/material/Tabs";
import { type ReactNode, useState } from "react";

export type LocalePanel = {
  locale: string;
  /** The language in its own words: "Română", "English". */
  label: string;
  /** Set when this language is not yet complete enough to publish; shown on the tab. */
  incompleteLabel?: string;
  content: ReactNode;
};

/**
 * One tab per language, over panels that are all part of the same form.
 *
 * **The panels are hidden, never unmounted, and that is the whole point.** The editor is one
 * `<form>` with one save button now, so the inactive language's inputs have to still be in the
 * document when it is submitted — a panel that unmounted on a tab change would post nothing for
 * that language, and the save would write empty strings over somebody's English text. `hidden`
 * removes it from the page and from the accessibility tree while leaving it in the form.
 *
 * The one client island in the editor, and it earns it: switching tabs is the only thing on this
 * page that should not cost a round trip. Everything below it is uncontrolled — plain
 * `defaultValue` fields the browser owns — so this component holds exactly one piece of state,
 * which language is on top.
 *
 * With JavaScript off, the first tab is the visible one and the rest are unreachable. That is a
 * degradation and not a data loss: every hidden field still carries its `defaultValue`, so a save
 * from such a browser writes the other language back exactly as it was.
 */
export default function LocaleTabPanels({ panels }: { panels: readonly LocalePanel[] }) {
  const [active, setActive] = useState(0);

  return (
    <Box>
      <Tabs
        value={active}
        onChange={(_, value: number) => setActive(value)}
        variant="scrollable"
        scrollButtons={false}
        sx={{ mb: 2, borderBottom: 1, borderColor: "divider", minHeight: 44 }}
      >
        {panels.map((panel, index) => (
          <Tab
            key={panel.locale}
            /*
              The language in its own words, and a mark when it is not finished. "Conținut (EN)"
              said which panel this was and nothing about whether anybody had filled it in — so
              the missing language was found at the moment publication was refused, which is the
              worst moment to find it.
            */
            label={
              panel.incompleteLabel ? `${panel.label} · ${panel.incompleteLabel}` : panel.label
            }
            id={`locale-tab-${panel.locale}`}
            aria-controls={`locale-panel-${panel.locale}`}
            value={index}
            sx={{ minHeight: 44, textTransform: "none" }}
          />
        ))}
      </Tabs>

      {panels.map((panel, index) => (
        <Box
          key={panel.locale}
          role="tabpanel"
          id={`locale-panel-${panel.locale}`}
          aria-labelledby={`locale-tab-${panel.locale}`}
          hidden={index !== active}
        >
          {panel.content}
        </Box>
      ))}
    </Box>
  );
}
