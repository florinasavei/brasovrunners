import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { getTranslations } from "next-intl/server";
import type { ReactElement } from "react";
import { confirmWords } from "@/shared/feedback/confirm-words";
import ActionForm, { type ActionFormAction } from "@/shared/forms/ActionForm";
import CheckboxField from "@/shared/ui/CheckboxField";
import GlyphButton from "@/shared/ui/GlyphButton";
import StatusChip from "@/shared/ui/StatusChip";
import { TAP_TARGET } from "@/shared/ui/tap-target";
import { RAFFLE_GUARDIAN_FIELDS, RAFFLE_GUARDIAN_WAYS, type RaffleGuardianWay, type RaffleReason } from "../domain/raffle";
import type { RaffleLine } from "../raffle-roster";

/*
  «În dreptul fiecărei persoane» (§984; the owner, 2026-11-18: «vreau să văd în dreptul fiecărei persoane dacă participă la tombolă»): the
  one line that says whether a person takes part in the event's raffle and, when not, why — the same words on the desk (each row of its
  list and a scanned person's view), a registration's page, a volunteer's page and under the lists' «Tombolă» tick, all from the one
  answer (`raffleParticipation`). Beside it,
  where the door is a staff member's, «Înscrie la tombolă» with the acceptance's tick: the desk's (DESK) and the organizers' (STAFF) —
  and, on the desk's line, «Scoate de la tombolă» / «Pune înapoi la tombolă», asked first (§1020).

  Functions the page awaits, not async components: the element each returns is drawn in the page's own tree, which every screen test
  renders synchronously (`race-day/ui/RaceDayTabs.tsx`'s shape). Only strings and the action cross to the islands they hold.
*/

type Translate = (key: string, values?: Record<string, string>) => string;

/** The chip's words, short enough for one line of a phone: «Tombolă: participă» or «Tombolă: nu participă». */
export function raffleStandingWords(t: Translate, reason: RaffleReason): string {
  return reason === "in" ? t("raffle.standing.in") : t("raffle.standing.out");
}

/**
 * The house's state chip — green for in, plain for out — and, when out, why in a few words beside it («De ce: nu s-a înscris»): the
 * chip keeps its one line, the reason wraps as text does. `why` false leaves the reason out: the chip alone; a string says it in
 * those words instead (the desk's «— scos de la tombolă», §1020).
 */
function standingChip(t: Translate, reason: RaffleReason, testId: string, why: boolean | string = true): ReactElement {
  return (
    <Box sx={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 1 }} data-testid={testId} data-in={reason === "in" ? "1" : "0"}>
      <StatusChip glyph={reason === "in" ? "done" : "cancelled"} color={reason === "in" ? "success" : "default"} variant="outlined" label={raffleStandingWords(t, reason)} />
      {reason !== "in" && why !== false && (
        <Typography variant="body2" color="text.secondary" component="span" sx={{ overflowWrap: "anywhere" }}>
          {typeof why === "string" ? why : t("raffle.standing.why", { reason: t(`raffle.reasons.${reason}`) })}
        </Typography>
      )}
    </Box>
  );
}

type ServerAction = (form: FormData) => Promise<void>;

/** The acceptance's tick and the sign-up's button, in one plain form: the browser asks the tick before the post, the server again. */
function signUpForm(props: { action: ServerAction; hidden: ReactElement; label: string; ariaLabel: string; accepted: string; acceptedHelp: string; requiredMessage: string; testId: string }): ReactElement {
  return (
    <Box component="form" action={props.action} sx={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 1 }} data-testid={props.testId}>
      {props.hidden}
      <CheckboxField name="accepted" required dense help={props.acceptedHelp} requiredMessage={props.requiredMessage}>
        {props.accepted}
      </CheckboxField>
      <GlyphButton icon="addPerson" type="submit" variant="outlined" size="small" sx={TAP_TARGET} aria-label={props.ariaLabel}>
        {props.label}
      </GlyphButton>
    </Box>
  );
}

