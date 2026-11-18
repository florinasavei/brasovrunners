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
  one line that says whether a person takes part in the event's raffle and, when not, why — the same words on the desk's view of a person,
  a registration's page, a volunteer's page and under the lists' «Tombolă» tick, all from the one answer (`raffleParticipation`). Beside it,
  where the door is a staff member's, «Înscrie la tombolă» with the acceptance's tick: the desk's (DESK) and the organizers' (STAFF).

  Functions the page awaits, not async components: the element each returns is drawn in the page's own tree, which every screen test
  renders synchronously (`race-day/ui/RaceDayTabs.tsx`'s shape). Only strings and the action cross to the islands they hold.
*/

/** The line's words: «Participă la tombolă», or «Nu participă la tombolă: <de ce>». */
export function raffleStandingWords(t: (key: string, values?: Record<string, string>) => string, reason: RaffleReason): string {
  return reason === "in" ? t("raffle.standing.in") : t("raffle.standing.out", { reason: t(`raffle.reasons.${reason}`) });
}

/** The chip-sized line, the house's state chip: green for in, plain for out. */
function standingChip(words: string, reason: RaffleReason, testId: string): ReactElement {
  return <StatusChip glyph={reason === "in" ? "done" : "cancelled"} color={reason === "in" ? "success" : "default"} variant="outlined" label={words} testId={testId} wrap />;
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

/**
 * The desk's view of a person (§NNN): «Tombolă: participă / nu participă» for every desk role, always, in both modes; and, in the
 * sign-up mode with its gate open for a person who may still sign up, «Înscrie la tombolă» — the person having accepted the rules on
 * paper or aloud, which the desk member ticks.
 */
export async function raffleDeskLine(props: { line: RaffleLine; locale: string; code: string; registrationId: string; name: string; action: ServerAction }): Promise<ReactElement> {
  const t = await getTranslations("Admin");
  const words = raffleStandingWords(t, props.line.reason);
  return (
    <Stack spacing={1} data-testid="desk-raffle">
      <Box>{standingChip(words, props.line.reason, "desk-raffle-line")}</Box>
      {props.line.maySignUp &&
        signUpForm({
          action: props.action,
          hidden: (
            <>
              <input type="hidden" name="uiLocale" value={props.locale} />
              <input type="hidden" name="code" value={props.code} />
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
  const words = raffleStandingWords(t, props.line.reason);
  return (
    <Stack spacing={1} id="volunteer-raffle" sx={{ scrollMarginTop: 16 }} data-testid="volunteer-raffle">
      <Box>{standingChip(words, props.line.reason, "volunteer-raffle-line")}</Box>
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
  return standingChip(raffleStandingWords(t, props.line.reason), props.line.reason, "registration-raffle-line");
}

/** The list's few words for the answer (§NNN): «Da», or «Nu · <de ce>». */
export function raffleNoteWords(t: (key: string, values?: Record<string, string>) => string, reason: RaffleReason): string {
  return reason === "in" ? t("raffle.yes") : `${t("raffle.no")} · ${t(`raffle.reasons.${reason}`)}`;
}

/** Under a list's «Tombolă» tick (§NNN): the answer in a few words — «Da», or «Nu · <de ce>». */
export function RaffleStandingNote({ words, inRaffle }: { words: string; inRaffle: boolean }) {
  return (
    <Typography variant="caption" component="p" color={inRaffle ? "success.main" : "text.secondary"} sx={{ m: 0, overflowWrap: "anywhere" }} data-testid="raffle-standing">
      {words}
    </Typography>
  );
}
