"use client";

import Box from "@mui/material/Box";
import { useSyncExternalStore } from "react";
import { rsvpSummarySuffix, type RsvpSummaryWords } from "../domain/summary";
import { readRsvpGoing, subscribeRsvpGoing } from "./going-store";

/**
 * The words after «Confirmă prezența (opțional)» on the closed fold's line (§812): « · 3 vin», « · Fii primul care confirmă», and for a
 * remembered browser that answered « · Tu vii ✓ · 3 vin». The server draws it from the page's cached count; this island adds the tick the moment
 * `RsvpRemembered` knows the browser answered (`going-store.ts`), and a refresh after a press hands it the new count as a prop —
 * the same way the card below is updated. Drawn inside the heading, so the heading's name is the whole line.
 *
 * Strings only: the words are made by the Server Component (`RsvpBox`), so this file carries no messages and imports nothing heavy.
 */
export default function RsvpSummary({ slug, words, countKnown }: { slug: string; words: RsvpSummaryWords; countKnown: boolean }) {
  const going = useSyncExternalStore(
    subscribeRsvpGoing,
    () => readRsvpGoing(slug),
    () => false,
  );
  const suffix = rsvpSummarySuffix(words, going, countKnown);
  if (suffix === "") return null;
  return (
    <Box component="span" data-testid="rsvp-summary-line" data-going={going ? "true" : "false"} sx={{ fontWeight: 400, color: "text.secondary" }}>
      {suffix}
    </Box>
  );
}