/** Where the desk's «Înscrie la tombolă» comes back to: the scanned person's view, or the desk's list with its event and search. */
export type RaffleDeskBack = { to: "code"; code: string } | { to: "desk"; eventId?: string; q?: string };

/**
 * «Scoate de la tombolă» (`takeOut`) or «Pune înapoi la tombolă» on the desk's line (§1020): one plain form posting the state it
 * wants (`inRaffle=0|1`), asked first by the house's one dialog — «Scoți pe Ana Pop (nr. 27) de la tombolă?», «Numărul lui nu mai
 * intră la tragere. Rămâne scris cine a decis.», the email nobody gets, «Anulează» focused, and «Da, scoate de la tombolă», red, which
 * Enter never presses (a way back is «Pune înapoi la tombolă», asked the same way). The question is a courtesy: the action and the
 * service assert the desk's own predicate again (`canSetRaffleMarkAtDesk`, BR-REQ-060-01).
 */
async function exclusionForm(props: { exclusionAction: ActionFormAction; hidden: ReactElement; takeOut: boolean; name: string; number: string }): Promise<ReactElement> {
  const t = await getTranslations("Admin");
  const words = await confirmWords();
  const { takeOut } = props;
  return (
    <ActionForm
      action={props.exclusionAction}
      confirm={{
        title: t(takeOut ? "raffle.desk.takeOutTitle" : "raffle.desk.putBackTitle", { name: props.name, number: props.number }),
        body: t(takeOut ? "raffle.desk.takeOutBody" : "raffle.desk.putBackBody"),
        // The person is not told (§949): said as every press that writes to nobody says it.
        ...words.noMail(props.name),
        confirmLabel: t(takeOut ? "raffle.desk.takeOutConfirm" : "raffle.desk.putBackConfirm"),
        cancelLabel: t("raffle.desk.cancel"),
        destructive: takeOut,
      }}
      data-testid={takeOut ? "desk-raffle-take-out" : "desk-raffle-put-back"}
    >
      {props.hidden}
      <input type="hidden" name="inRaffle" value={takeOut ? "0" : "1"} />
      <GlyphButton
        icon={takeOut ? "tickOff" : "tickOn"}
        type="submit"
        variant="outlined"
        color={takeOut ? "inherit" : "primary"}
        size="small"
        sx={TAP_TARGET}
        aria-label={t(takeOut ? "raffle.takeOutFor" : "raffle.putBackFor", { name: props.name })}
      >
        {t(takeOut ? "raffle.desk.takeOut" : "raffle.desk.putBack")}
      </GlyphButton>
    </ActionForm>
  );
}

/**
 * A person at the desk (§984), under their row on the desk's list and on the scanned person's view: «Tombolă: participă / nu
 * participă» for every desk role, always, in both modes, with why. A registration taken out reads «Tombolă: nu participă — scos de
 * la tombolă» for every desk role since §1020 — the reason is no longer the organizers' alone, the desk taking people out too — so the
 * desk sees what it did and can put it back. Every other reason is said to all — «nu s-a înscris» is what lets the desk offer the
 * sign-up. Then one press at most, whichever the answer allows:
 *
 * - «Scoate de la tombolă» for a registration that takes part, and «Pune înapoi la tombolă» for one taken out (§1020; the owner,
 *   2026-11-20: «ar trebui să pot să-l scot de la tombolă ca și voluntar dar să fie cu extra confirmare») — every desk role, asked
 *   first (`exclusionForm`), the number named in the question; an elite registration (§897) like any other; never on a row the
 *   desk draws read-only (a completed event, §82), which reads and offers no button;
 * - in the sign-up mode with its gate open for a person who may still sign up, «Înscrie la tombolă» — the person having accepted the
 *   rules on paper or aloud, which the desk member ticks.
 */
