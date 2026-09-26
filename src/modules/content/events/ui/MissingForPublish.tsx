"use client";

import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Link from "@mui/material/Link";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { type RefObject, useEffect, useRef, useState } from "react";
import { revealField } from "@/shared/forms/ActionFormIsland";
import { paintedScheduler } from "@/shared/forms/after-paint";
import { fieldId } from "@/shared/forms/outcome";
import { fillIn } from "@/shared/forms/fill-in";
import {
  type IdenticalLabels,
  type IdenticalText,
  identicalTextLabel,
  identicalTexts,
  missingForPublish,
  type PublishGap,
  publishGapLabel,
  type PublishGapLabels,
} from "./publish-check";

const NO_GAPS: readonly PublishGap[] = [];

/** How `usePublishGaps` starts and where it reads (§406). */
export type PublishGapsOptions = {
  /**
   * The server's answer for the first paint: the saved event on the editor, the blank form on the
   * create page — the same function over the same values, so nothing moves when the script
   * arrives. Nothing, for a list that may start empty.
   */
  initial?: readonly PublishGap[];
  /** The form to read, by id, for an island that sits outside it (the editor's map, §406). */
  formId?: string;
  /**
   * The saved value of each box the check reads, for a box the form does not draw: a language the
   * reader may not write, the place for a role that may not change the settings. Absent from the
   * form is not blank — it is what is stored (`storedPublishReader`).
   */
  stored?: Readonly<Record<string, string>>;
};

/** A box's value as the check reads it: what the form posts, or what is stored when the form has no such box. */
function readBox(form: HTMLFormElement, data: FormData, name: string, stored: Readonly<Record<string, string>> | undefined): string {
  if (stored && form.elements.namedItem(name) === null) return stored[name] ?? "";
  return String(data.get(name) ?? "");
}

/**
 * The publication gaps of the form an element sits in, re-read as the form is typed into (§350).
 *
 * The rich-text fields announce their hidden value with a bubbling `input`, and the "to be
 * announced" switch re-sends `change` once its box has lost `required`, so listening on the form
 * is enough; the measure waits because the editor writes after the keystroke it answers — and it
 * waits for the frame, once for a burst of keystrokes (§371), because it reads the whole form
 * and a keystroke is owed its letter first. The list is replaced only when it changed, so a
 * keystroke that closes no gap re-renders nothing.
 */
export function usePublishGaps(anchor: RefObject<HTMLElement | null>, locales: readonly string[], options: PublishGapsOptions = {}): PublishGap[] {
  const { initial = NO_GAPS, formId, stored } = options;
  const [gaps, setGaps] = useState<PublishGap[]>(() => [...initial]);
  useEffect(() => {
    const byId = formId ? document.getElementById(formId) : null;
    const form = byId instanceof HTMLFormElement ? byId : anchor.current?.closest("form");
    if (!form) return;
    const measure = () => {
      const data = new FormData(form);
      const next = missingForPublish((name) => readBox(form, data, name, stored), locales);
      setGaps((current) => (sameNames(current, next) ? current : next));
    };
    const scheduler = paintedScheduler(measure);
    measure();
    form.addEventListener("input", scheduler.schedule);
    form.addEventListener("change", scheduler.schedule);
    return () => {
      form.removeEventListener("input", scheduler.schedule);
      form.removeEventListener("change", scheduler.schedule);
      scheduler.cancel();
    };
  }, [anchor, locales, formId, stored]);
  return gaps;
}

/** Whether two lists name the same boxes in the same order: a gap or a copy is its box's name. */
function sameNames(a: readonly { name: string }[], b: readonly { name: string }[]): boolean {
  return a.length === b.length && a.every((item, index) => item.name === b[index].name);
}

/**
 * The long texts of the form an element sits in whose English says the Romanian word for word
 * (§354, bilingual everywhere), re-read as the form is typed into — `usePublishGaps`'s twin for
 * the one check that warns rather than refuses.
 */
