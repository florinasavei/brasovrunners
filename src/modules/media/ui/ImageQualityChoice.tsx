"use client";

import FormControl from "@mui/material/FormControl";
import FormControlLabel from "@mui/material/FormControlLabel";
import FormHelperText from "@mui/material/FormHelperText";
import FormLabel from "@mui/material/FormLabel";
import Radio from "@mui/material/Radio";
import RadioGroup from "@mui/material/RadioGroup";
import { useId, useSyncExternalStore } from "react";
import { DEFAULT_IMAGE_QUALITY, IMAGE_QUALITIES, type ImageQuality, parseImageQuality } from "../ladder";

/**
 * «Calitate: Minimă / Medie (recomandat) / Mare / Originală», beside every upload (§414, four
 * levels since §NNN; the owner: "I wanna choose the quality of the image when uploading it").
 *
 * **Per upload, remembered for the session.** The choice is about the picture — a poster with a
 * list of rules wants "high", a photograph from the finish does not — so it is made where the
 * picture is chosen and not in a setting somewhere else. It is remembered in `sessionStorage` so
 * an organizer filling an album of posters says it once, and forgotten with the tab so the next
 * person starts from the recommendation. Every read and write is wrapped: a private window or a
 * blocked store keeps the choice in this page's memory instead, and the page works the same.
 *
 * One store for every uploader on the page (`useSyncExternalStore`), so the gallery's control and
 * each editor's say the same thing; the server snapshot is the default, so the first paint
 * matches the server's HTML and the remembered choice arrives with hydration.
 */

/*
  `sessionStorage`, not `localStorage`, deliberately: the choice is about the pictures of one
  sitting — an album of posters, a page with a map — and a shared backoffice laptop should not
  start the next person, or the same person next week, on «Înaltă» because of what was uploaded
  before. Closing the tab is the reset, and the recommendation is where every new tab starts.
*/
const SESSION_KEY = "br.imageQuality";
/** This page's own copy, and the only one when the browser refuses the store. */
let inMemory: ImageQuality = DEFAULT_IMAGE_QUALITY;
/**
 * Whether the store took the last choice. Once a write has thrown — a private window, a full
 * quota, site data blocked — the store is not read again for this page: whatever it holds is
 * older than the choice just made, and reading it back would undo that choice.
 */
let storeHoldsChoice = true;
const listeners = new Set<() => void>();

/**
 * The choice as it stands, outside React: for a handler registered once and called much later —
 * the editor's paste and drop, which Tiptap keeps from the first render — where a value from the
 * render it was made in would be the default, whatever was chosen since.
 *
 * The store when it works; this page's memory when it throws, when a write to it has thrown,
 * when it holds nothing and when it holds something that is not a choice. (The first version
 * read `parseImageQuality(stored) ?? inMemory`, and `parseImageQuality(null)` is the default,
 * so the memory was never reached — found by re-review, §414.)
 */
export function readRemembered(): ImageQuality {
  if (!storeHoldsChoice) return inMemory;
  let stored: string | null;
  try {
    stored = window.sessionStorage.getItem(SESSION_KEY);
  } catch {
    return inMemory;
  }
  if (stored === null) return inMemory;
  return parseImageQuality(stored) ?? inMemory;
}

/** Remember a choice for the rest of the session, in the store if it takes it. */
export function rememberQuality(next: ImageQuality): void {
  inMemory = next;
  try {
    window.sessionStorage.setItem(SESSION_KEY, next);
    storeHoldsChoice = true;
  } catch {
    storeHoldsChoice = false;
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The remembered choice and the way to change it, shared by every uploader on the page. */
export function useImageQuality(): [ImageQuality, (next: ImageQuality) => void] {
  const quality = useSyncExternalStore(subscribe, readRemembered, () => DEFAULT_IMAGE_QUALITY);
  return [quality, rememberQuality];
}

/** One label per choice (§NNN: «Minimă», «Medie», «Mare», «Originală»), the legend and the help. */
export type ImageQualityLabels = Record<ImageQuality, string> & {
  legend: string;
  help: string;
};

export default function ImageQualityChoice({
  value,
  onChange,
  labels,
  disabled = false,
}: {
  value: ImageQuality;
  onChange: (next: ImageQuality) => void;
  labels: ImageQualityLabels;
  disabled?: boolean;
}) {
  const helpId = useId();
  return (
    <FormControl component="fieldset" disabled={disabled} data-testid="image-quality" sx={{ minWidth: 0 }}>
      <FormLabel component="legend" sx={{ typography: "body2", fontWeight: 600 }}>
        {labels.legend}
      </FormLabel>
      {/*
        No `name`: MUI gives each group its own, so the picture bar, a film's panel and the other
        language's editor are separate groups rather than one native group across the page — and
        nothing called `quality` rides along with the editor's form when it is saved.
      */}
      <RadioGroup
        row
        value={value}
        aria-describedby={helpId}
        onChange={(event) => {
          const next = parseImageQuality(event.target.value);
          if (next) onChange(next);
        }}
      >
        {IMAGE_QUALITIES.map((quality) => (
          <FormControlLabel
            key={quality}
            value={quality}
            control={<Radio size="small" />}
            label={labels[quality]}
            // A thumb must hit it (BR-REQ-041-01 criterion 6): the whole row is the target.
            sx={{ minHeight: 44, mr: 2 }}
          />
        ))}
      </RadioGroup>
      <FormHelperText id={helpId} sx={{ mx: 0 }}>
        {labels.help}
      </FormHelperText>
    </FormControl>
  );
}
