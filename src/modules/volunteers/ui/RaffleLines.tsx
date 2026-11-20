import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { getTranslations } from "next-intl/server";
import type { ReactElement } from "react";
import { confirmWords } from "@/shared/feedback/confirm-words";
import ActionForm, { type ActionFormAction } from "@/shared/forms/ActionForm";
import CheckboxField from "@/shared/ui/CheckboxField";
import GlyphButton from "@/shared/ui/GlyphButton";
import StatusChip from "@/shared/ui/StatusChip";
import { TAP_TARGET } from "@/shared/ui/tap-target";
import type { RaffleReason } from "../domain/raffle";
import type { RaffleLine } from "../raffle-roster";

/*
  «În dreptul fiecărei persoane» (§984; the owner, 2026-11-18: «vreau să văd în dreptul fiecărei persoane dacă participă la tombolă»): the
  one line that says whether a person takes part in the event's raffle and, when not, why — the same words on the desk (each row of its
  list and a scanned person's view), a registration's page, a volunteer's page and under the lists' «Tombolă» tick, all from the one
  answer (`raffleParticipation`). Beside it,
  where the door is a staff member's, «Înscrie la tombolă» with the acceptance's tick: the desk's (DESK) and the organizers' (STAFF) —
  and, on the desk's line, «Scoate de la tombolă» / «Pune înapoi la tombolă», asked first (§NNN).

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
 * those words instead (the desk's «— scos de la tombolă», §NNN).
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
 * «Scoate de la tombolă» (`takeOut`) or «Pune înapoi la tombolă» on the desk's line (§NNN): one plain form posting the state it
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
 * la tombolă» for every desk role since §NNN — the reason is no longer the organizers' alone, the desk taking people out too — so the
 * desk sees what it did and can put it back. Every other reason is said to all — «nu s-a înscris» is what lets the desk offer the
 * sign-up. Then one press at most, whichever the answer allows:
 *
 * - «Scoate de la tombolă» for a registration that takes part, and «Pune înapoi la tombolă» for one taken out (§NNN; the owner,
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
 * A volunteer's page (§984): the line, and — for the organizers who open the page, in the sign-up mode with its gate open —
 * «Înscrie la tombolă» (STAFF), coming back to the page.
 */
export async function raffleVolunteerLine(props: { line: RaffleLine; locale: string; eventId: string; volunteerId: string; name: string; action: ServerAction }): Promise<ReactElement> {
  const t = await getTranslations("Admin");
  return (
    <Stack spacing={1} id="volunteer-raffle" sx={{ scrollMarginTop: 16 }} data-testid="volunteer-raffle">
      {standingChip(t, props.line.reason, "volunteer-raffle-line")}
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
