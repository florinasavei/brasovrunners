import { countForm } from "@/i18n/count-form";
import { emailLeavesWords } from "@/modules/notifications/domain/email-wait";
import { mailSkippedCount } from "@/shared/forms/send-email";

/**
 * The toast's mail line (the design «telling the owner about every email a staff press sends», 2026-11-03, slice 2):
 * what an emailing press sent, after the act's own sentence — «Înscrierea a fost anulată. Pleacă la 10:15 (estimat):
 * „Înscriere anulată” către 1 persoană și 1 email pentru club. În plus, 1 email către altă persoană: „S-a eliberat un
 * loc”.»
 *
 * Built in the browser by `ToastProvider` from the flash's `mail…` values (`notifications/domain/press-receipt.ts`
 * writes them): **what** left, by the type's words (`Admin.emails.types`); **how many** — the people, the club's
 * mailboxes, other people, test addresses; and **when** — now, at the estimated hour (the queue's own words, «10:15»
 * today and the day with its hour otherwise, `emailLeavesWords`), after Mailgun resumes, or over the next days.
 * The road the press's dialog chose (§841) is told inside it. A press that queued nothing has no `mail` value and no
 * line: the toast says nothing about email.
 *
 * **Short enough to read** (BR-REQ-060-01's 200 characters for a toast, amended to the whole sentence): when the act
 * and its line are longer, the line drops what «Emailuri azi» lists anyway, in this order — the other people's
 * emails, the test addresses, the roles' note, the road, the club's count, Zitadel's note — and keeps what the person
 * got and when.
 *
 * Pure, so it is unit-tested in Node; the cookie is the browser's to rewrite, so every value is checked before it is
 * read, and a line that does not add up is no line.
 *
 * **What the press chose not to send** (slice 4): «Trimite emailul» unticked (`mailSkipped`, how many emails it kept
 * back) is said first — the person was sent nothing, or the people of a bulk press —, then whatever else left (the offer to the next in line); a publication's new-event alert
 * (`mailAlert`) is said last: left to the job's next pass, or not sent at all.
 */

/** A toast's longest sentence, the act and its mail line together (BR-REQ-060-01). */
export const TOAST_MAX_CHARACTERS = 200;

/** The catalogue's `Feedback` translator, as the provider hands it. */
type Words = (key: string, values?: Record<string, string>) => string;

type When = "now" | "at" | "reset" | "days";
type Audience = "people" | "test" | "others";

type MailValues = {
  when: When;
  at: Date | null;
  pressedAt: Date;
  to: Audience;
  type: string | null;
  type2: string | null;
  count: number;
  later: { count: number; at: Date | null; days: boolean } | null;
  club: number;
  test: number;
  others: { count: number; type: string | null } | null;
  road: "mailgun" | "gmail" | null;
  roles: boolean;
  zitadel: boolean;
};

const WHENS: readonly When[] = ["now", "at", "reset", "days"];
const AUDIENCES: readonly Audience[] = ["people", "test", "others"];
const TYPE = /^[A-Z][A-Z0-9_]{1,63}$/;
const COUNT = /^\d{1,9}$/;

function countOf(value: string | undefined): number | null {
  return value !== undefined && COUNT.test(value) ? Number(value) : null;
}

function instantOf(value: string | undefined): Date | null {
  if (value === undefined || value.length > 40) return null;
  const at = new Date(value);
  return Number.isNaN(at.getTime()) ? null : at;
}

function typeOf(value: string | undefined): string | null {
  return value !== undefined && TYPE.test(value) ? value : null;
}

/** The flash's `mail…` values read back, or null for anything that is not a whole line. */
function readMailValues(values: Readonly<Record<string, string>>): MailValues | null {
  const when = values.mail as When;
  if (!WHENS.includes(when)) return null;
  const to = (values.mailTo ?? "people") as Audience;
  const count = countOf(values.mailPeople);
  const pressedAt = instantOf(values.mailPressedAt);
  const at = instantOf(values.mailAt);
  if (!AUDIENCES.includes(to) || count === null || count === 0 || pressedAt === null) return null;
  if ((when === "at" || when === "reset") && at === null) return null;
  const type = typeOf(values.mailType);
  if (to === "people" && type === null) return null;
  const laterCount = countOf(values.mailLater);
  const laterAt = instantOf(values.mailLaterAt);
  const laterDays = values.mailLaterDays === "1";
  const othersCount = countOf(values.mailOthers);
  return {
    when,
    at,
    pressedAt,
    to,
    type,
    type2: to === "people" ? typeOf(values.mailType2) : null,
    count,
    later: laterCount && (laterDays || laterAt) ? { count: laterCount, at: laterAt, days: laterDays } : null,
    club: countOf(values.mailClub) ?? 0,
    test: countOf(values.mailTest) ?? 0,
    others: othersCount ? { count: othersCount, type: typeOf(values.mailOtherType) } : null,
    road: values.mailRoad === "mailgun" || values.mailRoad === "gmail" ? values.mailRoad : null,
    roles: values.mailRoles === "1",
    zitadel: values.mailZitadel === "1",
  };
}

