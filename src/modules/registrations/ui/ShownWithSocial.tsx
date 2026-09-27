"use client";

import Box from "@mui/material/Box";
import { useCallback, useSyncExternalStore } from "react";
import type { ReactNode } from "react";

/**
 * The tick «Arată și Strava și Instagram lângă numele meu pe listă» (§500) is asked only once
 * there is something to show: hidden, and out of the form, until the Strava box or the Instagram
 * box in the socials fold holds a value. The mirror of `HiddenForMinor`, reading the two boxes
 * instead of the birth date.
 *
 * Shown in the server's markup and with JavaScript off, because nothing typed is known there — the
 * service drops the tick without a social whatever the browser sent, so an early tick is harmless.
 * Hidden means a `disabled` fieldset as well as `display: none`, so a tick left behind after both
 * boxes were emptied is not posted.
 *
 * `forceOpen` keeps it shown when a submission came back with the tick on (a returned form whose
 * socials are prefilled shows it anyway; this covers the rest), so a consent the runner gave is
 * never silently hidden.
 */
export default function ShownWithSocial({
  inputIds,
  forceOpen = false,
  children,
}: {
  inputIds: readonly string[];
  forceOpen?: boolean;
  children: ReactNode;
}) {
  const key = inputIds.join(" ");
  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      const inputs = key
        .split(" ")
        .map((id) => document.getElementById(id))
        .filter((input): input is HTMLInputElement => input instanceof HTMLInputElement);
      for (const input of inputs) {
        // `input` for typing, `change` for autofill.
        input.addEventListener("input", onStoreChange);
        input.addEventListener("change", onStoreChange);
      }
      return () => {
        for (const input of inputs) {
          input.removeEventListener("input", onStoreChange);
          input.removeEventListener("change", onStoreChange);
        }
      };
    },
    [key],
  );

  const hasSocial = useSyncExternalStore(
    subscribe,
    () =>
      key.split(" ").some((id) => {
        const input = document.getElementById(id);
        return input instanceof HTMLInputElement && input.value.trim() !== "";
      }),
    // On the server nothing is typed and nothing is known: show it (see above).
    () => true,
  );

  const hidden = !hasSocial && !forceOpen;
  return (
    <Box
      component="fieldset"
      disabled={hidden}
      data-testid="list-socials-gate"
      // The fieldset's own border, padding and min-width undone, as on `HiddenForMinor`.
      sx={{ display: hidden ? "none" : "block", border: 0, p: 0, m: 0, minWidth: 0 }}
    >
      {children}
    </Box>
  );
}
