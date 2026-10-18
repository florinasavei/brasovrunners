import Box from "@mui/material/Box";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { type Deadlines, EVENT_REMINDER_CHOICES, withinRaceWeek } from "@/modules/deadlines/domain/deadlines";
import { capitalizeFirst } from "@/i18n/dates";
import { hoursPhrase, leadPhrase, minutesPhrase } from "@/modules/deadlines/domain/duration-words";
import { EVENT_TYPES, hasProgramme, takesRegistrations } from "@/modules/events/domain/event-type";
import { typedStartOrNull } from "@/modules/events/domain/provisional-start";
import { readRouteGpx } from "@/modules/events/domain/route-gpx";
import { readBibDesign } from "@/modules/registrations/bib-design";
import type { RaceDeclarationKey } from "@/modules/legal-documents/domain/keys";
import { effectiveMinimumAge } from "@/modules/registrations/domain/age";
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
  healthNoteSummary,
  kitSummary,
  minAgeSummary,
  programmeSummary,
  registrationSummary,
  registrationWindowSummary,
  rulesSummary,
  summaryDate,
  summaryDateTime,
} from "../box-summaries";
import { countForm } from "@/i18n/count-form";
import OnlyForMode from "../OnlyForMode";
import OnlyForTurnUp from "../OnlyForTurnUp";
import OnlyForType from "../OnlyForType";
import WaitlistLimitOnly from "../WaitlistLimitOnly";
import WallTimeField from "../WallTimeField";
import { BoxNote, type BoxProps, type LanguageEntry, RiskLine, SettingsReadOnly, summaryWords } from "./box-kit";
import { asksHealthNoteOnForm } from "./ConditionsGroup";
import RsvpAnswersCard, { type RsvpAnswerRow } from "./RsvpAnswersCard";
import DeclarationCard, { declarationLine } from "./DeclarationCard";
import ProgrammeBox from "./ProgrammeBox";
import StartListBox from "./StartListBox";
import { RulesBox } from "./TextBoxes";
import { DEFAULT_TIMEZONE } from "./WhenBox";

const REGISTRATION_MODES = ["NONE", "INTERNAL", "EXTERNAL"] as const;

/** An approved race-declaration version the editor offers; `effectiveAt` tells a version in force from one approved for later (§515). */
export type DeclarationOption = { id: string; key: RaceDeclarationKey; version: number; title: string; effectiveAt?: Date };

/** The box's own constraints, read off `fields.ts`, as `TextField` takes them (§315). */
function box(field: EventFieldName, extra: Record<string, unknown> = {}) {
  return textFieldConstraints(eventInputConstraints(field), extra);
}

