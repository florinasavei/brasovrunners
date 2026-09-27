import QuietHelp from "@/shared/ui/QuietHelp";

/**
 * The discreet «?» after the event page's weather line (§473; the owner, 2026-09-26: "un mic ?
 * cu tooltip ... că poate varia și că datele sunt furnizate de open-meteo.com, dar foarte
 * discret"). A small muted glyph; the words are the tooltip and the accessible name. The island
 * is `QuietHelp` (shared since the calendar page's «?», §NNN); the page hands it a string, never
 * an element. The glyph is 14 px, the hit area 44 px (BR-REQ-041-01 criterion 6), so the line
 * keeps its height.
 */
export default function WeatherHelp({ text }: { text: string }) {
  return <QuietHelp text={text} testId="event-weather-help" glyphSize={14} />;
}
