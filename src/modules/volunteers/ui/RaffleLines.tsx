import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { getTranslations } from "next-intl/server";
import type { ReactElement } from "react";
import CheckboxField from "@/shared/ui/CheckboxField";
import GlyphButton from "@/shared/ui/GlyphButton";
import StatusChip from "@/shared/ui/StatusChip";
import { TAP_TARGET } from "@/shared/ui/tap-target";
import type { RaffleReason } from "../domain/raffle";
import type { RaffleLine } from "../raffle-roster";

/*
  «În dreptul fiecărei persoane» (§NNN; the owner, 2026-11-18: «vreau să văd în dreptul fiecărei persoane dacă participă la tombolă»): the
  one line that says whether a person takes part in the event's raffle and, when not, why — the same words on the desk (each row of its
  list and a scanned person's view), a registration's page, a volunteer's page and under the lists' «Tombolă» tick, all from the one
  answer (`raffleParticipation`). Beside it,
  where the door is a staff member's, «Înscrie la tombolă» with the acceptance's tick: the desk's (DESK) and the organizers' (STAFF).

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
 * chip keeps its one line, the reason wraps as text does. `why` false leaves the reason out: the chip alone.
 */
function standingChip(t: Translate, reason: RaffleReason, testId: string, why = true): ReactElement {
  return (
    <Box sx={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 1 }} data-testid={testId} data-in={reason === "in" ? "1" : "0"}>
      <StatusChip glyph={reason === "in" ? "done" : "cancelled"} color={reason === "in" ? "success" : "default"} variant="outlined" label={raffleStandingWords(t, reason)} />
      {reason !== "in" && why && (
        <Typography variant="body2" color="text.secondary" component="span" sx={{ overflowWrap: "anywhere" }}>
          {t("raffle.standing.why", { reason: t(`raffle.reasons.${reason}`) })}
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
 * A person at the desk (§NNN), under their row on the desk's list and on the scanned person's view: «Tombolă: participă / nu
 * participă» for every desk role, always, in both modes, with why — but the organizers' own exclusion, «scos de organizatori»
 * (`takenOut`), is said only to the organizers (`organizer`: `canTakeRaffleList`, the Organizer and the Administrators, whose decision
 * it is); every other desk role reads «Tombolă: nu participă» alone there. Every other reason is said to all — «nu s-a înscris» is
 * what lets the desk offer the sign-up. And, in the sign-up mode with its gate open for a person who may still sign up, «Înscrie la
 * tombolă» — the person having accepted the rules on paper or aloud, which the desk member ticks.
 */
export async function raffleDeskLine(props: { line: RaffleLine; locale: string; back: RaffleDeskBack; registrationId: string; name: string; action: ServerAction; organizer: boolean }): Promise<ReactElement> {
  const t = await getTranslations("Admin");
  const { back } = props;
  return (
    <Stack spacing={1} data-testid="desk-raffle">
      {standingChip(t, props.line.reason, "desk-raffle-line", props.organizer || props.line.reason !== "takenOut")}
      {props.line.maySignUp &&
        signUpForm({
          action: props.action,
          hidden: (
            <>
              <input type="hidden" name="uiLocale" value={props.locale} />
              <input type="hidden" name="back" value={back.to} />
              {back.to === "code" && <input type="hidden" name="code" value={back.code} />}
              {back.to === "desk" && back.eventId && <input type="hidden" name="eventId" value={back.eventId} />}
              {back.to === "desk" && back.q && <input type="hidden" name="q" value={back.q} />}
              <input type="hidden" name="registrationId" value={props.registrationId} />
            </>
          ),
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
 * A volunteer's page (§NNN): the line, and — for the organizers who open the page, in the sign-up mode with its gate open —
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

/** A registration's page (§NNN): the line alone — the sign-up's staff doors are the desk and the «Tombolă» tab. */
export async function raffleRegistrationLine(props: { line: RaffleLine }): Promise<ReactElement> {
  const t = await getTranslations("Admin");
  return standingChip(t, props.line.reason, "registration-raffle-line");
}

/** The list's few words for the answer (§NNN): «Da», or «Nu · <de ce>». */
export function raffleNoteWords(t: Translate, reason: RaffleReason): string {
  return reason === "in" ? t("raffle.yes") : `${t("raffle.no")} · ${t(`raffle.reasons.${reason}`)}`;
}

/** Under a list's «Tombolă» tick (§NNN): the answer in a few words — «Da», or «Nu · <de ce>». */
export function RaffleStandingNote({ words, takesPart }: { words: string; takesPart: boolean }) {
  return (
    <Typography variant="caption" component="p" color={takesPart ? "success.main" : "text.secondary"} sx={{ m: 0, overflowWrap: "anywhere" }} data-testid="raffle-standing" data-in={takesPart ? "1" : "0"}>
      {words}
    </Typography>
  );
}
