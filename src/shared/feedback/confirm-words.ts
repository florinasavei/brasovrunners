import { getLocale, getTranslations } from "next-intl/server";
import type { EmailMessageType } from "@/db/schema/email-outbox";
import { type CountForm, countForm } from "@/i18n/count-form";
import { isCopiedPerMessage } from "@/modules/notifications/domain/club-notices";
import { type EmailGroup, type EmailTransport, emailGroupOf, RECOMMENDED_ROAD } from "@/modules/notifications/domain/email-transport";
import { SEND_EMAIL_FIELD } from "@/shared/forms/send-email";
import { type ClubCopies, clubCopiesForThisRequest } from "./club-copies-request";
import { emailRoadsForThisRequest } from "./email-roads-request";
import type { ConfirmAlso, ConfirmRoad, ConfirmSpec, EmailCount } from "./notice";

/**
 * Who a press's email reaches when the dialog counts them rather than naming one person: «câte unul către fiecare
 * participant», «… fiecare abonat» — `Admin.confirm.mail.audience.<name>`.
 */
export type MailAudience =
  | "participants"
  | "subscribers"
  | "invited"
  | "ticked"
  | "unsigned"
  | "present"
  | "volunteerAddresses"
  | "memberAddresses"
  | "firstWaiting"
  | "held"
  // «Trimite fiecăruia punctul lui» (§956): who has not been told the point they stand at, and — «din nou tuturor» — everybody at a point.
  | "volunteersNotTold"
  | "volunteersAtPoints";

/**
 * Whom the email goes to (`mail`): a person by name — or `{firstName} {lastName}`, which the dialog fills from the
 * form as posted (`ConfirmSpec.fillFrom`) —, a person by name and address where the page already shows the address
 * (a volunteer, a colleague), a count read on the server with the send's own query, at most one per line of a box
 * typed in the browser, or one per box ticked in the browser (`ticksOf`: the people ticked are the recipients of one
 * send; `uncounted` names the ticks that count nobody — a test registration's, §12.6).
 */
export type MailTo =
  | string
  | { name: string; address: string }
  | { count: number; audience: MailAudience }
  | { upTo: number; audience: MailAudience }
  | { upToLinesOf: string; audience: MailAudience }
  | { ticksOf: string; audience: MailAudience; uncounted?: readonly string[] };

export type MailInput = {
  to: MailTo;
  /** The email the press sends the person, by its type: named in the words of «Emailuri» (`Admin.emails.types`). */
  type: EmailMessageType;
  /**
   * The other email the same press may send instead, by its outcome — the waiting list or a free place, confirmed or
   * waiting. Both are named; a road is said only when both take the same one.
   */
  or?: EmailMessageType;
  /** A test registration's row (§30): its address reaches nobody, the club gets no copy, and the test sentence says so. */
  test?: boolean;
  /** The press confirms a registration: the declaration's archive copy and «cineva a confirmat» go to the club too (§244, §245). */
  confirms?: boolean;
  /**
   * The press may end with the person on the waiting list and nothing sent (`confirmByStaff` on a row whose address was never
   * confirmed or whose hold lapsed, the staff entry's fast track on a full race): the line says the email «or none», and the
   * club's count «cel mult». A person only.
   */
  orNothing?: boolean;
  /** What else the press sets off, said after the club's line: the next in line's offer, Zitadel's own email. */
  also?: readonly ConfirmAlso[];
  /**
   * The email as a choice made at the press (§976, amending slice 4): the question ends in «{action} și trimite emailul» and
   * «{action} fără email» — only on the presses whose service takes the option (`shared/forms/send-email.ts`). `true` for
   * the usual words and field.
   */
  optOut?: MailOptOut;
};

/**
 * The two answers' words and their field, when not the usual ones: «{action} și trimite invitația» / «{action} fără
 * invitație» on a colleague's invitation. Each a template whose `{action}` the dialog fills with the question's verb;
 * each defaults to the builder's own.
 */
export type MailOptOut = true | { sendLabel?: string; skipLabel?: string; field?: string };

/**
 * A count the browser makes at the press (`mailCount`): the ticks of the bulk cancel, each ticked value adding what
 * `counts` names for it — and `base`, who is written to whatever is ticked (a series save's own date).
 */
export type MailCountInput = {
  field: string;
  counts: Readonly<Record<string, number>>;
  base?: number;
  type: EmailMessageType;
  audience: MailAudience;
  also?: readonly ConfirmAlso[];
  /** The email's two answers for the whole batch (§976): «… și trimite emailurile» or «… fără emailuri», the same for every person ticked. */
  optOut?: MailOptOut;
};

