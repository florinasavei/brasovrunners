import { createTranslator } from "next-intl";
import en from "../../../../messages/en.json";
import ro from "../../../../messages/ro.json";
import type { RegistrationStatus } from "@/db/schema/registrations";
import { formatDay } from "@/i18n/dates";
import { confirmationDueMoment } from "../domain/hold-deadlines";
import { rowDeadlineOf } from "../domain/row-deadline";
import { waitlistStandingPhrase } from "./waitlist-position-words";

type Say = (key: string, values?: Record<string, string | number>) => string;

/** What the block reads off the registration's page query (`findRegistrationDetailForAdmin`), nothing more. */
export type TellFacts = {
  status: RegistrationStatus;
  holdExpiresAt: Date | null;
  emailLinkExpiresAt: Date | null;
  offerEmailQueued?: boolean | null;
  eventStartsAt: Date;
  eventTimezone: string;
  eventCancelled: boolean;
  waitlistAutoOffer: boolean;
  waitlistCountPublic: boolean;
  waitlistPosition: number | null;
  waitlistLength: number | null;
  liveLinkExpiresAt: Date | null;
  /** The row's race number: said only on a confirmed row. */
  bibNumber: number | null;
  checkedInAt: Date | null;
};

/** The states whose next step is a link in an email: the ones a lost or spam-filed email stops. */
const WAITS_ON_AN_EMAIL: ReadonlySet<RegistrationStatus> = new Set(["PENDING_EMAIL_CONFIRMATION", "PENDING_DECLARATION", "WAITLIST_OFFERED"]);

const ENDED: ReadonlySet<RegistrationStatus> = new Set(["CANCELLED", "EXPIRED"]);

/**
 * «Ce îi spui» (§NNN; the owner: «oamenii mai pierd mailuri, le mai intră în SPAM»): the sentences a
 * staff member tells somebody who asks where their registration stands, in the registration's own
 * language, so the club tells one story. Each line is the participant's own words wherever the public
 * pages already have them — read here from the same keys, never a copy:
 *
 * - the state, as «Toate înscrierile mele» names it (`Registrations.mine.status.*`), in one framing line;
 * - a family's reservation (`mine.reservedUntil`) and a held place's deadline (`mine.confirmBy`, with
 *   `confirmationDueMoment`'s «la start»), as the participant's page says them;
 * - the waiting line (`waitlistStandingPhrase`, §629, §634): a position only with automatic offers and
 *   the count public — the same function the participant's page and «Toate înscrierile mele» call;
 * - a cancelled event (`manage.eventCancelled`) instead of any deadline, which the cancellation voids;
 * - the spam hint (`spamHint.body`) on a state whose next step is a link in an email.
 *
 * The rest — a past deadline, an offer, a confirmed or ended row, the live link's expiry — are the
 * backoffice's own lines (`Admin.registrations.tell.*`), worded to the person in the same register.
 * `say` is `Registrations` and `ours` is `Admin.registrations.tell`, both in the registration's
 * language. Never an address, nobody else's data: the line's numbers only, as the person reads them.
 */
export function tellLines(say: Say, ours: Say, locale: string, facts: TellFacts, now: Date): string[] {
  const at = (instant: Date) => formatDay(instant, { locale, timeZone: facts.eventTimezone, style: "long", withTime: true, position: "inline" });
  const lines = [ours("state", { state: say(`mine.status.${facts.status}`) })];
  const active = !ENDED.has(facts.status);

  // A cancelled event voids every deadline and every next step: the participant's page says only that (§331).
  if (facts.eventCancelled && active) {
    lines.push(say("manage.eventCancelled"));
    return lines;
  }

  const deadline = rowDeadlineOf(facts, now);
  switch (facts.status) {
    case "PENDING_EMAIL_CONFIRMATION":
      if (deadline?.kind === "reserved") lines.push(say("mine.reservedUntil", { until: at(deadline.at) }));
      else lines.push(ours(deadline?.kind === "linkLapsed" ? "linkLapsed" : "PENDING_EMAIL_CONFIRMATION"));
      break;
    case "PENDING_DECLARATION":
      if (deadline?.kind === "hold") {
        lines.push(say("mine.confirmBy", { due: confirmationDueMoment(locale, { at: deadline.at, startsAt: facts.eventStartsAt }, at(deadline.at)) }));
      } else lines.push(ours("kept"));
      break;
    case "WAITLISTED":
      if (facts.waitlistPosition !== null && facts.waitlistLength !== null) {
        lines.push(
          waitlistStandingPhrase(say, locale, {
            position: facts.waitlistPosition,
            length: facts.waitlistLength,
            autoOffer: facts.waitlistAutoOffer,
            countPublic: facts.waitlistCountPublic,
          }),
        );
      }
      lines.push(ours("WAITLISTED"));
      break;
    case "WAITLIST_OFFERED":
      if (deadline?.kind === "offer") lines.push(ours("offer", { due: at(deadline.at) }));
      else lines.push(ours("offerLapsed"));
      break;
    case "CONFIRMED":
      lines.push(ours("CONFIRMED"));
      if (facts.bibNumber !== null) lines.push(ours("bib", { number: facts.bibNumber }));
      // Checked in at the desk or by the person (BR-REQ-037-08): a confirmed row with its moment.
      if (facts.checkedInAt) lines.push(ours("checkedIn"));
      break;
    default:
      lines.push(ours(facts.status));
  }

  if (active && facts.liveLinkExpiresAt) lines.push(ours("linkUntil", { instant: at(facts.liveLinkExpiresAt) }));
  // Not once the link or the offer has lapsed: there is no email left to look for.
  if (WAITS_ON_AN_EMAIL.has(facts.status) && deadline?.kind !== "linkLapsed" && deadline?.kind !== "offerLapsed") lines.push(say("spamHint.body"));
  return lines;
}

/**
 * The lines in the registration's own language (§NNN), whatever the staff member reads the page in:
 * the two catalogues' words resolved outside the request's locale, as `promo-consent-words.ts` does,
 * through the same `tellLines`.
 */
export function whatToTell(locale: string, facts: TellFacts, now: Date): string[] {
  const lang = locale === "en" ? "en" : "ro";
  const messages = lang === "en" ? en : ro;
  const say = createTranslator({ locale: lang, messages, namespace: "Registrations" }) as unknown as Say;
  const admin = createTranslator({ locale: lang, messages, namespace: "Admin" }) as unknown as Say;
  return tellLines(say, (key, values) => admin(`registrations.tell.${key}`, values), lang, facts, now);
}
