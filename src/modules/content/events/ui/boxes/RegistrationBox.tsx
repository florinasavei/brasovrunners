import Box from "@mui/material/Box";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { Link } from "@/i18n/navigation";
import { EVENT_COST_TYPES } from "@/modules/events/domain/cost";
import { EVENT_TYPES, takesRegistrations } from "@/modules/events/domain/event-type";
import { readBibDesign } from "@/modules/registrations/bib-design";
import { MIN_PARTICIPANT_AGE } from "@/modules/registrations/domain/age";
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
  conditionsSummary,
  registrationSummary,
  registrationWindowSummary,
  startListSummary,
  summaryDate,
} from "../box-summaries";
import CostFields from "../CostFields";
import GlyphSelect from "../GlyphSelect";
import OnlyForMode from "../OnlyForMode";
import OnlyForType from "../OnlyForType";
import WallTimeField from "../WallTimeField";
import { BoxNote, type BoxProps, RiskLine, SettingsReadOnly, summaryWords } from "./box-kit";
import { DEFAULT_TIMEZONE } from "./WhenBox";

const REGISTRATION_MODES = ["NONE", "INTERNAL", "EXTERNAL"] as const;

/**
 * The colours a race's numbers may print in (§173, §177): six that stay apart from each other
 * on paper and from the club's blue, which is the empty choice. Hex triplets, because that is
 * what `events.bib_colour` checks for and what the sheet paints.
 */
const BIB_COLOURS = [
  { key: "green", hex: "#1b8a3a" },
  { key: "red", hex: "#c62828" },
  { key: "orange", hex: "#ef6c00" },
  { key: "purple", hex: "#6a1b9a" },
  { key: "teal", hex: "#00838f" },
  { key: "black", hex: "#212121" },
] as const;

export type DeclarationOption = { id: string; version: number; title: string };

/** The box's own constraints, read off `fields.ts`, as `TextField` takes them (§315). */
function box(field: EventFieldName, extra: Record<string, unknown> = {}) {
  return textFieldConstraints(eventInputConstraints(field), extra);
}

/**
 * Box 8, "Participare și înscrieri" (§NNN): what it costs, how people register — here, with
 * another organizer, or not at all — and under which rules. Everything about registration is in
 * this one box, as named cards: the period, who may enter and what they sign, the confirmation
 * window, the race numbers (with the bib design and, on the editor, allocation and printing), and
 * the public list (owner requirement 1: the list lives in the registration box).
 *
 * **Only what the chosen mode needs is shown** (`OnlyForMode`): "Pe site" shows the capacity and
 * the five cards, "La organizator" the organizer's name and link, "Fără" one sentence. A group run
 * takes no registration at all (§111): its sentence replaces everything under the cost. Every
 * hidden field stays in the document — hidden, not removed — so switching back finds what was
 * typed, and the service ignores what the mode hides (`ignoreHiddenFields`, before its schema). No
 * mode-dependent box carries a browser `required`: the server decides; and while hidden, the boxes
 * are read-only, so a `min` or a `pattern` left unmet out of sight never stops the save (`ShownWhen`).
 *
 * The cost's amount and its payment or donation link sit with the cost, at the top (§343,
 * `CostFields`, which shows them only while the chosen kind needs them); the waiting list's length
 * sits beside the capacity (§NNN, the waiting-list cap), and "not here" stores no length either.
 */