/** What the builder hands a dialog: spread into `confirm={{ … }}` (`ActionForm`) or `mail={…}` (`ConfirmSubmitButton`). */
export type ConfirmMail = Pick<ConfirmSpec, "email" | "emailCount" | "also" | "road" | "emailOptOut">;

/** The bulk sends whose club copy is one per send, not one per email (§419, §445): the club line counts the Bcc once. */
const COPIED_ONCE_PER_SEND: ReadonlySet<EmailMessageType> = new Set<EmailMessageType>(["ORGANIZER_MESSAGE", "EVENT_UPDATE_NOTICE", "NEWSLETTER", "NEW_EVENT_ALERT"]);

/** How many club emails one email of this type queues: its per-message copies (§320). A test row's, none (§12.6). */
function copiesEach(type: EmailMessageType, copies: ClubCopies): number {
  return isCopiedPerMessage(type) ? copies.bcc : 0;
}

/**
 * The words every confirmation dialog shares, translated once on the server (§384): the cancel button, the email the
 * press sends, and the road it takes.
 *
 * **The email, before the press** (the design «telling the owner about every email a staff press sends», slice 3;
 * the owner's choice: every staff press that sends an email says so first). One builder words every dialog's email
 * line, so the dialogs cannot drift apart:
 *
 * - `mail({ to, type, … })` — «Pleacă 1 email către Ana Pop: „Înscriere anulată”.»: the person named (or the count
 *   and whom, «câte unul către fiecare participant»), the email by its name in «Emailuri», the club's mailboxes as one
 *   quiet count — «Și 2 emailuri pentru căsuțele clubului.» — counted from the club's setting exactly as the enqueue
 *   counts it (`club-copies-request.ts`), and the road the email takes (§841) derived from its type, so a line can no
 *   longer announce one email and offer the road of another. With `or`, both outcomes are named, and the road only
 *   when they share it; with `test`, the test address's sentence replaces the club's line.
 * - `mailCount({ field, counts, … })` — the same line counted in the browser from the ticks at the press.
 * - `noMail(name)` — «Nu pleacă niciun email către Ana Pop.»: a press that writes to nobody, said as plainly.
 * - `nextInLineMaybe()` — a quiet line for the freed place's offer to the first on the waiting list, as the event's
 *   setting decides.
 *
 * `queue(n)`: "Se trimit acum {n} emailuri din coadă" — for the outbox's «Trimite acum», which sends messages already
 * queued, not a press's own. `road(group)` (§841): the group's setting today, read once per request however many
 * dialogs a page words (`email-roads-request.ts`), the road the platform recommends and why, and whether the reader may
 * switch for this press (both roads configured). The dialog draws it under the email line (`ConfirmDialog`), and the
 * press carries the choice to the action (`email-road.ts`).
 */