export async function raffleDeskLine(props: {
  line: RaffleLine;
  locale: string;
  back: RaffleDeskBack;
  registrationId: string;
  name: string;
  /** The race number as the event writes it (§735), named in the question; null for none, and then no press is drawn. */
  number: string | null;
  action: ServerAction;
  /** The desk's «Scoate» / «Pune înapoi» (`checkin/raffle-actions.ts#raffleDeskExclusionAction`), asked first. */
  exclusionAction: ActionFormAction;
  /** The desk's row is read-only (§82: the race is over): the line reads, and «Scoate» / «Pune înapoi» is not drawn. */
  readOnly?: boolean;
}): Promise<ReactElement> {
  const t = await getTranslations("Admin");
  const { back, line, number } = props;
  // The way back the line's presses carry, rebuilt by the actions from these fields alone.
  const hidden = (
    <>
      <input type="hidden" name="uiLocale" value={props.locale} />
      <input type="hidden" name="back" value={back.to} />
      {back.to === "code" && <input type="hidden" name="code" value={back.code} />}
      {back.to === "desk" && back.eventId && <input type="hidden" name="eventId" value={back.eventId} />}
      {back.to === "desk" && back.q && <input type="hidden" name="q" value={back.q} />}
      <input type="hidden" name="registrationId" value={props.registrationId} />
    </>
  );
  const takenOut = line.reason === "takenOut";
  return (
    <Stack spacing={1} data-testid="desk-raffle">
      {standingChip(t, line.reason, "desk-raffle-line", takenOut ? t("raffle.desk.takenOut") : true)}
      {number !== null &&
        !props.readOnly &&
        (line.reason === "in" || takenOut) &&
        (await exclusionForm({ exclusionAction: props.exclusionAction, hidden, takeOut: line.reason === "in", name: props.name, number }))}
      {line.maySignUp &&
        signUpForm({
          action: props.action,
          hidden,
          label: t("raffle.signUp"),
          ariaLabel: t("raffle.signUpFor", { name: props.name }),
          accepted: t("raffle.accepted"),
          acceptedHelp: t("raffle.acceptedHelp"),
          requiredMessage: t("errors.RAFFLE_RULES_NOT_ACCEPTED"),
          testId: "desk-raffle-sign-up",
        })}
    </Stack>
  );
}

/**
 * What the «Tombolă» tab and the volunteer's page say of a volunteer confirmed for the raffle alone (§1028), beside «Da»: that it is a
 * raffle confirmation, never a volunteer's — «confirmat doar pentru tombolă» — and, for a minor, how the parent agreed.
 */
export function raffleConfirmationWords(t: Translate, guardianWay: RaffleGuardianWay | null): string {
  const state = t("raffle.confirm.state");
  return guardianWay === null ? state : `${state} · ${t("raffle.confirm.guardianLine", { way: t(`raffle.confirm.ways.${guardianWay}`) })}`;
}

/**
 * «Confirmă pentru tombolă» (§1028, amending §984 and §1023) — the organizers' press on a volunteer who is not confirmed, on the row of
 * the «Tombolă» tab and on the volunteer's own page: one form, asked first by the house's one dialog — «Confirmi pe Maria Pop pentru
 * tombolă?», what it does (a V number when the person has none, the draw, still unconfirmed as a volunteer, who decided kept), the email
 * nobody gets, «Anulează» focused, «Da, confirmă pentru tombolă». For **a minor** the form holds the way the parent or guardian agreed —
 * «telefonic», «la fața locului», «în scris», a native select the browser asks before the dialog opens, its chosen words in the dialog's
 * sentence — and the dialog the box «Părintele sau tutorele a fost de acord să participe la tombolă», which its confirm waits for and
 * writes into the form (`ConfirmSpec.tick`). **«Cu înscriere separată»** the press signs the person up too: the form holds «A acceptat
 * regulamentul», as the organizers' «Înscrie» does. Every rule is the server's again (`raffle-confirmation.ts`, BR-REQ-060-01):
 * without JavaScript there is no dialog, and a minor's empty answers are refused by name.
 */
