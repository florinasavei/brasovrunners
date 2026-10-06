import Box from "@mui/material/Box";
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
import { htmlConstraints, textFieldConstraints } from "@/shared/forms/constraints";
import RecallField from "@/shared/forms/recall";
import CheckboxField from "@/shared/ui/CheckboxField";
import InfoTip from "@/shared/ui/InfoTip";
import Panel from "@/shared/ui/Panel";
import { type EventFieldName, eventInputConstraints } from "../../constraints";
import { waitlistLimitSchema } from "../../fields";
import { WAITLIST_CHOICES, waitlistChoiceOf } from "../../waitlist-choice";
import BibDesignPanel from "../BibDesignPanel";
import { BIB_COLOURS } from "../bib-colours";
import {
  bibDesignSummary,
  bibsSummary,
  confirmationSummary,
  kitSummary,
  registrationSummary,
  registrationWindowSummary,
  summaryDate,
  summaryDateTime,
} from "../box-summaries";
import { countForm } from "@/i18n/count-form";
import OnlyForMode from "../OnlyForMode";
import OnlyForType from "../OnlyForType";
import WaitlistLimitOnly from "../WaitlistLimitOnly";
import WallTimeField from "../WallTimeField";
import { BoxNote, type BoxProps, RiskLine, SettingsReadOnly, summaryWords } from "./box-kit";
import { DEFAULT_TIMEZONE } from "./WhenBox";

const REGISTRATION_MODES = ["NONE", "INTERNAL", "EXTERNAL"] as const;

/** An approved race-declaration version the editor offers; `effectiveAt` tells a version in force from one approved for later (§515). */
export type DeclarationOption = { id: string; key: RaceDeclarationKey; version: number; title: string; effectiveAt?: Date };

/** The box's own constraints, read off `fields.ts`, as `TextField` takes them (§315). */
function box(field: EventFieldName, extra: Record<string, unknown> = {}) {
  return textFieldConstraints(eventInputConstraints(field), extra);
}