export async function confirmWords() {
  const t = await getTranslations("Admin");
  const locale = await getLocale();
  const roads = await emailRoadsForThisRequest();
  // A courtesy line: a read that fails leaves the club's count unsaid rather than the page unrendered.
  const copies: ClubCopies = await clubCopiesForThisRequest().catch(() => ({ bcc: 0, archive: 0, notices: 0 }));
  const names: Record<EmailTransport, string> = { mailgun: t("emails.transport.options.mailgun"), gmail: t("emails.transport.options.gmail") };
  const typeName = (type: EmailMessageType) => t(`emails.types.${type}`);
  const forms = (key: string) => t.raw(key) as Record<CountForm, string>;
  const counted = (key: string, count: number) => t(`${key}.${countForm(count, locale)}`, { count });

  const road = (group: EmailGroup): ConfirmRoad => ({
    group,
    current: roads.gmail ? roads.groups[group] : "mailgun",
    recommended: RECOMMENDED_ROAD[group],
    switchable: roads.gmail,
    leaves: t.raw("confirm.road.leaves") as string,
    legend: t("confirm.road.legend"),
    recommendedMark: t("confirm.road.recommended"),
    why: t(`confirm.road.why.${group}`),
    names,
  });
  /** The road of the announced email, or none when the press may send either of two emails on two roads. */
  const roadOf = (type: EmailMessageType, or?: EmailMessageType): { road?: ConfirmRoad } => {
    const group = emailGroupOf(type, false);
    return or === undefined || emailGroupOf(or, false) === group ? { road: road(group) } : {};
  };
  /** The club's quiet line: how many emails, never which mailboxes; «cel mult» when the outcome decides. */
  const clubLine = (count: number, upTo: boolean): ConfirmAlso[] =>
    count > 0 ? [{ text: counted(upTo ? "confirm.mail.clubUpTo" : "confirm.mail.club", count) }] : [];
  const testLine: ConfirmAlso = { text: t("confirm.mail.test") };
  /**
   * The email's two answers (§976): their field and their words, templates the dialog fills with the question's verb —
   * «{action} și trimite emailul» / «{action} fără email» for a person, «… emailurile» / «… fără emailuri» for a count
   * (`many`). Raw: `{action}` is the dialog's to fill.
   */
  const optOutOf = (optOut: MailOptOut | undefined, many: boolean): Pick<ConfirmSpec, "emailOptOut"> => {
    if (!optOut) return {};
    const given = optOut === true ? {} : optOut;
    return {
      emailOptOut: {
        field: given.field ?? SEND_EMAIL_FIELD,
        sendLabel: given.sendLabel ?? (t.raw(many ? "confirm.mail.sendButtonMany" : "confirm.mail.sendButton") as string),
        skipLabel: given.skipLabel ?? (t.raw(many ? "confirm.mail.skipButtonMany" : "confirm.mail.skipButton") as string),
      },
    };
  };

  const mail = ({ to, type, or, test, confirms, orNothing, also, optOut }: MailInput): ConfirmMail => {
    const what = typeName(type);
    const extra = also ?? [];
    if (typeof to === "string" || "name" in to) {
      const values: Record<string, string> = typeof to === "string" ? { name: to, type: what } : { name: to.name, address: to.address, type: what };
      if (or !== undefined) values.alt = typeName(or);
      const email = t(`confirm.mail.${typeof to === "string" ? "to" : "toAddress"}${or !== undefined ? "Either" : orNothing ? "OrNothing" : ""}`, values);
      // One email: its own copies and, on a confirmation, the archive and «cineva a confirmat»; with two possible outcomes
      // (`or` — the second never a confirmation), the larger count, said «cel mult» when the two differ.
      const first = copiesEach(type, copies) + (confirms ? copies.archive + copies.notices : 0);
      const second = or !== undefined ? copiesEach(or, copies) : first;
      return {
        email,
        ...roadOf(type, or),
        also: [...(test ? [testLine] : clubLine(Math.max(first, second), first !== second || orNothing === true)), ...extra],
        ...optOutOf(optOut, false),
      };
    }
    if ("upToLinesOf" in to) {
      const emailCount: EmailCount = {
        field: to.upToLinesOf,
        base: 0,
        counts: {},
        lines: true,
        forms: Object.fromEntries(
          (["one", "few", "other"] as const).map((form) => [form, t(`confirm.mail.upTo.${form}`, { count: "{count}", type: what, audience: t(`confirm.mail.audience.${to.audience}`) })]),
        ) as Record<CountForm, string>,
        club: { each: copiesEach(type, copies), once: COPIED_ONCE_PER_SEND.has(type) ? copies.bcc : 0, forms: forms("confirm.mail.club") },
        locale,
      };
      return { emailCount, ...roadOf(type), ...(extra.length > 0 ? { also: extra } : {}), ...optOutOf(optOut, true) };
    }
    if ("ticksOf" in to) {
      // One per tick, counted at the press (§945): exactly that many, and the club's copy of the one send they make.
      const emailCount: EmailCount = {
        field: to.ticksOf,
        base: 0,
        counts: Object.fromEntries((to.uncounted ?? []).map((value) => [value, 0])),
        ticks: true,
        forms: Object.fromEntries(
          (["one", "few", "other"] as const).map((form) => [form, t(`confirm.mail.toMany.${form}`, { count: "{count}", type: what, audience: t(`confirm.mail.audience.${to.audience}`) })]),
        ) as Record<CountForm, string>,
        club: { each: copiesEach(type, copies), once: COPIED_ONCE_PER_SEND.has(type) ? copies.bcc : 0, forms: forms("confirm.mail.club") },
        locale,
      };
      return { emailCount, ...roadOf(type), ...(extra.length > 0 ? { also: extra } : {}), ...optOutOf(optOut, true) };
    }
    // A count read on the server: exactly that many, or — `upTo` — at most that many, as the press's outcome decides.
    const upTo = "upTo" in to;
    const count = upTo ? to.upTo : to.count;
    if (count <= 0) return extra.length > 0 ? { also: extra } : {};
    const email = t(`confirm.mail.${upTo ? "upTo" : "toMany"}.${countForm(count, locale)}`, { count, type: what, audience: t(`confirm.mail.audience.${to.audience}`) });
    const club = COPIED_ONCE_PER_SEND.has(type) ? copies.bcc : count * copiesEach(type, copies);
    return { email, ...roadOf(type), also: [...(test ? [testLine] : clubLine(club, upTo)), ...extra], ...optOutOf(optOut, true) };
  };

  const mailCount = ({ field, counts, base, type, audience, also, optOut }: MailCountInput): ConfirmMail & { emailCount: EmailCount } => ({
    emailCount: {
      field,
      base: base ?? 0,
      counts,
      forms: Object.fromEntries(
        (["one", "few", "other"] as const).map((form) => [form, t(`confirm.mail.toMany.${form}`, { count: "{count}", type: typeName(type), audience: t(`confirm.mail.audience.${audience}`) })]),
      ) as Record<CountForm, string>,
      club: { each: copiesEach(type, copies), once: COPIED_ONCE_PER_SEND.has(type) ? copies.bcc : 0, forms: forms("confirm.mail.club") },
      locale,
    },
    ...roadOf(type),
    ...(also && also.length > 0 ? { also } : {}),
    ...optOutOf(optOut, true),
  });

  const noMail = (name: string, also?: readonly ConfirmAlso[]): ConfirmMail => ({ email: t("confirm.mail.none", { name }), ...(also && also.length > 0 ? { also } : {}) });

  return {
    cancel: t("confirm.cancel"),
    /** «Trimite emailul»: the box's words, for a `MailLine` beside a button (slice 4) — a question offers two answers instead (§976). */
    optOutLabel: t("confirm.mail.optOut"),
    queue: (count: number) => t(`confirm.emailMessages.${countForm(count, locale)}`, { count }),
    road,
    mail,
    mailCount,
    noMail,
    /** «Persoanele șterse nu primesc niciun email.» — a bulk press that writes to none of the people it acts on. */
    noMailMany: (also?: readonly ConfirmAlso[]): ConfirmMail => ({ email: t("confirm.mail.noneMany"), ...(also && also.length > 0 ? { also } : {}) }),
    /**
     * The freed place's offer to the first on the waiting list, as the event's setting decides — offered with its email, or
     * kept free (BR-REQ-037-03 criterion 10): no page knows at the press whether somebody waits for a place given
     * automatically, so the line says what the setting does. `many`: each place a bulk press frees.
     */
    nextInLineMaybe: (many = false): ConfirmAlso => ({ text: t(many ? "confirm.mail.nextInLineMaybeMany" : "confirm.mail.nextInLineMaybe") }),
    /** A quiet line in the builder's voice, for what a press sends besides its email: Zitadel's own, the job's later. */
    line: (key: MailLineKey, values?: Record<string, string | number>): ConfirmAlso => ({ text: t(`confirm.mail.${key}`, values) }),
    /**
     * The publication's two answers (slice 4, §976): its email is a quieter line — the new-event alert the job sends later
     * (`alertLater`, `alertMaybe`) — so the answers name it: «{action} și anunță abonații» / «{action} fără anunț», the
     * second for good: the subscribers are never told of this event. `labels`: a verb that reads badly in the template —
     * «Creează și publică» — gives its two answers whole.
     */
    alertOptOut: (labels?: { sendLabel: string; skipLabel: string }): Pick<ConfirmSpec, "emailOptOut"> =>
      optOutOf(labels ?? { sendLabel: t.raw("confirm.mail.alertSendButton") as string, skipLabel: t.raw("confirm.mail.alertSkipButton") as string }, false),
  };
}

/** The quiet lines a dialog may add by name (`line`): each a sentence of `Admin.confirm.mail`. */
export const MAIL_LINE_KEYS = [
  "zitadel",
  "zitadelEach",
  "zitadelAgain",
  "linkReplaced",
  "agreementCopy",
  "guardianCopy",
  "guardianNone",
  "rolesHeld",
  "invitesServeLine",
  "alertLater",
  "alertMaybe",
  "laterDays",
  "windowResend",
  "jobPass",
  "andType",
  // Slice 4: why a refusal offers no choice of the email, and the window's resend left unsent.
  "refusalTells",
  "windowSkipped",
] as const;
export type MailLineKey = (typeof MAIL_LINE_KEYS)[number];

export type ConfirmWords = Awaited<ReturnType<typeof confirmWords>>;
