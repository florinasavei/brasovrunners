import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import Typography from "@mui/material/Typography";
import { getFormatter, getTranslations } from "next-intl/server";
import type { Locale } from "@/i18n/routing";
import { DIFFICULTY_LEVEL_COUNT, difficultyWords } from "@/modules/events/domain/difficulty";
import CalendarEventChip from "@/modules/events/ui/CalendarEventChip";
import { difficultyLevelGlyph } from "@/modules/events/ui/difficulty-glyphs";
import { FILTER_OPTION_SX } from "@/modules/events/ui/filter-chip-sx";
import GlyphChip from "@/modules/events/ui/GlyphChip";
import { GLYPHS } from "@/modules/events/ui/glyphs";
import { buildRoutePills } from "@/modules/events/ui/route-pills";
import RoutePills from "@/modules/events/ui/RoutePills";
import CardWeather from "@/modules/weather/ui/CardWeather";
import ChipLink from "@/shared/ui/ChipLink";
import { SAMPLE_WEATHER, sampleNightRun, sampleRace, sampleSeries } from "../fixtures";
import DesignSection, { Block, Code, ROW_SX } from "./section";

/** Every level of the club's scale, 1 to 15 (§526). */
const LEVELS = Array.from({ length: DIFFICULTY_LEVEL_COUNT }, (_, index) => index + 1);

/**
 * «Pastile și glife» (§692): the route's pills built from the sample rows by `buildRoutePills` —
 * the same function the listing card and the backoffice list call, so the page cannot draw them in
 * another order — the fifteen difficulty gauges in a row, the card's marks, the calendar entry in
 * each state it has, and the listing's filter chips, ticked and not. Every glyph crosses to
 * `GlyphChip` as a name (§112); the weather pill is made here, as `EventFacts` makes it (§370).
 */