export async function raffleConfirmForm(props: {
  confirmAction: ActionFormAction;
  /** The hidden fields the press carries back and names the person by: the page's language, the event, the person, the way back. */
  hidden: ReactElement;
  name: string;
  minor: boolean;
  /** «Cu înscriere separată»: the press signs the person up, the acceptance's tick beside it. */
  signUpMode: boolean;
  testId: string;
}): Promise<ReactElement> {
  const t = await getTranslations("Admin");
  const words = await confirmWords();
  const { minor } = props;
  return (
    <ActionForm
      action={props.confirmAction}
      confirm={{
        title: t("raffle.confirm.title", { name: props.name }),
        // A minor's sentence names the way chosen on the form at the press (`fillFromChosen`): «… dat telefonic».
        body: minor ? t("raffle.confirm.bodyMinor", { name: props.name, way: `{${RAFFLE_GUARDIAN_FIELDS.way}}` }) : t("raffle.confirm.body"),
        // The person is not told (§949): said as every press that writes to nobody says it.
        ...words.noMail(props.name),
        ...(minor ? { tick: { field: RAFFLE_GUARDIAN_FIELDS.agreed, label: t("raffle.confirm.guardianAgreed") }, fillFromChosen: [RAFFLE_GUARDIAN_FIELDS.way] } : {}),
        confirmLabel: t("raffle.confirm.confirm"),
        cancelLabel: t("raffle.confirm.cancel"),
      }}
      data-testid={props.testId}
    >
      <Box sx={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 1 }}>
        {props.hidden}
        {/* The dialog's box, posted empty as drawn; its confirm writes `on` here (§888's mechanism). */}
        {minor && <input type="hidden" name={RAFFLE_GUARDIAN_FIELDS.agreed} defaultValue="" />}
        {minor && (
          <TextField
            select
            required
            name={RAFFLE_GUARDIAN_FIELDS.way}
            label={t("raffle.confirm.way")}
            defaultValue=""
            size="small"
            slotProps={{ select: { native: true }, inputLabel: { shrink: true }, htmlInput: { "data-testid": "raffle-confirm-way" } }}
            // The select itself a thumb's 44 pixels (BR-REQ-041-01): a native select opens on the element, not on its frame.
            sx={{ minWidth: 200, "& .MuiInputBase-input": { minHeight: 44, boxSizing: "border-box" } }}
          >
            <option value="">{t("raffle.confirm.wayChoose")}</option>
            {RAFFLE_GUARDIAN_WAYS.map((way) => (
              <option key={way} value={way}>
                {t(`raffle.confirm.ways.${way}`)}
              </option>
            ))}
          </TextField>
        )}
        {props.signUpMode && (
          <CheckboxField name="accepted" required dense help={t("raffle.acceptedHelp")} requiredMessage={t("errors.RAFFLE_RULES_NOT_ACCEPTED")}>
            {t("raffle.accepted")}
          </CheckboxField>
        )}
        <GlyphButton icon="confirm" type="submit" variant="outlined" size="small" sx={TAP_TARGET} aria-label={t("raffle.confirm.buttonFor", { name: props.name })} data-testid="raffle-confirm">
          {t("raffle.confirm.button")}
        </GlyphButton>
      </Box>
    </ActionForm>
  );
}

/**
 * A volunteer's page (§984): the line, and — for the organizers who open the page, in the sign-up mode with its gate open —
 * «Înscrie la tombolă» (STAFF), coming back to the page. Since §1028 a volunteer confirmed for the raffle alone reads so beside the
 * chip («Confirmat doar pentru tombolă, nu ca voluntar», a minor's parent's way after it), and one who may be is offered
 * «Confirmă pentru tombolă» (`confirmAction`), coming back to the page.
 */