/**
 * "Participare și înscrieri" (§350): how people register — here, with another organizer, or not at
 * all — and under which rules; on the page, who may enter and the button, under the cost row (§406:
 * the cost is its own card, `CostBox`, just above this one, where the page draws its row). Registration's rules are
 * in this one box, as named cards: the period (the minimum age and the declaration are under «Regulamentul», §505, §448), the confirmation
 * window, the reminder, the race numbers (with the bib design and, on the editor, allocation and
 * printing). The public list was the fifth card here (owner requirement 1 of §350); since §406 it is
 * its own card, last, because the page draws it last (`StartListBox`), and since §512 the last card
 * inside «Program, regulament și declarație».
 *
 * **Only what the chosen mode needs is shown** (`OnlyForMode`): "Pe site" shows the capacity and
 * the cards, "La organizator" the organizer's name and link, "Fără" one sentence. A group run
 * takes no registration at all (§111): its sentence replaces everything here. Every
 * hidden field stays in the document — hidden, not removed — so switching back finds what was
 * typed, and the service ignores what the mode hides (`ignoreHiddenFields`, before its schema). No
 * mode-dependent box carries a browser `required`: the server decides; and while hidden, the boxes
 * are read-only, so a `min` or a `pattern` left unmet out of sight never stops the save (`ShownWhen`).
 *
 * The waiting list sits beside the capacity (§350, the waiting-list cap), and "not here" stores no
 * length either. Since §633 it is a select of three answers in words, with the number shown only
 * under «Limitată la un număr de locuri».
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
  windowHolds = null,
}: BoxProps & {
  /**
   * The reserved places the participation window gave, as a save would treat them (§665,
   * `registrations/window-holds.ts#previewWindowHolds`): how many a save moves now to the stored
   * window's instant, how many already hold it, and that instant. Real registrations only; the create
   * form has none.
   */
  windowHolds?: { moveNow: number; atWindow: number; to: Date } | null;
  /** The page's clock, for "race week" (the bib card opens by itself then). */
  now?: Date;
  /**
   * The club's deadlines (§377), read by the page: the reminder an event left "as usual" gets, the
   * hold the confirmation card names, and the race week that opens the bib card by itself (§311).
   */
  clubDeadlines: Pick<Deadlines, "reminderHours" | "holdMinutes" | "offerHours" | "raceWeekDays">;
  declarations: readonly DeclarationOption[];
  /** How many wait for a place (§147); the create form has nobody. */
  waiting?: number;
  bibCounts?: { total: number; unprinted: number } | null;
  /** Sub-sub-card 8.4.2, edit only, drawn by the page (it posts forms of its own). */
  bibPrint?: ReactNode;
  locale: string;
}) {
  const t = await getTranslations("Admin");
  const { words } = await summaryWords();
  const zone = event?.timezone ?? DEFAULT_TIMEZONE;
  const initialType = event?.type ?? "GROUP_RUN";
  const initialMode = event?.registrationMode ?? "NONE";
  // «Lista de așteptare» opens on what is stored (§633): null «Nelimitată», 0 «Fără listă», a count «Limitată».
  const initialWaitlistChoice = waitlistChoiceOf(event?.waitlistCapacity);
  const declaration = declarations.find((option) => option.id === event?.declarationDocumentId) ?? null;
  const colour = BIB_COLOURS.find((choice) => choice.hex === event?.bibColour);
  const colourLabel = event?.bibColour ? (colour ? t(`editor.bibColours.${colour.key}`) : event.bibColour) : null;
  const design = readBibDesign(event?.bibDesign ?? null);
  const designOn = (["showName", "showEventTitle", "showDate", "showLogo", "cutMarks"] as const)
    .filter((field) => design[field])
    .map((field) => t(`editor.bibDesign.${field}`));
  // The members' bib (§664) is one more thing the closed line names when it is on.
  if (design.member.enabled) designOn.push(t("editor.bibDesign.member.summary"));
  const footerOn = (["showEventInFooter", "showPartners", "showWebsite", "showEmail"] as const)
    .filter((field) => design[field])
    .map((field) => t(`editor.bibDesign.footer.${field}`));

  // The reminder card (§377): the club's lead in words, the owner's choices plus a number a script
  // stored, and the closed line — "Setarea clubului (cu 2 zile înainte de start)", "Cu 3 zile înainte
  // de start", "Fără reminder".
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
    The confirmation card's saved numbers as dates (§104), in the one form that is true (§407): no
    window at all — the allocator's own `confirmationWindow` test — a deadline that is the start
    itself ("termen la start", `confirmationDueAtStart`), or two dates.
  */
  const hold = minutesPhrase(locale, clubDeadlines.holdMinutes);
  const confirmationDates = (() => {
    // No dates to count back from while the date is left blank (§545): never the provisional day's.
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

  /*
    What the save does to the places the window already gave (§665): moves those held to another
    window's instant now, or — when they all hold this one — says a changed window will move them.
  */
  const windowHoldsLine = (() => {
    if (!windowHolds) return null;
    const due = summaryDateTime(windowHolds.to, zone, locale, "inline");
    if (windowHolds.moveNow > 0) {
      return t(`editor.boxes.confirmation.moveNow.${countForm(windowHolds.moveNow, locale)}`, { count: windowHolds.moveNow, due });
    }
    if (windowHolds.atWindow > 0) {
      return t(`editor.boxes.confirmation.follow.${countForm(windowHolds.atWindow, locale)}`, { count: windowHolds.atWindow, due });
    }
    return null;
  })();

  const summary = registrationSummary(words, event, {
    takesRegistrations: takesRegistrations(initialType),
    // The cost is its own card since §406 (`CostBox`), and its closed line says it.
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
        // A reader keeps what is not a setting of the event (§542): the race numbers' allocation and
        // printing — «Vezi numerele», «Descarcă toate numerele (PDF)» — which the page draws only
        // for a role that reads the registrations (§289: the Organizer, not the Redactor).
        <Stack spacing={2}>
          <SettingsReadOnly />
          {bibPrint}
        </Stack>
      ) : (
        <Stack spacing={2}>
          <OnlyForType type={EVENT_TYPES.filter((type) => !takesRegistrations(type))} selectName="event.type" initialType={initialType}>
            <BoxNote testId="group-run-no-registration">{t("editor.groupRunNoRegistration")}</BoxNote>
          </OnlyForType>

          {/* The whole registration block follows the type select (§111); the service writes NONE
              for a group run whatever the hidden fields still post. */}
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
                  {/* The places and the waiting list side by side (§350, the waiting-list cap): the
                      second only means anything once the first is set, and a row says they are one
                      question. Stacked on a phone. Since §633 the waiting list is a choice in words —
                      «Nelimitată», «Limitată la un număr de locuri», «Fără listă de așteptare» — and
                      the number shows only under «Limitată» (`WaitlistLimitOnly`), where an empty box
                      or a 0 means unlimited: a 0 never closes the list by accident. The select is
                      native, as «Locurile din lista de așteptare se alocă automat» below, so the island
                      can switch it; the three meanings are the «i» beside it. Boxes, not Stacks,
                      inside the row: the row is one Stack, read as one by the form's tests. */}
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
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Box sx={{ display: "flex", alignItems: "flex-start", gap: 0.5 }}>
                        <RecallField
                          select
                          name="event.waitlistMode"
                          label={t("editor.waitlistMode")}
                          helperText={t("editor.waitlistModeHelp")}
                          defaultValue={initialWaitlistChoice}
                          slotProps={{ select: { native: true }, inputLabel: { shrink: true } }}
                          sx={{ flex: 1, minWidth: 0 }}
                          data-testid="waitlist-mode"
                        >
                          {WAITLIST_CHOICES.map((choice) => (
                            <option key={choice} value={choice}>
                              {t(`editor.waitlistModeChoices.${choice}`)}
                            </option>
                          ))}
                        </RecallField>
                        <InfoTip text={t("editor.waitlistModeTip")} />
                      </Box>
                      <WaitlistLimitOnly initialChoice={initialWaitlistChoice}>
                        <RecallField
                          name="event.waitlistCapacity"
                          label={t("editor.waitlistCapacity")}
                          helperText={t("editor.waitlistCapacityHelp")}
                          // 0 is «Fără listă», not a limit: the box opens empty then, for a limit to be typed.
                          defaultValue={event?.waitlistCapacity ? event.waitlistCapacity : ""}
                          {...textFieldConstraints(htmlConstraints(waitlistLimitSchema), { inputMode: "numeric" })}
                          fullWidth
                          sx={{ mt: 2 }}
                        />
                      </WaitlistLimitOnly>
                    </Box>
                  </Stack>

                  {/*
                    Who hands out a freed or added place (§615): the line, at once («Da», the default
                    and every event before it), or the organizer, from «Coada de înscrieri» with
                    «Trimite-i oferta» and at the desk with «Dă-i un loc» («Nu»). Under the capacity,
                    because it says what a raise of the capacity does. A native select of the two
                    answers, as the reminder's: it always posts one, so the save reads it.
                  */}
                  <Stack spacing={1}>
                    <RecallField
                      select
                      name="event.waitlistAutoOffer"
                      label={t("editor.waitlistAutoOffer")}
                      defaultValue={event?.waitlistAutoOffer === false ? "false" : "true"}
                      slotProps={{ select: { native: true }, inputLabel: { shrink: true } }}
                      sx={{ width: { sm: 320 } }}
                      data-testid="waitlist-auto-offer"
                    >
                      <option value="true">{t("editor.waitlistAutoOfferYes")}</option>
                      <option value="false">{t("editor.waitlistAutoOfferNo")}</option>
                    </RecallField>
                    <BoxNote more={t("editor.waitlistAutoOfferHelpMore")}>{t("editor.waitlistAutoOfferHelp")}</BoxNote>
                  </Stack>

                  {/* 8.1 — from when until when. */}
                  <Panel glyph="window" collapsible level={3} id="box-registration-window" title={t("editor.boxes.registrationWindow.title")} aside={registrationWindowSummary(words, event, locale)}>
                    <Stack spacing={1}>
                      {/* «Se deschid în curând» (§451): announced, with no date. The marker says the
                          form carried the box, so an unticked one reads as "off", not "not edited". */}
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

                  {/* 8.2 — who may enter was a card here («Condiții de participare», §329). Since
                      §505 the minimum age is one box of «Regulamentul» for every type, and what a
                      runner signs is chosen beside it since §448 (`DeclarationCard`): one line
                      says where both went. */}
                  <BoxNote testId="declaration-moved">{t("editor.boxes.conditions.declarationUnderRules")}</BoxNote>

                  {/* 8.3 — the participation window (§104). */}
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
                      {windowHoldsLine && (
                        <Typography variant="body2" data-testid="confirmation-holds">
                          {windowHoldsLine}
                        </Typography>
                      )}
                      <BoxNote more={t("editor.confirmationWindowHelpMore", { hold })}>{t("editor.confirmationWindowHelp")}</BoxNote>
                    </Stack>
                  </Panel>

                  {/*
                    8.3b — the reminder before the start (§81, §377): the club's lead unless this
                    event says otherwise. A native select of the owner's choices — "as usual",
                    24, 48, 72, 96, 120 hours, none — and the stored number too when a script set another,
                    so a save never quietly changes it.
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

                  {/*
                    8.3c — «Kit de participare» (§554; the owner, 2026-09-29: «o subsecțiune cu kit de
                    participare, și doar dacă e bifat tricoul să avem alegerea mărimii în formular»):
                    what the runners are handed. For now one tick, the T-shirt; the form asks the
                    size only while it is on. Inside "Pe site", so only a type that takes
                    registrations shows it (§111). The marker says the form carried the box, so an
                    unticked one reads as "no shirt", not as "not edited".
                  */}
                  <Panel glyph="kit" collapsible level={3} id="box-kit" title={t("editor.boxes.kit.title")} aside={kitSummary(words, event?.kitShirt ?? false)}>
                    <Stack spacing={1}>
                      <input type="hidden" name="event.kitShirt.present" value="1" />
                      <CheckboxField name="event.kitShirt" defaultChecked={event?.kitShirt ?? false}>
                        {t("editor.kitShirt")}
                      </CheckboxField>
                      <BoxNote>{t("editor.kitShirtHelp")}</BoxNote>
                    </Stack>
                  </Panel>

                  {/* 8.4 — the one card for race numbers: the band (§173), what one bib looks like
                      (§249, now on create too) and, on the editor, whether they exist and print. */}
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
                  {/* The public list was 8.5 here; it is the last card of «Program, regulament și
                      declarație» now, where the page draws it (§406, §512, `StartListBox`). */}
                </Stack>
              </OnlyForMode>
            </Stack>
          </OnlyForType>
        </Stack>
      )}
    </Panel>
  );
}