export default async function RegistrationBox({
  event,
  mayEditSettings,
  risk,
  declarations,
  waiting = 0,
  bibCounts,
  bibPrint,
  locale,
  now,
}: BoxProps & {
  /** The page's clock, for "race week" (the bib card opens by itself then). */
  now?: Date;
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
  const declaration = declarations.find((option) => option.id === event?.declarationDocumentId) ?? null;
  const colour = BIB_COLOURS.find((choice) => choice.hex === event?.bibColour);
  const colourLabel = event?.bibColour ? (colour ? t(`editor.bibColours.${colour.key}`) : event.bibColour) : null;
  // "Cu taxă, 50 lei", "Donație": the kind in the select's own words, and the amount beside a kind
  // that has one (§343) — what the page will say, on the box's closed line.
  const costAmount = event?.costType === "PAID" || event?.costType === "DONATION" ? (event.costAmount ?? "").trim() : "";
  const costLabel = event?.costType ? `${t(`editor.costValues.${event.costType}`)}${costAmount ? `, ${costAmount}` : ""}` : null;
  const minAge = event?.minAge ?? MIN_PARTICIPANT_AGE;
  const needsDeclaration = initialMode === "INTERNAL" && declaration === null && event !== null;
  const design = readBibDesign(event?.bibDesign ?? null);
  const designOn = (["showName", "showEventTitle", "showDate", "showLogo", "cutMarks"] as const)
    .filter((field) => design[field])
    .map((field) => t(`editor.bibDesign.${field}`));
  const footerOn = (["showEventInFooter", "showPartners", "showWebsite", "showEmail"] as const)
    .filter((field) => design[field])
    .map((field) => t(`editor.bibDesign.footer.${field}`));

  const summary = registrationSummary(words, event, {
    takesRegistrations: takesRegistrations(initialType),
    costLabel,
    declarationVersion: declaration?.version ?? null,
    defaultMinAge: MIN_PARTICIPANT_AGE,
    locale,
    creating: event === null,
  });

  return (
    <Panel
      collapsible
      id="box-registration"
      title={t("editor.boxes.registration.title")}
      aside={summary}
      openWhen={{ attention: needsDeclaration }}
      tone={risk ? "risk" : "default"}
      badge={risk?.chip}
    >
      {risk && <RiskLine>{t("editor.risk.registration")}</RiskLine>}
      {!mayEditSettings ? (
        <SettingsReadOnly />
      ) : (
        <Stack spacing={2}>
          {/* The cost, on every type (moved from "Traseu și detalii"): the empty option is "not
              stated", a real answer the page shows by omitting the row. */}
          <GlyphSelect
            name="event.costType"
            label={t("editor.fields.costType")}
            helperText={t("editor.costHelp")}
            defaultValue={event?.costType ?? ""}
            options={[
              { value: "", label: t("editor.notStated") },
              ...EVENT_COST_TYPES.map((value) => ({ value, label: t(`editor.costValues.${value}`), glyph: `cost:${value}` as const })),
            ]}
          />

          {/*
            "Suma" and "Unde se plătește" for a paid event, "Link pentru donație" and "Suma
            sugerată" for a donation (§343; the owner: "Cu taxă" showed no box for the money, and
            usually nothing is paid — the exception is Wings for Life, where a donation is made
            on another site). One pair of columns, relabelled by `CostFields` rather than posted
            twice; shown only while the chosen kind needs one of them, values kept otherwise.
          */}
          <CostFields
            initialCostType={event?.costType ?? ""}
            costAmount={{ defaultValue: event?.costAmount ?? "", box: box("costAmount") }}
            costUrl={{ defaultValue: event?.costUrl ?? "", box: box("costUrl", { inputMode: "url" }) }}
            labels={{
              paidAmount: t("editor.costAmount"),
              paidAmountHelp: t("editor.costAmountHelp"),
              paidUrl: t("editor.costPaidUrl"),
              paidUrlHelp: t("editor.costPaidUrlHelp"),
              donationUrl: t("editor.costDonationUrl"),
              donationUrlHelp: t("editor.costDonationUrlHelp"),
              donationAmount: t("editor.costDonationAmount"),
              donationAmountHelp: t("editor.costDonationAmountHelp"),
            }}
          />

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
                  {/* The places and the waiting list's length side by side (§NNN, the waiting-list
                      cap): the second only means anything once the first is set, and a row says
                      they are one question. Stacked on a phone. Empty is no limit for both; 0 on
                      the second is no waiting list at all. */}
                  <Stack direction={{ xs: "column", sm: "row" }} spacing={2} data-testid="capacity-row">
                    <RecallField
                      name="event.capacity"
                      label={t("editor.capacity")}
                      helperText={waiting > 0 ? `${t("editor.capacityHelp")} ${t("editor.capacityWaiting", { waiting })}` : t("editor.capacityHelp")}
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

                  {/* 8.1 — from when until when. */}
                  <Panel collapsible level={3} id="box-registration-window" title={t("editor.boxes.registrationWindow.title")} aside={registrationWindowSummary(words, event, locale)}>
                    <Stack spacing={1}>
                      <Stack direction={{ xs: "column", md: "row" }} spacing={2}>
                        <WallTimeField name="event.registrationOpensAt" label={t("editor.registrationOpensAt")} timeLabel={t("editor.timeOfDay")} value={event?.registrationOpensAt ?? null} zone={zone} />
                        <WallTimeField name="event.registrationClosesAt" label={t("editor.registrationClosesAt")} timeLabel={t("editor.timeOfDay")} value={event?.registrationClosesAt ?? null} zone={zone} />
                      </Stack>
                      <BoxNote>{t("editor.registrationWindowHelp")}</BoxNote>
                      {risk && <BoxNote>{t("editor.boxes.registrationWindow.earlierClose")}</BoxNote>}
                    </Stack>
                  </Panel>

                  {/* 8.2 — who may enter, and what they sign at confirmation. Deliberately not in the
                      bib card: the declaration decides who may take part. */}
                  <Panel
                    collapsible
                    level={3}
                    id="box-conditions"
                    title={t("editor.boxes.conditions.title")}
                    aside={conditionsSummary(words, minAge, declaration)}
                    openWhen={{ attention: needsDeclaration }}
                  >
                    <Stack spacing={2}>
                      {/* Years reached by the event's day (§329), never below fourteen (§321). */}
                      <RecallField
                        name="event.minAge"
                        label={t("editor.minAge")}
                        helperText={t("editor.minAgeHelp")}
                        defaultValue={minAge}
                        {...box("minAge", { inputMode: "numeric" })}
                        sx={{ width: { sm: 220 } }}
                      />
                      {/* A choice among approved versions, never an editor (`AGENTS.md` §11.1). */}
                      <RecallField
                        select
                        name="event.declarationDocumentId"
                        label={t("editor.declarationDocument")}
                        helperText={declarations.length === 0 ? t("editor.declarationNone") : t("editor.declarationDocumentHelp")}
                        defaultValue={event?.declarationDocumentId ?? ""}
                      >
                        <MenuItem value="">{t("editor.declarationUnset")}</MenuItem>
                        {declarations.map((document) => (
                          <MenuItem key={document.id} value={document.id}>
                            v{document.version} · {document.title}
                          </MenuItem>
                        ))}
                      </RecallField>
                      <Typography variant="body2">
                        <Link href="/admin/legal">{t("editor.boxes.conditions.legalLink")}</Link>
                      </Typography>
                    </Stack>
                  </Panel>

                  {/* 8.3 — the participation window (§104). */}
                  <Panel
                    collapsible
                    level={3}
                    id="box-confirmation"
                    title={t("editor.boxes.confirmation.title")}
                    aside={confirmationSummary(words, event?.confirmationOpensDaysBefore ?? 7, event?.confirmationDeadlineDaysBefore ?? 2)}
                  >
                    <Stack spacing={1}>
                      <Stack direction={{ xs: "column", md: "row" }} spacing={2}>
                        <RecallField
                          name="event.confirmationOpensDaysBefore"
                          label={t("editor.confirmationOpensDaysBefore")}
                          defaultValue={event?.confirmationOpensDaysBefore ?? 7}
                          {...box("confirmationOpensDaysBefore", { inputMode: "numeric" })}
                          fullWidth
                        />
                        <RecallField
                          name="event.confirmationDeadlineDaysBefore"
                          label={t("editor.confirmationDeadlineDaysBefore")}
                          defaultValue={event?.confirmationDeadlineDaysBefore ?? 2}
                          {...box("confirmationDeadlineDaysBefore", { inputMode: "numeric" })}
                          fullWidth
                        />
                      </Stack>
                      {event && (
                        <Typography variant="body2" data-testid="confirmation-dates">
                          {t("editor.boxes.confirmation.dates", {
                            date: summaryDate(event.startsAt, zone, locale, "inline"),
                            opens: summaryDate(new Date(event.startsAt.getTime() - event.confirmationOpensDaysBefore * 86_400_000), zone, locale, "inline"),
                            due: summaryDate(new Date(event.startsAt.getTime() - event.confirmationDeadlineDaysBefore * 86_400_000), zone, locale, "inline"),
                          })}
                        </Typography>
                      )}
                      <BoxNote>{t("editor.confirmationWindowHelp")}</BoxNote>
                    </Stack>
                  </Panel>

                  {/* 8.4 — the one card for race numbers: the band (§173), what one bib looks like
                      (§249, now on create too) and, on the editor, whether they exist and print. */}
                  <Panel
                    collapsible
                    level={3}
                    id="box-bibs"
                    title={t("editor.boxes.bibs.title")}
                    aside={bibsSummary(words, event?.bibStartNumber ?? 1, colourLabel, bibCounts ? { allocated: bibCounts.total, unprinted: bibCounts.unprinted } : null)}
                    openWhen={{ attention: Boolean(bibCounts && bibCounts.unprinted > 0 && event && now && raceWeek(event.startsAt, now)) }}
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

                  {/* 8.5 — the start list, off unless somebody deliberately turns it on
                      (BR-REQ-039-01): a disclosure, so the help says what it publishes. */}
                  <Panel collapsible level={3} id="box-start-list" title={t("editor.boxes.startList.title")} aside={startListSummary(words, event?.participantListVisibility)}>
                    <Box>
                      <CheckboxField name="event.participantListVisibility" defaultChecked={event?.participantListVisibility === "NAMES"}>
                        {t("editor.participantList")}
                      </CheckboxField>
                      <BoxNote>{t("editor.participantListHelp")}</BoxNote>
                    </Box>
                  </Panel>
                </Stack>
              </OnlyForMode>
            </Stack>
          </OnlyForType>
        </Stack>
      )}
    </Panel>
  );
}

/** Whether the event starts within the next seven days (the bib card's "attention", §311). */
function raceWeek(startsAt: Date, now: Date): boolean {
  const until = startsAt.getTime() - now.getTime();
  return until >= 0 && until <= 7 * 86_400_000;
}
