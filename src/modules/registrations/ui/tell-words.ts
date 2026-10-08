import { createTranslator } from "next-intl";
import en from "../../../../messages/en.json";
import ro from "../../../../messages/ro.json";
import type { RegistrationStatus } from "@/db/schema/registrations";
import { formatDay } from "@/i18n/dates";
import { waitlistCountShown } from "@/modules/events/domain/registration-cta";
import { formatDeadlineInSentence } from "@/modules/notifications/domain/deadline-in-sentence";
import { confirmationDueMoment } from "../domain/hold-deadlines";
import type { RegistrationEmailState } from "../domain/email-state";
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
  /** «Arată public numărătoarea» (§668), the parent of the switch above (§669): required, so no caller can leave the line's length said by forgetting it. */
  participantCountPublic: boolean;
  waitlistPosition: number | null;
  waitlistLength: number | null;
  liveLinkExpiresAt: Date | null;
  /** The row's race number: said only on a confirmed row. */
  bibNumber: number | null;
  checkedInAt: Date | null;
  /** Why an expired row expired: a lapsed declaration hold says what its email said (§638). */
  expiryReason?: string | null;
  /**
   * The registration's email state (§663, §NNN): one more sentence when the address refuses the club's mail
   * (`unreachable`), so the person knows our mail does not reach them. A message the club's account could not
   * send, or one owed again to an address that works, is not the person's to hear about as a refusal.
   */
  emailState?: Pick<RegistrationEmailState, "kind" | "status"> | null;
};

/** The states whose next step is a link in an email: the ones a lost or spam-filed email stops. */
const WAITS_ON_AN_EMAIL: ReadonlySet<RegistrationStatus> = new Set(["PENDING_EMAIL_CONFIRMATION", "PENDING_DECLARATION", "WAITLIST_OFFERED"]);

const ENDED: ReadonlySet<RegistrationStatus> = new Set(["CANCELLED", "EXPIRED"]);

/**
 * «Ce îi spui» (§654; the owner: «oamenii mai pierd mailuri, le mai intră în SPAM»): the sentences a
 * staff member tells somebody who asks where their registration stands, in the registration's own
 * language, so the club tells one story. Each line is the participant's own words wherever the public
 * pages already have them — read here from the same keys, never a copy:
 *
 * - the state, as «Toate înscrierile mele» names it (`Registrations.mine.status.*`), in one framing line —
 *   on a confirmed row the confirmation page's own sentence instead (`spent.CONFIRMED.title`), said once;
 *   on a cancelled or expired row no frame at all, since the state's own sentence opens by naming it
 *   («Înscrierea a fost anulată.», «Înscrierea a expirat, …», «Locul tău a expirat: …»);
 * - a family's reservation (`mine.reservedUntil`) and a held place's deadline (`mine.confirmBy`, with
 *   `confirmationDueMoment`'s «la start»), as the participant's page says them;
 * - the waiting line (`waitlistStandingPhrase`, §629, §634): a position only with automatic offers and
 *   the count public — the same function the participant's page and «Toate înscrierile mele» call;
 * - a cancelled event (`manage.eventCancelled`) instead of any deadline, which the cancellation voids;
 * - the spam hint (`spamHint.body`) on a state whose next step is a link in an email.
 *
 * - a check-in as the participant's page says it (`manage.selfCheckInDone`).
 *
 * The rest are the backoffice's own lines (`Admin.registrations.tell.*`). Where an email or a public page
 * already words the thing, the key is that text word for word and a unit test keeps each pair equal:
 * `PENDING_EMAIL_CONFIRMATION` is the address email's first line; `WAITLISTED` the waiting-list email's
 * last sentence; `offer` the offer email's subject and its sentence up to the deadline, its `{due}` written as that
 * email writes `holdExpiresAtFormatted` (`formatDeadlineInSentence` inside `confirmationDueMoment`); `bib` the
 * confirmation email's number sentence; `CANCELLED` is `mine.cancelledTitle` and the first sentence of
 * `mine.cancelled`; `holdLapsed` the `DECLARATION_HOLD_EXPIRED` email's sentence without the event's name.
 * Nothing public words a past deadline kept (`kept`), a lapsed link or offer, a queued offer, where the
 * QR code is (`CONFIRMED`), a plain expiry or the link's expiry (`linkUntil`): those are the backoffice's.
 *
 * The live link (`admin-repository.ts#liveLinkExpiresAtFor`) is said only when it adds something true:
 * never on a held place (`hold` / `kept`), whose declaration link lives until the start (`render.ts`)
 * while the hold's deadline is the one to tell; and never when its instant is the one the block already
 * gave (an open offer's link lapses with the offer); nor once the deadline has lapsed (`linkLapsed`,
 * `offerLapsed`): a resend after the offer's deadline mints a link for the default lifetime, and «the
 * place is no longer held» followed by «the link is valid until …» would contradict itself.
 * `say` is `Registrations` and `ours` is `Admin.registrations.tell`, both in the registration's
 * language. Never an address, nobody else's data: the line's numbers only, as the person reads them.
 */
