import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { type Deadlines, EVENT_REMINDER_CHOICES, withinRaceWeek } from "@/modules/deadlines/domain/deadlines";
import { capitalizeFirst } from "@/i18n/dates";
import { hoursPhrase, leadPhrase, minutesPhrase } from "@/modules/deadlines/domain/duration-words";
import { EVENT_TYPES, takesRegistrations } from "@/modules/events/domain/event-type";
import { typedStartOrNull } from "@/modules/events/domain/provisional-start";
import { readBibDesign } from "@/modules/registrations/bib-design";
import type { RaceDeclarationKey } from "@/modules/legal-documents/domain/keys";
import { spareBandOf } from "@/modules/registrations/domain/spare-bibs";
import {
  confirmationDueAtStart,
  confirmationWindow,
  DEFAULT_CONFIRMATION_DEADLINE_DAYS,
  DEFAULT_CONFIRMATION_OPENS_DAYS,
} from "@/modules/registrations/domain/hold-deadlines";
import { REGISTRATION_MODE_LABEL } from "@/modules/staff-identity/domain/staff-labels";
import { textFieldConstraints } from "@/shared/forms/constraints";
import RecallField from "@/shared/forms/recall";
import CheckboxField from "@/shared/ui/CheckboxField";
import Panel from "@/shared/ui/Panel";
import { type EventFieldName, eventInputConstraints } from "../../constraints";
import BibDesignPanel from "../BibDesignPanel";
import {
  bibDesignSummary,
  bibsSummary,
  confirmationSummary,
  registrationSummary,
  registrationWindowSummary,
  summaryDate,
} from "../box-summaries";
import OnlyForMode from "../OnlyForMode";
import OnlyForType from "../OnlyForType";
import WallTimeField from "../WallTimeField";
import { BoxNote, type BoxProps, RiskLine, SettingsReadOnly, summaryWords } from "./box-kit";
import { DEFAULT_TIMEZONE } from "./WhenBox";

const REGISTRATION_MODES = ["NONE", "INTERNAL", "EXTERNAL"] as const;

/**
 * The colours a race's numbers may print in (§173, §177): six distinct on paper and from the
 * club's blue, which is the empty choice. Hex triplets, as `events.bib_colour` checks.
 */
const BIB_COLOURS = [
  { key: "green", hex: "#1b8a3a" },
  { key: "red", hex: "#c62828" },
  { key: "orange", hex: "#ef6c00" },
  { key: "purple", hex: "#6a1b9a" },
  { key: "teal", hex: "#00838f" },
  { key: "black", hex: "#212121" },
] as const;

/** An approved race-declaration version the editor offers; `effectiveAt` tells in-force from approved-for-later (§515). */
export type DeclarationOption = { id: string; key: RaceDeclarationKey; version: number; title: string; effectiveAt?: Date };

/** The box's own constraints, read off `fields.ts`, as `TextField` takes them (§315). */
function box(field: EventFieldName, extra: Record<string, unknown> = {}) {
  return textFieldConstraints(eventInputConstraints(field), extra);
}

/**
 * "Participare și înscrieri" (§350): how people register (here, elsewhere, or not at all) and, as
 * named cards, the registration period, the confirmation window, the reminder and the race
 * numbers. The minimum age and the declaration live under «Regulamentul» (§448, §505), the public
 * list in `StartListBox` (§512), the cost in `CostBox`. Only what the chosen mode needs is shown
 * (`OnlyForMode`); a group run takes no registration (§111). Hidden fields stay in the document,
 * the service ignores them (`ignoreHiddenFields`), no mode-dependent box is browser-`required`,
 * and hidden boxes are read-only (`ShownWhen`).
 */
