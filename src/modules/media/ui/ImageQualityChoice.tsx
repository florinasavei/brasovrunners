"use client";

import FormControl from "@mui/material/FormControl";
import FormControlLabel from "@mui/material/FormControlLabel";
import FormHelperText from "@mui/material/FormHelperText";
import FormLabel from "@mui/material/FormLabel";
import Radio from "@mui/material/Radio";
import RadioGroup from "@mui/material/RadioGroup";
import { useCallback, useId, useSyncExternalStore } from "react";
import { DEFAULT_IMAGE_QUALITY, IMAGE_QUALITIES, type ImageQuality, parseImageQuality } from "../ladder";

/**
 * «Calitate: Normală (recomandat) / Înaltă (fișier mai mare)», beside every upload (§NNN; the
 * owner: "I wanna choose the quality of the image when uploading it").
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

const SESSION_KEY = "br.imageQuality";
let inMemory: ImageQuality = DEFAULT_IMAGE_QUALITY;
const listeners = new Set<() => void>();

/**
 * The choice as it stands, outside React: for a handler registered once and called much later —
 * the editor's paste and drop, which Tiptap keeps from the first render — where a value from the
 * render it was made in would be the default, whatever was chosen since.
 */
export function readRemembered(): ImageQuality {
  try {
    return parseImageQuality(window.sessionStorage.getItem(SESSION_KEY)) ?? inMemory;
  } catch {
    return inMemory;
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The remembered choice and the way to change it, shared by every uploader on the page. */
export function useImageQuality(): [ImageQuality, (next: ImageQuality) => void] {
  const quality = useSyncExternalStore(subscribe, readRemembered, () => DEFAULT_IMAGE_QUALITY);
  const choose = useCallback((next: ImageQuality) => {
    inMemory = next;
    try {
      window.sessionStorage.setItem(SESSION_KEY, next);
    } catch {
      // The page's memory holds it instead; see above.
    }
    for (const listener of listeners) listener();
  }, []);
  return [quality, choose];
}

export type ImageQualityLabels = {
  legend: string;
  normal: string;
  high: string;
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
      <RadioGroup
        row
        name="quality"
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
            label={quality === "normal" ? labels.normal : labels.high}
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
