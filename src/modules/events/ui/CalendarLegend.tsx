import Box from "@mui/material/Box";
import { CALENDAR_TONES, type CalendarTone } from "@/modules/events/domain/calendar-kind";
import { onlyUnderLook } from "@/theme/look";
import { legendDotSx } from "./calendar-tone-sx";

export type CalendarLegendProps = {
  /** The list's accessible name: «Ce înseamnă culorile». */
  label: string;
  /** Each colour's word: «Alergări săptămânale», «Evenimente speciale», «Alte evenimente». */
  words: Record<CalendarTone, string>;
};

/**
 * What the calendar's colours mean (the facelift's phase 4): a dot and a word for each of the three
 * tones under the grid, so a colour is never the only thing that says a date's kind. A list, drawn
 * only under «Aspectul nou». A plain, synchronous Server Component with the words as props, so the
 * section that draws it (itself a Server Component) renders it in one pass, as `RoutePills` is.
 */
export default function CalendarLegend({ label, words }: CalendarLegendProps) {
  return (
    <Box
      component="ul"
      aria-label={label}
      data-testid="calendar-legend"
      sx={{ ...onlyUnderLook("flex"), flexWrap: "wrap", columnGap: 3, rowGap: 0.5, listStyle: "none", m: 0, mt: 1.5, p: 0 }}
    >
      {CALENDAR_TONES.map((tone) => (
        <Box component="li" key={tone} data-tone={tone} sx={{ display: "inline-flex", alignItems: "center", gap: 1, minHeight: 24, fontSize: "0.875rem", color: "text.secondary" }}>
          <Box component="span" aria-hidden="true" sx={legendDotSx(tone)} />
          {words[tone]}
        </Box>
      ))}
    </Box>
  );
}

/** The legend's words from the catalogue, for the section and the design page. */
export function calendarLegendWords(t: (key: `calendar.look.legend.${"label" | CalendarTone}`) => string): CalendarLegendProps {
  return {
    label: t("calendar.look.legend.label"),
    words: { weekly: t("calendar.look.legend.weekly"), special: t("calendar.look.legend.special"), other: t("calendar.look.legend.other") },
  };
}