/**
 * Card 6, «Participare, înscrieri și regulament» (§760; the owner, 2026-10-13: «cardurile 6 și 9 se
 * pot uni sincer, sunt chestii oarecum related»): what were two cards — «Participare și înscrieri»
 * (§350) and «Program, regulament și declarație» (§481, §512) — in one, the same fields with the same
 * names and ids, only held together. On the page, who may enter and the button, under the cost row;
 * further down the programme, the rules and the public list — the card wears the number of the first,
 * and is drawn when any is (`cardStates`).
 *
 * **Its named cards, in the order a runner's registration happens:**
 *
 * 1. how people register (the mode, the places and the waiting list — no card of their own, the
 *    card's first question), then, while the club registers them here, «Perioada de înscriere»
 *    (`#box-registration-window`), «Fereastra de confirmare» (`#box-confirmation`) and «Reminderul
 *    dinaintea startului» (`#box-reminder`) — the registration's life, in time;
 * 2. what a participant agrees to: «Regulamentul» with the minimum age (`#box-rules`, §505), right
 *    above «Declarația pe propria răspundere» (`#box-declaration`, §448) — the age and the declaration
 *    side by side, so the sentence that sent the reader from one card to the other is gone. What the
 *    form asks — «Condiții de participare», the «Informații medicale» tick (§557) — is a group at the
 *    foot of «Regulamentul», under the minimum age (§799); there is no `#box-conditions` any more;
 * 3. the day itself: «Programul zilei și ce să aduci» (`#box-schedule`), then, while the club
 *    registers them here, «Kit de participare» (`#box-kit`, §554) and «Numere de concurs (BIB)»
 *    (`#box-bibs`, with the designer and, on the editor, allocation and printing);
 * 4. «Lista publică a participanților» (`#box-start-list`, §512), last, as the page draws it last.
 *
 * The closed line says the registration's line, then the programme's, the rules' and the age in brief.
 * It opens itself while a saved event that registers on the site has no declaration chosen, or while a
 * group run offering its self-declaration has no text in force for its surface (§483); with people
 * registered it is amber (registration and the programme are both boxes a change reaches, §350).
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
  groupRunDeclarations,
  languages,
  declarations,
  waiting = 0,
  bibCounts,
  bibPrint,
  locale,
  now,
  clubDeadlines,
  windowHolds = null,
  rsvp = null,
}: BoxProps & {
  /**
   * «Răspunsuri „Vin!”» (§811): the event's answers, read by the page for this role — the counts always, the rows (with the addresses)
   * only for a role that reads the registrations. Null on the create form, which has none.
   */
  rsvp?: { counts: { confirmed: number; unconfirmed: number }; rows: readonly RsvpAnswerRow[] | null } | null;
  /** Every language's row, for the programme's and the rules' texts (§760: their cards are in here). */
  languages: readonly LanguageEntry[];
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

  const registers = takesRegistrations(initialType);
  const translations = languages.map((entry) => entry.translation);
  // The declaration's line (§448, §483): whether the card opens itself, and what the closed line says.
  const line = await declarationLine(event, declarations, words, groupRunDeclarations);
  // The named cards of what was «Program, regulament și declarație» (§481, §512), each awaited so the
  // element is ready when the card is (`requiredLine` does the same); their fields, names and ids unchanged.
  const programme = await ProgrammeBox({ event, mayEditSettings, risk, languages });
  // The rules hold the minimum age, for every type (§505).
  const rules = await RulesBox({ languages, event, mayEditSettings });
  const declarationCard = await DeclarationCard({ event, mayEditSettings, groupRunDeclarations, declarations, words });
  const startList = await StartListBox({ event, mayEditSettings });

  /*
    The closed line, short (§760): the registration's own line — the mode, the places, the
    declaration's version and the list where the club registers people, with its waiting list when
    that is public too (§628) — then the declaration a group run offers (the registration's line
    names a race's), whether the form asks for medical information (§557, a disclosure old card 9's
    line said), the programme's line, the rules' and the minimum age. Each named card inside says
    the rest on its own line.
  */
  const summary = [
    registrationSummary(words, event, {
      takesRegistrations: registers,
      // The cost is a card of «Ce fel de eveniment» since §466, and its closed line says it.
      declarationVersion: declaration?.version ?? null,
      locale,
      creating: event === null,
    }),
    !asksHealthNoteOnForm(event) ? line.text : null,
    asksHealthNoteOnForm(event) ? healthNoteSummary(words, event?.askHealthNote ?? false) : null,
    programmeSummary(words, event, hasProgramme(initialType), translations, locale),
    t("editor.boxes.registration.rulesLine", { state: rulesSummary(words, translations) }),
    minAgeSummary(words, effectiveMinimumAge(event?.minAge), locale),
  ]
    .filter(Boolean)
    .join(words.separator);

  /*
    6.1 — how people register (§350): the mode, the places and the waiting list, then — while the
    club registers them here — the period, the confirmation window and the reminder. The fields of
    what was «Participare și înscrieri», as they were.
  */
  const registrationFields = (
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

                  {/* 6.1.1 — from when until when. */}
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

                  {/* 6.1.2 — the participation window (§104). The minimum age and the declaration are
                      named cards of this same card since §760, «Regulamentul» and «Declarația pe
                      propria răspundere» below: the sentence that sent the reader to them is gone. */}
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
                    6.1.3 — the reminder before the start (§81, §377): the club's lead unless this
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
                </Stack>
              </OnlyForMode>
            </Stack>
          </OnlyForType>

          {/*
            «Acceptă răspunsuri „Vin!” din pagină, calendar și email» (§811, «Vin!» part 1): the club's tick on an event one simply
            turns up to — a type that takes no registration, or one that does with «Fără înscrieri» chosen (`OnlyForTurnUp`). The
            marker says the form carried the box, so an unticked one reads as «off», not as «not edited» (§554). The notice must
            describe the answers before the page offers them (`/admin/tasks`, `rsvpNotice`): the tick stays on meanwhile.
          */}
          <OnlyForTurnUp registeringTypes={EVENT_TYPES.filter(takesRegistrations)} initialType={initialType} initialMode={initialMode}>
            <Stack spacing={1}>
              <input type="hidden" name="event.rsvpEnabled.present" value="1" />
              <CheckboxField name="event.rsvpEnabled" defaultChecked={event?.rsvpEnabled ?? false}>
                {t("editor.rsvpEnabled")}
              </CheckboxField>
              <BoxNote>{t("editor.rsvpEnabledHelp")}</BoxNote>
            </Stack>
          </OnlyForTurnUp>
        </Stack>
  );

  /*
    6.3 — the kit and the race numbers, the day's two cards that belong to registering here: shown
    only for a type that takes registrations, registering on the site (§111, §350) — hidden, never
    removed, like every field that follows the type and the mode.
  */
  const kitAndBibs = (
    <OnlyForType type={EVENT_TYPES.filter(takesRegistrations)} selectName="event.type" initialType={initialType}>
      <OnlyForMode mode="INTERNAL" initialMode={initialMode}>
                <Stack spacing={2}>
                  {/*
                    6.3.1 — «Kit de participare» (§554; the owner, 2026-09-29: «o subsecțiune cu kit de
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

                  {/* 6.3.2 — the one card for race numbers: the band (§173), what one bib looks like
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
                      {/* The band's colour (§173) is the designer's «Antet» now (§759), with the rest of the header. */}
                      <RecallField
                        name="event.bibStartNumber"
                        label={t("editor.bibStartNumber")}
                        helperText={t("editor.bibStartNumberHelp")}
                        defaultValue={event?.bibStartNumber ?? 1}
                        {...box("bibStartNumber", { inputMode: "numeric" })}
                        sx={{ width: { sm: 220 } }}
                      />
                      {event && <BoxNote>{t("editor.boxes.bibs.startChange")}</BoxNote>}
                      <BibDesignPanel
                        eventId={event?.id ?? null}
                        design={design}
                        bibStartNumber={event?.bibStartNumber ?? 1}
                        bibColour={event?.bibColour ?? null}
                        hasRouteGpx={readRouteGpx(event?.routeGpx) !== null}
                        summary={bibDesignSummary(words, designOn, footerOn)}
                      />
                      {bibPrint}
                    </Stack>
                  </Panel>
                </Stack>
      </OnlyForMode>
    </OnlyForType>
  );

  return (
    <Panel glyph="registration"
      collapsible
      id="box-registration"
      title={heading ?? t("editor.boxes.registration.title")}
      aside={summary}
      openWhen={{ attention: line.missing }}
      tone={risk ? "risk" : "default"}
    >
      {risk && <RiskLine>{t("editor.risk.registration")}</RiskLine>}
      <Stack spacing={2}>
        {/* 6.1 — how people register, and the registration's life. A reader is told once that the settings are not theirs (§358). */}
        {mayEditSettings ? registrationFields : <SettingsReadOnly />}
        {/* Right under the «Vin!» tick, which ends the block above (§811): who said they come — read-only, only when there are answers. */}
        {rsvp && <RsvpAnswersCard counts={rsvp.counts} rows={rsvp.rows} locale={locale} timeZone={zone} />}
        {/* 6.2 — what a participant agrees to: the rules, with the minimum age and what the form asks, then the declaration (§505, §448, §557, §799). */}
        {rules}
        {declarationCard}
        {/* 6.3 — the day: the programme and what to bring, then the kit and the numbers. */}
        {programme}
        {mayEditSettings
          ? kitAndBibs
          : // A reader keeps what is not a setting of the event (§542): the race numbers' allocation and
            // printing — «Vezi numerele», «Descarcă toate numerele (PDF)» — which the page draws only
            // for a role that reads the registrations (§289: the Organizer, not the Redactor).
            bibPrint}
        {/* 6.4 — the public list, last, where the page draws it (§406, §512). */}
        {startList}
      </Stack>
    </Panel>
  );
}
