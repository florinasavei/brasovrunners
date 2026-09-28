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
 * «Calitate» beside every upload (§414, §437): chosen per picture, remembered for the session.
 * One store for every uploader on the page (`useSyncExternalStore`); the server snapshot is the
 * default so hydration matches.
 */

/* `sessionStorage`, not `localStorage`: a shared laptop's next person starts from the default. */
const SESSION_KEY = "br.imageQuality";
/** This page's own copy, and the only one when the browser refuses the store. */
let inMemory: ImageQuality = DEFAULT_IMAGE_QUALITY;
/** False once a write has thrown: the store then holds an older choice and is not read again. */
let storeHoldsChoice = true;
const listeners = new Set<() => void>();

/**
 * The current choice outside React, for handlers Tiptap keeps from the first render. Falls back to
 * memory on any store failure; `null` is checked first because `parseImageQuality(null)` is the default.
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

/** One label per choice (§437: «Minimă», «Medie», «Mare», «Originală»), the legend and the help. */
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
      {/* No `name`: each group stays separate, and nothing called `quality` posts with the form. */}
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
            // BR-REQ-041-01 criterion 6.
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
