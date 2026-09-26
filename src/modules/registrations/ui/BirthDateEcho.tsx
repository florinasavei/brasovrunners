"use client";

import Typography from "@mui/material/Typography";
import { birthDateEchoText } from "./birth-date-echo";
import { useBirthDateValue } from "./use-birth-date-minor";

/**
 * The typed birth date read back in words, with the age on the event's day (§NNN): "Marți,
 * 3 aprilie 1990 · 36 de ani în ziua evenimentului". A native date box shows the date in the
 * browser's own order — "03/04/1990" is April to one reader and March to another — so the line
 * under it says which day was meant. Nothing before a full date is typed, and nothing without
 * JavaScript (the box itself still works; the server's refusal still says the rule).
 *
 * `template` comes from the page's catalogue with `{date}` and `{age}` left in, so this island
 * carries no words of its own (§353). `eventDay` is the event's calendar day in its own zone —
 * the same day the server's age rules count on (§321).
 */
export default function BirthDateEcho({
  birthDateId,
  locale,
  eventDay,
  template,
}: {
  birthDateId: string;
  locale: string;
  eventDay: string;
  template: string;
}) {
  const text = birthDateEchoText(useBirthDateValue(birthDateId), eventDay, locale, template);
  if (!text) return null;
  return (
    <Typography variant="body2" color="text.secondary" aria-live="polite" sx={{ mt: -1, px: 1.75 }}>
      {text}
    </Typography>
  );
}
