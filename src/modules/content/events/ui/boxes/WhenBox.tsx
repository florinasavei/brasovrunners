import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { getLocale, getTranslations } from "next-intl/server";
import { CLUB_TIME_ZONE } from "@/i18n/dates";
import RecallField from "@/shared/forms/recall";
import { textFieldConstraints } from "@/shared/forms/constraints";
import Panel from "@/shared/ui/Panel";
import { startBoxValues, typedStartOrNull } from "@/modules/events/domain/provisional-start";
import { toWallTimeInput } from "@/modules/events/domain/zoned-time";
import { eventInputConstraints } from "../../constraints";
import { DURATION_HOURS_CONSTRAINTS, DURATION_MINUTES_CONSTRAINTS, savedDurationMinutes, splitDuration } from "../../duration";
import { placeSummary, summaryDateTime, timezoneSummary, whenSummary } from "../box-summaries";
import OnlyForType from "../OnlyForType";
import RaceStartNotSet from "../RaceStartNotSet";
import StartToBeAnnounced from "../StartToBeAnnounced";
import WallTimeField from "../WallTimeField";
import { BoxNote, type BoxProps, type LanguageEntry, requiredLine, RiskLine, SettingsReadOnly, summaryWords } from "./box-kit";
import PlaceFields, { placeNameInBox } from "./PlaceBox";

/** The club's own zone. Offered as the default rather than the browser's, which on a phone in
 * an airport is not where the race is. */
export const DEFAULT_TIMEZONE = CLUB_TIME_ZONE;

/**
 * The zones an organizer may pick (§153): every IANA zone this runtime knows, the club's first,
 * then Europe, then the rest — a native select, searchable by typing. A stored zone the runtime
 * no longer lists is kept as an option so an old event still saves.
 */
function timezoneOptions(current: string): readonly string[] {
  const known = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [DEFAULT_TIMEZONE];
  const europe = known.filter((zone) => zone.startsWith("Europe/") && zone !== DEFAULT_TIMEZONE);
  const rest = known.filter((zone) => !zone.startsWith("Europe/"));
  const ordered = [DEFAULT_TIMEZONE, ...europe, ...rest];
  return ordered.includes(current) ? ordered : [current, ...ordered];
}

/** A named part of the card: a plain heading over its fields, never a fold of its own. */
function PartHeading({ id, children }: { id: string; children: string }) {
  return (
    <Typography component="h3" id={id} variant="subtitle2">
      {children}
    </Typography>
  );
}

/**
 * «Când și unde» (§481; the owner, 2026-09-27: "The back-office event creator/editor needs to be
 * more grouped: date and location can be on the same card"). §350's box 4 «Data și ora» and box 5
 * «Locul» are one card now, as the page draws them — «Când», then «Unde», one under the other in
 * the facts — in this order:
 *
 * 1. **Data și ora** — when it starts, the gun time on a race (§71), how long it lasts (§433);
 * 2. **Locul** (`#box-place`, `PlaceFields`) — «to be announced» (§328), the meeting point once per
 *    language (§362), the map link, the coordinates (§416);
 * 3. **Fus orar** — folded away as the one level-3 card inside, because it is changed only for an
 *    event somewhere else.
 *
 * The page address (`AddressBox`) is not here: it is the page's own address, not the event's
 * place, and stays with the cards that are not on the page (§406).
 *
 * The closed line starts with what publication still needs from it — the meeting point, per
 * language (§406) — then the date, then the place. Open on the create page, where the date is
 * required; folded on the editor. With people registered, the card is amber and says what a new
 * date and a new place do to them. Field names, ids and refusals are the two boxes' own, unchanged.
 */