export default async function RegistrationBox({
  event,
  mayEditSettings,
  risk,
  heading,
  declarations,
  waiting = 0,
  bibCounts,
  bibPrint,
  locale,
  now,
  clubDeadlines,
}: BoxProps & {
  /** The page's clock, for "race week" (the bib card opens by itself then). */
  now?: Date;
  /**
   * The club's deadlines (§377): the reminder "as usual", the hold the confirmation card names,
   * and the race week that opens the bib card (§311).
   */
  clubDeadlines: Pick<Deadlines, "reminderHours" | "holdMinutes" | "offerHours" | "raceWeekDays">;
  declarations: readonly DeclarationOption[];
  /** How many wait for a place (§147); the create form has nobody. */
  waiting?: number;
  bibCounts?: { total: number; unprinted: number } | null;
  /** "Alocare și tipărire", edit only, drawn by the page (it posts forms of its own). */
  bibPrint?: ReactNode;
  locale: string;
}) {
  const t = await getTranslations("Admin");
  const { words } = await summaryWords();
  const zone = event?.timezone ?? DEFAULT_TIMEZONE;
  const initialType = event?.type ?? "GROUP_RUN";
  const initialMode = event?.registrationMode ?? "NONE";
  const declaration = declarations.find((option) => option.id === event?.declarationDocumentId) ?? null;
  const colour = BIB_COLOURS.find((choice) => choice.hex === event?.bibColour);
  const colourLabel = event?.bibColour ? (colour ? t(`editor.bibColours.${colour.key}`) : event.bibColour) : null;
  const design = readBibDesign(event?.bibDesign ?? null);
  const designOn = (["showName", "showEventTitle", "showDate", "showLogo", "cutMarks"] as const)
    .filter((field) => design[field])
    .map((field) => t(`editor.bibDesign.${field}`));
  const footerOn = (["showEventInFooter", "showPartners", "showWebsite", "showEmail"] as const)
    .filter((field) => design[field])
    .map((field) => t(`editor.bibDesign.footer.${field}`));

  // The reminder card (§377): the club's lead in words, the choices plus any scripted number, and the closed line.
  const before = (hours: number) => t("editor.reminder.before", { lead: leadPhrase(locale, hours) });
  const clubReminder = clubDeadlines.reminderHours > 0 ? before(clubDeadlines.reminderHours) : t("editor.reminder.clubNone");
  const storedReminder = event?.reminderHoursBefore ?? null;
  const reminderChoices = [
    ...EVENT_REMINDER_CHOICES,
    ...(storedReminder !== null && storedReminder > 0 && !(EVENT_REMINDER_CHOICES as readonly number[]).includes(storedReminder) ? [storedReminder] : []),
  ].sort((a, b) => a - b);
  const reminderSummary =
    storedReminder === null
      ? t("editor.reminder.usual", { lead: clubReminder })
      : storedReminder === 0
        ? t("editor.reminder.none")
        : capitalizeFirst(before(storedReminder), locale);

  /*
    The confirmation card's saved numbers as dates (§104, §407): no window (`confirmationWindow`),
    a deadline at the start itself (`confirmationDueAtStart`), or two dates.
  */
  const hold = minutesPhrase(locale, clubDeadlines.holdMinutes);
  const confirmationDates = (() => {
    // No dates to count back from a blank date (§545), never the provisional day.
    if (!event || !typedStartOrNull(event)) return null;
    if (!confirmationWindow(event)) return t("editor.boxes.confirmation.datesOff", { hold });
    const values = {
      date: summaryDate(event.startsAt, zone, locale, "inline"),
      opens: summaryDate(new Date(event.startsAt.getTime() - event.confirmationOpensDaysBefore * 86_400_000), zone, locale, "inline"),
      due: summaryDate(new Date(event.startsAt.getTime() - event.confirmationDeadlineDaysBefore * 86_400_000), zone, locale, "inline"),
    };
    return confirmationDueAtStart({ days: event.confirmationDeadlineDaysBefore })
      ? t("editor.boxes.confirmation.datesAtStart", values)
      : t("editor.boxes.confirmation.dates", values);
  })();

  const summary = registrationSummary(words, event, {
    takesRegistrations: takesRegistrations(initialType),
    // The cost is `CostBox`'s (§406), with its own closed line.
    declarationVersion: declaration?.version ?? null,
    locale,
    creating: event === null,
  });

  return (
    <Panel glyph="registration"
      collapsible
      id="box-registration"
      title={heading ?? t("editor.boxes.registration.title")}
      aside={summary}
      tone={risk ? "risk" : "default"}
    >
      {risk && <RiskLine>{t("editor.risk.registration")}</RiskLine>}
      {!mayEditSettings ? (
        // A reader keeps what is not an event setting (§542): the numbers' allocation and printing,
        // drawn by the page only for a role that reads registrations (§289).
        <Stack spacing={2}>
          <SettingsReadOnly />
          {bibPrint}
        </Stack>
      ) : (
        <Stack spacing={2}>
          <OnlyForType type={EVENT_TYPES.filter((type) => !takesRegistrations(type))} selectName="event.type" initialType={initialType}>
            <BoxNote testId="group-run-no-registration">{t("editor.groupRunNoRegistration")}</BoxNote>
          </OnlyForType>

          {/* The block follows the type select (§111); the service writes NONE for a group run whatever posts. */}
          <OnlyForType type={EVENT_TYPES.filter(takesRegistrations)} selectName="event.type" initialType={initialType}>
            <Stack spacing={2}>
              <RecallField
                select
                name="event.registrationMode"
                label={t("editor.registrationMode")}
                helperText={t("editor.registrationModeHelp")}
                defaultValue={initialMode}
                required={eventInputConstraints("registrationMode").required}
              >
                {REGISTRATION_MODES.map((mode) => (
                  <MenuItem key={mode} value={mode}>
                    {REGISTRATION_MODE_LABEL[mode]}
                  </MenuItem>
                ))}
              </RecallField>

              <OnlyForMode mode="EXTERNAL" initialMode={initialMode}>
                <Stack spacing={1}>
                  <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
                    <RecallField name="event.externalProvider" label={t("editor.externalProvider")} defaultValue={event?.externalProvider ?? ""} {...box("externalProvider")} sx={{ flex: 1 }} />
                    <RecallField
                      name="event.externalRegistrationUrl"
                      label={t("editor.externalRegistrationUrl")}
                      defaultValue={event?.externalRegistrationUrl ?? ""}
                      {...box("externalRegistrationUrl", { inputMode: "url" })}
                      sx={{ flex: 1 }}
                    />
                  </Stack>
                  <BoxNote>{t("editor.externalHelp")}</BoxNote>
                </Stack>
              </OnlyForMode>

              <OnlyForMode mode="NONE" initialMode={initialMode}>
                <BoxNote testId="mode-none">{t("editor.modeNoneSentence")}</BoxNote>
              </OnlyForMode>

              <OnlyForMode mode="INTERNAL" initialMode={initialMode}>
                <Stack spacing={2}>
                  {/* Places and the waiting-list cap side by side (§350), stacked on a phone. Empty is
                      no limit for both; 0 for the second is no waiting list. */}
                  <Stack direction={{ xs: "column", sm: "row" }} spacing={2} data-testid="capacity-row">
                    <RecallField
                      name="event.capacity"
                      label={t("editor.capacity")}
                      helperText={
                        waiting > 0
                          ? `${t("editor.capacityHelp")} ${t("editor.capacityWaiting", { waiting, offer: hoursPhrase(locale, clubDeadlines.offerHours) })}`
                          : t("editor.capacityHelp")
                      }
                      defaultValue={event?.capacity ?? ""}
                      {...box("capacity", { inputMode: "numeric" })}
                      sx={{ flex: 1 }}
                    />
                    <RecallField
                      name="event.waitlistCapacity"
                      label={t("editor.waitlistCapacity")}
                      helperText={t("editor.waitlistCapacityHelp")}
                      defaultValue={event?.waitlistCapacity ?? ""}
                      {...box("waitlistCapacity", { inputMode: "numeric" })}
                      sx={{ flex: 1 }}
                    />
                  </Stack>

                  {/* The registration period. */}
                  <Panel glyph="window" collapsible level={3} id="box-registration-window" title={t("editor.boxes.registrationWindow.title")} aside={registrationWindowSummary(words, event, locale)}>
                    <Stack spacing={1}>
                      {/* «Se deschid în curând» (§451). The marker says the form carried the box, so
                          unticked reads as "off", not "not edited". */}
                      <input type="hidden" name="event.registrationOpensSoon.present" value="1" />
                      <CheckboxField name="event.registrationOpensSoon" defaultChecked={event?.registrationOpensSoon ?? false}>
                        {t("editor.registrationOpensSoon")}
                      </CheckboxField>
                      <BoxNote>{t("editor.registrationOpensSoonHelp")}</BoxNote>
                      <Stack direction={{ xs: "column", md: "row" }} spacing={2}>
                        <WallTimeField name="event.registrationOpensAt" label={t("editor.registrationOpensAt")} timeLabel={t("editor.timeOfDay")} value={event?.registrationOpensAt ?? null} zone={zone} />
                        <WallTimeField name="event.registrationClosesAt" label={t("editor.registrationClosesAt")} timeLabel={t("editor.timeOfDay")} value={event?.registrationClosesAt ?? null} zone={zone} />
                      </Stack>
                      <BoxNote>{t("editor.registrationWindowHelp")}</BoxNote>
                      {risk && <BoxNote>{t("editor.boxes.registrationWindow.earlierClose")}</BoxNote>}
                    </Stack>
                  </Panel>

                  {/* The minimum age and the declaration moved to «Regulamentul» (§448, §505); one line says so. */}
                  <BoxNote testId="declaration-moved">{t("editor.boxes.conditions.declarationUnderRules")}</BoxNote>

                  {/* The participation window (§104). */}
                  <Panel glyph="confirmation"
                    collapsible
                    level={3}
                    id="box-confirmation"
                    title={t("editor.boxes.confirmation.title")}
                    aside={confirmationSummary(words, event?.confirmationOpensDaysBefore ?? DEFAULT_CONFIRMATION_OPENS_DAYS, event?.confirmationDeadlineDaysBefore ?? DEFAULT_CONFIRMATION_DEADLINE_DAYS)}
                  >
                    <Stack spacing={1}>
                      <Stack direction={{ xs: "column", md: "row" }} spacing={2}>
                        <RecallField
                          name="event.confirmationOpensDaysBefore"
                          label={t("editor.confirmationOpensDaysBefore")}
                          defaultValue={event?.confirmationOpensDaysBefore ?? DEFAULT_CONFIRMATION_OPENS_DAYS}
                          {...box("confirmationOpensDaysBefore", { inputMode: "numeric" })}
                          fullWidth
                        />
                        <RecallField
                          name="event.confirmationDeadlineDaysBefore"
                          label={t("editor.confirmationDeadlineDaysBefore")}
                          defaultValue={event?.confirmationDeadlineDaysBefore ?? DEFAULT_CONFIRMATION_DEADLINE_DAYS}
                          {...box("confirmationDeadlineDaysBefore", { inputMode: "numeric" })}
                          fullWidth
                        />
                      </Stack>
                      {confirmationDates && (
                        <Typography variant="body2" data-testid="confirmation-dates">
                          {confirmationDates}
                        </Typography>
                      )}
                      <BoxNote more={t("editor.confirmationWindowHelpMore", { hold })}>{t("editor.confirmationWindowHelp")}</BoxNote>
                    </Stack>
                  </Panel>

                  {/*
                    The reminder before the start (§81, §377): the club's lead unless overridden. The
                    stored number is offered too when a script set another, so a save never changes it.
                  */}
                  <Panel glyph="reminder" collapsible level={3} id="box-reminder" title={t("editor.boxes.reminder.title")} aside={reminderSummary}>
                    <Stack spacing={1}>
                      <RecallField
                        select
                        name="event.reminderHoursBefore"
                        label={t("editor.reminder.label")}
                        defaultValue={event?.reminderHoursBefore ?? ""}
                        slotProps={{ select: { native: true }, inputLabel: { shrink: true } }}
                        sx={{ width: { sm: 320 } }}
                      >
                        <option value="">{t("editor.reminder.usual", { lead: clubReminder })}</option>
                        {reminderChoices.map((hours) => (
                          <option key={hours} value={hours}>
                            {capitalizeFirst(before(hours), locale)}
                          </option>
                        ))}
                        <option value="0">{t("editor.reminder.none")}</option>
                      </RecallField>
                      <BoxNote>{t("editor.reminder.help", { lead: clubReminder })}</BoxNote>
                    </Stack>
                  </Panel>

                  {/* Race numbers: the band (§173), the bib design (§249) and, on the editor, allocation and printing. */}
                  <Panel glyph="bibs"
                    collapsible
                    level={3}
                    id="box-bibs"
                    title={t("editor.boxes.bibs.title")}
                    aside={bibsSummary(
                      words,
                      event?.bibStartNumber ?? 1,
                      colourLabel,
                      bibCounts ? { allocated: bibCounts.total, unprinted: bibCounts.unprinted } : null,
                      event ? spareBandOf(event) : null,
                    )}
                    openWhen={{ attention: Boolean(bibCounts && bibCounts.unprinted > 0 && event && now && withinRaceWeek(event, now, clubDeadlines)) }}
                  >
                    <Stack spacing={2}>
                      <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
                        <RecallField
                          name="event.bibStartNumber"
                          label={t("editor.bibStartNumber")}
                          helperText={t("editor.bibStartNumberHelp")}
                          defaultValue={event?.bibStartNumber ?? 1}
                          {...box("bibStartNumber", { inputMode: "numeric" })}
                          sx={{ width: { sm: 220 } }}
                        />
                        {/* A palette, not a colour picker (§177): the club's own is the empty choice. */}
                        <RecallField
                          select
                          name="event.bibColour"
                          label={t("editor.bibColour")}
                          helperText={t("editor.bibColourHelp")}
                          defaultValue={event?.bibColour ?? ""}
                          slotProps={{ select: { native: true }, inputLabel: { shrink: true } }}
                          sx={{ width: { sm: 220 } }}
                        >
                          <option value="">{t("editor.bibColours.club")}</option>
                          {BIB_COLOURS.map((choice) => (
                            <option key={choice.hex} value={choice.hex}>
                              {t(`editor.bibColours.${choice.key}`)}
                            </option>
                          ))}
                          {event?.bibColour && !colour && <option value={event.bibColour}>{event.bibColour}</option>}
                        </RecallField>
                      </Stack>
                      {event && <BoxNote>{t("editor.boxes.bibs.startChange")}</BoxNote>}
                      <BibDesignPanel
                        eventId={event?.id ?? null}
                        design={design}
                        bibStartNumber={event?.bibStartNumber ?? 1}
                        bibColour={event?.bibColour ?? null}
                        summary={bibDesignSummary(words, designOn, footerOn)}
                      />
                      {bibPrint}
                    </Stack>
                  </Panel>
                  {/* The public list is `StartListBox` (§406, §512). */}
                </Stack>
              </OnlyForMode>
            </Stack>
          </OnlyForType>
        </Stack>
      )}
    </Panel>
  );
}
