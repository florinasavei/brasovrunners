import HowToRegIcon from "@mui/icons-material/HowToReg";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import { formatDay } from "@/i18n/dates";
import { openRegistrationClosing, registrationState } from "../domain/registration-window";
import type { PublicEvent } from "../repository";
import { GROUP_GAP, LINE_GAP, ROW_ICON_SX } from "./card-layout";
import { countForm } from "@/i18n/count-form";
import type { RegistrationDoor } from "./registration-door";
import RegistrationDoorButton, { type ButtonCta, doorButtonLabel, hasDoorButton } from "./RegistrationDoorButton";

type Say = (key: string, values?: Record<string, string | number>) => string;

/** What the card says about registration: a line, and the page's button when the page has one. */
export type CardRegistrationLine = {
  /** The state: "Înscrieri deschise până pe …", "Înscrierile se deschid pe …", "Înscrierile s-au închis". */
  lead: string;
  /** `lead` cut around its date and hour, the one part in bold (§NNN); null when it has no date. */
  leadParts: FactParts | null;
  /** After a middle dot: "7 locuri libere din 10", or "Lista de așteptare" once the places are gone. */
  detail: string | null;
  /** `detail` cut around "7 locuri libere", the one part in bold (§NNN); null for the waiting list. */
  detailParts: FactParts | null;
  /** Bold where there is something to do or wait for; quiet where the question is closed. */
  bold: boolean;
  button: { cta: ButtonCta; label: string } | null;
};

/** A sentence in three pieces, the middle one the fact: "Înscrieri deschise până " + date + "". */
export type FactParts = { before: string; fact: string; after: string };

const SLOT = "";

/**
 * The catalogue's own sentence with `fact` in the slot `name`: the words around it come from the
 * message itself, formatted with a marker in the slot and cut there, so the order is each
 * language's own and nothing is searched for in the finished text (§NNN).
 */
function factParts(say: Say, key: string, values: Record<string, string | number>, name: string, fact: string): FactParts {
  const framed = say(key, { ...values, [name]: SLOT });
  const at = framed.indexOf(SLOT);
  return { before: framed.slice(0, at), fact, after: framed.slice(at + SLOT.length) };
}

const whole = (parts: FactParts) => parts.before + parts.fact + parts.after;

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
 * **Race week on the featured card** (§78, moved here by §NNN): the lead event's closed window says
 * where to go instead of only "closed" — "come to the desk with the QR from your email", the one
 * thing a registered runner needs that week. `raceWeek` is true only for the featured card inside
 * the club's race week; every other card, and the page, keep the plain sentence.
 *
 * Pure, over the card's translator: `EventFacts` reads the door and hands the words to the
 * synchronous component below.
 */
export function cardRegistrationLine(
  say: Say,
  locale: string,
  event: PublicEvent,
  now: Date,
  door: RegistrationDoor,
  raceWeek = false,
): CardRegistrationLine {
  // Inside the sentence, so the weekday keeps its lower case (§349).
  const shortDate = (date: Date) => formatDay(date, { locale, timeZone: event.timezone, style: "short", withTime: true, position: "inline" });
  // Until when an open window stays open (§308) — the instant the button goes away.
  const closesAt = openRegistrationClosing(event, now);
  const closesText = closesAt ? shortDate(closesAt) : null;
  const untilParts = closesText ? factParts(say, "cta.openUntilShort", {}, "date", closesText) : null;
  const openUntil = untilParts ? whole(untilParts) : say("registrationState.OPEN");
  const quiet = { leadParts: null, detail: null, detailParts: null };

  if (door.kind === "UNKNOWN") return { ...quiet, lead: openUntil, leadParts: untilParts, bold: true, button: null };

  const { cta, fill } = door;
  const button = hasDoorButton(cta) ? { cta, label: doorButtonLabel(say, cta) } : null;
  switch (cta.kind) {
    case "OPEN": {
      const free = cta.availablePlaces;
      const detailParts =
        free !== null && fill
          ? factParts(say, "cta.freeOfCard", { places: fill.capacity }, "free", say(`cta.freeCount.${countForm(free, locale)}`, { count: free }))
          : null;
      return { lead: openUntil, leadParts: untilParts, detail: detailParts && whole(detailParts), detailParts, bold: true, button };
    }
    case "FULL":
      return { ...quiet, lead: openUntil, leadParts: untilParts, detail: say("cta.cardWaitlist"), bold: true, button };
    case "WAITLIST_FULL":
      return { ...quiet, lead: say("cta.waitlistFull"), bold: true, button: null };
    case "FULL_NO_WAITLIST":
      return { ...quiet, lead: say("cta.fullNoWaitlist"), bold: true, button: null };
    case "NOT_YET_OPEN": {
      // The opening date rather than "not yet" (§146) — or "soon" when there is none yet (§451).
      const opensText = cta.opensAt === null ? null : shortDate(cta.opensAt);
      const leadParts = opensText === null ? null : factParts(say, "cta.opensOnShort", {}, "date", opensText);
      return { ...quiet, lead: leadParts ? whole(leadParts) : say("cta.opensSoonShort"), leadParts, bold: true, button: null };
    }
    case "EXTERNAL":
      return { ...quiet, lead: say("registrationState.EXTERNAL"), bold: true, button };
    case "CLOSED":
      // Race week on the featured card: where to go, in bold — it is something to do (§78).
      if (raceWeek) return { ...quiet, lead: say("cta.closedRaceWeek"), bold: true, button: null };
      return { ...quiet, lead: say(`registrationState.${registrationState(event, now)}`), bold: false, button: null };
    default:
      // Closed, cancelled, held, or none needed: the state's own words, quiet, as before §409.
      return { ...quiet, lead: say(`registrationState.${registrationState(event, now)}`), bold: false, button: null };
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
        sx={{ display: "flex", alignItems: "flex-start", minWidth: 0 }}
      >
        <HowToRegIcon aria-hidden="true" sx={ROW_ICON_SX} />
        <Box sx={{ minWidth: 0, overflowWrap: "anywhere" }}>
          <Words text={line.lead} parts={line.leadParts} bold={line.bold} />
          {line.detail && (
            <>
              {" "}
              <Box component="span" aria-hidden="true" sx={{ color: "text.disabled", fontWeight: 400 }}>
                ·
              </Box>{" "}
              {/* The count stays whole on a phone: it wraps as one piece, never "7 locuri / libere". */}
              <Box component="span" data-testid="card-places" sx={{ whiteSpace: "nowrap" }}>
                <Words text={line.detail} parts={line.detailParts} bold={line.bold} />
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

/**
 * Only the facts in bold (§NNN, the owner 2026-09-26: "nu vreau totul să fie bold, ci doar
 * chestiile importante … adică doar data, ora și locurile libere"): "Înscrieri deschise până
 * **dum., 27 sept. 2026, la 07:00** · **8 locuri libere** din 10". A sentence with no date or count
 * (the waiting list full, race week, "soon", the organizer's site) has nothing in bold; it stays in
 * the primary ink, so the line still reads as live.
 */
function Words({ text, parts, bold }: { text: string; parts: FactParts | null; bold: boolean }) {
  if (!bold || !parts) return <>{text}</>;
  return (
    <>
      {parts.before}
      <Box component="strong" sx={{ fontWeight: 700 }}>{parts.fact}</Box>
      {parts.after}
    </>
  );
}