export default async function WhenBox({
  event,
  mayEditSettings,
  risk,
  heading,
  languages,
  inSeries = false,
}: BoxProps & { languages: readonly LanguageEntry[]; inSeries?: boolean }) {
  const t = await getTranslations("Admin");
  const { words } = await summaryWords();
  // The reader's language for the dates (`src/i18n/dates.ts`), on the event's own clock.
  const locale = await getLocale();
  const zone = event?.timezone ?? DEFAULT_TIMEZONE;
  const initialType = event?.type ?? "GROUP_RUN";
  const duration = splitDuration(savedDurationMinutes(event?.startsAt, event?.endsAt));
  const translations = languages.map((entry) => entry.translation);
  // The place a change moves people away from, as the Romanian page names it (§362).
  const place = placeNameInBox(event, languages, "ro");
  // What publication still needs from this card, in each language (§406): the meeting point.
  const required = await requiredLine("place", event, languages);
  const raceWall = toWallTimeInput(event?.raceStartsAt ?? null, zone);
  const [raceDate, raceTime] = raceWall ? raceWall.split("T") : ["", ""];
  const raceStartBoxes = { date: raceDate, time: raceTime };

  return (
    <Panel glyph="when"
      collapsible
      id="box-when"
      title={heading ?? t("editor.boxes.whenWhere.title")}
      aside={
        <>
          {required}
          {words.separator}
          {[whenSummary(words, event, locale), placeSummary(words, event, translations)].join(words.separator)}
        </>
      }
      openWhen={{ attention: event === null }}
      tone={risk ? "risk" : "default"}
    >
      {/* Never the provisional start of a date left blank (§545) — though nobody can be registered then (§533). */}
      {risk && event && typedStartOrNull(event) && (
        <RiskLine>{t("editor.risk.when", { date: summaryDateTime(event.startsAt, event.timezone, locale, "inline") })}</RiskLine>
      )}
      {risk && place && <RiskLine>{t("editor.risk.place", { place })}</RiskLine>}
      {mayEditSettings ? (
        <Stack spacing={2}>
          <PartHeading id="box-when-date">{t("editor.boxes.when.title")}</PartHeading>
          {inSeries ? (
            /* A date on MUI's picker and a native 24-hour time, whatever clock the browser speaks
               (§70, §345). A series is its dates: no switch, the start always required (§533). */
            <>
              <WallTimeField
                name="event.startsAt"
                label={t("editor.startsAt")}
                timeLabel={t("editor.timeOfDay")}
                helperText={t("editor.startsAtHelp", { timezone: zone })}
                value={event?.startsAt ?? null}
                zone={zone}
                required={eventInputConstraints("startsAtWallTime").required}
              />
              <BoxNote>{t("editor.boxes.when.series")}</BoxNote>
            </>
          ) : (
            /* The same two boxes, then «Data se anunță mai târziu» and «Ora se anunță mai târziu»
               (§533), the place's switch for the start (§328). While a switch is on, the box it
               excuses is not required and may stay empty (§545): the boxes show "" for a part left
               blank (`startBoxValues`), never the provisional value the platform stored for it. */
            <StartToBeAnnounced
              labels={{
                date: t("editor.startsAt"),
                time: t("editor.timeOfDay"),
                help: t("editor.startsAtHelp", { timezone: zone }),
                dateSwitch: t("editor.dateToBeAnnounced"),
                dateSwitchHelp: t("editor.dateToBeAnnouncedHelp"),
                timeSwitch: t("editor.timeToBeAnnounced"),
                timeSwitchHelp: t("editor.timeToBeAnnouncedHelp"),
              }}
              values={startBoxValues(event?.startsAt ?? null, zone)}
              defaults={{ dateToBeAnnounced: event?.dateToBeAnnounced ?? false, timeToBeAnnounced: event?.timeToBeAnnounced ?? false }}
              required={eventInputConstraints("startsAtWallTime").required === true}
            />
          )}
          {/* Only a race has a gun time apart from the meeting time (§71); hidden, not removed. Its
              tick «Startul cursei nu e stabilit» saves none (§590) — ticked on an event that has none. */}
          <OnlyForType type="RACE" selectName="event.type" initialType={initialType}>
            <RaceStartNotSet
              labels={{
                date: t("editor.raceStartsAt"),
                time: t("editor.timeOfDay"),
                help: t("editor.raceStartsAtHelp"),
                tick: t("editor.raceStartNotSet"),
                tickHelp: t("editor.raceStartNotSetHelp"),
              }}
              values={raceStartBoxes}
              defaultNotSet={event !== null && event.raceStartsAt === null}
              required={eventInputConstraints("raceStartsAtWallTime").required === true}
            />
          </OnlyForType>
          {/* How long, not when it ends: the end is derived (§71) — asked as hours and minutes (§433). */}
          <Stack component="fieldset" spacing={0.5} sx={{ border: 0, m: 0, p: 0, minWidth: 0 }}>
            <Typography component="legend" variant="body2" sx={{ mb: 1, p: 0 }}>
              {t("editor.duration")}
            </Typography>
            <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1.5, alignItems: "flex-start" }}>
              <RecallField
                name="event.durationHours"
                label={t("editor.durationHours")}
                defaultValue={duration.hours}
                {...textFieldConstraints(DURATION_HOURS_CONSTRAINTS, { inputMode: "numeric" })}
                sx={{ flex: "0 0 120px" }}
              />
              <RecallField
                name="event.durationMinutesPart"
                label={t("editor.durationMinutesPart")}
                defaultValue={duration.minutes}
                {...textFieldConstraints(DURATION_MINUTES_CONSTRAINTS, { inputMode: "numeric" })}
                sx={{ flex: "0 0 120px" }}
              />
            </Box>
            <Typography variant="caption" color="text.secondary" sx={{ px: 1.75 }}>
              {t("editor.durationHelp")}
            </Typography>
          </Stack>
          {/* «Unde» (§481): the place's own part, where "Publică" scrolls for a missing meeting point. */}
          <Stack component="section" id="box-place" aria-labelledby="box-place-heading" spacing={2} sx={{ scrollMarginTop: 16 }}>
            <PartHeading id="box-place-heading">{t("editor.boxes.place.title")}</PartHeading>
            <PlaceFields event={event} mayEditSettings languages={languages} />
          </Stack>
          <Panel glyph="timezone" collapsible level={3} id="box-timezone" title={t("editor.boxes.when.timezone")} aside={timezoneSummary(words, zone)}>
            <RecallField
              select
              name="event.timezone"
              label={t("editor.timezone")}
              helperText={t("editor.boxes.when.timezoneHelp")}
              defaultValue={zone}
              required={eventInputConstraints("timezone").required}
              slotProps={{ select: { native: true } }}
            >
              {timezoneOptions(zone).map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </RecallField>
          </Panel>
        </Stack>
      ) : (
        <Stack spacing={2}>
          {/* A reader who may not change the settings reads the place as text, once. */}
          <Box id="box-place">
            <PlaceFields event={event} mayEditSettings={false} languages={languages} />
          </Box>
          <SettingsReadOnly />
        </Stack>
      )}
    </Panel>
  );
}
