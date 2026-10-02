import { countForm } from "@/i18n/count-form";
import { formatDay } from "@/i18n/dates";
import type { Deadlines } from "@/modules/deadlines/domain/deadlines";
import { hoursPhrase, minutesPhrase } from "@/modules/deadlines/domain/duration-words";
import { confirmationDueAtStart, confirmationDueWords, confirmationWindow } from "./hold-deadlines";

/**
 * «Când pierde lumea locul? Trebuie să apară asta in back-office» (§635; the owner, 2026-10-02): when
 * the people of one event lose their place, as short sentences the backoffice
 * shows under «Cine s-a înscris», in the event's «Înscrierile primite» box and beside the queue's
 * «Rezervate».
 *
 * **Display only.** Every sentence states a rule the allocator already applies, with the number the
 * setting gives (§377) — nothing here decides, moves or computes a deadline the code does not:
 * - a place given before the participation window opens is the person's until the window's deadline,
 *   or until the start when that deadline is 0 (§104, §407); inside the window, and with no window,
 *   the club's `holdMinutes`, counted from when the declaration email leaves (§513) and capped by the
 *   close and the start (`computeDeclarationHoldExpiry`);
 * - past its deadline a declaration hold is not released by the clock (§160): `expireStaleHolds`
 *   releases `waiting − free` of them, oldest deadline first, whenever an allocator path or the
 *   maintenance job runs while somebody `WAITLISTED` has no free place — in both settings of
 *   «Locurile din lista de așteptare se alocă automat». With «Da», and before the close, the place is
 *   offered to the first in line in the same transaction (`fillAvailableSpots`); with «Nu», or after
 *   the close, it stays free for «Trimite-i oferta» (before the close and after it, §642) or the desk's «Dă-i un loc».
 *   With no waiting list (a limit of 0) the one who wants it is a newcomer with no other free place
 *   (§348). An uncapped event never releases one. At the start every unsigned hold goes. Nothing is
 *   emailed when a hold is released (no message type is queued for it);
 * - the first email's link lives `confirmationHours` from when it leaves; until then the registration
 *   holds no place — a family's reservation excepted (§543) — and then it expires;
 * - a waiting-list offer lives `offerHours` from when its email leaves (§520), capped by the close
 *   and the start; unsigned, it lapses, and the place goes to the next in line with «Da» while
 *   registration is open, and stays free with «Nu».
 *
 * Pure: the event's facts, the counts and the clock in, the sentences out. The words are the
 * catalogue's (`Admin.registrations.placeDeadlines.*`), handed in as `t` — the Admin translator — so
 * the same function serves every surface and its unit test reads the real catalogues. The counts are
 * real registrations only (`readPlaceDeadlines`): a test row is in no number the club is given
 * (§12.6). A count of zero drops its sentences.
 */

/** The event's facts the sentences depend on: the window, the limits, the setting, the close. */
export type PlaceDeadlineEvent = {
  startsAt: Date;
  eventStatus: "SCHEDULED" | "CANCELLED" | "COMPLETED";
  registrationClosesAt: Date | null;
  confirmationOpensDaysBefore: number | null;
  confirmationDeadlineDaysBefore: number | null;
  /** null: no limit of places. */
  capacity: number | null;
  /** null: no limit to the line; 0: no waiting list at all. */
  waitlistCapacity: number | null;
  /** «Locurile din lista de așteptare se alocă automat» (§615). */
  waitlistAutoOffer: boolean;
};

/** Real registrations only, by the state whose deadline they wait on. */
export type PlaceDeadlineCounts = {
  /** `PENDING_DECLARATION`: a place held, the declaration unsigned. */
  held: number;
  /** Of `held`, those past their stored deadline — kept while nobody wants the place (§160). */
  heldPast: number;
  /** `PENDING_EMAIL_CONFIRMATION`: the first email's link not clicked yet. */
  awaitingEmail: number;
  /** Of `awaitingEmail`, those whose family's reservation still holds a place (§543). */
  familyReserved: number;
  /** `WAITLIST_OFFERED` still open: before its deadline, or its email still queued (§520). */
  offered: number;
};

