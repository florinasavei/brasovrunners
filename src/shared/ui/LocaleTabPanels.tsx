"use client";

import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Tab from "@mui/material/Tab";
import Tabs from "@mui/material/Tabs";
import {
  createContext,
  type FormEvent,
  type ReactNode,
  startTransition,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { countForm } from "@/i18n/count-form";
import { missingForPublish, missingInLanguage, type PublishGapBox } from "@/modules/content/events/ui/publish-check";
import { paintedScheduler } from "@/shared/forms/after-paint";
import { isBlankValue } from "@/shared/forms/blank-value";
import { identicalInBothLanguages } from "@/shared/forms/both-languages";
import { createTwinFoldStore, REVEAL_EVENT, type TwinFoldStore, twinFoldKey } from "./fold";

/** What a panel tells the folds inside it (§363): the strip's shared store, its language, whether it is on top. */
export type TwinFoldPanel = { store: TwinFoldStore; locale: string; shown: boolean };

const TwinFoldContext = createContext<TwinFoldPanel | null>(null);

/** One panel's side of the strip's folds: every `useTwinFold` inside reads and writes `value.store`. */
export function TwinFoldProvider({ value, children }: { value: TwinFoldPanel; children: ReactNode }) {
  return <TwinFoldContext.Provider value={value}>{children}</TwinFoldContext.Provider>;
}

/**
 * A fold's open state, shared with its twin in every other language of the strip (§363; the
 * owner: "I would like to keep the expand/collapsed state while changing the language tab in the
 * event editor"). Keyed by `twinFoldKey(name, locale)`: opening the Romanian description opens the
 * English one, closing it in English closes it in Romanian, for as long as the page is open — and
 * across a refused save too, since the strip is not re-mounted by one while the fold inside it is.
 *
 * `open` starts `false` on the server and on the first client render, which is exactly what a
 * `<details>` without the attribute says, so nothing the server renders changes and a page with
 * JavaScript off folds as before. `shown` says whether the fold's panel is the one on top: a fold
 * that opened because its twin did may wait to mount something heavy until it can be seen.
 *
 * Outside a strip (a fold with no twins), the same answer from a store of its own.
 */
export function useTwinFold(name: string): { open: boolean; setOpen: (open: boolean) => void; shown: boolean } {
  const panel = useContext(TwinFoldContext);
  const [own] = useState(createTwinFoldStore);
  const store = panel?.store ?? own;
  const key = panel ? twinFoldKey(name, panel.locale) : name;
  const read = () => store.get(key) ?? false;
  const open = useSyncExternalStore(store.subscribe, read, read);
  const setOpen = useCallback((next: boolean) => store.set(key, next), [store, key]);
  return { open, setOpen, shown: panel?.shown ?? true };
}

export type LocalePanel = {
  locale: string;
  /** The language in its own words: "Română", "English". */
  label: string;
  /** Set when this language is not yet complete; shown on the tab. The server's first paint. */
  incompleteLabel?: string;
  /** How many required boxes this language lacks, for a strip that counts them (`requiredCount`). The server's first paint. */
  missingCount?: number;
  content: ReactNode;
};

/**
 * A strip whose boxes publication needs counts them on each tab instead of the bare mark (§NNN;
 * the owner: "I need to see on the cards as well what info is required"): «Română · 2 obligatorii
 * lipsă», «English · complet». The three counted forms (`countForm`) with `{count}`, the word for
 * none, the reader's language to choose the form in, and the card whose publication gaps are
 * counted: the count is `missingForPublish` over the form as typed, filtered to that card
 * (`missingInLanguage`) — the one rule the card's closed line, the map and "Publică" read, never a
 * second one here.
 */
export type RequiredCountWords = { one: string; few: string; other: string; complete: string; locale: string; box: PublishGapBox };

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
 * The same words in both languages (§354, bilingual everywhere): which of the panel's boxes to
 * compare across languages, what the amber line above the panels says, and the word each copying
 * tab wears — every tab after the first, compared with the first (`routing.locales` order). A
 * warning, never a refusal. `initial` is the server's answer from what is stored, so the first
 * paint already shows it; the boxes are re-read as they are typed, like the marks above.
 */
export type IdenticalWatch = { names: readonly string[]; warning: string; mark: string; initial: boolean };

/** Panel `index` shown and every other one hidden, on the DOM itself (§371; see `bringForward`). */
function showOnly(panels: readonly (HTMLElement | null)[], index: number) {
  panels.forEach((panel, other) => {
    if (panel) panel.hidden = other !== index;
  });
}

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
 * component holds which language is on top and which tabs are marked unfinished, **and which folds
 * are open** (§363): a fold inside a panel and its twin in the other language are one fold, so the
 * description opened in Română is open in English (`useTwinFold`).
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
  identical,
  requiredCount,
  live = true,
}: {
  /** The box this strip belongs to: every id on it starts with it. */
  idPrefix: string;
  panels: readonly LocalePanel[];
  /** Count the required boxes a language lacks on its tab, rather than mark it (a `required` watch). */
  requiredCount?: RequiredCountWords;
  /** Recompute the tabs' marks from the boxes as they are typed into. */
  watch?: TabWatch;
  /** The mark's word ("incomplet") for a tab that becomes unfinished while typing. */
  markLabel?: string;
  /** Warn when a watched text says the same words in both languages (§354). */
  identical?: IdenticalWatch;
  /** Whether anything here can be typed into; a read-only strip keeps the server's first answers. */
  live?: boolean;
}) {
  const [active, setActive] = useState(0);
  const [incomplete, setIncomplete] = useState<readonly boolean[]>(() => panels.map((panel) => panel.incompleteLabel !== undefined));
  const [counts, setCounts] = useState<readonly number[]>(() => panels.map((panel) => panel.missingCount ?? 0));
  const [same, setSame] = useState(identical?.initial ?? false);
  const markWord = markLabel ?? panels.find((panel) => panel.incompleteLabel)?.incompleteLabel;
  // Whether this validation pass has already brought a panel forward; see `reveal`.
  const revealed = useRef(false);
  const root = useRef<HTMLDivElement>(null);
  const panelRefs = useRef<(HTMLDivElement | null)[]>([]);
  /*
    The folds' shared state (§363), one store per strip for the strip's life. Each panel's value is
    kept stable across the re-renders typing causes (the marks), so a fold's editor re-renders on
    a tab change or its own fold's change, never on a keystroke elsewhere in the strip.
  */
  const [folds] = useState(createTwinFoldStore);
  const panelFolds = useMemo(
    () => panels.map((panel, index): TwinFoldPanel => ({ store: folds, locale: panel.locale, shown: index === active })),
    [folds, panels, active],
  );

  /**
   * Bring panel `index` forward — the DOM at once, React's state after it.
   *
   * **The whole swap is done by hand, and the state follows as a transition (§371).** The browser
   * needs the panel shown before it looks for a box to focus, so that part was always by hand; the
   * state was set at once, and React renders an update made inside an `invalid` event before the
   * event ends — the strip, and MUI's `Tabs`, which measures its tabs after every render: a forced
   * layout of the panel just revealed, inside the refused press, before the browser's own. Now the
   * siblings are hidden by hand too, so the frame shows one language, and the strip catches up in a
   * transition that does not hold the frame the refusal paints.
   *
   * Until that transition commits, the panel's folds still say `shown: false` (§363), so a
   * description whose twin is open mounts its editor in the transition's render — after the frame
   * that paints the refusal, not inside the press. What the browser points at is the fold's
   * summary line (`ValidityProxy`), which is there either way.
   */
  const bringForward = useCallback((index: number) => {
    if (revealed.current) return;
    revealed.current = true;
    setTimeout(() => {
      revealed.current = false;
    }, 0);
    showOnly(panelRefs.current, index);
    startTransition(() => setActive(index));
  }, []);

  /*
    The DOM back in step with the state whenever the state moves (§371). The hand swap above runs
    ahead of React, and React writes `hidden` only where the prop changed since its last commit, so
    the moment a new `active` commits every panel's attribute is rewritten from it. A tab press can
    also end on the `active` React already has — when it lands while a refusal's transition is
    still pending — and then nothing commits at all, so the strip's `onChange` swaps by hand too:
    between the two, the strip never names one language over the other language's panel.
  */
  useLayoutEffect(() => {
    showOnly(panelRefs.current, active);
  }, [active]);

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
    bringForward(index);
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
      const onReveal = () => bringForward(index);
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
    if ((!watch && !identical) || !live || !container) return;
    const boxOf = (locale: string, field: string) =>
      container.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[name="translations.${locale}.${field}"]`);
    const valueOf = (locale: string, field: string) => boxOf(locale, field)?.value ?? "";
    const measure = () => {
      if (watch) {
        const next = panels.map((panel) =>
          watch.names.some((field) => {
            const blank = isBlankValue(valueOf(panel.locale, field));
            if (watch.rule === "required") return blank;
            return blank && panels.some((other) => other.locale !== panel.locale && !isBlankValue(valueOf(other.locale, field)));
          }),
        );
        // The same marks keep the same array, so React renders nothing (§371): a new one re-rendered
        // the strip on every keystroke and every focus leaving a box — the press of a save button
        // too — and MUI's `Tabs` measures its tabs after every render it makes, a forced layout.
        setIncomplete((current) => (current.length === next.length && current.every((mark, index) => mark === next[index]) ? current : next));
        if (requiredCount && watch.rule === "required") {
          // The publication check itself, over the whole form as it stands (§NNN): the same gaps the
          // card's closed line and "Publică" name. A language with no boxes here (the reader may not
          // write it) keeps the server's count.
          const form = container.closest("form") ?? container;
          const gaps = missingForPublish(
            (name) => form.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[name="${name}"]`)?.value ?? "",
            panels.map((panel) => panel.locale),
          );
          const missing = panels.map((panel) =>
            watch.names.some((field) => boxOf(panel.locale, field)) ? missingInLanguage(gaps, requiredCount.box, panel.locale) : (panel.missingCount ?? 0),
          );
          setCounts((current) => (current.length === missing.length && current.every((count, index) => count === missing[index]) ? current : missing));
        }
      }
      if (identical) {
        const [first, ...rest] = panels;
        // A language with no boxes here (the reader may not write it) cannot be re-read: the
        // server's answer stands for it rather than turning into "different" on a keystroke.
        const readable = first !== undefined && rest.every((panel) => identical.names.every((field) => boxOf(panel.locale, field) && boxOf(first.locale, field)));
        if (readable) {
          setSame(identical.names.some((field) => rest.some((panel) => identicalInBothLanguages(valueOf(first.locale, field), valueOf(panel.locale, field)))));
        }
      }
    };
    // Behind the frame the keystroke or the press leads to, once for a burst (§371): the marks
    // are not what the reader is waiting for, the letter and the "Se salvează…" are.
    const scheduler = paintedScheduler(measure);
    for (const type of ["input", "change", "focusout"]) container.addEventListener(type, scheduler.schedule);
    return () => {
      for (const type of ["input", "change", "focusout"]) container.removeEventListener(type, scheduler.schedule);
      scheduler.cancel();
    };
  }, [watch, identical, live, panels, requiredCount]);

  /** The tab's own state: the counted phrase for a counting strip, the bare mark otherwise. */
  const stateOf = (index: number): string | null => {
    if (requiredCount) {
      const count = counts[index] ?? 0;
      return count === 0 ? requiredCount.complete : requiredCount[countForm(count, requiredCount.locale)].replace("{count}", String(count));
    }
    return incomplete[index] && markWord ? markWord : null;
  };

  return (
    <Box ref={root}>
      <Tabs
        value={active}
        onChange={(_, value: number) => {
          // By hand first as well: a press on a tab while a refusal's transition is still pending
          // may compute the `active` React already has, and then React rewrites no attribute (§371).
          showOnly(panelRefs.current, value);
          setActive(value);
        }}
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
            label={[
              panel.label,
              stateOf(index),
              // The copying language's tab — every one after the first — says it (§354).
              same && identical && index > 0 ? identical.mark : null,
            ]
              .filter((part): part is string => Boolean(part))
              .join(" · ")}
            id={`${idPrefix}-tab-${panel.locale}`}
            aria-controls={`${idPrefix}-panel-${panel.locale}`}
            value={index}
            sx={{ minHeight: 44, textTransform: "none" }}
          />
        ))}
      </Tabs>

      {/* The same words in both languages (§354): above the panels, so it reads whichever tab is on top. */}
      {same && identical && (
        <Alert severity="warning" sx={{ mb: 2 }} data-testid={`${idPrefix}-identical`}>
          {identical.warning}
        </Alert>
      )}

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
          <TwinFoldProvider value={panelFolds[index]}>{panel.content}</TwinFoldProvider>
        </Box>
      ))}
    </Box>
  );
}
