import Stack from "@mui/material/Stack";
import { getLocale, getTranslations } from "next-intl/server";
import { CLUB_TIME_ZONE } from "@/i18n/dates";
import RecallField from "@/shared/forms/recall";
import { textFieldConstraints } from "@/shared/forms/constraints";
import Panel from "@/shared/ui/Panel";
import { eventInputConstraints } from "../../constraints";
import { summaryDateTime, timezoneSummary, whenSummary } from "../box-summaries";
import OnlyForType from "../OnlyForType";
import WallTimeField from "../WallTimeField";
import { BoxNote, type BoxProps, RiskLine, SettingsReadOnly, summaryWords } from "./box-kit";

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

/**
 * Box 4, "Data și ora" (§350): when it starts, the gun time on a race (§71), how long it lasts —
 * and, folded away under them, the time zone, which is changed only for an event somewhere else
 * (it used to be the first box of the form).
 *
 * Open on the create page, where the date is required; folded on the editor. With people
 * registered, the box is amber and its first line says what a new date does to them.
 */
export default async function WhenBox({ event, mayEditSettings, risk, inSeries = false }: BoxProps & { inSeries?: boolean }) {
  const t = await getTranslations("Admin");
  const { words } = await summaryWords();
  // The reader's language for the dates (`src/i18n/dates.ts`), on the event's own clock.
  const locale = await getLocale();
  const zone = event?.timezone ?? DEFAULT_TIMEZONE;
  const initialType = event?.type ?? "GROUP_RUN";

  return (
    <Panel
      collapsible
      id="box-when"
      title={t("editor.boxes.when.title")}
      aside={whenSummary(words, event, locale)}
      openWhen={{ attention: event === null }}
      tone={risk ? "risk" : "default"}
      badge={risk?.chip}
    >
      {risk && event && (
        <RiskLine>{t("editor.risk.when", { count: risk.count, date: summaryDateTime(event.startsAt, event.timezone, locale, "inline") })}</RiskLine>
      )}
      {mayEditSettings ? (
        <Stack spacing={2}>
          {/* A date and a 24-hour time each, on MUI's pickers, whatever clock the browser speaks (§70). */}
          <WallTimeField
            name="event.startsAt"
            label={t("editor.startsAt")}
            timeLabel={t("editor.timeOfDay")}
            helperText={t("editor.startsAtHelp", { timezone: zone })}
            value={event?.startsAt ?? null}
            zone={zone}
            required={eventInputConstraints("startsAtWallTime").required}
          />
          {inSeries && <BoxNote>{t("editor.boxes.when.series")}</BoxNote>}
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
          {/* How long, not when it ends: the end is derived (§71). */}
          <RecallField
            name="event.durationMinutes"
            label={t("editor.durationMinutes")}
            helperText={t("editor.durationMinutesHelp")}
            defaultValue={event?.endsAt && event.startsAt ? Math.round((event.endsAt.getTime() - event.startsAt.getTime()) / 60_000) : ""}
            {...textFieldConstraints(eventInputConstraints("durationMinutes"), { inputMode: "numeric" })}
            sx={{ width: 220 }}
          />
          <Panel collapsible level={3} id="box-timezone" title={t("editor.boxes.when.timezone")} aside={timezoneSummary(words, zone)}>
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
        <SettingsReadOnly />
      )}
    </Panel>
  );
}