/** What the line may leave out to stay short, in the order it gives them up. */
const DROPS = ["others", "test", "roles", "road", "club", "zitadel"] as const;
type Part = (typeof DROPS)[number];

/**
 * The mail line, or null when the press sent nothing (or the values do not add up). `typeName` gives an email type's
 * words, null for one it does not know; `room` is what the act's sentence leaves of the toast's 200 characters.
 */
export function mailLine(
  values: Readonly<Record<string, string>>,
  t: Words,
  typeName: (type: string) => string | null,
  locale: string,
  room: number = Number.POSITIVE_INFINITY,
): string | null {
  // What the press chose not to send (slice 4), around what it did send: how many emails it kept back, in the count's form.
  const kept = mailSkippedCount(values.mailSkipped) ?? 0;
  const skipped = kept > 0 ? t(`mail.skipped.${countForm(kept, locale)}`, { count: String(kept) }) : "";
  const alert = values.mailAlert === "later" ? t("mail.alertLater") : values.mailAlert === "skipped" ? t("mail.alertSkipped") : "";
  const chosen = [skipped, alert].filter(Boolean).join(" ").length;
  const sent = sentLine(values, t, typeName, locale, room - (chosen > 0 ? chosen + 1 : 0));
  const line = [skipped, sent, alert].filter(Boolean).join(" ");
  return line === "" ? null : line;
}

/** The line of what the press sent (above): null when it sent nothing, or the values do not add up. */
function sentLine(values: Readonly<Record<string, string>>, t: Words, typeName: (type: string) => string | null, locale: string, room: number): string | null {
  const mail = readMailValues(values);
  if (!mail) return null;
  const name = mail.type === null ? null : typeName(mail.type);
  if (mail.type !== null && name === null) return null;
  const name2 = mail.type2 === null ? null : typeName(mail.type2);
  const otherName = mail.others?.type ? typeName(mail.others.type) : null;

  // «10:15» today and the day with its hour otherwise, as the queue and the page after a registration say it.
  const when = (instant: Date) => {
    const words = emailLeavesWords(instant, mail.pressedAt, locale);
    return words.key === "leavesToday" ? t("mail.atToday", { at: words.at }) : words.at;
  };
  const counted = (key: string, count: number, extra: Record<string, string> = {}) =>
    t(`${key}.${countForm(count, locale)}`, { ...extra, count: String(count) });

  const compose = (kept: ReadonlySet<Part>): string => {
    const what =
      mail.to === "people"
        ? name2
          ? counted("mail.what2", mail.count, { type: name ?? "", type2: name2 })
          : counted("mail.what", mail.count, { type: name ?? "" })
        : mail.to === "test"
          ? name
            ? counted("mail.whatTest", mail.count, { type: name })
            : counted("mail.whatTestMixed", mail.count)
          : name
            ? counted("mail.whatOthers", mail.count, { type: name })
            : counted("mail.whatOthersMixed", mail.count);
    const test = kept.has("test") && mail.test > 0 ? counted("mail.test", mail.test) : "";
    const club = kept.has("club") && mail.club > 0 ? counted("mail.club", mail.club) : "";
    const later = mail.later
      ? mail.later.days || mail.later.at === null
        ? counted("mail.laterDays", mail.later.count)
        : counted("mail.later", mail.later.count, { when: when(mail.later.at) })
      : "";
    const all = `${what}${test}${club}${later}`;
    const road = kept.has("road") && mail.road ? t(`mail.road.${mail.road}`) : "";
    const sentence =
      mail.when === "now"
        ? t("mail.now", { road, what: all })
        : mail.when === "days"
          ? t("mail.days", { what: all })
          : mail.when === "reset"
            ? t("mail.reset", { when: when(mail.at as Date), what: all })
            : t("mail.at", { when: when(mail.at as Date), road, what: all });
    const others =
      kept.has("others") && mail.others
        ? otherName
          ? counted("mail.others", mail.others.count, { type: otherName })
          : counted("mail.othersMixed", mail.others.count)
        : "";
    const roles = kept.has("roles") && mail.roles ? t("mail.roles") : "";
    const zitadel = kept.has("zitadel") && mail.zitadel ? t("mail.zitadel") : "";
    return [sentence, others, roles, zitadel].filter(Boolean).join(" ");
  };

  const kept = new Set<Part>(DROPS);
  let line = compose(kept);
  for (const part of DROPS) {
    if (line.length <= room) break;
    kept.delete(part);
    line = compose(kept);
  }
  return line;
}
