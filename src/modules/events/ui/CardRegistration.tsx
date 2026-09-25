import HowToRegIcon from "@mui/icons-material/HowToReg";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import { formatDay } from "@/i18n/dates";
import { openRegistrationClosing, registrationState } from "../domain/registration-window";
import type { PublicEvent } from "../repository";
import { GROUP_GAP, LINE_GAP, ROW_ICON_SX } from "./card-layout";
import { freePlacesPhrase } from "./counted-phrases";
import type { RegistrationDoor } from "./registration-door";
import RegistrationDoorButton, { type ButtonCta, doorButtonLabel, hasDoorButton } from "./RegistrationDoorButton";

type Say = (key: string, values?: Record<string, string | number>) => string;

/** What the card says about registration: a line, and the page's button when the page has one. */
export type CardRegistrationLine = {
  /** The state: "Înscrieri deschise până pe …", "Înscrierile se deschid pe …", "Înscrierile s-au închis". */
  lead: string;
  /** After a middle dot: "7 locuri libere din 10", or "Lista de așteptare" once the places are gone. */
  detail: string | null;
  /** Bold where there is something to do or wait for; quiet where the question is closed. */
  bold: boolean;
  button: { cta: ButtonCta; label: string } | null;
};

/**
 * The listing card's registration, in words (§409). The owner, 2026-09-25: "trebuie să văd
 * butonul de înscrieri pe card pentru evenimentele de tip concurs; să fac bold pe asta cu
 * înscrierile și să văd câte locuri sunt disponibile".
 *
 * **The same door as the page, not a second one.** `door` is `readRegistrationDoor`'s answer — the
 * one `RegistrationCta` reads on the page — and the button is `RegistrationDoorButton` with
 * `doorButtonLabel`, the page's own. So the card offers a button exactly when the page does, in the
 * same words, to the same form: "Înscrie-te la eveniment" while there is a place, "Intră pe lista
 * de așteptare" once there is not, the organizer's page for an event registered elsewhere, and
 * nothing where the page has no button (a full list, §348; a window not open yet or closed).
 *
 * **The line.** Bold where there is something to do or wait for — "Înscrieri deschise până pe
 * sâm., 26 sept. 2026, 10:00 · 7 locuri libere din 10", "… · Lista de așteptare", "Înscrierile se
 * deschid pe …", the organizer's site, a full event — and as it was (quiet, secondary) where the
 * question is closed: registration over, the event cancelled or held, or none needed. An uncapped
 * event says no number (BR-REQ-034-01 criterion 4). A count that could not be read (§281) says the
 * window and no number, and offers no button: it would lead to a form whose first act is the read
 * that just failed.
 *
 * Pure, over the card's translator: `EventFacts` reads the door and hands the words to the
 * synchronous component below.
 */
export function cardRegistrationLine(say: Say, locale: string, event: PublicEvent, now: Date, door: RegistrationDoor): CardRegistrationLine {
  // Inside the sentence, so the weekday keeps its lower case (§349).
  const shortDate = (date: Date) => formatDay(date, { locale, timeZone: event.timezone, style: "short", withTime: true, position: "inline" });
  // Until when an open window stays open (§308) — the instant the button goes away.
  const closesAt = openRegistrationClosing(event, now);
  const openUntil = closesAt ? say("cta.openUntilShort", { date: shortDate(closesAt) }) : say("registrationState.OPEN");

  if (door.kind === "UNKNOWN") return { lead: openUntil, detail: null, bold: true, button: null };

  const { cta, fill } = door;
  const button = hasDoorButton(cta) ? { cta, label: doorButtonLabel(say, cta) } : null;
  switch (cta.kind) {
    case "OPEN":
      return {
        lead: openUntil,
        detail: cta.availablePlaces !== null && fill ? freePlacesPhrase(say, locale, cta.availablePlaces, fill.capacity) : null,
        bold: true,
        button,
      };
    case "FULL":
      return { lead: openUntil, detail: say("cta.cardWaitlist"), bold: true, button };
    case "WAITLIST_FULL":
      return { lead: say("cta.waitlistFull"), detail: null, bold: true, button: null };
    case "FULL_NO_WAITLIST":
      return { lead: say("cta.fullNoWaitlist"), detail: null, bold: true, button: null };
    case "NOT_YET_OPEN":
      // The opening date rather than "not yet" (§146).
      return { lead: say("cta.opensOnShort", { date: shortDate(cta.opensAt) }), detail: null, bold: true, button: null };
    case "EXTERNAL":
      return { lead: say("registrationState.EXTERNAL"), detail: null, bold: true, button };
    default:
      // Closed, cancelled, held, or none needed: the state's own words, quiet, as before §409.
      return { lead: say(`registrationState.${registrationState(event, now)}`), detail: null, bold: false, button: null };
  }
}

/**
 * The card's registration line and, under it, the page's button — two rows of the facts' grid, the
 * line last among the facts where BR-REQ-011-01 criterion 18 reads it.
 */
export default function CardRegistration({ slug, line }: { slug: string; line: CardRegistrationLine }) {
  return (
    <>
      <Typography
        component="div"
        variant="body2"
        color={line.bold ? "text.primary" : "text.secondary"}
        data-fact="registration"
        sx={{ display: "flex", alignItems: "flex-start", minWidth: 0, fontWeight: line.bold ? 700 : undefined }}
      >
        <HowToRegIcon aria-hidden="true" sx={ROW_ICON_SX} />
        <Box sx={{ minWidth: 0, overflowWrap: "anywhere" }}>
          {line.lead}
          {line.detail && (
            <>
              {" "}
              <Box component="span" aria-hidden="true" sx={{ color: "text.disabled", fontWeight: 400 }}>
                ·
              </Box>{" "}
              {/* The count stays whole on a phone: it wraps as one piece, never "7 locuri / libere". */}
              <Box component="span" data-testid="card-places" sx={{ whiteSpace: "nowrap" }}>
                {line.detail}
              </Box>
            </>
          )}
        </Box>
      </Typography>
      {line.button && (
        // A group's gap under the line (the grid's own gap is a line's): the button is a group of
        // its own, as the pills are (§366). 44 pixels tall (BR-REQ-041-01 criterion 6).
        <Box data-fact="door" sx={{ mt: GROUP_GAP - LINE_GAP }}>
          <RegistrationDoorButton slug={slug} cta={line.button.cta} label={line.button.label} />
        </Box>
      )}
    </>
  );
}
