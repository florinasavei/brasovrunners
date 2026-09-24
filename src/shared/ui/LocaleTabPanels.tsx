"use client";

import Box from "@mui/material/Box";
import Tab from "@mui/material/Tab";
import Tabs from "@mui/material/Tabs";
import { type FormEvent, type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { isBlankValue } from "@/shared/forms/blank-value";
import { REVEAL_EVENT } from "./fold";

export type LocalePanel = {
  locale: string;
  /** The language in its own words: "Română", "English". */
  label: string;
  /** Set when this language is not yet complete; shown on the tab. The server's first paint. */
  incompleteLabel?: string;
  content: ReactNode;
};

/**
 * Which of the panel's boxes make its tab "· incomplet", re-read as the person types (§350):
 *
 * - `required` — any watched box empty in this language (the title and the summary, the address);
 * - `parity` — a watched box empty here while the other language has it (an optional text, where
 *   one language written and the other not is the thing worth seeing).
 *
 * `names` are the part after `translations.<locale>.`.
 */
export type TabWatch = { names: readonly string[]; rule: "required" | "parity" };

/**
 * One tab per language, over panels that are all part of the same form.
 *
 * **The panels are hidden, never unmounted, and that is the whole point.** The editor is one
 * `<form>` with one save button now, so the inactive language's inputs have to still be in the
 * document when it is submitted — a panel that unmounted on a tab change would post nothing for
 * that language, and the save would write empty strings over somebody's English text. `hidden`
 * removes it from the page and from the accessibility tree while leaving it in the form.
 *
 * **Many strips on one page** (§350): the event editor gives every box with per-language text its
 * own Română | English tabs, so the ids carry the box's `idPrefix` — `title-tab-en`,
 * `address-panel-ro` — and never collide. There is no page-wide language switch any more, so a
 * setting shared by both languages never hides behind a language tab.
 *
 * Everything below it is uncontrolled — plain `defaultValue` fields the browser owns — so this
 * component holds which language is on top and which tabs are marked unfinished.
 *
 * With JavaScript off, the first tab is the visible one and the rest are unreachable. That is a
 * degradation and not a data loss: every hidden field still carries its `defaultValue`, so a save
 * from such a browser writes the other language back exactly as it was.
 */
export default function LocaleTabPanels({
  idPrefix,
  panels,
  watch,
  markLabel,
}: {
  /** The box this strip belongs to: every id on it starts with it. */
  idPrefix: string;
  panels: readonly LocalePanel[];
  /** Recompute the tabs' marks from the boxes as they are typed into. */
  watch?: TabWatch;
  /** The mark's word ("incomplet") for a tab that becomes unfinished while typing. */
  markLabel?: string;
}) {
  const [active, setActive] = useState(0);
  const [incomplete, setIncomplete] = useState<readonly boolean[]>(() => panels.map((panel) => panel.incompleteLabel !== undefined));
  const markWord = markLabel ?? panels.find((panel) => panel.incompleteLabel)?.incompleteLabel;
  // Whether this validation pass has already brought a panel forward; see `reveal`.
  const revealed = useRef(false);
  const root = useRef<HTMLDivElement>(null);
  const panelRefs = useRef<(HTMLDivElement | null)[]>([]);

  /** Bring panel `index` forward — the DOM attribute at once, React's state after it. */
  const bringForward = useCallback((index: number, element: HTMLElement | null) => {
    if (revealed.current) return;
    revealed.current = true;
    setTimeout(() => {
      revealed.current = false;
    }, 0);
    if (element) element.hidden = false;
    setActive(index);
  }, []);

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
    bringForward(index, event.currentTarget);
  };

  /*
    The same, asked for by a descendant (`REVEAL_EVENT`): `ActionForm` dispatches it from a box the
    browser refused and from the box a refusal summary's link names, and the "missing for
    publication" list from the box it links to. A custom event because the asker does not know
    which strip, if any, the box sits in — it bubbles, and the strip that holds it answers.
  */
  useEffect(() => {
    const cleanups = panelRefs.current.map((element, index) => {
      if (!element) return () => undefined;
      const onReveal = () => bringForward(index, element);
      element.addEventListener(REVEAL_EVENT, onReveal);
      return () => element.removeEventListener(REVEAL_EVENT, onReveal);
    });
    return () => cleanups.forEach((cleanup) => cleanup());
  }, [bringForward, panels.length]);

  /*
    The marks follow the typing (§350). Read from the form's own boxes by name, on `input`,
    `change` and `focusout` inside this strip — the rich-text field announces its hidden value
    with a bubbling `input` — so a language marked unfinished loses the mark the moment its last
    box is filled, and the other language gains one when a parity text is written here first.
  */
  useEffect(() => {
    const container = root.current;
    if (!watch || !container) return;
    const valueOf = (locale: string, field: string) =>
      container.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[name="translations.${locale}.${field}"]`)?.value ?? "";
    const measure = () => {
      setIncomplete(
        panels.map((panel) =>
          watch.names.some((field) => {
            const blank = isBlankValue(valueOf(panel.locale, field));
            if (watch.rule === "required") return blank;
            return blank && panels.some((other) => other.locale !== panel.locale && !isBlankValue(valueOf(other.locale, field)));
          }),
        ),
      );
    };
    const deferred = () => setTimeout(measure, 0);
    for (const type of ["input", "change", "focusout"]) container.addEventListener(type, deferred);
    return () => {
      for (const type of ["input", "change", "focusout"]) container.removeEventListener(type, deferred);
    };
  }, [watch, panels]);

  return (
    <Box ref={root}>
      <Tabs
        value={active}
        onChange={(_, value: number) => setActive(value)}
        variant="scrollable"
        scrollButtons={false}
        /*
          Sticky at the top of its own box while the language's text scrolls past (§170; the
          owner: "this part should be sticky"). The box is the containing block, so the strip
          never outlives it and never meets the sticky save bar at the bottom of the page. It
          carries the panel's own background, or the text would scroll through it.
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
            label={incomplete[index] && markWord ? `${panel.label} · ${markWord}` : panel.label}
            id={`${idPrefix}-tab-${panel.locale}`}
            aria-controls={`${idPrefix}-panel-${panel.locale}`}
            value={index}
            sx={{ minHeight: 44, textTransform: "none" }}
          />
        ))}
      </Tabs>

      {panels.map((panel, index) => (
        <Box
          key={panel.locale}
          ref={(element: HTMLDivElement | null) => {
            panelRefs.current[index] = element;
          }}
          role="tabpanel"
          id={`${idPrefix}-panel-${panel.locale}`}
          aria-labelledby={`${idPrefix}-tab-${panel.locale}`}
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