function useIdenticalTexts(anchor: RefObject<HTMLElement | null>, locales: readonly string[], on: boolean): IdenticalText[] {
  const [found, setFound] = useState<IdenticalText[]>([]);
  useEffect(() => {
    const form = anchor.current?.closest("form");
    if (!form || !on) return;
    const measure = () => {
      const data = new FormData(form);
      const next = identicalTexts((name) => String(data.get(name) ?? ""), locales);
      setFound((current) => (sameNames(current, next) ? current : next));
    };
    // After the frame, once for a burst, and a new list only when it changed — as the gaps (§371).
    const scheduler = paintedScheduler(measure);
    measure();
    form.addEventListener("input", scheduler.schedule);
    form.addEventListener("change", scheduler.schedule);
    return () => {
      form.removeEventListener("input", scheduler.schedule);
      form.removeEventListener("change", scheduler.schedule);
      scheduler.cancel();
    };
  }, [anchor, locales, on]);
  return found;
}

/**
 * The texts that say the same words in both languages, under the Publicare box's gaps (§354):
 * amber, each a link to the English box like a gap's line, and said not to block publication —
 * a short text may honestly be the same. The editor renders the same list from what is stored;
 * the create page's is this one, live.
 */
export function IdenticalTextsList({ items, labels, title }: { items: readonly IdenticalText[]; labels: IdenticalLabels; title: string }) {
  if (items.length === 0) return null;
  return (
    <Alert severity="warning" icon={false} data-testid="identical-texts">
      <Typography variant="subtitle2" component="p" sx={{ fontWeight: 600 }}>
        {title}
      </Typography>
      <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
        {items.map((item) => (
          <li key={item.name}>
            <RevealLink name={item.name}>{identicalTextLabel(item, labels)}</RevealLink>
          </li>
        ))}
      </Box>
    </Alert>
  );
}

/**
 * "Ce lipsește pentru publicare", on the create page's Publicare box (§350): one line per gap,
 * named by the box and the tab that hold it ("Titlu și rezumat › English › Rezumat"), each a link
 * that opens every fold around the box and brings its tab forward before the browser scrolls to
 * it. The same check "Creează și publică" runs (`missingForPublish`), so the list and the button
 * never disagree. Nothing when nothing is missing.
 */
export function MissingForPublishList({
  locales,
  labels,
  title,
  complete,
  identical,
}: {
  locales: readonly string[];
  labels: PublishGapLabels;
  title: string;
  /** "Nothing is missing" — said rather than an empty space. */
  complete: string;
  /** The texts identical in both languages (§354), listed under the gaps as warnings. */
  identical?: { labels: IdenticalLabels; title: string };
}) {
  const anchor = useRef<HTMLDivElement>(null);
  const gaps = usePublishGaps(anchor, locales);
  const same = useIdenticalTexts(anchor, locales, identical !== undefined);
  return (
    <Stack spacing={1.5} ref={anchor}>
      <Box data-testid="missing-for-publish">
        <Typography variant="subtitle2" component="p" sx={{ fontWeight: 600 }}>
          {title}
        </Typography>
        {gaps.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            {complete}
          </Typography>
        ) : (
          <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
            {gaps.map((gap) => (
              <li key={gap.name}>
                <Link
                  href={`#${fieldId(gap.name)}`}
                  variant="body2"
                  onClick={() => revealField(document.getElementById(fieldId(gap.name)))}
                  sx={{ display: "inline-flex", alignItems: "center", minHeight: 44 }}
                >
                  {publishGapLabel(gap, labels)}
                </Link>
              </li>
            ))}
          </Box>
        )}
      </Box>
      {identical && <IdenticalTextsList items={same} labels={identical.labels} title={identical.title} />}
    </Stack>
  );
}

/**
 * One line of the editor's server-computed "Ce lipsește pentru publicare" (§350): a link to the
 * box it names that opens every fold around it and brings its tab forward first.
 */
export function RevealLink({ name, children }: { name: string; children: string }) {
  return (
    <Link
      href={`#${fieldId(name)}`}
      variant="body2"
      onClick={() => revealField(document.getElementById(fieldId(name)))}
      sx={{ display: "inline-flex", alignItems: "center", minHeight: 44 }}
    >
      {children}
    </Link>
  );
}

/** The Publicare box's closed line on the create page: "Ciornă nouă · lipsesc 5 lucruri pentru publicare". */
export function MissingForPublishCount({
  locales,
  template,
  ready,
}: {
  locales: readonly string[];
  /** With `{count}`. */
  template: string;
  /** When nothing is missing. */
  ready: string;
}) {
  const anchor = useRef<HTMLSpanElement>(null);
  const gaps = usePublishGaps(anchor, locales);
  return <span ref={anchor}>{gaps.length === 0 ? ready : fillIn(template, { count: gaps.length })}</span>;
}
