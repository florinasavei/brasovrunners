import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { getLocale, getTranslations } from "next-intl/server";
import { CLUB_TIME_ZONE } from "@/i18n/dates";
import RecallField from "@/shared/forms/recall";
import { textFieldConstraints } from "@/shared/forms/constraints";
import Panel from "@/shared/ui/Panel";
import { startBoxValues, typedStartOrNull } from "@/modules/events/domain/provisional-start";
import { eventInputConstraints } from "../../constraints";
import { DURATION_HOURS_CONSTRAINTS, DURATION_MINUTES_CONSTRAINTS, savedDurationMinutes, splitDuration } from "../../duration";
import { placeSummary, summaryDateTime, timezoneSummary, whenSummary } from "../box-summaries";
import OnlyForType from "../OnlyForType";
import StartToBeAnnounced from "../StartToBeAnnounced";
import WallTimeField from "../WallTimeField";
import { BoxNote, type BoxProps, type LanguageEntry, requiredLine, RiskLine, SettingsReadOnly, summaryWords } from "./box-kit";
import PlaceFields, { placeNameInBox } from "./PlaceBox";

/** The club's own zone as the default, not the browser's (a phone abroad is not where the race is). */
export const DEFAULT_TIMEZONE = CLUB_TIME_ZONE;

/**
 * The zones an organizer may pick (§153): every IANA zone the runtime knows, the club's first,
 * then Europe. A stored zone the runtime no longer lists stays an option so an old event saves.
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
 * «Când și unde» (§481), as the page draws «Când» then «Unde»: Data și ora (the start, a race's
 * gun time §71, the duration §433); Locul (`#box-place`, `PlaceFields`); and Fus orar, folded,
 * changed only for an event elsewhere. The page address is not here (§406). The closed line
 * starts with what publication needs (the meeting point per language), then date and place. Open
 * on create, folded on the editor, amber with people registered.
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
  // The reader's language for the dates (`src/i18n/dates.ts`), on the event's clock.
  const locale = await getLocale();
  const zone = event?.timezone ?? DEFAULT_TIMEZONE;
  const initialType = event?.type ?? "GROUP_RUN";
  const duration = splitDuration(savedDurationMinutes(event?.startsAt, event?.endsAt));
  const translations = languages.map((entry) => entry.translation);
  // The place a change moves people away from, as the Romanian page names it (§362).
  const place = placeNameInBox(event, languages, "ro");
  // What publication still needs from this card (§406): the meeting point, per language.
  const required = await requiredLine("place", event, languages);

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
      {/* Never the provisional start of a blank date (§545). */}
      {risk && event && typedStartOrNull(event) && (
        <RiskLine>{t("editor.risk.when", { date: summaryDateTime(event.startsAt, event.timezone, locale, "inline") })}</RiskLine>
      )}
      {risk && place && <RiskLine>{t("editor.risk.place", { place })}</RiskLine>}
      {mayEditSettings ? (
        <Stack spacing={2}>
          <PartHeading id="box-when-date">{t("editor.boxes.when.title")}</PartHeading>
          {inSeries ? (
            /* A series is its dates: no switch, the start always required (§533). */
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
            /* The same two boxes with the «… se anunță mai târziu» switches (§533, §545): an excused box
               may stay empty, and shows "" rather than the stored provisional value (`startBoxValues`). */
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
          {/* Only a race has a gun time apart from the meeting time (§71); hidden, not removed. */}
          <OnlyForType type="RACE" selectName="event.type" initialType={initialType}>
            <WallTimeField
              name="event.raceStartsAt"
              label={t("editor.raceStartsAt")}
              timeLabel={t("editor.timeOfDay")}
              helperText={t("editor.raceStartsAtHelp")}
              value={event?.raceStartsAt ?? null}
              zone={zone}
              required={eventInputConstraints("raceStartsAtWallTime").required}
            />
          </OnlyForType>
          {/* How long, not when it ends: the end is derived (§71); hours and minutes (§433). */}
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
          {/* «Unde» (§481), where "Publică" scrolls for a missing meeting point. */}
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