/** Which part of the event a sentence is about: the queue panel shows only the held places'. */
export type PlaceDeadlineGroup = "held" | "email" | "offer";

export type PlaceDeadlineLine = { group: PlaceDeadlineGroup; text: string };

type Translate = (key: string, values?: Record<string, string | number>) => string;

const KEY = "registrations.placeDeadlines";

export function placeDeadlineSentences(input: {
  event: PlaceDeadlineEvent;
  counts: PlaceDeadlineCounts;
  deadlines: Pick<Deadlines, "confirmationHours" | "holdMinutes" | "offerHours">;
  now: Date;
  locale: string;
  /** The zone the dates are written in: the club's on the list, the event's beside its other times. */
  timeZone: string;
  /** The `Admin` namespace's translator. */
  t: Translate;
}): PlaceDeadlineLine[] {
  const { event, counts, deadlines, now, locale, timeZone, t } = input;
  // A cancelled event's registrations stand as they were (§331); a finished one has no place to lose.
  if (event.eventStatus !== "SCHEDULED") return [];
  const lines: PlaceDeadlineLine[] = [];
  const say = (group: PlaceDeadlineGroup, key: string, values?: Record<string, string | number>) =>
    lines.push({ group, text: t(`${KEY}.${key}`, values) });
  const counted = (count: number) => countForm(count, locale);
  const when = (at: Date) => formatDay(at, { locale, timeZone, style: "short", withTime: true, position: "inline" });
  // Before the close and the start, the instant an offer made now would already be lapsed (`capHoldExpiry`, §420).
  const closesAt = Math.min(event.registrationClosesAt?.getTime() ?? event.startsAt.getTime(), event.startsAt.getTime());
  const open = now.getTime() < closesAt;

  if (counts.held > 0) {
    const window = confirmationWindow(event);
    const dueAtStart = window !== null && confirmationDueAtStart({ at: window.deadline, startsAt: event.startsAt });
    const before = window ? confirmationDueWords(locale, event.confirmationDeadlineDaysBefore ?? 0) : "";
    const n = counts.held;
    if (window && now < window.opensAt) {
      // Every place given so far was given before the window opened: each is held to its deadline.
      say("held", `${dueAtStart ? "heldUntilStart" : "heldUntil"}.${counted(n)}`, { count: n, due: when(window.deadline), before });
    } else {
      say("held", `held.${counted(n)}`, { count: n });
      // The window is open: the places given before it keep its deadline, the later ones the club's minutes.
      if (window && now < window.deadline) {
        say("held", dueAtStart ? "windowKeptStart" : "windowKept", { opens: when(window.opensAt), due: when(window.deadline), before });
      }
      if (open) say("held", "holdNow", { hold: minutesPhrase(locale, deadlines.holdMinutes) });
    }
    if (counts.heldPast > 0) say("held", `heldPast.${counted(counts.heldPast)}`, { count: counts.heldPast });
    // What a passed deadline does (§160) — not while every deadline is the start itself.
    const someDeadlineBeforeStart = !(window && now < window.opensAt && dueAtStart) || counts.heldPast > 0;
    if (someDeadlineBeforeStart) {
      say(
        "held",
        event.capacity === null
          ? "releaseNever"
          : event.waitlistCapacity === 0
            ? "releaseNoList"
            : !open
              ? "releaseClosed"
              : event.waitlistAutoOffer
                ? "releaseAuto"
                : "releaseManual",
      );
    }
    say("held", "atStart");
  }

  if (counts.awaitingEmail > 0) {
    const n = counts.awaitingEmail;
    say("email", `${counts.familyReserved > 0 ? "emailLinkFamily" : "emailLink"}.${counted(n)}`, {
      count: n,
      hours: hoursPhrase(locale, deadlines.confirmationHours),
    });
  }

  if (counts.offered > 0) {
    const n = counts.offered;
    say("offer", `${event.waitlistAutoOffer ? "offerAuto" : "offerManual"}.${counted(n)}`, {
      count: n,
      hours: hoursPhrase(locale, deadlines.offerHours),
    });
  }

  return lines;
}