export async function raffleVolunteerLine(props: {
  line: RaffleLine;
  locale: string;
  eventId: string;
  volunteerId: string;
  name: string;
  action: ServerAction;
  /** «Confirmă pentru tombolă» (§1028): the organizers' press, drawn while the line says it may be offered. */
  confirmAction?: ActionFormAction;
}): Promise<ReactElement> {
  const t = await getTranslations("Admin");
  const volunteer = props.line.volunteer;
  return (
    <Stack spacing={1} id="volunteer-raffle" sx={{ scrollMarginTop: 16 }} data-testid="volunteer-raffle">
      {standingChip(t, props.line.reason, "volunteer-raffle-line")}
      {volunteer?.confirmedForRaffle && (
        <Typography variant="body2" color="text.secondary" sx={{ overflowWrap: "anywhere" }} data-testid="volunteer-raffle-confirmed">
          {volunteer.guardianWay === null
            ? t("raffle.confirm.pageLine")
            : `${t("raffle.confirm.pageLine")} · ${t("raffle.confirm.guardianLine", { way: t(`raffle.confirm.ways.${volunteer.guardianWay}`) })}`}
        </Typography>
      )}
      {volunteer?.mayConfirmForRaffle &&
        props.confirmAction &&
        (await raffleConfirmForm({
          confirmAction: props.confirmAction,
          hidden: (
            <>
              <input type="hidden" name="uiLocale" value={props.locale} />
              <input type="hidden" name="eventId" value={props.eventId} />
              <input type="hidden" name="table" value="volunteer" />
              <input type="hidden" name="personId" value={props.volunteerId} />
              <input type="hidden" name="back" value="volunteer" />
            </>
          ),
          name: props.name,
          minor: volunteer.minor,
          signUpMode: props.line.signUpMode,
          testId: "volunteer-raffle-confirm-form",
        }))}
      {props.line.maySignUp &&
        signUpForm({
          action: props.action,
          hidden: (
            <>
              <input type="hidden" name="uiLocale" value={props.locale} />
              <input type="hidden" name="eventId" value={props.eventId} />
              <input type="hidden" name="table" value="volunteer" />
              <input type="hidden" name="personId" value={props.volunteerId} />
              <input type="hidden" name="back" value="volunteer" />
            </>
          ),
          label: t("raffle.signUp"),
          ariaLabel: t("raffle.signUpFor", { name: props.name }),
          accepted: t("raffle.accepted"),
          acceptedHelp: t("raffle.acceptedHelp"),
          requiredMessage: t("errors.RAFFLE_RULES_NOT_ACCEPTED"),
          testId: "volunteer-raffle-sign-up",
        })}
    </Stack>
  );
}

/** A registration's page (§984): the line alone — the sign-up's staff doors are the desk and the «Tombolă» tab. */
export async function raffleRegistrationLine(props: { line: RaffleLine }): Promise<ReactElement> {
  const t = await getTranslations("Admin");
  return standingChip(t, props.line.reason, "registration-raffle-line");
}

/** The list's few words for the answer (§984): «Da», or «Nu · <de ce>». */
export function raffleNoteWords(t: Translate, reason: RaffleReason): string {
  return reason === "in" ? t("raffle.yes") : `${t("raffle.no")} · ${t(`raffle.reasons.${reason}`)}`;
}

/** Under a list's «Tombolă» tick (§984): the answer in a few words — «Da», or «Nu · <de ce>». */
export function RaffleStandingNote({ words, takesPart }: { words: string; takesPart: boolean }) {
  return (
    <Typography variant="caption" component="p" color={takesPart ? "success.main" : "text.secondary"} sx={{ m: 0, overflowWrap: "anywhere" }} data-testid="raffle-standing" data-in={takesPart ? "1" : "0"}>
      {words}
    </Typography>
  );
}
