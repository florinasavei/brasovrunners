"use client";

import Box from "@mui/material/Box";
import Tab from "@mui/material/Tab";
import Tabs from "@mui/material/Tabs";
import { type FormEvent, type ReactNode, useRef, useState } from "react";

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
  // Whether this validation pass has already brought a panel forward; see `reveal`.
  const revealed = useRef(false);

  /**
   * A required box on a hidden tab, when the browser refuses the submit.
   *
   * The browser checks every control, fires `invalid` on each empty required one, then focuses
   * the first and names it in a bubble — unless that control is not focusable, in which case it
   * logs "an invalid form control is not focusable" and nothing visible happens at all. A
   * `hidden` panel is exactly that: on the create form, an English title left empty behind the
   * Romanian tab is a "Creează" button that does nothing. So the panel that holds the control
   * comes forward **during** the event — the DOM attribute set by hand, because React's own
   * re-render lands after the browser has already looked for something to focus — and every
   * closed `<details>` on the way up is opened, since a fold hides a box the same way. The
   * first invalid control is the one the browser will point at, so the first event of a pass
   * decides which tab wins; the rest only open their folds.
   */
  const reveal = (index: number) => (event: FormEvent<HTMLDivElement>) => {
    let node = (event.target as HTMLElement | null)?.parentElement ?? null;
    while (node && node !== event.currentTarget) {
      if (node instanceof HTMLDetailsElement) node.open = true;
      node = node.parentElement;
    }
    if (revealed.current) return;
    revealed.current = true;
    setTimeout(() => {
      revealed.current = false;
    }, 0);
    event.currentTarget.hidden = false;
    setActive(index);
  };

  return (
    <Box>
      <Tabs
        value={active}
        onChange={(_, value: number) => setActive(value)}
        variant="scrollable"
        scrollButtons={false}
        /*
          Sticky at the top of the panel while the language's text scrolls past (§170; the
          owner: "this part should be sticky"). The content panel is the tallest thing on the
          page — two rich-text editors, the rules, the programme — and by the time somebody is
          at the bottom of the Romanian text, the way to the English one is a page and a half
          above. It carries the panel's own background, or the text would scroll through it.
        */
        sx={{
          position: "sticky",
          top: 0,
          zIndex: 3,
          bgcolor: "background.paper",
          mb: 2,
          borderBottom: 1,
          borderColor: "divider",
          minHeight: 44,
        }}
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
          onInvalid={reveal(index)}
          // Which language a box belongs to, for `SubmitButton`'s "fill in first: English: Titlu".
          data-language={panel.label}
        >
          {panel.content}
        </Box>
      ))}
    </Box>
  );
}