export function tellLines(say: Say, ours: Say, locale: string, facts: TellFacts, now: Date): string[] {
  const at = (instant: Date) => formatDay(instant, { locale, timeZone: facts.eventTimezone, style: "long", withTime: true, position: "inline" });
  const active = !ENDED.has(facts.status);
  // Each state said once: a confirmed row opens with the confirmation's own sentence, an ended row with
  // its own sentence below, which already names the state; every other row with the framed state words.
  const lines: string[] = [];
  if (facts.status === "CONFIRMED") lines.push(`${say("spent.CONFIRMED.title")}.`);
  else if (active) lines.push(ours("state", { state: say(`mine.status.${facts.status}`) }));

  // A cancelled event voids every deadline and every next step: the participant's page says only that (§331).
  if (facts.eventCancelled && active) {
    lines.push(say("manage.eventCancelled"));
    return lines;
  }

  const deadline = rowDeadlineOf(facts, now);
  // The instant the block already gave the person, so the link's expiry is not said twice.
  let stated: Date | null = null;
  switch (facts.status) {
    case "PENDING_EMAIL_CONFIRMATION":
      if (deadline?.kind === "reserved") {
        lines.push(say("mine.reservedUntil", { until: at(deadline.at) }));
        stated = deadline.at;
      } else lines.push(ours(deadline?.kind === "linkLapsed" ? "linkLapsed" : "PENDING_EMAIL_CONFIRMATION"));
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
            // What the person's own page says (§669): the parent unticked keeps the length private too.
            countPublic: waitlistCountShown(facts),
          }),
        );
      }
      lines.push(ours("WAITLISTED"));
      break;
    case "WAITLIST_OFFERED":
      // The first email still queued (§520): its send re-bases the deadline, so the stored one is not the
      // person's yet, and there is no email to look for in the spam folder.
      if (facts.offerEmailQueued) {
        lines.push(ours("offerQueued"));
        return lines;
      }
      if (deadline?.kind === "offer") {
        // The offer email's own words for its deadline (`render.ts`, `holdExpiresAtFormatted`).
        const due = confirmationDueMoment(locale, { at: deadline.at, startsAt: facts.eventStartsAt }, formatDeadlineInSentence(deadline.at, facts.eventTimezone, locale));
        lines.push(ours("offer", { due }));
        stated = deadline.at;
      } else lines.push(ours("offerLapsed"));
      break;
    case "CONFIRMED":
      lines.push(ours("CONFIRMED"));
      if (facts.bibNumber !== null) lines.push(ours("bib", { number: facts.bibNumber }));
      // Checked in at the desk or by the person (BR-REQ-037-08): the participant page's own words.
      if (facts.checkedInAt) lines.push(say("manage.selfCheckInDone"));
      break;
    case "EXPIRED":
      // A lapsed declaration hold was told so by email (§638): the same words, without the event's name.
      lines.push(ours(facts.expiryReason === "DECLARATION_HOLD_LAPSED" ? "holdLapsed" : "EXPIRED"));
      break;
    default:
      lines.push(ours(facts.status));
  }

  const link = facts.liveLinkExpiresAt;
  const held = deadline?.kind === "hold" || deadline?.kind === "kept";
  const lapsed = deadline?.kind === "linkLapsed" || deadline?.kind === "offerLapsed";
  if (active && link && !held && !lapsed && link.getTime() !== stated?.getTime()) lines.push(ours("linkUntil", { instant: at(link) }));
  // Not once the link or the offer has lapsed: there is no email left to look for. Nor while an email the
  // person waits on was refused and not sent again (§NNN): the address refused it, the club's account was
  // refused so it never left, or it is owed to an address that works again — none of them is in spam. A
  // message sent again may be; a complaint is the person's own, and their mail still arrives.
  const state = facts.emailState ?? null;
  const refusedNotResent = state !== null && state.status === "BOUNCED" && state.kind !== "retried";
  if (WAITS_ON_AN_EMAIL.has(facts.status) && !lapsed && !refusedNotResent) lines.push(say("spamHint.body"));
  // The address refuses the club's mail (§663, §NNN): on any state, confirmed included — said to the person
  // without the address, which stays theirs to change (§645). An email the club's account could not send,
  // or one owed to an address that works again, is said as owed — never as the address's refusal.
  if (state?.kind === "unreachable") lines.push(ours(`rejected.${state.status}`));
  else if (state?.kind === "not-sent" || state?.kind === "missing") lines.push(ours("rejected.owed"));
  return lines;
}

/**
 * The lines in the registration's own language (§654), whatever the staff member reads the page in:
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