export default async function PillSection({ locale }: { locale: Locale }) {
  const t = await getTranslations("Admin");
  const tEvent = await getTranslations("Event");
  const tEvents = await getTranslations("Events");
  const format = await getFormatter();
  const rows = [sampleRace(locale), sampleSeries(locale)[0], sampleNightRun(locale)];
  const RaceGlyph = GLYPHS["type:RACE"];
  const TrailGlyph = GLYPHS["surface:TRAIL"];

  return (
    <DesignSection id="pills" title={t("design.sections.pills")} intro={t("design.pills.intro")}>
      <Block title={t("design.pills.route")} note={t("design.pills.routeNote")}>
        <Box sx={{ display: "grid", gap: 1.5 }} data-testid="design-route-pills">
          {rows.map((row, index) => (
            <Box key={row.id} sx={{ display: "grid", gap: 0.5, gridTemplateColumns: { xs: "1fr", md: "200px minmax(0, 1fr)" }, alignItems: "center" }}>
              <Typography variant="body2" sx={{ fontWeight: 600 }}>
                {row.title}
              </Typography>
              <RoutePills pills={buildRoutePills(row, tEvent, format)} trailing={index === 0 ? <CardWeather reading={SAMPLE_WEATHER} locale={locale} /> : undefined} />
            </Box>
          ))}
        </Box>
      </Block>

      <Block title={t("design.pills.difficulty")} note={t("design.pills.difficultyNote")}>
        <Box sx={{ ...ROW_SX, gap: 1 }} data-testid="design-difficulty-row">
          {LEVELS.map((level) => {
            const words = difficultyWords(level, tEvent);
            return <GlyphChip key={level} glyph={difficultyLevelGlyph(level)} label={`${level} · ${words.short}`} srLabel={words.sr} variant="outlined" />;
          })}
        </Box>
      </Block>

      <Block title={t("design.pills.marks")} note={t("design.pills.marksNote")}>
        <Box sx={{ ...ROW_SX, gap: 1 }} data-testid="design-marks">
          <GlyphChip glyph="featured" color="primary" label={tEvents("featured")} />
          <GlyphChip glyph="special" color="secondary" label={tEvent("special")} />
          <GlyphChip glyph="repeat" variant="outlined" label={t("design.pills.weekly")} />
          <GlyphChip glyph="partner" variant="outlined" label={t("design.pills.partner")} />
          <GlyphChip glyph="membersOnly" color="primary" label={tEvent("membersOnly")} />
          <GlyphChip glyph="night" variant="outlined" label={tEvent("night.chip")} />
          <GlyphChip glyph="series" variant="outlined" label={t("design.pills.series")} />
          <GlyphChip glyph="discount" variant="outlined" label={t("design.pills.discount")} />
          <Chip size="small" color="error" label={tEvent("cancelled")} />
          <Chip size="small" label={tEvent("completed")} />
        </Box>
      </Block>

      <Block title={t("design.pills.calendar")} note={t("design.pills.calendarNote")}>
        <Box sx={{ display: "grid", gap: 1.5, gridTemplateColumns: { xs: "1fr", md: "repeat(2, minmax(0, 1fr))" } }} data-testid="design-calendar-chips">
          <Box>
            <Typography variant="caption" color="text.secondary">
              {t("design.pills.calendarStates.quiet")}
            </Typography>
            <CalendarEventChip href="#pills" time="18:30" title={rows[1].title} glyphs={["type:GROUP_RUN", "surface:ASPHALT"]} filled={false} cancelled={false} note={null} partner={null} dense={false} />
          </Box>
          <Box>
            <Typography variant="caption" color="text.secondary">
              {t("design.pills.calendarStates.filled")}
            </Typography>
            <CalendarEventChip href="#pills" time="10:00" title={rows[0].title} glyphs={["type:RACE", "surface:TRAIL"]} filled cancelled={false} note={null} partner={t("design.pills.partner")} dense={false} />
          </Box>
          <Box>
            <Typography variant="caption" color="text.secondary">
              {t("design.pills.calendarStates.cancelled")}
            </Typography>
            <CalendarEventChip
              href="#pills"
              time="18:30"
              title={rows[1].title}
              glyphs={["type:GROUP_RUN"]}
              filled={false}
              cancelled
              note={{ kind: "cancelled", text: tEvent("cancelled") }}
              partner={null}
              dense={false}
            />
          </Box>
          <Box>
            <Typography variant="caption" color="text.secondary">
              {t("design.pills.calendarStates.dense")}
            </Typography>
            <Box sx={{ width: 72, border: 1, borderColor: "divider", borderRadius: 1, p: 0.25 }}>
              <CalendarEventChip
                href="#pills"
                time="20:00"
                title={rows[2].title}
                glyphs={["type:GROUP_RUN", "surface:MIXED"]}
                filled={false}
                cancelled={false}
                note={{ kind: "moved", text: t("design.pills.calendarMoved") }}
                night={t("design.pills.calendarNight")}
                partner={t("design.pills.partner")}
                dense
              />
            </Box>
          </Box>
        </Box>
      </Block>

      <Block title={t("design.pills.filter")} note={t("design.pills.filterNote")}>
        <Box sx={{ ...ROW_SX, gap: 0.5 }} data-testid="design-filter-chips">
          <ChipLink href="#pills" label={tEvent("type.RACE")} glyph="type:RACE" active closeMark ariaLabel={`${tEvents("filter.remove")}: ${tEvent("type.RACE")}`} />
          <ChipLink href="#pills" label={tEvent("surface.TRAIL")} glyph="surface:TRAIL" />
          <ChipLink href="#pills" label={tEvents("filter.clear")} />
          <Box component="label" sx={FILTER_OPTION_SX}>
            <span>
              <input type="checkbox" name="design-filter-race" value="RACE" defaultChecked readOnly />
              <RaceGlyph aria-hidden="true" />
              {tEvent("type.RACE")}
            </span>
          </Box>
          <Box component="label" sx={FILTER_OPTION_SX}>
            <span>
              <input type="checkbox" name="design-filter-trail" value="TRAIL" readOnly />
              <TrailGlyph aria-hidden="true" />
              {tEvent("surface.TRAIL")}
            </span>
          </Box>
        </Box>
        <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 1 }}>
          <Code>FILTER_OPTION_SX</Code> · <Code>ChipLink</Code>
        </Typography>
      </Block>
    </DesignSection>
  );
}
