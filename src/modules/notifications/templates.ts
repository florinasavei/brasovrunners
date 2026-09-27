import type { EmailLocale, OutgoingEmail } from "@/infrastructure/email/adapter";
import type { EmailMessageType } from "@/db/schema/email-outbox";
import { emailBodyParts, readEmailBody, type EmailBodyPart } from "./domain/email-rich-text";
import { copyFor, onlyMissingFacts, type EmailCopy, fillPlaceholders } from "./domain/email-copy";
import { organizerParagraphs } from "./domain/organizer-message";
import { type EmailEventFacts, type EventFactsBlock, eventFactsBlock } from "./domain/event-facts";
import { DEFAULT_TOKEN_HOURS } from "./domain/token-lifetime";
import type { EventChangeKind } from "@/modules/events/domain/event-changes";
import { CLUB_NAME, COLOR } from "@/theme/brand";
import { capitalizeFirst, formatBirthDate } from "@/i18n/dates";
import { DEFAULT_DEADLINES } from "@/modules/deadlines/domain/deadlines";
import { daysPhrase, durationPhrase, hoursPhrase, leadPhrase, minutesPhrase } from "@/modules/deadlines/domain/duration-words";
import { RETENTION_PERIODS } from "@/modules/jobs/domain/retention-periods";
import { getPathname } from "@/i18n/navigation";
import { countForm } from "@/i18n/count-form";
import { ADDRESS_CAP_RULE } from "@/modules/registrations/domain/address-cap";
import { env } from "@/shared/config/env";
import { CLUB_LOCALITY } from "@/modules/events/domain/place";
import { type EventForecast, forecastPlaceName } from "@/modules/weather/domain/forecast";
import { weatherSpanWords } from "@/modules/weather/words";

/**
 * The twelve message types of AGENTS.md §16.3 (BR-REQ-080-01), in Romanian and English.
 *
 * Ordinary transactional copy, not legal text — the restraint AGENTS.md §1.2 and
 * DECISIONS.md §27 apply to the privacy notice, terms and declaration does not extend to "your
 * registration is confirmed", which every application sends and which the club has not asked
 * to review line by line. Kept short and factual regardless: a club running local races is not
 * the voice for marketing copy.
 *
 * One shared layout (`renderContent`) produces the HTML and the plain-text body from the same
 * content, so the two can never drift into saying different things.
 */

export type TemplateContent = {
  subject: string;
  greeting: string;
  /**
   * The body, in order. A plain string is the platform's own sentence, escaped and rendered
   * here; an `EmailBodyPart` is a block the club wrote in the editor (§270), already rendered
   * into email-safe HTML and its own plain-text lines. The two mix, because the platform adds
   * sentences around the club's words.
   */
  paragraphs: (string | EmailBodyPart)[];
  /**
   * The facts a participant keeps (`DECISIONS.md` §81): one bold line — date, time, meeting
   * point — and the links that go with it (the map, the Strava event). On the confirmation
   * and the reminder; text-first, so the plain-text body reads the same.
   */
  facts?: { line: string; links: { label: string; url: string }[] };
  /** Present only when the message carries an action link. */
  action?: { label: string; url: string };
  /**
   * A second, quieter button under the action (§468): an outlined one in the club's blue, for the
   * choice that is not the message's point — «Nu înscriu această persoană» under the family link's
   * «Confirm că înscriu altă persoană». Only beside an action, never on its own.
   */
  secondaryAction?: { label: string; url: string };
  /** Further links after the action — the signed declaration as a PDF (§95). */
  links?: { label: string; url: string }[];
  /** Present on the confirmation: the QR the participant shows to pick up their number. */
  image?: { url: string; alt: string; caption: string };
  /**
   * The event's facts as one block (§392, `domain/event-facts.ts`): when, where, the programme, the
   * route, the cost and the page's sections — under the words and the QR, above the button. On the
   * confirmation, the reminder and the declaration request; the platform's, like the QR, so the
   * club's words never carry it.
   */
  eventFacts?: EventFactsBlock;
  closing: string;
  /** "Reply to this email with questions" — on every message when the club has a reply address. */
  footer?: string;
  /**
   * Who sends this and where the privacy notice is (§323) — the last line of every participant
   * message: the sentence, then the notice's address in the message's language as a link.
   */
  privacy?: { text: string; url: string };
};

/*
  The club's everyday name is the platform's one constant (`CLUB_NAME`, §215), never a literal
  in a message (§357; the owner: "I do not [want] hardcoded stuff in the document and emails
  anymore!"): the sign-off, the banner's words, the invitation and the "my registrations" subject
  all read it, so the name is written once, and a message says nothing a constant could not.
*/
const SIGN_OFF: Record<EmailLocale, string> = {
  ro: `Echipa ${CLUB_NAME}`,
  en: `The ${CLUB_NAME} team`,
};

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/**
 * What the family link's facts box states (§446, §468): the event, who the address holds, the person
 * the form named, what the button does, how long the link lives and the club's limit per address.
 */
type FamilyFactsInput = {
  event?: string;
  when?: string;
  registered: readonly string[];
  name: string;
  /** `YYYY-MM-DD`, written in words per language. */
  birthDate: string;
  /** The link's life in words ("48 de ore"), from «Termene». */
  hours: string;
  /** The club's limit of registrations per address, from «Termene»; absent, no line. */
  cap?: number;
};
/** A family sitting's facts (§519): the event, everybody joining now, who the address held before, the link's life, the limit. */
type FamilySittingFactsInput = {
  event?: string;
  when?: string;
  people: ReadonlyArray<{ name: string; birthDate: string }>;
  registered: readonly string[];
  hours: string;
  cap?: number;
};
/** A fact's value as parts, the important ones bold — each on its own, never the joining words. */
type FamilyFact = { label: string; value: ReadonlyArray<{ text: string; bold?: boolean }> };

/**
 * The family link's facts as one outlined box (§468, the §392 box's look): each label on its own
 * line, its value under it in bold — the event, who the address holds, the person the button is
 * for. The plain-text half reads "Label: value", one fact per line.
 */
function familyFactsPart(facts: readonly FamilyFact[]): EmailBodyPart {
  const body = facts
    .map((fact, index) => {
      const margin = index === facts.length - 1 ? "0" : "0 0 10px";
      const value = fact.value
        .map((part) => (part.bold ? `<strong style="font-size:16px">${escapeHtml(part.text)}</strong>` : escapeHtml(part.text)))
        .join("");
      return `<p style="margin:${margin};font-size:15px;line-height:1.5">${escapeHtml(fact.label)}<br>${value}</p>`;
    })
    .join("");
  return {
    html: `<div data-email-part="family-facts" style="margin:0 0 18px;padding:14px 16px;border:1px solid ${COLOR.line};border-radius:10px">${body}</div>`,
    text: [...facts.map((fact) => `${fact.label}: ${fact.value.map((part) => part.text).join("")}`), ""],
  };
}

/** A family confirmation's words for its blocks (§519), one language's. */
type FamilyConfirmedWords = { number: string; provisional: string; noNumber: string; code: string; qr: string };

/**
 * Names as one phrase in the email's language (§519, the owner's answer of 2026-09-27): commas, and
 * «și» / "and" before the last — «Ana, Ion și Maria», "Ana, Ion and Maria" (no serial comma, as in
 * Romanian; written out rather than `Intl.ListFormat`, whose English adds one). One name is itself.
 */
export function joinNames(locale: EmailLocale, names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} ${locale === "ro" ? "și" : "and"} ${names.at(-1)}`;
}

/** The family's greeting (§519): every confirmed person's first name, in the order the forms were sent. */
function familyFirstNames(people: NonNullable<TemplateData["familyConfirmed"]>): string[] {
  return people.map((person) => person.firstName?.trim() || person.name.trim().split(/\s+/)[0] || person.name);
}

/**
 * A family's one confirmation (§519): one outlined block per person, headed by the name in bold —
 * the race number, bold (§189: the number is what a runner reads at the desk), the desk code, and
 * the QR the desk scans. The second half of the bilingual message repeats the words, not the pictures
 * (`renderBilingual`), as for one person's QR. The plain-text half reads one line per fact.
 */
function familyConfirmedPart(people: NonNullable<TemplateData["familyConfirmed"]>, words: FamilyConfirmedWords): EmailBodyPart {
  const numberText = (person: (typeof people)[number]) =>
    person.raceNumber === null ? words.noNumber : person.provisional ? `${person.raceNumber} ${words.provisional}` : String(person.raceNumber);
  const blocks = people.map((person) => {
    const number =
      person.raceNumber === null
        ? escapeHtml(words.noNumber)
        : `<strong style="font-size:20px">${person.raceNumber}</strong>${person.provisional ? ` ${escapeHtml(words.provisional)}` : ""}`;
    return [
      `<div data-email-part="family-person" style="margin:0 0 14px;padding:14px 16px;border:1px solid ${COLOR.line};border-radius:10px">`,
      `<p style="margin:0 0 8px;font-size:17px;line-height:1.4"><strong>${escapeHtml(person.name)}</strong></p>`,
      `<p style="margin:0 0 6px;font-size:15px;line-height:1.5">${escapeHtml(words.number)}: ${number}</p>`,
      ...(person.checkinCode
        ? [`<p style="margin:0 0 8px;font-size:15px;line-height:1.5">${escapeHtml(words.code)}: <strong>${escapeHtml(person.checkinCode)}</strong></p>`]
        : []),
      ...(person.qrUrl
        ? [
            `<p style="margin:0"><img src="${person.qrUrl}" alt="${escapeHtml(`${words.qr} ${person.checkinCode ?? ""}`)}" width="160" height="160" style="display:block;width:160px;height:160px"></p>`,
          ]
        : []),
      "</div>",
    ].join("");
  });
  return {
    html: `<div data-email-part="family-confirmed">${blocks.join("")}</div>`,
    text: people.flatMap((person) => [
      person.name,
      `${words.number}: ${numberText(person)}`,
      ...(person.checkinCode ? [`${words.code}: ${person.checkinCode}`] : []),
      ...(person.qrUrl ? [`${words.qr}: ${person.qrUrl}`] : []),
      "",
    ]),
  };
}

export function renderContent(
  content: TemplateContent,
  locale: EmailLocale,
): { html: string; text: string; htmlParts: string[]; textLines: string[] } {
  const textLines = [
    content.greeting,
    "",
    ...(content.facts
      ? [content.facts.line, ...content.facts.links.map((link) => `${link.label}: ${link.url}`), ""]
      : []),
    // The plain-text half drops the bold and underline markers rather than printing them (§189,
    // §309); a block the club wrote carries its own lines, already stripped of formatting.
    ...content.paragraphs.flatMap((part) =>
      typeof part === "string" ? [part.replace(/\*\*([^*]+)\*\*/g, "$1").replace(/__([^_]+)__/g, "$1")] : part.text,
    ),
    ...(content.eventFacts ? ["", ...content.eventFacts.text.split("\n")] : []),
    ...(content.image ? ["", `${content.image.caption}: ${content.image.url}`] : []),
    ...(content.action ? ["", `${content.action.label}: ${content.action.url}`] : []),
    ...(content.action && content.secondaryAction ? [`${content.secondaryAction.label}: ${content.secondaryAction.url}`] : []),
    ...(content.links ?? []).map((link) => `${link.label}: ${link.url}`),
    "",
    content.closing,
    SIGN_OFF[locale],
    ...(content.footer ? ["", content.footer] : []),
    // The address last, with nothing after it: a text client that links it could take a
    // trailing full stop into the link (review nit). The HTML part keeps the sentence's stop.
    ...(content.privacy ? ["", `${content.privacy.text} ${content.privacy.url}`] : []),
  ];

  /**
   * `**like this**` becomes bold, applied **after** escaping so the marker can only ever wrap
   * text this codebase wrote (§189). The owner, of a confirmation: "in mail, numarul de concurs
   * trebuie facut bold, e super important!" — and it is: it is the one thing a runner reads on
   * a phone at the desk. The plain-text part strips the markers rather than printing them.
   */
  /*
    And `__like this__` is underlined (§309), the same way and for the same reason: the owner, of
    the message re-sent to somebody who filled in the form again, "this needs to be underlined!"
    — "Ești deja înscris" is the one sentence that person is hunting for. Inline style as well as
    the element, because a few clients reset `<u>`.
  */
  const emphasise = (escaped: string) =>
    escaped
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/__([^_]+)__/g, '<u style="text-decoration:underline">$1</u>');
  const paragraph = (inner: string) => `<p style="margin:0 0 14px;font-size:16px;line-height:1.5">${inner}</p>`;
  const htmlParts = [
    paragraph(escapeHtml(content.greeting)),
    // The facts first and bold: what the eye finds on a phone the morning of.
    ...(content.facts
      ? [
          paragraph(
            `<strong>${escapeHtml(content.facts.line)}</strong>${content.facts.links
              .map((link) => `<br><a href="${link.url}" style="color:${COLOR.blueInk}">${escapeHtml(link.label)}</a>`)
              .join("")}`,
          ),
        ]
      : []),
    ...content.paragraphs.map((part) =>
      typeof part === "string" ? paragraph(emphasise(escapeHtml(part))) : part.html,
    ),
    // The event's facts under the club's text and above the QR — what the eye finds on a phone
    // on race morning (§81, restored by the fix round; §392).
    ...(content.eventFacts ? [content.eventFacts.html] : []),
    // A hosted image, never a data URI: several mail clients strip inline data, and a QR that
    // does not render is a participant at the desk with nothing to show.
    ...(content.image
      ? [
          `<p style="margin:0 0 6px"><img src="${content.image.url}" alt="${escapeHtml(content.image.alt)}" width="240" height="240" style="display:block;width:240px;height:240px"></p>`,
          paragraph(escapeHtml(content.image.caption)),
        ]
      : []),
    // The one action as a button (§96): a link a thumb finds, in the club's blue.
    ...(content.action
      ? [
          `<p style="margin:20px 0"><a href="${content.action.url}" style="display:inline-block;background:${COLOR.blueInk};color:${COLOR.surface};text-decoration:none;font-weight:700;font-size:16px;padding:14px 22px;border-radius:10px">${escapeHtml(content.action.label)}</a></p>`,
        ]
      : []),
    // The second choice (§468): outlined, so the eye takes the first button for the message's point.
    ...(content.action && content.secondaryAction
      ? [
          `<p style="margin:-8px 0 20px"><a href="${content.secondaryAction.url}" style="display:inline-block;background:${COLOR.surface};color:${COLOR.blueInk};text-decoration:none;font-weight:700;font-size:15px;padding:12px 20px;border:2px solid ${COLOR.blueInk};border-radius:10px">${escapeHtml(content.secondaryAction.label)}</a></p>`,
        ]
      : []),
    ...(content.links && content.links.length > 0
      ? [
          `<ul style="margin:0 0 18px;padding:0 0 0 18px;font-size:15px;line-height:1.7">${content.links
            .map((link) => `<li><a href="${link.url}" style="color:${COLOR.blueInk}">${escapeHtml(link.label)}</a></li>`)
            .join("")}</ul>`,
        ]
      : []),
    paragraph(`${escapeHtml(content.closing)}<br>${escapeHtml(SIGN_OFF[locale])}`),
    ...(content.footer ? [`<p style="margin:0;color:${COLOR.inkMuted};font-size:13px">${escapeHtml(content.footer)}</p>`] : []),
    ...(content.privacy
      ? [
          `<p style="margin:${content.footer ? "8px" : "0"} 0 0;color:${COLOR.inkMuted};font-size:13px">${escapeHtml(content.privacy.text)} <a href="${content.privacy.url}" style="color:${COLOR.blueInk}">${escapeHtml(content.privacy.url)}</a>.</p>`,
        ]
      : []),
  ];

  return { html: card([htmlParts]), text: textLines.join("\n"), htmlParts, textLines };
}

/**
 * One card, the club's name on a blue band above it (§96), holding one language's parts — or
 * two, one under the other with a rule between (§96: "make the email bilingual by default").
 * Inline styles only — mail clients drop stylesheets — and a table-free layout that Gmail,
 * Outlook and Apple Mail all keep.
 */
function card(blocks: string[][]): string {
  const rule = `<hr style="border:0;border-top:1px solid ${COLOR.line};margin:24px 0">`;
  /**
   * The club's lockup on the band, not its name in letters (§174; the owner: "în mailul de
   * înregistrare am nevoie de logoul BVR").
   *
   * A hosted **PNG**, because half the mail clients in use refuse SVG, and the white-on-blue
   * raster is generated from the same source the site serves (`scripts/brand-assets.mjs`). The
   * `alt` is the club's name, so a client with images off shows exactly what the band said
   * before — nothing is lost when the picture is blocked, which is the common case on a first
   * message from an unknown sender.
   *
   * The address derives from `APP_BASE_URL` like every other absolute URL here (`AGENTS.md`
   * §8): no hostname is written in `src/`.
   */
  const logo = `<img src="${env.APP_BASE_URL}/brand/logo-email-banner.png" alt="${escapeHtml(CLUB_NAME)}" width="600" style="display:block;width:100%;max-width:600px;height:auto;border:0">`;
  /**
   * The header is a **white banner**, and the message declares itself a light-scheme document
   * (§218; the Organizer: "this email header looks ugly! it should be a banner with white background").
   *
   * ## What was actually wrong, because the card was already white
   *
   * `COLOR.surface` is `#ffffff`, so in an ordinary inbox the band and the logo were the same
   * colour and nothing showed. The screenshot was Gmail's **dark mode**, which re-colours what
   * it can and cannot re-colour a raster: the card went dark, the logo's own white rectangle
   * did not, and the lockup ended up looking like a sticker on a dark wall — the exact thing
   * §189 changed the blue band to avoid.
   *
   * ## The two halves of the fix
   *
   * `color-scheme: light` in both the meta and a `:root` rule is what tells Apple Mail, Outlook
   * and Gmail's webmail to leave the colours alone. It is declared twice on purpose: the meta
   * is what most clients read, and Gmail strips `<head>` but keeps a `<style>` block.
   *
   * And the band is **the picture**, edge to edge (§239; the owner: "the email banner must
   * be edge-to-edge"). A white cell with a small logo centred in it is not what arrives in
   * Gmail's dark theme: the cell is re-coloured, the raster is not, and the white band
   * shrinks to a white rectangle the size of the lockup. A client cannot invert the inside
   * of a PNG, so the white margin now belongs to `logo-email-banner.png` and there is no
   * edge between two whites left to expose. The cell keeps its `bgcolor` underneath for the
   * common case of a first message with images blocked, and pads nothing.
   *
   * It is still a **table cell with a `bgcolor` attribute**, not a styled `<div>`. A
   * client that inverts anyway has to fight an HTML attribute rather than a CSS declaration,
   * which is the one lever that still works in the clients that ignore `color-scheme`; the
   * logo is centred in it so a band wider than the picture still reads as a letterhead rather
   * than as a picture with space beside it.
   *
   * A full document rather than a fragment, for the same reason: there was no `<head>` to put
   * any of this in.
   */
  return [
    "<!DOCTYPE html>",
    '<html lang="ro"><head>',
    '<meta charset="utf-8">',
    '<meta name="color-scheme" content="light">',
    '<meta name="supported-color-schemes" content="light">',
    "<style>:root{color-scheme:light;supported-color-schemes:light}</style>",
    "</head>",
    `<body style="margin:0;padding:0;background:${COLOR.surface}">`,
    `<div style="max-width:600px;margin:0 auto;font-family:Roboto,Helvetica,Arial,sans-serif;color:${COLOR.ink}">`,
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse">`,
    `<tr><td bgcolor="${COLOR.surface}" align="center" style="background-color:${COLOR.surface};padding:0;font-size:0;line-height:0;border:1px solid ${COLOR.line};border-bottom:0;border-radius:12px 12px 0 0">${logo}</td></tr>`,
    "</table>",
    `<div style="padding:24px;border:1px solid ${COLOR.line};border-top:0;border-radius:0 0 12px 12px;background-color:${COLOR.surface}">`,
    ...blocks.flatMap((parts, index) => (index > 0 ? [rule, ...parts] : parts)),
    "</div></div></body></html>",
  ].join("\n");
}

const OTHER_LOCALE: Record<EmailLocale, EmailLocale> = { ro: "en", en: "ro" };

/**
 * Both languages in one message, the registration's own first (§96): a runner from abroad
 * registered in English still shows the mail to a Romanian friend, and a Romanian who chose
 * English by accident reads the top half. Two subjects joined with " / ", within what a
 * subject line bears; the plain-text body reads the same, the second language after a rule.
 */
export function renderBilingual(
  messageType: EmailMessageType,
  locale: EmailLocale,
  data: TemplateData,
  actionUrl: string | undefined,
  /** The club's own wording (§247); both halves read it, each in its own language. */
  overrides?: EmailCopy | null,
): { subject: string; html: string; text: string } {
  const first = buildTemplateContent(messageType, locale, data, actionUrl, overrides);
  // The second language repeats the words, not the picture: one QR per message is enough —
  // and its date is its own ("Sunday 11 October", not "duminică").
  const otherData: TemplateData = {
    ...data,
    ...(data.eventStartsAtFormattedOther ? { eventStartsAtFormatted: data.eventStartsAtFormattedOther } : {}),
    // Every date of the second half in its own language (§349), not only the event's.
    ...(data.holdExpiresAtFormattedOther ? { holdExpiresAtFormatted: data.holdExpiresAtFormattedOther } : {}),
    ...(data.signedAtFormattedOther ? { signedAtFormatted: data.signedAtFormattedOther } : {}),
    // A group run series' rhythm in the second half's language (§523).
    ...(data.seriesRhythmOther ? { seriesRhythm: data.seriesRhythmOther } : {}),
    ...(data.eventLocationNameOther ? { eventLocationName: data.eventLocationNameOther } : {}),
    ...(data.eventProgrammeOther ? { eventProgramme: data.eventProgrammeOther } : {}),
    // The facts block in the second half's language, from its own page (§392): its place's name,
    // its programme labels, its page's sections — drawn once per half (§373).
    ...(data.eventFactsOther ? { eventFacts: data.eventFactsOther } : {}),
    // The status in the other language's own words (§373, email follow-up), never the registrant's.
    ...(data.currentStatusOther ? { currentStatus: data.currentStatusOther } : {}),
    /*
      The event's own words in the second half's language (§373, email follow-up): its title — in
      the second subject too, and in a `{eventTitle}` of the club's words for that language — and
      what to bring, or nothing when that language has none. Absent when the event has no text in
      the other language: both halves read the row's, as before.
    */
    ...(data.eventTitleOther ? { eventTitle: data.eventTitleOther } : {}),
    ...(data.eventChecklistOther !== undefined ? { eventChecklist: data.eventChecklistOther ?? undefined } : {}),
    // The organizer's own words in the second half's language (§354, bilingual everywhere) —
    // absent only for a row queued with one text, which both halves then read as before.
    ...(data.organizerNoteOther ? { organizerNote: data.organizerNoteOther } : {}),
    ...(data.cancellationReasonOther ? { cancellationReason: data.cancellationReasonOther } : {}),
    // A family's blocks in the second half: the words and the numbers, not the QR pictures again (§519).
    ...(data.familyConfirmed ? { familyConfirmed: data.familyConfirmed.map((person) => ({ ...person, qrUrl: undefined })) } : {}),
    // The organizer's message (§364): its own subject and body in the second half's language.
    ...(data.organizerSubjectOther ? { organizerSubject: data.organizerSubjectOther } : {}),
    ...(data.organizerBodyOther ? { organizerBody: data.organizerBodyOther } : {}),
    // The newsletter's own words and topics in the second half's language (§445).
    ...(data.newsletterSubjectOther ? { newsletterSubject: data.newsletterSubjectOther } : {}),
    ...(data.newsletterBodyOther ? { newsletterBody: data.newsletterBodyOther } : {}),
    ...(data.newsletterTopicsOther ? { newsletterTopics: data.newsletterTopicsOther } : {}),
    // The organizer's message reads the same `eventTitleOther`/`eventChecklistOther` fields above
    // (§364) — every message's second half does now (§373, email follow-up), so no separate gate
    // is needed for this one.
  };
  const second = { ...buildTemplateContent(messageType, OTHER_LOCALE[locale], otherData, actionUrl, overrides), image: undefined };
  const a = renderContent(first, locale);
  const b = renderContent(second, OTHER_LOCALE[locale]);
  return {
    subject: `${first.subject} / ${second.subject}`,
    html: card([a.htmlParts, b.htmlParts]),
    text: [...a.textLines, "", "— — —", "", ...b.textLines].join("\n"),
  };
}

/**
 * The reminder's night line's facts (§394, §404): empty strings for what is not named. `after`
 * marks the shape where the sun alone made the call and the start was already past sunset — no
 * end was ever named, and the line says the start came after that sunset instead of leaving the
 * sunset looking like the reason on its own. `sunrise` (non-empty) marks the dawn shape: an
 * early-morning start before that day's sunrise, named instead of the evening's sunset.
 */
type NightReminderLine = {
  sunset: string;
  sunrise: string;
  start: string;
  end: string;
  endSource: "event" | "programme" | null;
  isGroupRun: boolean;
  after: boolean;
};

/** What every template needs beyond the locale — never a rendered body, never a token. */
export type TemplateData = {
  participantName: string;
  /**
   * This is the club's copy of a participant's message (§320): "[Copie club]" in front of the
   * subject, one line at the top saying the personal links were taken out, no action button, and
   * none of the links or codes only the participant may hold — whatever else the data carries.
   */
  clubCopy?: boolean;
  /**
   * This message is a re-send, because the form was filled in again with an address that is
   * already registered (§199, §235). One sentence goes in front of the body saying so.
   */
  alreadyRegistered?: boolean;
  /**
   * The race number in this message is the provisional one (§214, §237): it is shown so
   * the runner has it, and said to be provisional because the settle at the close may
   * move it.
   */
  bibProvisional?: boolean;
  eventTitle?: string;
  /** The event's title in the other language, for the bilingual message's second half (§373, email follow-up). */
  eventTitleOther?: string;
  eventLocationName?: string;
  /**
   * The place in the other language's words, for the bilingual message's second half: that
   * language's own name for it (§373, email follow-up; §362) — "Tractorul Park" under "Parcul
   * Tractorul" — or, while the place is to be announced (§328), the sentence that says so in
   * that language. Absent: the second half reads `eventLocationName`.
   */
  eventLocationNameOther?: string;
  eventStartsAtFormatted?: string;
  /** The same instant in the other language's words, for the bilingual message's second half (§96). */
  eventStartsAtFormattedOther?: string;
  /** A race's gun time, "10:00", when it has one apart from the gathering (§71); on the update notice (§331). */
  eventRaceStartsAtFormatted?: string;
  currentStatus?: string;
  /** The same status in the other language's words, for the bilingual message's second half (§373, email follow-up). */
  currentStatusOther?: string;
  /** The desk code and the address of its QR image, on the confirmation and the reminder (BR-REQ-037-08). */
  checkinCode?: string;
  checkinQrUrl?: string;
  /** The race number, once given (§87) — on the confirmation and the reminder. */
  bibNumber?: number;
  /** The event's map link and Strava event link, when set (§81). */
  eventMapUrl?: string;
  eventStravaEventUrl?: string;
  /** "What to bring", the translation's one line (§81). */
  eventChecklist?: string;
  /**
   * Set only on the reminder of a date that is a night event (§394): the sunset of that day,
   * "16:36", on the event's clock — the same in both halves, a 24-hour time is no language's.
   * The line says it and says to bring a light. An empty string is a night event whose sunset
   * could not be computed (a polar night); the line then says the light alone.
   */
  nightEventSunset?: string;
  /**
   * Set alongside `nightEventSunset` (§394): whether this event is a group run, since the night
   * line calls it a run («Alergare de noapte») rather than an event («Eveniment de noapte») only
   * then — the owner calls a run a run.
   */
  nightEventIsGroupRun?: boolean;
  /**
   * Set alongside `nightEventSunset` (§404): the date's start on the event's clock, "19:00" — named
   * before the sunset, so the sunset is never read as the start. Absent or empty: the line says the
   * sunset alone.
   */
  nightEventStart?: string;
  /**
   * Set alongside `nightEventSunset` only when the end is why the date is dark (§394, §404): that
   * end on the event's clock, and whether «Durata» (`event`) or the day's last programme row
   * (`programme`) gave it.
   */
  nightEventEnd?: string;
  nightEventEndSource?: "event" | "programme";
  /**
   * Set alongside `nightEventSunset` (§404): the sun alone made the call and the start was
   * already past that sunset, so no end was ever named — the line says the start came *after*
   * the sunset instead of leaving the sunset looking like the reason on its own.
   */
  nightEventAfter?: boolean;
  /**
   * Set alongside `nightEventSunset` (§404) for the dawn shape: the start is before that day's
   * sunrise, "07:52" — the line names the sunrise, never an evening sunset the run is not after.
   */
  nightEventSunrise?: string;
  /**
   * The same line in the other language, for the second half (§373, email follow-up); `null` when
   * that language has none, and the second half then says nothing rather than the first half's
   * words. Absent when the other language was not read — both halves read `eventChecklist`.
   */
  eventChecklistOther?: string | null;
  /** Set when the club has a reply address: the footer says to use it. */
  replyTo?: string;
  /** The thank-you's optional link — results, photos (§82). Carried in the payload, not a token. */
  thanksUrl?: string;
  /** The signed declaration as a PDF, on the confirmation (§95): the same manage token, read-only. */
  declarationPdfUrl?: string;
  /** When it was signed, formatted for the locale — on the declaration's own message. */
  signedAtFormatted?: string;
  /** The same instant in the other language's words, for the bilingual message's second half (§349). */
  signedAtFormattedOther?: string;
  /** The event's public page, and the manage page (§96): the deep links under the action. */
  eventUrl?: string;
  /** The rules on that page, when the organizer wrote some (§96). */
  eventRulesUrl?: string;
  /** The programme on that page, when there is one (§96). */
  eventScheduleUrl?: string;
  /** "Linkuri și fișiere" on that page (`#links`), when the event has any (§332); on the confirmation and the reminder. */
  eventLinksUrl?: string;
  /**
   * The forecast for the start (§402), on the reminder only: the start's hour, the hours the event
   * is out and which place it was read at (§484), which each half of the bilingual message words in
   * its own language (`weatherSpanWords`). Absent beyond seven days and whenever Open-Meteo did not
   * answer — the facts block's «Vremea» row is then simply not there.
   */
  eventWeather?: EventForecast;
  /** The programme's rows as lines, in the message's language and in the other's (§117); on the update notice (§331). */
  eventProgramme?: string[];
  eventProgrammeOther?: string[];
  /**
   * What the facts block says about the event (§392, `domain/event-facts.ts`), in this half's
   * language, and in the other's for the bilingual message's second half. Read by the confirmation,
   * the reminder and the declaration request only; absent when the message is about no event.
   */
  eventFacts?: EmailEventFacts;
  eventFactsOther?: EmailEventFacts;
  /**
   * When the hold on the place lapses, in the event's zone (§104); on `COMPLETE_DECLARATION`,
   * and only while it is ahead — past it the place is kept for as long as nobody waits (§160).
   */
  holdExpiresAtFormatted?: string;
  /** The same deadline in the other language's words, for the second half (§349). */
  holdExpiresAtFormattedOther?: string;
  /** True when the hold is the participation window's (§104), not the club's minutes. */
  confirmLater?: boolean;
  /**
   * True when the event's participation window is already open (§104, §377): the message is the
   * send when the window opens (or a resend after it), itself the reminder, so it does not promise
   * "or when we remind you".
   */
  windowOpen?: boolean;
  /**
   * The deadlines this message states, as numbers (§377): the club's "Termene" in force when it is
   * rendered, this event's own reminder lead, its participation window's opening, and how long a
   * link with no deadline of its own lives. Each half of a bilingual message words them in its own
   * language (`buildTemplateContent`), so the English half never carries "48 de ore".
   */
  timings?: {
    confirmationHours: number;
    holdMinutes: number;
    offerHours: number;
    /**
     * This offer's own length in minutes, from `offerCreatedAt` to the (possibly capped)
     * `holdExpiresAt` (`render.ts`, §419): `{offerHours}` then says whole hours only when the
     * span is exactly that many, and minutes otherwise — "20 de minute", "91 de minute" — never a
     * length longer than the real span.
     */
    offerMinutes?: number;
    /** This event's lead — its own, or the club's (`reminderHoursFor`); zero is none. */
    reminderHours: number;
    /** `events.confirmation_opens_days_before`, when the message is about an event. */
    confirmationOpensDays?: number;
    /** How long the "my registrations" link lives, in days (`render.ts`, `DEFAULT_TOKEN_HOURS`). */
    linkDays?: number;
  };
  /**
   * The same deadlines as words, in this half's language — "48 de ore", "30 de minute", "24 de
   * ore", "2 zile" — set by `buildTemplateContent` from `timings`, whatever a caller put here.
   * They are what `{confirmationHours}`, `{holdMinutes}`, `{offerHours}` and `{reminderHours}`
   * fill in the club's own words (§247), number and noun together so the Romanian agrees for any
   * value; `reminderHours` is empty when the event sends no reminder.
   */
  confirmationHours?: string;
  holdMinutes?: string;
  offerHours?: string;
  reminderHours?: string;
  /** The participation window's opening in words ("o săptămână"), and the link's lifetime ("14 zile"). */
  confirmationOpens?: string;
  linkLifetime?: string;
  manageUrl?: string;
  /**
   * The public participant list's own switch, on the confirmation (BR-REQ-039-01; `DECISIONS.md`
   * §143): its own token, read at send time. `listed` is whether the name is on the list today,
   * so the link reads the right way round — "take me off" or "show my name".
   */
  listConsentUrl?: string;
  listed?: boolean;
  /**
   * The listing and the contact page (§239; the owner: "I need more links in that email").
   *
   * Set on every participant message, so the footer list is the same wherever somebody
   * lands in the journey — the event, its rules, its programme, their own registrations,
   * the other races, and a way to reach a human.
   */
  eventsUrl?: string;
  contactUrl?: string;
  /**
   * The privacy notice (§323), in the language of the half being built. Set by
   * `buildTemplateContent` itself — each half of a bilingual message points at its own
   * language's notice — so whatever a caller put here is replaced.
   */
  privacyUrl?: string;
  /** The staff invitation (§141): who is invited, as what, by whom, and where to sign in. */
  staffRole?: string;
  inviterName?: string;
  staffEmail?: string;
  signInUrl?: string;
  /**
   * "Detalii actualizate" (§331): which facts the save changed — the place, the start, the
   * programme, the event on again. The values are the event's as it stands at send time, in the
   * fields above; this says which of them to name as new.
   */
  updateChanges?: readonly EventChangeKind[];
  /** The organizer's own words on that message, plain text, at most 500 characters — in this half's language. */
  organizerNote?: string;
  /**
   * The same note in the other language, for the bilingual message's second half (§354, bilingual
   * everywhere). Absent for a row queued before the note was written twice: both halves then
   * carry `organizerNote`, as they always did.
   */
  organizerNoteOther?: string;
  /** Why the event was cancelled, as the organizer typed it (§331) — in this half's language. */
  cancellationReason?: string;
  /** The same reason in the other language, for the second half (§354); absent on an older row. */
  cancellationReasonOther?: string;
  /**
   * "Trimite un mesaj participanților" (§364): the subject and the body the organizer wrote for
   * this send, in this half's language — plain text, placeholders still in it, filled here with
   * this half's facts. Absent only for a row whose payload cannot be read, which then goes with
   * the platform's own subject and framing sentence.
   */
  organizerSubject?: string;
  organizerBody?: string;
  /** The same two in the other language, for the second half — never the same text twice (§354). */
  organizerSubjectOther?: string;
  organizerBodyOther?: string;
  /**
   * "Înscrierile mele" without a token (§77): the page that asks for an address and mails the link.
   * On the organizer's message, which mints nothing, so its reader can still find their registration.
   */
  myRegistrationsUrl?: string;
  /**
   * The link for another person on one address (§389, `REGISTER_ANOTHER_PERSON`): the club's limit
   * of registrations per address as it stood when the form was sent, and whether the address had
   * reached it — then the message says so and carries no link. Both from the row's payload: the
   * email says what the submission decided.
   */
  addressCap?: number;
  addressAtCap?: boolean;
  /**
   * Another person on the address, confirmed from the inbox (§446): who the address holds at the
   * event now, as "Ana P." — its own active registrations, never anybody else's — and the person
   * the form named, in full, with the birth date as "2012-03-12", written in words per language (§468). Read from the kept form at send
   * time; absent at the limit or once the form is gone, and then there is no button either.
   */
  familyRegistered?: string[];
  familyPersonName?: string;
  familyPersonBirthDate?: string;
  /**
   * The same single-use link's other answer (§468): the confirmation page in its "no" shape, where
   * one press deletes the kept form. Set only beside the button, from the one token minted for it.
   */
  familyDeclineUrl?: string;
  /**
   * A family sitting's one message (§519): everybody the sitting sent the form for and nobody
   * confirmed yet, by full name and birth date ("YYYY-MM-DD"), in the order sent — read at send time.
   * Set, the message is the family's: its subject, its facts box, its button and its words.
   */
  familySittingPeople?: ReadonlyArray<{ name: string; birthDate: string }>;
  /** «Toate înscrierile mele» beside the family's button (§77, §519): the address's own page, its own token. */
  familyMineUrl?: string;
  /**
   * A family's one confirmation (§519; the owner: «în mail trebuie să vină toate QR-urile pentru toată
   * familia»): everybody confirmed by the family's one button, in the order the forms were sent — the
   * name, the desk code and its QR (never on a club copy, §320), and the race number (`raceNumberOf`),
   * provisional or not, or null while there is none. Set, the confirmation is the family's, and it
   * greets everybody by `firstName` (the name's first word when absent), in that order (§519).
   */
  familyConfirmed?: ReadonlyArray<{
    name: string;
    firstName?: string;
    checkinCode?: string;
    qrUrl?: string;
    raceNumber: number | null;
    provisional: boolean;
  }>;
  /**
   * A message re-sent because the form came back with a registration's name or birth date but not
   * both (§446): one sentence says how to register somebody else. Only ever in the inbox.
   */
  anotherPersonHint?: boolean;
  /**
   * The slip was another name on a registered birth date (§493): twins, perhaps, whom "send the form
   * again" cannot help — the sentence says what can (another address, or the club at the desk).
   */
  sameBirthDateHint?: boolean;
  /**
   * The kept form behind the message is gone (§446): confirmed already, or lapsed and purged —
   * a row the outbox deferred past the window (§40), or sent again after the press. There is no
   * button and no person to name, so the message says the request lapsed and how to start again.
   */
  familyEntryGone?: boolean;
  /**
   * The declaration request of one person on an address that holds others still to sign at the
   * event (§471): their names as "Maria P.", read at send time. The line says the one link signs
   * them all, one after the other. Absent for a person alone, and on a club copy.
   */
  familyToSign?: string[];
  /**
   * A minor's registration (§108): the parent's or guardian's name, as typed on the form. The
   * message greets them and says whose registration it is about (§419) — the address is theirs.
   */
  guardianName?: string;
  /**
   * On a declaration request for a minor (§419): whether the declaration in force asks the minor to
   * sign beside the parent (§330, `asksForMinorSignature`) — the line then says both sign, each
   * with their own identity document.
   */
  minorSigns?: boolean;
  /**
   * A bulk send's one club copy (§419; `enqueueBulkClubCopies`): how many real participants the
   * send reached. The copy then greets the club, names nobody and says the count.
   */
  clubCopyRecipients?: number;
  /**
   * A group run's signer's copy whose PDF shows the identity document masked (§419): the text asked
   * for one, and the address it goes to was never confirmed. The message says so.
   */
  idDocumentMasked?: boolean;
  /**
   * A group run's declaration that covers the run's series (§523): both emails name the series —
   * the run's title — and its rhythm, «în fiecare marți, la 18:30», in each half's language, and say
   * it is valid for every run of it. Unset for a one-off run's, which names that run as before.
   */
  groupRunSeries?: boolean;
  seriesRhythm?: string;
  seriesRhythmOther?: string;
  /**
   * The newsletter (§445). The topics this subscriber chose, as a phrase in this half's language —
   * "„Evenimente mari” și „Testări de încălțăminte”" — and in the other half's.
   */
  newsletterTopics?: string;
  newsletterTopicsOther?: string;
  /** The confirmation message went to an address already subscribed: its action is the subscriber's own page. */
  newsletterAlready?: boolean;
  /** The subscriber's own page — the topics and "unsubscribe" — on every newsletter message; never on anything else. */
  newsletterManageUrl?: string;
  /** A newsletter's own words (§445): this half's subject and body, and the other half's. */
  newsletterSubject?: string;
  newsletterSubjectOther?: string;
  newsletterBody?: string;
  newsletterBodyOther?: string;
};

/**
 * The organizer's own words — the note on an update, the reason for a cancellation — as a block
 * of its own (§331): a bold label, then the text escaped, its line breaks kept, and **no**
 * emphasis markers read inside it. The platform's sentences may carry `**` and `__` (§189,
 * §309); a note typed in the backoffice is not the platform's sentence, and a stray pair of
 * asterisks in it must print as asterisks.
 */
function organizerTextPart(label: string, text: string): EmailBodyPart {
  const lines = text.split("\n");
  return {
    html: `<p style="margin:0 0 14px;font-size:16px;line-height:1.5"><strong>${escapeHtml(label)}</strong><br>${lines.map(escapeHtml).join("<br>")}</p>`,
    text: [label, ...lines],
  };
}

/**
 * A neutral word for the runner the one bulk club copy names nobody in particular (§419, review
 * finding): the organizer's body may read "Salut, {participantName}!", and the bulk copy has no
 * one registration to fill that with — never a blank ("Salut, !").
 */
function bulkParticipantWord(locale: EmailLocale): string {
  return locale === "ro" ? "participantul" : "the participant";
}

/**
 * The organizer's own message (§364), after the platform's one framing sentence: the body they
 * typed, its placeholders filled with this half's facts, a blank line starting a paragraph and a
 * single line break kept. Escaped as plain text, and — like the note on an update (§331) — no
 * `**` or `__` read inside it: a pair of asterisks somebody typed prints as asterisks.
 *
 * On the one bulk club copy (`bulkCopy`), `{participantName}` and `{bibNumber}` — facts this
 * copy has none of — read as a neutral word and nothing, rather than the blank a per-registration
 * send's missing field would leave (§419, review finding: "Salut, !" is not a sentence).
 */
function organizerMessageParts(messageType: EmailMessageType, data: TemplateData, locale: EmailLocale, bulkCopy: boolean): EmailBodyPart[] {
  if (messageType !== "ORGANIZER_MESSAGE" || !data.organizerBody) return [];
  const fields = bulkCopy ? { ...data, participantName: bulkParticipantWord(locale), bibNumber: undefined } : data;
  const paragraphs = organizerParagraphs(fillPlaceholders(data.organizerBody, fields as unknown as Record<string, unknown>));
  return paragraphs.map((lines, index) => ({
    html: `<p style="margin:0 0 14px;font-size:16px;line-height:1.5">${lines.map(escapeHtml).join("<br>")}</p>`,
    // A blank line between paragraphs in the plain-text part too, so it reads as it was typed.
    text: index < paragraphs.length - 1 ? [...lines, ""] : lines,
  }));
}

/** The subject the organizer wrote, filled with this half's facts (§364); the platform's own when a row carries none. */
function organizerSubject(d: TemplateData, fallback: string): string {
  if (!d.organizerSubject) return fallback;
  return fillPlaceholders(d.organizerSubject, d as unknown as Record<string, unknown>) || fallback;
}

/** The bold line and its links, shared by the confirmation and the reminder. */
function eventFacts(d: TemplateData, labels: { map: string; strava: string }) {
  // The date starts this line, so it takes its capital here (§349); every sentence keeps the
  // language's own lower case. `capitalizeFirst` is the same in both languages' rules for the
  // letters a weekday starts with.
  const line = [d.eventStartsAtFormatted ? capitalizeFirst(d.eventStartsAtFormatted, "ro") : undefined, d.eventLocationName].filter(Boolean).join(" · ");
  if (!line) return undefined;
  const links = [
    ...(d.eventMapUrl ? [{ label: labels.map, url: d.eventMapUrl }] : []),
    ...(d.eventStravaEventUrl ? [{ label: labels.strava, url: d.eventStravaEventUrl }] : []),
  ];
  return { line, links };
}

/**
 * The links every participant message ends with (§239; the owner, of a confirmation: "I need
 * more links in that email").
 *
 * They were per-template, so which of them a message carried depended on which message it
 * was: the confirmation of an address — the first mail anybody gets, and the one most likely
 * to be the only one they read carefully — carried none at all. Somebody who wants to check
 * the start time, re-read the rules or say they cannot come should not have to find a
 * different email to do it.
 *
 * Each one is dropped when there is nothing to point at: no rules written, no programme, no
 * manage token on this message. The list is deduplicated against whatever the template
 * already named, by URL and with the template's own label winning — the reminder calls the
 * event page something of its own, and that wording is the one that fits its sentence.
 *
 * Not on the club's own copies (`DECLARATION_ARCHIVE`) or the staff invitation: neither is a
 * participant's message, and a manage link in either would be a link to somebody else's
 * registration.
 */
function standardLinks(
  d: TemplateData,
  labels: { event: string; rules: string; schedule: string; manage: string; events: string; contact: string },
) {
  return [
    ...(d.eventUrl ? [{ label: labels.event, url: d.eventUrl }] : []),
    ...(d.eventRulesUrl ? [{ label: labels.rules, url: d.eventRulesUrl }] : []),
    ...(d.eventScheduleUrl ? [{ label: labels.schedule, url: d.eventScheduleUrl }] : []),
    ...(d.manageUrl ? [{ label: labels.manage, url: d.manageUrl }] : []),
    ...(d.eventsUrl ? [{ label: labels.events, url: d.eventsUrl }] : []),
    ...(d.contactUrl ? [{ label: labels.contact, url: d.contactUrl }] : []),
  ];
}
const T = {
  ro: {
    hi: (name: string) => `Salut, ${name},`,
    moreLinks: {
      event: "Pagina evenimentului",
      rules: "Regulamentul evenimentului",
      schedule: "Programul evenimentului",
      manage: "Înscrierile mele",
      events: "Toate evenimentele",
      contact: "Scrie-ne",
    },
    verify: {
      subject: "Confirmă adresa de email",
      /*
        The first message to whoever the form named (§419; GDPR art. 12(1), 14(2)(f), 14(3)(b)): whose
        registration it is, where the data came from, how long the link lasts and that the
        registration lapses without it — a family member registered on this address (§389) reads it
        first, and the privacy notice is the footer's link.
      */
      body: (d: TemplateData) => [
        `Am primit o înscriere la ${d.eventTitle ?? "eveniment"} pe numele ${d.participantName}, trimisă cu această adresă de email. Pentru a continua, confirmă adresa.`,
        `Linkul este valabil ${d.confirmationHours ?? hoursPhrase("ro", DEFAULT_DEADLINES.confirmationHours)}; dacă nu confirmi adresa până atunci, înscrierea expiră.`,
        `Datele din înscriere ni le-a trimis cine a completat formularul cu această adresă. Dacă nu ${d.participantName} l-a completat, arată-i acest mesaj: cum folosim datele scrie în nota de confidențialitate, la linkul de la sfârșitul mesajului. Dacă ${d.participantName} nu vrea să participe, nu confirma: înscrierea expiră singură.`,
        "Dacă nu ai solicitat această înscriere, poți ignora acest mesaj.",
      ],
      action: "Confirmă adresa de email",
    },
    completeDeclaration: {
      subject: (d: TemplateData) =>
        d.confirmLater
          ? `Ești înscris — confirmă participarea până ${d.holdExpiresAtFormatted ?? "termen"}`
          : "Un loc te așteaptă — semnează declarația",
      body: (d: TemplateData) => [
        d.confirmLater
          ? // No "the race is free" (§419): said of any event more than a day away, paid or not a race.
            `Locul tău la ${d.eventTitle ?? "eveniment"} este rezervat. Înscrierea este completă doar după ce semnezi declarația pe proprie răspundere. ${d.windowOpen ? "Semnează acum, din linkul de mai jos." : `Poți semna acum, din linkul de mai jos, sau când îți reamintim, ${d.confirmationOpens ? `cu ${d.confirmationOpens} înainte de start` : "înainte de start"}.`}`
          : `Un loc la ${d.eventTitle ?? "eveniment"} este rezervat pentru tine. Înscrierea este completă doar cu declarația pe proprie răspundere semnată — citește-o și semneaz-o din linkul de mai jos.`,
        `Dacă nu apuci online, semnezi declarația pe hârtie la masa de înscrieri, în ziua cursei, înainte să-ți ridici numărul.${d.holdExpiresAtFormatted ? ` Dacă se formează lista de așteptare, locul îți este ținut până ${d.holdExpiresAtFormatted}; până atunci semnează.` : ""}`,
      ],
      action: "Semnează declarația",
      links: (d: TemplateData) => (d.eventRulesUrl ? [{ label: "Regulamentul evenimentului", url: d.eventRulesUrl }] : []),
    },
    waitlistJoined: {
      subject: "Ești pe lista de așteptare",
      body: (d: TemplateData) => [
        `${d.eventTitle ?? "Evenimentul"} este complet momentan, așa că te-am adăugat pe lista de așteptare. Te vom anunța dacă se eliberează un loc.`,
      ],
    },
    waitlistSpotOffer: {
      subject: "S-a eliberat un loc pentru tine",
      /*
        The message that starts the clock says when it stops (§419; Codul civil art. 1191, 1193;
        terms §2's {{offerHours}}): the moment, in the event's zone, and the length the club set in
        "Termene" (§377). A resend after the offer lapsed names no moment that has passed.
      */
      body: (d: TemplateData) => [
        d.holdExpiresAtFormatted
          ? `S-a eliberat un loc la ${d.eventTitle ?? "eveniment"}. Este al tău dacă semnezi declarația pe propria răspundere până ${d.holdExpiresAtFormatted} (ai la dispoziție ${d.offerHours ?? hoursPhrase("ro", DEFAULT_DEADLINES.offerHours)}); după acest termen, locul trece la următorul de pe lista de așteptare.`
          : `S-a eliberat un loc la ${d.eventTitle ?? "eveniment"}. Ai la dispoziție ${d.offerHours ?? hoursPhrase("ro", DEFAULT_DEADLINES.offerHours)} de la ofertă să semnezi declarația pe propria răspundere; după aceea, locul trece la următorul de pe lista de așteptare.`,
      ],
      action: "Confirmă locul",
    },
    registrationConfirmed: {
      subject: "Înscrierea este confirmată",
      facts: (d: TemplateData) => eventFacts(d, { map: "Harta punctului de întâlnire", strava: "Evenimentul pe Strava" }),
      body: (d: TemplateData) => [
        `Înscrierea ta la ${d.eventTitle ?? "eveniment"} este confirmată. Te așteptăm!`,
        ...(d.bibNumber ? [`Numărul tău de concurs: **${d.bibNumber}**. Îl primești la masă, în ziua cursei.`] : []),
        ...(d.eventChecklist ? [`Ce să aduci: ${d.eventChecklist}`] : []),
        ...(d.checkinCode
          ? [`La ridicarea numărului de concurs arată codul QR de mai jos sau spune codul ${d.checkinCode}.`]
          : []),
        "Mai jos: înscrierea ta, „nu mai pot veni” și pagina evenimentului.",
      ],
      action: "Vezi înscrierea",
      image: (d: TemplateData) => (d.checkinQrUrl ? { url: d.checkinQrUrl, alt: `Cod QR ${d.checkinCode ?? ""}`, caption: `Codul tău: ${d.checkinCode ?? ""}` } : undefined),
      links: (d: TemplateData) => [
        ...(d.manageUrl ? [{ label: "Nu mai pot veni — anulez înscrierea", url: `${d.manageUrl}#cancel` }] : []),
        // The list switch, worded by the row (§143): the answer given on the form, reversible here.
        ...(d.listConsentUrl
          ? [{ label: d.listed === false ? "Vreau să apar pe lista publică de participanți" : "Nu vreau să apar pe lista publică de participanți", url: d.listConsentUrl }]
          : []),
        ...(d.eventUrl ? [{ label: "Pagina evenimentului", url: d.eventUrl }] : []),
        ...(d.eventScheduleUrl ? [{ label: "Programul evenimentului", url: d.eventScheduleUrl }] : []),
        ...(d.eventRulesUrl ? [{ label: "Regulamentul evenimentului", url: d.eventRulesUrl }] : []),
        // One line for the links (§332), never the links themselves: they live on the page.
        ...(d.eventLinksUrl ? [{ label: "Linkuri și fișiere: pe pagina evenimentului", url: d.eventLinksUrl }] : []),
        ...(d.declarationPdfUrl ? [{ label: "Declarația pe care ai semnat-o (PDF)", url: d.declarationPdfUrl }] : []),
      ],
    },
    eventReminder: {
      subject: "Ne vedem în curând — detaliile pentru ziua cursei",
      facts: (d: TemplateData) => eventFacts(d, { map: "Harta punctului de întâlnire", strava: "Evenimentul pe Strava" }),
      body: (d: TemplateData) => [
        // "Se apropie", never a number of days: a runner confirmed late gets this a day after confirming, nearer the start (§126, §357).
        `${d.eventTitle ?? "Evenimentul"} se apropie. Iată ce ai nevoie.`,
        // The programme is the facts block's own row now (§392), under the QR.
        ...(d.bibNumber ? [`Numărul tău de concurs: **${d.bibNumber}**.`] : []),
        ...(d.eventChecklist ? [`Ce să aduci: ${d.eventChecklist}`] : []),
        ...(d.checkinCode
          ? [`La masă arată codul QR de mai jos sau spune codul ${d.checkinCode}.`]
          : []),
        "Nu poți veni? Anulează înscrierea cu linkul de mai jos — locul tău merge la cineva de pe lista de așteptare.",
      ],
      action: "Nu pot veni — anulez înscrierea",
      image: (d: TemplateData) => (d.checkinQrUrl ? { url: d.checkinQrUrl, alt: `Cod QR ${d.checkinCode ?? ""}`, caption: `Codul tău: ${d.checkinCode ?? ""}` } : undefined),
      links: (d: TemplateData) => [
        ...(d.eventUrl ? [{ label: "Pagina evenimentului", url: d.eventUrl }] : []),
        ...(d.eventScheduleUrl ? [{ label: "Programul evenimentului", url: d.eventScheduleUrl }] : []),
        ...(d.eventRulesUrl ? [{ label: "Regulamentul evenimentului", url: d.eventRulesUrl }] : []),
        ...(d.eventLinksUrl ? [{ label: "Linkuri și fișiere: pe pagina evenimentului", url: d.eventLinksUrl }] : []),
      ],
    },
    eventThanks: {
      subject: "Mulțumim că ai alergat cu noi",
      body: (d: TemplateData) => [
        `Mulțumim că ai fost la ${d.eventTitle ?? "eveniment"}. Ne-a bucurat să te vedem la start.`,
        ...(d.thanksUrl ? ["Rezultatele și pozele sunt la linkul de mai jos."] : []),
        "Ne vedem la următoarea alergare.",
      ],
      action: "Rezultate și poze",
    },
    declarationSigned: {
      subject: "Declarația ta semnată",
      body: (d: TemplateData) => [
        `Atașată găsești declarația pe proprie răspundere pe care ai semnat-o pentru ${d.eventTitle ?? "eveniment"}${d.signedAtFormatted ? `, ${d.signedAtFormatted}` : ""}. Păstreaz-o: este copia ta.`,
        "Kitul de participare se ridică personal, pe baza actului de identitate scris în declarație.",
        "Dacă nu vezi atașamentul, același document este la linkul de mai jos.",
      ],
      action: "Gestionează înscrierea",
      links: (d: TemplateData) => (d.declarationPdfUrl ? [{ label: "Declarația semnată (PDF)", url: d.declarationPdfUrl }] : []),
    },
    bibAssigned: {
      subject: (d: TemplateData) => `Numărul tău de concurs: ${d.bibNumber ?? "—"}`,
      facts: (d: TemplateData) => eventFacts(d, { map: "Harta punctului de întâlnire", strava: "Evenimentul pe Strava" }),
      body: (d: TemplateData) => [
        `Ți-am dat numărul **${d.bibNumber ?? "—"}** la ${d.eventTitle ?? "eveniment"}. Îl ridici la masă în ziua cursei${d.checkinCode ? `, cu codul QR de mai jos sau spunând codul ${d.checkinCode}` : ""}.`,
        "Dacă ai primit deja un alt număr prin email, acesta îl înlocuiește.",
      ],
      action: "Vezi înscrierea",
      image: (d: TemplateData) => (d.checkinQrUrl ? { url: d.checkinQrUrl, alt: `Cod QR ${d.checkinCode ?? ""}`, caption: `Codul tău: ${d.checkinCode ?? ""}` } : undefined),
      links: (d: TemplateData) => [
        ...(d.manageUrl ? [{ label: "Nu mai pot veni — anulează-mi înscrierea", url: `${d.manageUrl}#cancel` }] : []),
        ...(d.eventUrl ? [{ label: "Pagina evenimentului", url: d.eventUrl }] : []),
      ],
    },
    declarationArchive: {
      // Searchable in the mailbox by who and for what: the subject carries both.
      subject: (d: TemplateData) => `Declarație semnată: ${d.participantName || "participant"} — ${d.eventTitle ?? "eveniment"}`,
      greeting: () => "Salut,",
      body: (d: TemplateData) => [
        `Atașată este declarația pe proprie răspundere semnată de ${d.participantName || "participant"} pentru ${d.eventTitle ?? "eveniment"}${d.signedAtFormatted ? `, ${d.signedAtFormatted}` : ""}.`,
        /*
          The PDF attached masks the identity document (§320); the sentence says how, how long the copy
          is kept — nothing sweeps a mailbox, so the email is where the reader learns when to delete
          it — and where the whole one is, until when (§419). Every period from `RETENTION`, never a literal.
        */
        `Copia pentru arhiva clubului, cu seria și numărul actului de identitate mascate (rămân cel mult primele două și ultimele două caractere). Păstreaz-o în căsuța clubului ${archivePeriod("ro")} de la eveniment, ca în nota de confidențialitate, apoi șterge-o de aici; documentul întreg este în PDF-ul cu toate declarațiile de pe pagina evenimentului din backoffice, până la ${identityDays("ro")} după eveniment.`,
      ],
    },
    groupRunDeclarationSigned: {
      // The signer's copy of a group run's optional self-declaration (§393): the PDF attached, no token.
      // A series' names the series (§523): «seria Tura de marți», valid for every run of it.
      subject: (d: TemplateData) =>
        `Declarația ta pe propria răspundere — ${d.groupRunSeries ? `seria ${d.eventTitle ?? "alergării de grup"}` : (d.eventTitle ?? "alergarea de grup")}`,
      body: (d: TemplateData) => [
        d.groupRunSeries
          ? `Atașată găsești declarația pe propria răspundere pe care ai semnat-o pentru seria de alergări de grup ${d.eventTitle ?? ""}${d.seriesRhythm ? ` (${d.seriesRhythm})` : ""}${d.signedAtFormatted ? `, ${d.signedAtFormatted}` : ""}. Păstreaz-o: este copia ta.`
          : `Atașată găsești declarația pe propria răspundere pe care ai semnat-o pentru ${d.eventTitle ?? "alergarea de grup"}${d.signedAtFormatted ? `, ${d.signedAtFormatted}` : ""}. Păstreaz-o: este copia ta.`,
        // One declaration for every run of the series (§523): a returning runner signs it once.
        d.groupRunSeries
          ? `Semnarea a fost opțională și nu te înscrie nicăieri: la alergare vii ca de obicei. Declarația este valabilă pentru toate alergările seriei, așa că nu o mai semnezi la următoarele; dacă organizatorul aprobă o versiune nouă a textului, pagina alergării ți-o cere din nou. Clubul păstrează declarația cât timp vii la alergări și o șterge când îi ceri.`
          : `Semnarea a fost opțională și nu te înscrie nicăieri: la alergare vii ca de obicei. Clubul păstrează declarația cât timp vii la alergări și o șterge când îi ceri.`,
      ],
      // The signer's own link (§523): the run's page says there that they have signed.
      action: "Vezi pe pagina alergării",
    },
    groupRunDeclarationArchive: {
      // The club's archive copy (§393, §99): searchable by who and for what; the document masked (§320).
      subject: (d: TemplateData) =>
        `Declarație semnată (alergare de grup): ${d.participantName || "alergător"} — ${d.groupRunSeries ? `seria ${d.eventTitle ?? ""}` : (d.eventTitle ?? "eveniment")}`,
      greeting: () => "Salut,",
      body: (d: TemplateData) => [
        d.groupRunSeries
          ? `Atașată este declarația pe propria răspundere semnată de ${d.participantName || "un alergător"} pentru seria de alergări de grup ${d.eventTitle ?? ""}${d.seriesRhythm ? ` (${d.seriesRhythm})` : ""}${d.signedAtFormatted ? `, ${d.signedAtFormatted}` : ""}. Este valabilă pentru toate alergările seriei.`
          : `Atașată este declarația pe propria răspundere semnată de ${d.participantName || "un alergător"} pentru alergarea de grup ${d.eventTitle ?? ""}${d.signedAtFormatted ? `, ${d.signedAtFormatted}` : ""}.`,
        /*
          The legitimate-interest, three-year choice of the notice, and the right to object (§419) —
          counted from the signing since §523: a series' declaration covers every run of it, so "from
          the run" named no one day.
        */
        `Copia pentru arhiva clubului. Păstreaz-o în căsuța clubului ${archivePeriod("ro")} de la semnare, ca în nota de confidențialitate, apoi șterge-o de aici, cu copiile ei; dacă alergătorul se opune și nu avem un motiv legitim mai puternic, șterge-o mai devreme. Declarația întreagă este în backoffice, pe pagina evenimentului, la „Declarații semnate (alergare de grup)”, cât timp alergătorul vine la alergări; când cere ștergerea ei, o ștergi de acolo, cu motivul, și copia de aici.`,
      ],
    },
    clubConfirmationNotice: {
      // Searchable in the club's mailbox by who and for what, like the archive copy above.
      subject: (d: TemplateData) => `Înscriere confirmată: ${d.participantName || "participant"} — ${d.eventTitle ?? "eveniment"}`,
      greeting: () => "Salut,",
      body: (d: TemplateData) => [
        `${d.participantName || "Un participant"} și-a confirmat înscrierea la ${d.eventTitle ?? "eveniment"}${d.eventStartsAtFormatted ? `, ${d.eventStartsAtFormatted}` : ""}.${d.bibNumber ? ` Numărul de concurs: ${d.bibNumber}.` : ""}`,
        "Mesaj pentru club: lista completă, filtrele și exportul sunt în backoffice, la Înscrieri. Participantul a primit confirmarea lui separat.",
      ],
    },
    staffInvitation: {
      subject: `Ești în echipa ${CLUB_NAME}`,
      body: (d: TemplateData) => [
        `${d.inviterName || "Un coleg"} te-a adăugat în echipa care administrează site-ul ${CLUB_NAME}, ca ${d.staffRole ?? "membru al echipei"}.`,
        `Intri cu adresa ${d.staffEmail ?? "aceasta"}: dacă nu ai încă un cont, îl faci din pagina de autentificare, cu exact această adresă (contul e legat de adresă). Accesul începe la prima autentificare.`,
        // What the club keeps about its own team (§323), said to the person it is kept about.
        "Pentru cont folosim Zitadel, cu numele și adresa ta; ce faci în backoffice rămâne în jurnalul clubului, cu numele tău, cel mult trei ani. Detalii în nota de confidențialitate.",
      ],
      action: "Intră în backoffice",
      links: (d: TemplateData) => (d.privacyUrl ? [{ label: "Nota de confidențialitate", url: d.privacyUrl }] : []),
    },
    registrationOpened: {
      // To an address, not a participant (§146): the greeting names nobody.
      subject: (d: TemplateData) => `Înscrierile la ${d.eventTitle ?? "eveniment"} s-au deschis`,
      greeting: () => "Salut,",
      facts: (d: TemplateData) => eventFacts(d, { map: "Harta punctului de întâlnire", strava: "Evenimentul pe Strava" }),
      body: (d: TemplateData) => [
        `Înscrierile la ${d.eventTitle ?? "eveniment"} s-au deschis. Te poți înscrie cu butonul de mai jos.`,
        "Primești acest mesaj pentru că ai cerut, pe pagina evenimentului, să fii anunțat când se deschid înscrierile. E singurul: adresa ta a fost ștearsă din lista de anunțare odată cu trimiterea lui.",
      ],
      action: "Înscrie-te",
      links: (d: TemplateData) => [
        ...(d.eventUrl ? [{ label: "Pagina evenimentului", url: d.eventUrl }] : []),
        ...(d.eventRulesUrl ? [{ label: "Regulamentul evenimentului", url: d.eventRulesUrl }] : []),
      ],
    },
    registrationCancelled: {
      subject: "Înscrierea a fost anulată",
      body: (d: TemplateData) => [`Înscrierea ta la ${d.eventTitle ?? "eveniment"} a fost anulată.`],
    },
    waitlistOfferExpired: {
      subject: "Timpul pentru confirmarea locului a expirat",
      body: (d: TemplateData) => [
        `Timpul disponibil pentru a confirma locul eliberat la ${d.eventTitle ?? "eveniment"} a expirat. Rămâi pe lista de așteptare și te vom anunța dacă se mai eliberează un loc.`,
      ],
    },
    registrationManageLink: {
      subject: "Linkul tău de gestionare a înscrierii",
      body: () => ["Iată linkul cu care poți vedea sau anula înscrierea ta."],
      action: "Gestionează înscrierea",
    },
    profileManageLink: {
      subject: `Înscrierile tale la ${CLUB_NAME}`,
      body: (d: TemplateData) => [
        "Iată linkul cu care vezi toate înscrierile tale active: starea fiecăreia, codul de acces și codul QR pentru ziua cursei, și posibilitatea de a renunța.",
        `Linkul este valabil ${d.linkLifetime ?? defaultLinkLifetime("ro")} și doar pentru tine.`,
      ],
      action: "Vezi înscrierile mele",
    },
    registrationStateNotice: {
      subject: "Starea înscrierii tale",
      body: (d: TemplateData) => [
        `Înscrierea ta la ${d.eventTitle ?? "eveniment"} are starea: ${d.currentStatus ?? "necunoscută"}.`,
      ],
    },
    eventUpdateNotice: {
      subject: (d: TemplateData) => `Detalii actualizate pentru ${d.eventTitle ?? "eveniment"}`,
      facts: (d: TemplateData) => eventFacts(d, { map: "Harta punctului de întâlnire", strava: "Evenimentul pe Strava" }),
      body: (d: TemplateData) => [
        `Organizatorii au actualizat detaliile pentru ${d.eventTitle ?? "evenimentul"} la care ești înscris.`,
        // A way out when the change does not suit, so the place goes to the waiting list (§419).
        "Înscrierea ta rămâne valabilă și nu trebuie să faci nimic. Dacă noua dată sau noul loc nu ți se potrivește, renunță la înscriere din „Înscrierile mele” (linkul de mai jos), ca locul să treacă la altcineva. Detaliile la zi sunt pe pagina evenimentului.",
      ],
      action: "Vezi pagina evenimentului",
      links: (d: TemplateData) => (d.myRegistrationsUrl ? [{ label: "Înscrierile mele (îți trimitem linkul pe email)", url: d.myRegistrationsUrl }] : []),
    },
    eventCancelled: {
      // Without a title the sentence names no event — never the club's name standing in for one (§357).
      subject: (d: TemplateData) => (d.eventTitle ? `Evenimentul „${d.eventTitle}” a fost anulat` : "Evenimentul a fost anulat"),
      body: (d: TemplateData) => [
        `Ne pare rău: evenimentul${d.eventTitle ? ` „${d.eventTitle}”` : ""}${d.eventStartsAtFormatted ? `, programat ${d.eventStartsAtFormatted},` : ""} a fost anulat.`,
        "Înscrierea ta rămâne la noi ca înregistrare și nu trebuie să faci nimic: nu e nevoie să o anulezi.",
        `Pentru întrebări, scrie-ne din pagina de contact (linkul „Scrie-ne” de mai jos)${d.replyTo ? " sau răspunde la acest email" : ""}.`,
      ],
    },
    /**
     * "Trimite un mesaj participanților" (§364): the organizer's subject and body, written for this
     * send; the platform adds only the facts line, one sentence saying who writes and why this
     * person receives it, the event's page as the button and the usual links. Nothing to act on.
     */
    organizerMessage: {
      // Without a title the sentences name no event — never the club's name standing in for one (§357).
      subject: (d: TemplateData) => organizerSubject(d, d.eventTitle ? `Un mesaj despre ${d.eventTitle}` : "Un mesaj despre evenimentul la care te-ai înscris"),
      facts: (d: TemplateData) => eventFacts(d, { map: "Harta punctului de întâlnire", strava: "Evenimentul pe Strava" }),
      body: (d: TemplateData) => [
        d.eventTitle
          ? `Un mesaj de la organizatorii evenimentului ${d.eventTitle}, la care te-ai înscris:`
          : "Un mesaj de la organizatorii evenimentului la care te-ai înscris:",
      ],
      action: "Vezi pagina evenimentului",
      links: (d: TemplateData) => (d.myRegistrationsUrl ? [{ label: "Înscrierile mele (îți trimitem linkul pe email)", url: d.myRegistrationsUrl }] : []),
    },
    /**
     * The form sent again from a registered address, for a different person (§389, §446): nobody
     * was registered yet, and this is the address's answer. Two shapes: the question, with one
     * button that confirms the person the form named — who the address holds and who that person
     * is are lines the platform adds before these words (`familyLines`); or, when the address
     * already carries the club's limit at the event, the sentence that says so and no button.
     * Addressed to the inbox, not to one runner — a parent reads it as often as the runner does —
     * so the greeting names nobody.
     */
    registerAnotherPerson: {
      subject: (d: TemplateData) =>
        d.addressAtCap
          ? `Adresa ta are deja numărul maxim de înscrieri la ${d.eventTitle ?? "eveniment"}`
          : d.familyEntryGone
            ? `Cererea de a înscrie încă o persoană la ${d.eventTitle ?? "eveniment"} nu mai este valabilă`
            : `Înscrii încă o persoană la ${d.eventTitle ?? "eveniment"}?`,
      greeting: () => "Salut,",
      body: (d: TemplateData) =>
        d.addressAtCap
          ? [
              `Formularul de înscriere la ${d.eventTitle ?? "eveniment"} a fost trimis din nou cu această adresă și un alt nume. Nu am înscris pe nimeni: pe o adresă de email se pot înscrie cel mult ${peoplePhrase("ro", d.addressCap)} la un eveniment, iar adresa ta le are deja.`,
              "Pentru încă o persoană, folosește adresa ei de email. Dacă cineva de pe adresa ta nu mai vine, îi anulezi înscrierea din linkul primit la confirmare sau din „Înscrierile mele”, și locul de pe adresă se eliberează.",
              "Dacă nu tu ai trimis formularul, poți ignora acest mesaj: nu s-a schimbat nimic.",
            ]
          : d.familyEntryGone
            ? [
                `Formularul de înscriere la ${d.eventTitle ?? "eveniment"} a fost trimis din nou cu această adresă, pentru o altă persoană, dar cererea nu mai este valabilă: a fost deja confirmată sau a expirat, iar datele trimise s-au șters.`,
                "Dacă persoana nu este încă înscrisă, trimite din nou formularul cu numele ei complet și data nașterii: primești un email nou, cu un buton de confirmare.",
                "Dacă nu tu ai trimis formularul, poți ignora acest mesaj: nu s-a schimbat nimic.",
              ]
            : [
              // One line to open, the facts in the box above (§468); the consent line keeps the privacy link (§419; GDPR art. 14).
              "Formularul a fost trimis din nou cu această adresă, pentru o altă persoană — nu am înscris-o încă: confirmă cu primul buton sau renunță cu al doilea.",
              "Dacă nu tu ai trimis formularul, ignoră mesajul: nu se înscrie nimeni, iar datele se șterg singure când linkul expiră.",
              "Înscrie pe cineva doar cu acordul lui și spune-i cum îi folosim datele: nota de confidențialitate e la linkul de la sfârșitul mesajului.",
            ],
      action: "Confirm că înscriu altă persoană",
    },
    /**
     * The newsletter's one message to an address left in the contact page's pop-up (§445): the
     * double opt-in's link, or — for an address already subscribed — the link to its own page, and
     * nothing changed. To an address, not a person: the greeting names nobody.
     */
    newsletterConfirm: {
      subject: (d: TemplateData) => (d.newsletterAlready ? `Abonamentul tău la noutățile ${CLUB_NAME}` : `Confirmă abonarea la noutățile ${CLUB_NAME}`),
      greeting: () => "Salut,",
      body: (d: TemplateData) =>
        d.newsletterAlready
          ? [
              "Cineva — probabil tu — a cerut din nou, pe pagina noastră de contact, noutățile clubului pe această adresă. Ești deja abonat(ă), așa că nu s-a schimbat nimic.",
              "Cu butonul de mai jos vezi temele alese; acolo le poți schimba sau te poți dezabona.",
            ]
          : [
              "Ai cerut, pe pagina noastră de contact, să primești noutățile clubului pe această adresă.",
              "Confirmă abonarea cu butonul de mai jos. Până nu confirmi nu îți trimitem nimic altceva, iar dacă nu confirmi, adresa se șterge.",
            ],
      action: (d: TemplateData) => (d.newsletterAlready ? "Vezi abonamentul" : "Confirmă abonarea"),
    },
    /** A newsletter the club wrote (§445): its own subject and body, the link to choose topics or unsubscribe. */
    newsletter: {
      subject: (d: TemplateData) => d.newsletterSubject ?? `Noutăți de la ${CLUB_NAME}`,
      greeting: () => "Salut,",
      body: () => [],
    },
    /** "A new event is on the calendar" (§445), from the maintenance job, to the subscribers of its topics. */
    newEventAlert: {
      subject: (d: TemplateData) => (d.eventTitle ? `Eveniment nou în calendar: ${d.eventTitle}` : "Un eveniment nou în calendarul clubului"),
      greeting: () => "Salut,",
      facts: (d: TemplateData) => eventFacts(d, { map: "Harta punctului de întâlnire", strava: "Evenimentul pe Strava" }),
      body: (d: TemplateData) => [
        `${d.eventTitle ?? "Un eveniment nou"} e acum în calendarul clubului. Tot ce ține de el — programul, traseul și, unde e cazul, înscrierea — e pe pagina lui.`,
      ],
      action: "Vezi evenimentul",
    },
    /** The newsletter's own lines (§445), which the platform adds whoever wrote the words above them. */
    newsletterWords: {
      topics: (topics: string) => `Primești noutățile clubului despre: ${topics}.`,
      link: (lifetime: string) => `Linkul este valabil ${lifetime} și se poate folosi o singură dată. Dacă nu tu ai cerut, ignoră acest mesaj.`,
      manage: "Alege ce primești sau dezabonează-te",
    },
    /** What the update and the cancellation add around the club's words (§331): the facts named as new, the labels of the organizer's text. */
    noticeWords: {
      place: (d: TemplateData) => (d.eventLocationName ? `Locul de întâlnire este acum: ${d.eventLocationName}.` : "Locul de întâlnire s-a schimbat — îl găsești pe pagina evenimentului."),
      time: (d: TemplateData) =>
        d.eventStartsAtFormatted
          ? `Data și ora sunt acum: ${d.eventStartsAtFormatted}${d.eventRaceStartsAtFormatted ? `; startul cursei la ${d.eventRaceStartsAtFormatted}` : ""}.`
          : "Data sau ora s-au schimbat — le găsești pe pagina evenimentului.",
      programme: (d: TemplateData) =>
        d.eventProgramme?.length ? `Programul actualizat: ${d.eventProgramme.join("; ")}.` : "Programul s-a schimbat — îl găsești pe pagina evenimentului.",
      reinstated: () => "Evenimentul nu mai este anulat: are loc.",
      noteLabel: "Mesajul organizatorilor:",
      reasonLabel: "Motivul:",
    },
    closing: "Alergare plăcută,",
    /**
     * In front of a message re-sent because the form was filled in again (§235, §286).
     *
     * The owner: "cand omul se re-inscrie cu acelasi mail, trebuie sa ii dam un mesaj mai clar,
     * gen «ne bucuram ca esti entuziasmat dar esti deja inscris cu numaru ...»". Filling the form
     * twice is enthusiasm, not a mistake, and the sentence says so — then answers the question
     * that was actually being asked, which is "am I in?". The number is named when there is one,
     * because that is the fact somebody is hunting for; it is safe here and nowhere else, since
     * only the owner of the address reads it (§19.4).
     */
    alreadyRegistered: (bib?: number | null) =>
      bib
        ? `Ne bucurăm că ești nerăbdător! __Ești deja înscris__ la acest eveniment, cu numărul ${bib} — nu s-a creat o a doua înscriere. Mai jos este înscrierea pe care o ai.`
        : "Ne bucurăm că ești nerăbdător! __Ești deja înscris__ la acest eveniment, așa că nu s-a creat o a doua înscriere — mai jos este înscrierea pe care o ai deja.",
    /** Appended when the number in this message can still change (§237). */
    bibProvisional: (n: number) =>
      `Numărul ${n} este provizoriu — îl confirmăm când se închid înscrierile și îți trimitem numărul final.`,
    /**
     * The reminder of a night event (§394), after the body whoever wrote it — «Alergare de
     * noapte» on a group run (the owner calls a run a run, not an "event"), «Eveniment de
     * noapte» on every other type.
     */
    nightEvent: (night: NightReminderLine) => {
      const label = night.isGroupRun ? "Alergare de noapte" : "Eveniment de noapte";
      if (!night.sunset) return `${label}: ia o frontală.`;
      // Every time named, the start first (§404): «începe la 19:00, apusul la 19:00» is not «apusul începe» — the same wording as the pill and the calendar (§404 nit).
      const start = night.start ? `începe la ${night.start}, ` : "";
      if (night.sunrise) return `${label}: ${start}înainte de răsăritul de la ${night.sunrise}. Ia o frontală.`;
      if (night.after) return `${label}: ${start}după apusul de la ${night.sunset}. Ia o frontală.`;
      const end = night.end ? (night.endSource === "programme" ? `, ultimul punct din program la ${night.end}` : `, se termină la ${night.end}`) : "";
      return `${label}: ${start}apusul la ${night.sunset}${end}. Ia o frontală.`;
    },
    /** After the body of the link for another person (§389): the club's limit, whoever wrote the words. */
    addressCapLine: (cap: number) => `Pe o adresă de email se pot înscrie cel mult ${peoplePhrase("ro", cap)} la un eveniment.`,
    /**
     * Before the body of the confirmation for another person (§446): who the address holds at the
     * event, and who the form named — facts of this send, whoever wrote the words around them.
     */
    familyFacts: (f: FamilyFactsInput): FamilyFact[] => [
      ...(f.event ? [{ label: "Evenimentul", value: [{ text: f.when ? `${f.event}, ${f.when}` : f.event, bold: true }] }] : []),
      { label: "Înscriși deja cu această adresă", value: [{ text: f.registered.length > 0 ? f.registered.join(", ") : "nimeni în acest moment", bold: true }] },
      { label: "Persoana din formular", value: [{ text: f.name, bold: true }] },
      ...(formatBirthDate(f.birthDate, "ro") ? [{ label: "Data nașterii", value: [{ text: formatBirthDate(f.birthDate, "ro"), bold: true }] }] : []),
      { label: "Ce se întâmplă dacă apeși", value: [{ text: "primește propriul loc", bold: true }, { text: ", propriul email cu declarația și propriul cod QR, pe această adresă" }] },
      { label: "Termen", value: [{ text: "linkul e valabil " }, { text: f.hours, bold: true }, { text: " și se folosește o singură dată" }] },
      ...(f.cap !== undefined
        ? [{ label: "Limita", value: [{ text: "cel mult " }, { text: peoplePhrase("ro", f.cap), bold: true }, { text: " pe o adresă, la un eveniment" }] }]
        : []),
    ],
    /**
     * A family sitting's one message (§519): everybody the forms of one sitting named, one button for
     * all of them, and the address's own page beside it. The platform's words: the message's facts are
     * the sitting's, and a club text for the single-person link would promise the wrong button.
     */
    familySitting: {
      subject: (d: TemplateData) => `Înscriere de familie: ${peoplePhrase("ro", d.familySittingPeople?.length ?? 1)} la ${d.eventTitle ?? "eveniment"}`,
      facts: (f: FamilySittingFactsInput): FamilyFact[] => [
        ...(f.event ? [{ label: "Evenimentul", value: [{ text: f.when ? `${f.event}, ${f.when}` : f.event, bold: true }] }] : []),
        ...f.people.map((person, index) => ({
          label: `Persoana ${index + 1} din ${f.people.length}`,
          value: [
            { text: person.name, bold: true },
            ...(formatBirthDate(person.birthDate, "ro") ? [{ text: ", data nașterii " }, { text: formatBirthDate(person.birthDate, "ro"), bold: true }] : []),
          ],
        })),
        ...(f.registered.length > 0 ? [{ label: "Înscriși deja cu această adresă", value: [{ text: f.registered.join(", "), bold: true }] }] : []),
        {
          label: "Ce se întâmplă dacă apeși",
          value: [
            { text: "confirmi adresa și toate înscrierile deodată", bold: true },
            { text: "; semnezi apoi declarațiile pe loc, una după alta, iar fiecare persoană primește propriul loc și propriul cod QR, pe această adresă" },
          ],
        },
        { label: "Termen", value: [{ text: "linkul e valabil " }, { text: f.hours, bold: true }, { text: " și se folosește o singură dată" }] },
        ...(f.cap !== undefined
          ? [{ label: "Limita", value: [{ text: "cel mult " }, { text: peoplePhrase("ro", f.cap), bold: true }, { text: " pe o adresă, la un eveniment" }] }]
          : []),
      ],
      body: (): string[] => [
        "Formularul de înscriere a fost trimis de pe această adresă pentru persoanele de mai sus. Nu am înscris încă pe nimeni: un singur buton confirmă adresa și toată familia.",
        "Cineva din listă nu trebuie înscris? Îl debifezi pe pagina care se deschide. Dacă nu tu ai trimis formularul, ignoră mesajul: nu se înscrie nimeni, iar datele se șterg singure când linkul expiră.",
        "Înscrie pe cineva doar cu acordul lui și spune-i cum îi folosim datele: nota de confidențialitate e la linkul de la sfârșitul mesajului.",
      ],
      action: (count: number) => `Confirm și semnez declarațiile (${count})`,
      mine: "Toate înscrierile mele",
    },
    /** A family's one confirmation (§519): everybody's QR code, desk code and race number, one block each. */
    familyConfirmed: {
      subject: (d: TemplateData) => `Confirmat: ${peoplePhrase("ro", d.familyConfirmed?.length ?? 1)} la ${d.eventTitle ?? "eveniment"}`,
      body: (d: TemplateData): string[] => [
        `Înscrierile de mai jos la ${d.eventTitle ?? "eveniment"} sunt confirmate. Vă așteptăm!`,
        "La masa de înscrieri, fiecare persoană arată codul QR de sub numele ei sau spune codul.",
        ...(d.eventChecklist ? [`Ce să aduceți: ${d.eventChecklist}`] : []),
      ],
      words: {
        number: "Număr de concurs",
        provisional: "(provizoriu: se stabilește la închiderea înscrierilor)",
        noNumber: "încă fără număr",
        code: "Codul pentru masă",
        qr: "Cod QR",
      },
      action: "Toate înscrierile mele",
    },
    /** The family link's second button (§468): the kept form deleted, nobody registered. */
    familyDecline: "Nu înscriu această persoană",
    /** Under "you are already registered", on a re-send for a slip (§446): the one way to register somebody else. */
    anotherPersonHint: "Dacă vrei să înscrii pe altcineva, trimite formularul cu numele complet și data de naștere a acelei persoane.",
    /** In its place when the slip was another name on a registered birth date (§493): how twins are registered. */
    sameBirthDateHint:
      "Pe aceeași adresă de email nu pot fi înscrise din formular două persoane născute în aceeași zi. Pentru un frate geamăn sau o soră geamănă, trimite formularul de pe altă adresă de email, ori răspunde la acest email și facem noi înscrierea.",
    /** After the body of a declaration request, on an address with more to sign (§471): the one link signs them all. */
    familyToSign: (names: readonly string[]) =>
      `Pe această adresă mai așteaptă semnătura declarațiile pentru: ${names.join(", ")}. Le poți semna pe toate din acest link, una după alta: câte o persoană la fiecare pas.`,
    footer: "Răspunde la acest email pentru întrebări.",
    /** The club's copy of a participant's message (§320): in front of the subject, and the first line. */
    clubCopy: {
      subject: "[Copie club] ",
      note: "Copie pentru club a mesajului trimis participantului. Legăturile personale, codul QR și atașamentele au fost scoase.",
      /** A bulk send's one copy (§419): how many received it, and nobody's name. */
      bulkNote: (count: number) =>
        `Copie pentru club a mesajului trimis la ${participantsPhrase("ro", count)}, fiecăruia în limba înscrierii lui. Numele destinatarilor nu apar aici, iar legăturile personale au fost scoase.`,
      /** A newsletter's or a new-event alert's one copy (§445): how many subscribers, and no address. */
      subscribersNote: (count: number) =>
        `Copie pentru club a mesajului trimis la ${subscribersPhrase("ro", count)} la noutăți, fiecăruia în limba aleasă. Adresele destinatarilor nu apar aici, iar linkul personal de dezabonare a fost scos.`,
    },
    /** The greeting of a message addressed to nobody by name — a bulk send's club copy (§419). */
    hello: "Salut,",
    /** Under the parent's or guardian's greeting on a minor's registration (§419). */
    guardianIntro: (participant: string) => `Mesajul privește înscrierea pe care ai făcut-o, ca părinte sau tutore, pentru ${participant}.`,
    /** Who signs a minor's declaration (§419, §330): both when the text in force asks the minor too. */
    minorSigners: (participant: string, both: boolean) =>
      both
        ? `Declarația o semnați amândoi, tu ca părinte sau tutore și ${participant}, fiecare cu actul lui de identitate; țineți-le pe amândouă la îndemână.`
        : `Declarația o semnezi tu, ca părinte sau tutore, pentru ${participant}.`,
    /** A group run's signer's copy (§419): the document masked, and the way out for a declaration one did not sign. */
    groupRunMasked: "În copia ta, seria și numărul actului de identitate apar mascate, pentru siguranță: adresa de e-mail nu a fost verificată înainte de trimitere.",
    groupRunNotYou: (contactUrl?: string) =>
      `Dacă nu tu ai semnat această declarație, scrie-ne din pagina de contact${contactUrl ? ` (${contactUrl})` : ""} și o ștergem.`,
    /**
     * Who sends it, and the notice (§323); the address follows the sentence. Neutral since §419: the
     * registration may be somebody else's made with this address — a child's, a family member's (§389).
     */
    privacyFooter: (club: string) => `Primești acest mesaj de la ${club} pentru o înscriere făcută cu această adresă de e-mail. Cum folosim datele:`,
    /** The same for "registration is open" (§146), which answers a request, not a registration. */
    privacyFooterInterest: (club: string) =>
      `Primești acest mesaj de la ${club} pentru că ai cerut să fii anunțat. Cum folosim datele tale:`,
    /** The same for a group run's self-declaration (§393): signed on a page, no registration behind it. */
    privacyFooterDeclaration: (club: string) =>
      `Primești acest mesaj de la ${club} pentru că ai semnat o declarație pe site-ul clubului. Cum folosim datele tale:`,
    /** The same for the newsletter (§445): a consent the person gave, withdrawn from the link above. */
    privacyFooterNewsletter: (club: string) =>
      `Primești acest mesaj de la ${club} pentru că ai cerut noutățile clubului pe această adresă. Te dezabonezi oricând din linkul de mai sus. Cum folosim datele tale:`,
  },
  en: {
    hi: (name: string) => `Hi ${name},`,
    moreLinks: {
      event: "The event's page",
      rules: "The event's rules",
      schedule: "The event's programme",
      manage: "My registrations",
      events: "All our events",
      contact: "Write to us",
    },
    verify: {
      subject: "Confirm your email address",
      body: (d: TemplateData) => [
        `We have received a registration for ${d.eventTitle ?? "an event"} in the name of ${d.participantName}, sent with this email address. To continue, confirm the address.`,
        `The link is valid for ${d.confirmationHours ?? hoursPhrase("en", DEFAULT_DEADLINES.confirmationHours)}; if you do not confirm your address by then, the registration expires.`,
        `The details in this registration were sent to us by whoever filled in the form with this address. If that was not ${d.participantName}, show them this message: how we use the details is in the privacy notice, linked at the end of this message. If ${d.participantName} does not want to take part, do not confirm: the registration lapses by itself.`,
        "If you did not request this registration, you can ignore this message.",
      ],
      action: "Confirm your email",
    },
    completeDeclaration: {
      subject: (d: TemplateData) =>
        d.confirmLater
          ? `You are registered — confirm your participation by ${d.holdExpiresAtFormatted ?? "the deadline"}`
          : "A place is waiting — sign the declaration",
      body: (d: TemplateData) => [
        d.confirmLater
          ? `Your place at ${d.eventTitle ?? "the event"} is held. Your registration is complete only once you sign the declaration of own responsibility. ${d.windowOpen ? "Sign now, from the link below." : `You can sign now, from the link below, or when we remind you ${d.confirmationOpens ? `${d.confirmationOpens} before the start` : "before the start"}.`}`
          : `A place at ${d.eventTitle ?? "the event"} is held for you. The registration is complete only with the signed declaration of own responsibility — read and sign it from the link below.`,
        `If you do not get to it online, you sign the declaration on paper at the registration desk on race day, before picking up your number.${d.holdExpiresAtFormatted ? ` If a waiting list forms, the place is held for you until ${d.holdExpiresAtFormatted}; sign before then.` : ""}`,
      ],
      action: "Sign the declaration",
      links: (d: TemplateData) => (d.eventRulesUrl ? [{ label: "The event's rules", url: d.eventRulesUrl }] : []),
    },
    waitlistJoined: {
      subject: "You're on the waiting list",
      body: (d: TemplateData) => [
        `${d.eventTitle ?? "The event"} is full right now, so we added you to the waiting list. We'll let you know if a place opens up.`,
      ],
    },
    waitlistSpotOffer: {
      subject: "A place has opened up for you",
      body: (d: TemplateData) => [
        d.holdExpiresAtFormatted
          ? `A place has opened up at ${d.eventTitle ?? "the event"}. It is yours if you sign the self-declaration by ${d.holdExpiresAtFormatted} (you have ${d.offerHours ?? hoursPhrase("en", DEFAULT_DEADLINES.offerHours)}); after that, the place passes to the next person on the waiting list.`
          : `A place has opened up at ${d.eventTitle ?? "the event"}. You have ${d.offerHours ?? hoursPhrase("en", DEFAULT_DEADLINES.offerHours)} from the offer to sign the self-declaration; after that, the place passes to the next person on the waiting list.`,
      ],
      action: "Confirm the place",
    },
    eventReminder: {
      subject: "See you soon — the details for race day",
      facts: (d: TemplateData) => eventFacts(d, { map: "Map of the meeting point", strava: "The event on Strava" }),
      body: (d: TemplateData) => [
        `${d.eventTitle ?? "The event"} is coming up. Here is what you need.`,
        ...(d.bibNumber ? [`Your race number: **${d.bibNumber}**.`] : []),
        ...(d.eventChecklist ? [`What to bring: ${d.eventChecklist}`] : []),
        ...(d.checkinCode ? [`At the desk show the QR code below or say the code ${d.checkinCode}.`] : []),
        "Can't come? Cancel with the link below — your place goes to somebody on the waiting list.",
      ],
      action: "I can't come — cancel my registration",
      image: (d: TemplateData) => (d.checkinQrUrl ? { url: d.checkinQrUrl, alt: `QR code ${d.checkinCode ?? ""}`, caption: `Your code: ${d.checkinCode ?? ""}` } : undefined),
      links: (d: TemplateData) => [
        ...(d.eventUrl ? [{ label: "The event's page", url: d.eventUrl }] : []),
        ...(d.eventScheduleUrl ? [{ label: "The event's programme", url: d.eventScheduleUrl }] : []),
        ...(d.eventRulesUrl ? [{ label: "The event's rules", url: d.eventRulesUrl }] : []),
        ...(d.eventLinksUrl ? [{ label: "Links and files: on the event's page", url: d.eventLinksUrl }] : []),
      ],
    },
    eventThanks: {
      subject: "Thank you for running with us",
      body: (d: TemplateData) => [
        `Thank you for being at ${d.eventTitle ?? "the event"}. It was good to see you at the start.`,
        ...(d.thanksUrl ? ["The results and the photos are at the link below."] : []),
        "See you at the next run.",
      ],
      action: "Results and photos",
    },
    declarationSigned: {
      subject: "Your signed declaration",
      body: (d: TemplateData) => [
        `Attached is the declaration of own responsibility you signed for ${d.eventTitle ?? "the event"}${d.signedAtFormatted ? `, on ${d.signedAtFormatted}` : ""}. Keep it: it is your copy.`,
        "The race kit is collected in person, against the identity document written in the declaration.",
        "If you cannot see the attachment, the same document is at the link below.",
      ],
      action: "Manage your registration",
      links: (d: TemplateData) => (d.declarationPdfUrl ? [{ label: "Signed declaration (PDF)", url: d.declarationPdfUrl }] : []),
    },
    bibAssigned: {
      subject: (d: TemplateData) => `Your race number: ${d.bibNumber ?? "—"}`,
      facts: (d: TemplateData) => eventFacts(d, { map: "Map of the meeting point", strava: "The event on Strava" }),
      body: (d: TemplateData) => [
        `You have number **${d.bibNumber ?? "—"}** at ${d.eventTitle ?? "the event"}. Collect it at the desk on race day${d.checkinCode ? `, with the QR code below or by saying the code ${d.checkinCode}` : ""}.`,
        "If an earlier email gave you a different number, this one replaces it.",
      ],
      action: "See your registration",
      image: (d: TemplateData) => (d.checkinQrUrl ? { url: d.checkinQrUrl, alt: `QR code ${d.checkinCode ?? ""}`, caption: `Your code: ${d.checkinCode ?? ""}` } : undefined),
      links: (d: TemplateData) => [
        ...(d.manageUrl ? [{ label: "I can't make it any more — cancel my registration", url: `${d.manageUrl}#cancel` }] : []),
        ...(d.eventUrl ? [{ label: "The event's page", url: d.eventUrl }] : []),
      ],
    },
    declarationArchive: {
      subject: (d: TemplateData) => `Signed declaration: ${d.participantName || "participant"} — ${d.eventTitle ?? "event"}`,
      greeting: () => "Hello,",
      body: (d: TemplateData) => [
        `Attached is the declaration of own responsibility signed by ${d.participantName || "participant"} for ${d.eventTitle ?? "the event"}${d.signedAtFormatted ? `, on ${d.signedAtFormatted}` : ""}.`,
        `The club's archive copy, with the identity document's series and number masked (at most the first two and last two characters remain). Keep it in the club's mailbox for ${archivePeriod("en")} from the event, as the privacy notice says, then delete it from here; the full document is in the event's declarations PDF in the backoffice until ${identityDays("en")} after the event.`,
      ],
    },
    groupRunDeclarationSigned: {
      subject: (d: TemplateData) =>
        `Your self-declaration — ${d.groupRunSeries ? `${d.eventTitle ?? "the group run"} (series)` : (d.eventTitle ?? "the group run")}`,
      body: (d: TemplateData) => [
        d.groupRunSeries
          ? `Attached is the self-declaration you signed for the group run series ${d.eventTitle ?? ""}${d.seriesRhythm ? ` (${d.seriesRhythm})` : ""}${d.signedAtFormatted ? `, on ${d.signedAtFormatted}` : ""}. Keep it: it is your copy.`
          : `Attached is the self-declaration you signed for ${d.eventTitle ?? "the group run"}${d.signedAtFormatted ? `, on ${d.signedAtFormatted}` : ""}. Keep it: it is your copy.`,
        d.groupRunSeries
          ? `Signing it was optional and registers you for nothing: come to the run as usual. The declaration is valid for every run of the series, so you do not sign it again for the next ones; if the organiser approves a new version of the text, the run's page asks you for it again. The club keeps the declaration while you keep coming to the runs and deletes it when you ask.`
          : `Signing it was optional and registers you for nothing: come to the run as usual. The club keeps the declaration while you keep coming to the runs and deletes it when you ask.`,
      ],
      action: "See it on the run's page",
    },
    groupRunDeclarationArchive: {
      subject: (d: TemplateData) =>
        `Signed declaration (group run): ${d.participantName || "runner"} — ${d.groupRunSeries ? `${d.eventTitle ?? ""} (series)` : (d.eventTitle ?? "event")}`,
      greeting: () => "Hello,",
      body: (d: TemplateData) => [
        d.groupRunSeries
          ? `Attached is the self-declaration signed by ${d.participantName || "a runner"} for the group run series ${d.eventTitle ?? ""}${d.seriesRhythm ? ` (${d.seriesRhythm})` : ""}${d.signedAtFormatted ? `, on ${d.signedAtFormatted}` : ""}. It is valid for every run of the series.`
          : `Attached is the self-declaration signed by ${d.participantName || "a runner"} for the group run ${d.eventTitle ?? ""}${d.signedAtFormatted ? `, on ${d.signedAtFormatted}` : ""}.`,
        `The club's archive copy. Keep it in the club's mailbox for ${archivePeriod("en")} from the signing, as the privacy notice says, then delete it from here, with its copies; if the runner objects and we have no stronger legitimate reason, delete it sooner. The full declaration is in the backoffice, on the event's page, under “Signed declarations (group run)”, while the runner keeps coming to the runs; when they ask for it to be deleted, erase it there, with the reason, and this copy too.`,
      ],
    },
    clubConfirmationNotice: {
      subject: (d: TemplateData) => `Registration confirmed: ${d.participantName || "participant"} — ${d.eventTitle ?? "event"}`,
      greeting: () => "Hello,",
      body: (d: TemplateData) => [
        `${d.participantName || "A participant"} has confirmed their registration for ${d.eventTitle ?? "the event"}${d.eventStartsAtFormatted ? `, ${d.eventStartsAtFormatted}` : ""}.${d.bibNumber ? ` Race number: ${d.bibNumber}.` : ""}`,
        "A note for the club: the full list, the filters and the export are in the backoffice, under Registrations. The participant received their own confirmation separately.",
      ],
    },
    staffInvitation: {
      subject: `You are on the ${CLUB_NAME} team`,
      body: (d: TemplateData) => [
        `${d.inviterName || "A colleague"} added you to the team that runs the ${CLUB_NAME} website, as ${d.staffRole ?? "a team member"}.`,
        `You sign in with ${d.staffEmail ?? "this address"}: if you have no account yet, create one at the sign-in page with exactly this address (the account is tied to the address). Access begins at your first sign-in.`,
        "Your account is held by Zitadel, with your name and address; what you do in the backoffice stays in the club's log, under your name, for at most three years. Details in the privacy notice.",
      ],
      action: "Open the backoffice",
      links: (d: TemplateData) => (d.privacyUrl ? [{ label: "Privacy notice", url: d.privacyUrl }] : []),
    },
    registrationOpened: {
      subject: (d: TemplateData) => `Registration for ${d.eventTitle ?? "the event"} is open`,
      greeting: () => "Hello,",
      facts: (d: TemplateData) => eventFacts(d, { map: "Map of the meeting point", strava: "The event on Strava" }),
      body: (d: TemplateData) => [
        `Registration for ${d.eventTitle ?? "the event"} is open. Register with the button below.`,
        "You are getting this because you asked, on the event's page, to be told when registration opens. It is the only one: your address was deleted from the notification list when it was sent.",
      ],
      action: "Register",
      links: (d: TemplateData) => [
        ...(d.eventUrl ? [{ label: "The event's page", url: d.eventUrl }] : []),
        ...(d.eventRulesUrl ? [{ label: "The event's rules", url: d.eventRulesUrl }] : []),
      ],
    },
    registrationConfirmed: {
      subject: "Your registration is confirmed",
      facts: (d: TemplateData) => eventFacts(d, { map: "Map of the meeting point", strava: "The event on Strava" }),
      body: (d: TemplateData) => [
        `Your registration for ${d.eventTitle ?? "the event"} is confirmed. See you there!`,
        ...(d.bibNumber ? [`Your race number: ${d.bibNumber}. You collect it at the desk on race day.`] : []),
        ...(d.eventChecklist ? [`What to bring: ${d.eventChecklist}`] : []),
        ...(d.checkinCode
          ? [`When you pick up your race number, show the QR code below or say the code ${d.checkinCode}.`]
          : []),
        "Below: your registration, “I can't make it any more” and the event's page.",
      ],
      action: "See your registration",
      image: (d: TemplateData) => (d.checkinQrUrl ? { url: d.checkinQrUrl, alt: `QR code ${d.checkinCode ?? ""}`, caption: `Your code: ${d.checkinCode ?? ""}` } : undefined),
      links: (d: TemplateData) => [
        ...(d.manageUrl ? [{ label: "I can't make it any more — cancel my registration", url: `${d.manageUrl}#cancel` }] : []),
        // The list switch, worded by the row (§143): the answer given on the form, reversible here.
        ...(d.listConsentUrl
          ? [{ label: d.listed === false ? "Show my name on the public participant list" : "Take me off the public participant list", url: d.listConsentUrl }]
          : []),
        ...(d.eventUrl ? [{ label: "The event's page", url: d.eventUrl }] : []),
        ...(d.eventScheduleUrl ? [{ label: "The event's programme", url: d.eventScheduleUrl }] : []),
        ...(d.eventRulesUrl ? [{ label: "The event's rules", url: d.eventRulesUrl }] : []),
        ...(d.eventLinksUrl ? [{ label: "Links and files: on the event's page", url: d.eventLinksUrl }] : []),
        ...(d.declarationPdfUrl ? [{ label: "The declaration you signed (PDF)", url: d.declarationPdfUrl }] : []),
      ],
    },
    registrationCancelled: {
      subject: "Your registration has been cancelled",
      body: (d: TemplateData) => [`Your registration for ${d.eventTitle ?? "the event"} has been cancelled.`],
    },
    waitlistOfferExpired: {
      subject: "The time to confirm your place has expired",
      body: (d: TemplateData) => [
        `The time available to confirm the place that opened up at ${d.eventTitle ?? "the event"} has expired. You remain on the waiting list and we'll let you know if another place opens up.`,
      ],
    },
    registrationManageLink: {
      subject: "Your registration management link",
      body: () => ["Here is the link to view or cancel your registration."],
      action: "Manage your registration",
    },
    profileManageLink: {
      subject: `Your registrations at ${CLUB_NAME}`,
      body: (d: TemplateData) => [
        "Here is the link to every active registration of yours: the state of each, the access code and QR for race day, and the option to withdraw.",
        `The link is valid for ${d.linkLifetime ?? defaultLinkLifetime("en")} and only for you.`,
      ],
      action: "See my registrations",
    },
    registrationStateNotice: {
      subject: "Your registration status",
      body: (d: TemplateData) => [
        `Your registration for ${d.eventTitle ?? "the event"} currently has this status: ${d.currentStatus ?? "unknown"}.`,
      ],
    },
    eventUpdateNotice: {
      subject: (d: TemplateData) => `Updated details for ${d.eventTitle ?? "the event"}`,
      facts: (d: TemplateData) => eventFacts(d, { map: "Map of the meeting point", strava: "The event on Strava" }),
      body: (d: TemplateData) => [
        `The organizers have updated the details of ${d.eventTitle ?? "the event"}, which you are registered for.`,
        "Your registration stays valid and there is nothing you need to do. If the new date or place does not suit you, withdraw from “My registrations” (the link below) so the place goes to someone else. The latest details are on the event's page.",
      ],
      action: "See the event's page",
      links: (d: TemplateData) => (d.myRegistrationsUrl ? [{ label: "My registrations (we email you the link)", url: d.myRegistrationsUrl }] : []),
    },
    eventCancelled: {
      subject: (d: TemplateData) => (d.eventTitle ? `“${d.eventTitle}” has been cancelled` : "The event has been cancelled"),
      body: (d: TemplateData) => [
        `We are sorry: ${d.eventTitle ? `“${d.eventTitle}”` : "the event"}${d.eventStartsAtFormatted ? `, planned for ${d.eventStartsAtFormatted},` : ""} has been cancelled.`,
        "Your registration stays with us as a record, and there is nothing you need to do: you do not need to cancel it.",
        `For questions, write to us from the contact page (the “Write to us” link below)${d.replyTo ? " or reply to this email" : ""}.`,
      ],
    },
    organizerMessage: {
      subject: (d: TemplateData) => organizerSubject(d, d.eventTitle ? `A message about ${d.eventTitle}` : "A message about the event you registered for"),
      facts: (d: TemplateData) => eventFacts(d, { map: "Map of the meeting point", strava: "The event on Strava" }),
      body: (d: TemplateData) => [
        d.eventTitle
          ? `A message from the organizers of ${d.eventTitle}, which you registered for:`
          : "A message from the organizers of the event you registered for:",
      ],
      action: "See the event's page",
      links: (d: TemplateData) => (d.myRegistrationsUrl ? [{ label: "My registrations (we email you the link)", url: d.myRegistrationsUrl }] : []),
    },
    registerAnotherPerson: {
      subject: (d: TemplateData) =>
        d.addressAtCap
          ? `Your address already has the most registrations allowed for ${d.eventTitle ?? "the event"}`
          : d.familyEntryGone
            ? `The request to register one more person for ${d.eventTitle ?? "the event"} has lapsed`
            : `Registering one more person for ${d.eventTitle ?? "the event"}?`,
      greeting: () => "Hello,",
      body: (d: TemplateData) =>
        d.addressAtCap
          ? [
              `The registration form for ${d.eventTitle ?? "the event"} was sent again with this address and another name. We registered nobody: one email address may register at most ${peoplePhrase("en", d.addressCap)} for an event, and yours already has.`,
              "For one more person, use their own email address. If someone on your address is no longer coming, cancel their registration from the link in their confirmation or from “My registrations”, and the place on the address is freed.",
              "If you did not send the form, you can ignore this message: nothing has changed.",
            ]
          : d.familyEntryGone
            ? [
                `The registration form for ${d.eventTitle ?? "the event"} was sent again with this address, for another person, but the request has lapsed: it was already confirmed or it expired, and the details sent have been deleted.`,
                "If the person is not registered yet, send the form again with their full name and birth date: you will get a new email with a button to confirm.",
                "If you did not send the form, you can ignore this message: nothing has changed.",
              ]
            : [
              "The form was sent again with this address, for another person — we have not registered them yet: confirm with the first button or decline with the second.",
              "If you did not send the form, ignore this message: nobody is registered, and the details are deleted when the link expires.",
              "Register someone only with their agreement, and tell them how we use their details: the privacy notice is at the link at the end of this message.",
            ],
      action: "I confirm I am registering another person",
    },
    /**
     * The newsletter's one message to an address left in the contact page's pop-up (§445): the
     * double opt-in's link, or — for an address already subscribed — the link to its own page, and
     * nothing changed. To an address, not a person: the greeting names nobody.
     */
    newsletterConfirm: {
      subject: (d: TemplateData) => (d.newsletterAlready ? `Your subscription to ${CLUB_NAME}'s news` : `Confirm your subscription to ${CLUB_NAME}'s news`),
      greeting: () => "Hello,",
      body: (d: TemplateData) =>
        d.newsletterAlready
          ? [
              "Someone — probably you — asked again, on our contact page, for the club's news at this address. You are already subscribed, so nothing has changed.",
              "The button below shows the topics you chose; you can change them there or unsubscribe.",
            ]
          : [
              "You asked, on our contact page, to receive the club's news at this address.",
              "Confirm your subscription with the button below. Until you do we send you nothing else, and if you do not, the address is deleted.",
            ],
      action: (d: TemplateData) => (d.newsletterAlready ? "See my subscription" : "Confirm my subscription"),
    },
    /** A newsletter the club wrote (§445): its own subject and body, the link to choose topics or unsubscribe. */
    newsletter: {
      subject: (d: TemplateData) => d.newsletterSubject ?? `News from ${CLUB_NAME}`,
      greeting: () => "Hello,",
      body: () => [],
    },
    /** "A new event is on the calendar" (§445), from the maintenance job, to the subscribers of its topics. */
    newEventAlert: {
      subject: (d: TemplateData) => (d.eventTitle ? `New on the calendar: ${d.eventTitle}` : "A new event on the club's calendar"),
      greeting: () => "Hello,",
      facts: (d: TemplateData) => eventFacts(d, { map: "Map of the meeting point", strava: "The event on Strava" }),
      body: (d: TemplateData) => [
        `${d.eventTitle ?? "A new event"} is now on the club's calendar. Everything about it — the programme, the route and, where there is one, the registration — is on its page.`,
      ],
      action: "See the event",
    },
    /** The newsletter's own lines (§445), which the platform adds whoever wrote the words above them. */
    newsletterWords: {
      topics: (topics: string) => `You receive the club's news about: ${topics}.`,
      link: (lifetime: string) => `The link is valid for ${lifetime} and can be used once. If you did not ask for this, ignore this message.`,
      manage: "Choose what you receive, or unsubscribe",
    },
    noticeWords: {
      place: (d: TemplateData) => (d.eventLocationName ? `The meeting point is now: ${d.eventLocationName}.` : "The meeting point has changed — it is on the event's page."),
      time: (d: TemplateData) =>
        d.eventStartsAtFormatted
          ? `The date and time are now: ${d.eventStartsAtFormatted}${d.eventRaceStartsAtFormatted ? `; the race starts at ${d.eventRaceStartsAtFormatted}` : ""}.`
          : "The date or the time has changed — it is on the event's page.",
      programme: (d: TemplateData) =>
        d.eventProgramme?.length ? `The updated programme: ${d.eventProgramme.join("; ")}.` : "The programme has changed — it is on the event's page.",
      reinstated: () => "The event is no longer cancelled: it is going ahead.",
      noteLabel: "A message from the organizers:",
      reasonLabel: "The reason:",
    },
    closing: "Happy running,",
    /** In front of a message re-sent because the form was filled in again (§235, §286). */
    alreadyRegistered: (bib?: number | null) =>
      bib
        ? `We are glad you are keen! __You are already registered__ for this event, with number ${bib} — no second registration was created. Below is the one you have.`
        : "We are glad you are keen! __You are already registered__ for this event, so no second registration was created — below is the registration you already have.",
    /** Appended when the number in this message can still change (§237). */
    bibProvisional: (n: number) =>
      `Number ${n} is provisional — we settle it when registration closes and send you the final one.`,
    /** «Night run» on a group run (the owner calls a run a run, not an "event"), «Night event» otherwise. */
    nightEvent: (night: NightReminderLine) => {
      const label = night.isGroupRun ? "Night run" : "Night event";
      if (!night.sunset) return `${label}: bring a headlamp.`;
      const start = night.start ? `starts at ${night.start}, ` : "";
      if (night.sunrise) return `${label}: ${start}before sunrise at ${night.sunrise}. Bring a headlamp.`;
      if (night.after) return `${label}: ${start}after the ${night.sunset} sunset. Bring a headlamp.`;
      const end = night.end ? (night.endSource === "programme" ? `, the programme's last row at ${night.end}` : `, ends at ${night.end}`) : "";
      return `${label}: ${start}sunset at ${night.sunset}${end}. Bring a headlamp.`;
    },
    addressCapLine: (cap: number) => `One email address may register at most ${peoplePhrase("en", cap)} for an event.`,
    familyFacts: (f: FamilyFactsInput): FamilyFact[] => [
      ...(f.event ? [{ label: "The event", value: [{ text: f.when ? `${f.event}, ${f.when}` : f.event, bold: true }] }] : []),
      { label: "Already registered with this address", value: [{ text: f.registered.length > 0 ? f.registered.join(", ") : "nobody at the moment", bold: true }] },
      { label: "The person in the form", value: [{ text: f.name, bold: true }] },
      ...(formatBirthDate(f.birthDate, "en") ? [{ label: "Date of birth", value: [{ text: formatBirthDate(f.birthDate, "en"), bold: true }] }] : []),
      { label: "What happens if you press", value: [{ text: "they get their own place", bold: true }, { text: ", their own email with the declaration and their own QR code, at this address" }] },
      { label: "Deadline", value: [{ text: "the link is valid for " }, { text: f.hours, bold: true }, { text: " and can be used once" }] },
      ...(f.cap !== undefined
        ? [{ label: "The limit", value: [{ text: "at most " }, { text: peoplePhrase("en", f.cap), bold: true }, { text: " per address, for an event" }] }]
        : []),
    ],
    familySitting: {
      subject: (d: TemplateData) => `Family registration: ${peoplePhrase("en", d.familySittingPeople?.length ?? 1)} for ${d.eventTitle ?? "the event"}`,
      facts: (f: FamilySittingFactsInput): FamilyFact[] => [
        ...(f.event ? [{ label: "The event", value: [{ text: f.when ? `${f.event}, ${f.when}` : f.event, bold: true }] }] : []),
        ...f.people.map((person, index) => ({
          label: `Person ${index + 1} of ${f.people.length}`,
          value: [
            { text: person.name, bold: true },
            ...(formatBirthDate(person.birthDate, "en") ? [{ text: ", date of birth " }, { text: formatBirthDate(person.birthDate, "en"), bold: true }] : []),
          ],
        })),
        ...(f.registered.length > 0 ? [{ label: "Already registered with this address", value: [{ text: f.registered.join(", "), bold: true }] }] : []),
        {
          label: "What happens if you press",
          value: [
            { text: "you confirm the address and every registration at once", bold: true },
            { text: "; you then sign the declarations right away, one after the other, and each person gets their own place and their own QR code, at this address" },
          ],
        },
        { label: "Deadline", value: [{ text: "the link is valid for " }, { text: f.hours, bold: true }, { text: " and can be used once" }] },
        ...(f.cap !== undefined
          ? [{ label: "The limit", value: [{ text: "at most " }, { text: peoplePhrase("en", f.cap), bold: true }, { text: " per address, for an event" }] }]
          : []),
      ],
      body: (): string[] => [
        "The registration form was sent from this address for the people above. Nobody is registered yet: one button confirms the address and the whole family.",
        "Someone on the list should not be registered? Untick them on the page that opens. If you did not send the form, ignore this message: nobody is registered, and the details are deleted by themselves when the link expires.",
        "Only register someone with their consent, and tell them how we use their data: the privacy notice is at the link at the end of this message.",
      ],
      action: (count: number) => `Confirm and sign the declarations (${count})`,
      mine: "All my registrations",
    },
    familyConfirmed: {
      subject: (d: TemplateData) => `Confirmed: ${peoplePhrase("en", d.familyConfirmed?.length ?? 1)} for ${d.eventTitle ?? "the event"}`,
      body: (d: TemplateData): string[] => [
        `The registrations below for ${d.eventTitle ?? "the event"} are confirmed. See you there!`,
        "At the registration desk, each person shows the QR code under their name or says the code.",
        ...(d.eventChecklist ? [`What to bring: ${d.eventChecklist}`] : []),
      ],
      words: {
        number: "Race number",
        provisional: "(provisional: settled when registration closes)",
        noNumber: "no number yet",
        code: "Desk code",
        qr: "QR code",
      },
      action: "All my registrations",
    },
    familyDecline: "I am not registering this person",
    anotherPersonHint: "If you want to register someone else, send the form with that person's full name and birth date.",
    sameBirthDateHint:
      "Two people born on the same day cannot both be registered from one email address through the form. For a twin, send the form from another email address, or reply to this email and we will register them.",
    /** After the body of a declaration request, on an address with more to sign (§471): the one link signs them all. */
    familyToSign: (names: readonly string[]) =>
      `The declarations of ${names.join(", ")} on this address are waiting for a signature too. You can sign them all from this link, one after the other: one person per step.`,
    footer: "Reply to this email with questions.",
    clubCopy: {
      subject: "[Club copy] ",
      note: "Club copy of the message sent to the participant. The personal links, the QR code and the attachments have been removed.",
      bulkNote: (count: number) =>
        `Club copy of the message sent to ${participantsPhrase("en", count)}, each in the language of their registration. The recipients' names are not included, and the personal links have been removed.`,
      /** A newsletter's or a new-event alert's one copy (§445): how many subscribers, and no address. */
      subscribersNote: (count: number) =>
        `Club copy of the message sent to ${subscribersPhrase("en", count)} to the news, each in the language they chose. The recipients' addresses are not included, and the personal unsubscribe link has been removed.`,
    },
    hello: "Hello,",
    guardianIntro: (participant: string) => `This message is about the registration you made, as parent or guardian, for ${participant}.`,
    minorSigners: (participant: string, both: boolean) =>
      both
        ? `You both sign the declaration, you as parent or guardian and ${participant}, each with your own identity document; keep both to hand.`
        : `You sign the declaration as parent or guardian for ${participant}.`,
    groupRunMasked: "In your copy, your identity document's series and number are masked, for safety: the email address was not verified before sending.",
    groupRunNotYou: (contactUrl?: string) =>
      `If you did not sign this declaration, write to us from the contact page${contactUrl ? ` (${contactUrl})` : ""} and we will delete it.`,
    privacyFooter: (club: string) => `You are receiving this message from ${club} about a registration made with this email address. How we use the data:`,
    privacyFooterInterest: (club: string) => `This message comes from ${club} because you asked to be told. How we use your data:`,
    privacyFooterDeclaration: (club: string) => `This message comes from ${club} because you signed a declaration on the club's website. How we use your data:`,
    privacyFooterNewsletter: (club: string) =>
      `This message comes from ${club} because you asked for the club's news at this address. Unsubscribe at any time from the link above. How we use your data:`,
  },
} as const;

const KEY_BY_MESSAGE_TYPE: Record<EmailMessageType, keyof typeof T.ro> = {
  VERIFY_REGISTRATION_EMAIL: "verify",
  COMPLETE_DECLARATION: "completeDeclaration",
  WAITLIST_JOINED: "waitlistJoined",
  WAITLIST_SPOT_OFFER: "waitlistSpotOffer",
  REGISTRATION_CONFIRMED: "registrationConfirmed",
  REGISTRATION_CANCELLED: "registrationCancelled",
  WAITLIST_OFFER_EXPIRED: "waitlistOfferExpired",
  REGISTRATION_MANAGE_LINK: "registrationManageLink",
  PROFILE_MANAGE_LINK: "profileManageLink",
  REGISTRATION_STATE_NOTICE: "registrationStateNotice",
  EVENT_REMINDER: "eventReminder",
  EVENT_THANKS: "eventThanks",
  DECLARATION_SIGNED: "declarationSigned",
  DECLARATION_ARCHIVE: "declarationArchive",
  BIB_ASSIGNED: "bibAssigned",
  STAFF_INVITATION: "staffInvitation",
  REGISTRATION_OPENED: "registrationOpened",
  CLUB_CONFIRMATION_NOTICE: "clubConfirmationNotice",
  EVENT_UPDATE_NOTICE: "eventUpdateNotice",
  EVENT_CANCELLED: "eventCancelled",
  ORGANIZER_MESSAGE: "organizerMessage",
  GROUP_RUN_DECLARATION_SIGNED: "groupRunDeclarationSigned",
  GROUP_RUN_DECLARATION_ARCHIVE: "groupRunDeclarationArchive",
  REGISTER_ANOTHER_PERSON: "registerAnotherPerson",
  NEWSLETTER_CONFIRM: "newsletterConfirm",
  NEWSLETTER: "newsletter",
  NEW_EVENT_ALERT: "newEventAlert",
};

/** The newsletter's three messages (§445): to an address, never about a registration. */
const NEWSLETTER_MESSAGES: ReadonlySet<EmailMessageType> = new Set(["NEWSLETTER_CONFIRM", "NEWSLETTER", "NEW_EVENT_ALERT"]);

/**
 * A newsletter's own words (§445), as the organizer's message's are (§364): the body as typed, a
 * blank line starting a paragraph and a single break kept, escaped, no emphasis read inside it. No
 * placeholder is filled — the service refuses any.
 */
function newsletterParts(messageType: EmailMessageType, data: TemplateData): EmailBodyPart[] {
  if (messageType !== "NEWSLETTER" || !data.newsletterBody) return [];
  const paragraphs = organizerParagraphs(data.newsletterBody);
  return paragraphs.map((lines, index) => ({
    html: `<p style="margin:0 0 14px;font-size:16px;line-height:1.5">${lines.map(escapeHtml).join("<br>")}</p>`,
    text: index < paragraphs.length - 1 ? [...lines, ""] : lines,
  }));
}

/**
 * The lines the platform adds to a newsletter message whoever wrote its words (§445): what the
 * subscriber chose, on the confirmation and on an alert; how long the confirmation link lives. The
 * link to choose topics or unsubscribe is under the button, on every one of them.
 */
function newsletterLines(messageType: EmailMessageType, locale: EmailLocale, data: TemplateData): string[] {
  if (!NEWSLETTER_MESSAGES.has(messageType)) return [];
  const words = T[locale].newsletterWords;
  const confirming = messageType === "NEWSLETTER_CONFIRM" && data.newsletterAlready !== true;
  return [
    ...(data.newsletterTopics && (confirming || messageType === "NEW_EVENT_ALERT") ? [words.topics(data.newsletterTopics)] : []),
    ...(confirming ? [words.link(data.confirmationHours ?? hoursPhrase(locale, DEFAULT_DEADLINES.confirmationHours))] : []),
  ];
}

/**
 * "4 persoane", "o persoană" / "4 people", "one person" (§389): how many runners one address may
 * register, as the words the two sentences about the limit say it — the number is the club's
 * setting, carried on the row, never a literal here. `countForm`'s Romanian forms (§341); the
 * limit's bounds (1–10) never reach the "de" form, and it is spelled for any number all the same.
 */
function peoplePhrase(locale: EmailLocale, count: number | undefined): string {
  const n = count ?? ADDRESS_CAP_RULE.default;
  const form = countForm(n, locale);
  if (locale === "ro") return form === "one" ? "o persoană" : form === "few" ? `${n} persoane` : `${n} de persoane`;
  return form === "one" ? "one person" : `${n} people`;
}

/** "12 participanți", "un participant" / "12 participants", "one participant" — a bulk copy's count (§419). */
function participantsPhrase(locale: EmailLocale, count: number): string {
  const form = countForm(count, locale);
  if (locale === "ro") return form === "one" ? "un participant" : form === "few" ? `${count} participanți` : `${count} de participanți`;
  return form === "one" ? "one participant" : `${count} participants`;
}

/** "12 abonați", "un abonat" / "12 subscribers", "one subscriber" — a newsletter copy's count (§445). */
function subscribersPhrase(locale: EmailLocale, count: number): string {
  const form = countForm(count, locale);
  if (locale === "ro") return form === "one" ? "un abonat" : form === "few" ? `${count} abonați` : `${count} de abonați`;
  return form === "one" ? "one subscriber" : `${count} subscribers`;
}

/**
 * The sentences the update and the cancellation add after the body (§331) — machinery, like the
 * provisional-number line (§237), so a club that rewrote the message's words (§247) still sends
 * the new place and the reason: they are statements about the event, not about how the club
 * likes to write. One line per kind the save changed, in the order a runner reads a morning — on
 * again, where, when, the programme — then the organizer's note, or the reason.
 */
function noticeParts(messageType: EmailMessageType, locale: EmailLocale, data: TemplateData): (string | EmailBodyPart)[] {
  const words = T[locale].noticeWords;
  if (messageType === "EVENT_CANCELLED") {
    return data.cancellationReason ? [organizerTextPart(words.reasonLabel, data.cancellationReason)] : [];
  }
  if (messageType !== "EVENT_UPDATE_NOTICE") return [];
  const changes = new Set(data.updateChanges ?? []);
  return [
    ...(changes.has("reinstated") ? [words.reinstated()] : []),
    ...(changes.has("place") ? [words.place(data)] : []),
    ...(changes.has("time") ? [words.time(data)] : []),
    ...(changes.has("programme") ? [words.programme(data)] : []),
    ...(data.organizerNote ? [organizerTextPart(words.noteLabel, data.organizerNote)] : []),
  ];
}

/**
 * The part of one message the club may rewrite (§247), as the platform writes it: the subject and
 * the body, and nothing the platform adds around a body — not the club copy's first line (§320),
 * not "you were already registered" (§235), not the update's new place or the cancellation's
 * reason (§331), not "this number is provisional" (§237). Those are sent whoever wrote the words,
 * so a club text that repeated them would say them twice.
 *
 * The editor's starting text is built from this (§359, `email-copy-fields.ts`), with every field of
 * the closed set standing for itself, so nothing of the page's sample reaches the box — and each
 * sentence the platform adds only when a fact exists in a paragraph of its own, so a saved text
 * drops it the same way. The send path never calls it: `buildTemplateContent` below reads the same
 * entries itself, unchanged.
 */
export function platformWords(
  messageType: EmailMessageType,
  locale: EmailLocale,
  data: TemplateData,
): { subject: string; paragraphs: string[] } {
  const entry = T[locale][KEY_BY_MESSAGE_TYPE[messageType]] as {
    subject: string | ((d: TemplateData) => string);
    body: (d: TemplateData) => string[];
  };
  return {
    subject: typeof entry.subject === "function" ? entry.subject(data) : entry.subject,
    paragraphs: entry.body(data),
  };
}

/**
 * Every message type's content, for one locale, given the data the renderer looked up.
 * `actionUrl` is undefined for the message types that carry none — `REGISTRATION_STATE_NOTICE`
 * (§16.3: "carries no scoped token and creates none") and the two waiting-list notices, which
 * point participants back at the ordinary event page rather than at a fresh action link.
 */
export function buildTemplateContent(
  messageType: EmailMessageType,
  locale: EmailLocale,
  given: TemplateData,
  actionUrl: string | undefined,
  /** The club's own wording for this message, when it has written some (§247). */
  overrides?: EmailCopy | null,
): TemplateContent {
  // The notice in this half's own language (§323): the Romanian half links /ro/…, the English /en/….
  const privacyUrl = privacyNoticeUrl(locale);
  let data: TemplateData = { ...given, privacyUrl, ...timingWords(locale, given.timings) };
  const copy = T[locale];
  const key = KEY_BY_MESSAGE_TYPE[messageType];
  /*
    The club's copy (§320) is the participant's message minus what only the participant may hold.
    The renderer already mints no token and sets none of these for one; they are dropped here as
    well, so the template cannot print a manage link, a list switch, the PDF-by-link, the desk
    code or its QR into a club mailbox whatever it is handed — and the action button goes too.
  */
  const clubCopy = data.clubCopy === true;
  if (clubCopy) {
    // `thanksUrl` too: it is the thank-you's action, so its "the link below" sentence goes with the button (review nit).
    data = {
      ...data,
      manageUrl: undefined,
      listConsentUrl: undefined,
      declarationPdfUrl: undefined,
      checkinCode: undefined,
      checkinQrUrl: undefined,
      thanksUrl: undefined,
      // A family's confirmation keeps the names and the numbers, never a code or a QR (§519).
      familyConfirmed: data.familyConfirmed?.map((person) => ({
        name: person.name,
        firstName: person.firstName,
        raceNumber: person.raceNumber,
        provisional: person.provisional,
      })),
    };
    actionUrl = undefined;
  }
  // TypeScript can't see that every key but "hi"/"closing" shares this shape; the
  // `KEY_BY_MESSAGE_TYPE` map is what actually guarantees it.
  const entry = copy[key] as {
    subject: string | ((d: TemplateData) => string);
    body: (d: TemplateData) => string[];
    /** The archive copy greets the club, not the participant whose name is in the subject. */
    greeting?: (d: TemplateData) => string;
    action?: string | ((d: TemplateData) => string);
    facts?: (d: TemplateData) => TemplateContent["facts"];
    image?: (d: TemplateData) => TemplateContent["image"];
    links?: (d: TemplateData) => TemplateContent["links"];
  };

  /*
    The club's own words, where it has written some (§247).

    Only the subject and the body. The greeting, the facts line, the action button and its
    token, the QR, the links and the sign-off are the message's machinery and stay in code —
    and so do the two sentences below that the platform adds *around* a body: "you were already
    registered" (§235) and "this number is provisional" (§237). Both are statements about the
    state of a registration rather than about how the club likes to write, and a club that
    rewrote the confirmation would otherwise silently lose them.
  */
  // The organizer's message is written per send (§364): there is no stored wording to apply, and a
  // hand-made entry for it in the setting must not replace what the organizer wrote this time.
  /*
    The link for another person, at the address's limit (§389), is the platform's sentence alone:
    it is a statement about the address's state — like "you were already registered" (§235) — and
    the club's words for this message are the question and the link, which this send carries
    neither of. A club text would otherwise offer a button the message does not have.
  */
  const atAddressCap = messageType === "REGISTER_ANOTHER_PERSON" && data.addressAtCap === true;
  /*
    …and so is the one whose kept form is gone (§446): the club's words promise a button this send
    cannot carry, so the platform's lapsed shape says what happened and how to start again.
  */
  const familyGone = messageType === "REGISTER_ANOTHER_PERSON" && !atAddressCap && data.familyEntryGone === true;
  /*
    …and a family sitting's one message (§519): its facts, its button and its words are the sitting's
    — everybody at once — and a club text written for one person's link would promise the wrong one.
  */
  const familySittingPeople = data.familySittingPeople ?? [];
  const familySittingShape = messageType === "REGISTER_ANOTHER_PERSON" && !atAddressCap && !familyGone && familySittingPeople.length > 0;
  /*
    …and a family's one confirmation (§519): everybody's blocks, the family's subject and button — a
    club text written for one runner's confirmation would say "your number" over three.
  */
  const familyConfirmedPeople = messageType === "REGISTRATION_CONFIRMED" ? (data.familyConfirmed ?? []) : [];
  const familyConfirmedShape = familyConfirmedPeople.length > 0;
  /*
    The freed place's offer with no deadline ahead (§419) — a resend after it lapsed — is the
    platform's sentence alone, which states the offer's length instead of a moment. The club's words
    name the moment (`{holdExpiresAtFormatted}`), and a sentence missing it would read "până la
    (ai la dispoziție …)": a statement about the offer's state, like the address's limit above.
  */
  const lapsedOffer = messageType === "WAITLIST_SPOT_OFFER" && !data.holdExpiresAtFormatted;
  /*
    The newsletter (§445) is written per send, like the organizer's message; and the confirmation
    that went to an address already subscribed is the platform's sentence alone — a statement about
    the address's state, like the limit above: the club's words for this message ask to confirm.
  */
  const newsletterState = messageType === "NEWSLETTER" || (messageType === "NEWSLETTER_CONFIRM" && data.newsletterAlready === true);
  const written =
    messageType === "ORGANIZER_MESSAGE" || atAddressCap || familyGone || familySittingShape || familyConfirmedShape || lapsedOffer || newsletterState
      ? null
      : copyFor(overrides, messageType, locale);
  const writtenBody = written?.body ? readEmailBody(written.body) : null;
  const fill = (text: string) => fillPlaceholders(text, data as unknown as Record<string, unknown>);

  const subject = familySittingShape
    ? copy.familySitting.subject(data)
    : familyConfirmedShape
      ? copy.familyConfirmed.subject(data)
      : written
    ? fill(written.subject)
    : typeof entry.subject === "function"
      ? entry.subject(data)
      : entry.subject;

  /*
    The event's facts as one block (§392), in this half's language, on the three messages a runner
    keeps to know where and when: the confirmation, the reminder, the declaration request (which is
    also the participation confirmation, §104). It says the date, the place and the map, so the one
    bold line of §81 gives way to it there, and it carries the event's own page and its sections
    (`#schedule`, `#rules`, `#route`, `#links`), so the list under the button does not name them a
    second time. A club copy keeps it: every fact in it is on the public page (§320 takes only what
    is the participant's own).
  */
  /*
    The reminder's forecast (§402) is a row of that block, in this half's words — the pieces the
    event page's «Vremea» row says. Only on the reminder, the message a runner opens the day
    before: a confirmation sent weeks ahead would carry a forecast long out of date by race day.
  */
  // Where and for which hours (§484): this half's name for the place — or the club's locality when
  // the forecast is the club's — and the event's own clock. The row's label is the sentence's head,
  // «Vremea la <loc>, <zi> 08:00–10:00», so the text reads it whole, a colon, the sky.
  const weatherWordsForRow =
    messageType === "EVENT_REMINDER" && data.eventWeather && data.eventFacts
      ? weatherSpanWords(data.eventWeather, locale, {
          place: forecastPlaceName(data.eventWeather.place, data.eventFacts.locationToBeAnnounced ? null : data.eventFacts.locationName, CLUB_LOCALITY),
          timeZone: data.eventFacts.timezone,
        })
      : undefined;
  const weatherRow = weatherWordsForRow
    ? { label: weatherWordsForRow.heading, line: weatherWordsForRow.line, credit: weatherWordsForRow.credit }
    : undefined;
  const factsBlock = data.eventFacts && EVENT_FACTS_MESSAGES.has(messageType) ? eventFactsBlock(data.eventFacts, locale, weatherRow) : undefined;
  const linkData: TemplateData = factsBlock
    ? { ...data, eventUrl: undefined, eventScheduleUrl: undefined, eventRulesUrl: undefined, eventLinksUrl: undefined }
    : data;

  // A bulk send's one club copy (§419): it greets the club and names nobody.
  const bulkCopy = clubCopy && data.clubCopyRecipients !== undefined;
  /*
    A minor's registration (§108, §419): the address is the parent's or guardian's, so the message
    greets them and its first line says whose registration it is about — never "Salut, Ioana," to a
    twelve-year-old in the parent's inbox. Not on the older declaration message (`DECLARATION_SIGNED`),
    kept as it was, nor on a message with a greeting of its own. An adult's greeting, the family's
    included (§389), is unchanged: that person confirms and signs for themselves.

    The link for another person (§389) is one of those: it is to the address's holder about
    registering somebody else, so it greets plainly ("Salut," / "Hello,", its own `greeting`)
    whoever the registration the address already holds is for, a minor included.
  */
  /*
    A family's one confirmation (§519, the owner's answer of 2026-09-27) greets everybody it confirms
    by first name, in the order of the forms — «Salut, Ana, Ion și Maria,» — and so no parent's
    greeting and no "whose registration this is" line: every name is already in the greeting.
  */
  const familyGreeting = familyConfirmedShape ? joinNames(locale, familyFirstNames(familyConfirmedPeople)) : undefined;
  const guardianName =
    data.guardianName && !entry.greeting && !bulkCopy && !familyGreeting && messageType !== "DECLARATION_SIGNED" ? data.guardianName : undefined;

  return {
    // Each half of a bilingual subject carries its own language's mark, so a mailbox filter on
    // either word finds every copy whichever language the runner chose (§96).
    subject: clubCopy ? `${copy.clubCopy.subject}${subject}` : subject,
    greeting: entry.greeting ? entry.greeting(data) : bulkCopy ? copy.hello : copy.hi(familyGreeting ?? guardianName ?? data.participantName),
    facts: factsBlock ? undefined : entry.facts?.(data),
    /*
      The re-send says it is one (§235).

      Filling the form again with an address that is already registered creates nothing and
      re-sends whatever the state can offer (§199) — for a confirmed entrant, the confirmation,
      QR and all. That arrived reading exactly like a first confirmation, so the owner read two
      of them as two registrations and said so: "te poți înscrie cu fix același mail de 2 ori,
      primești și QR și tot". No second registration exists; only the message was ambiguous.

      One sentence in front of the body, and it is **here** rather than in one template because
      the re-send picks its type from the state: confirmed gets the confirmation, unsigned gets
      the declaration, queued gets the waiting-list notice. All three needed the same sentence.

      This is the whole of what may be said. The screen stays generic whatever the state,
      because answering "is this address registered" there would answer it about *anybody*'s
      address ( §19.4); the inbox is the one place the question can be answered to
      the only person entitled to the answer.
    */
    paragraphs: [
      // What this is, before anything else is read (§320) — for a bulk send, to how many (§419).
      ...(clubCopy
        ? [
            bulkCopy
              ? NEWSLETTER_MESSAGES.has(messageType)
                ? copy.clubCopy.subscribersNote(data.clubCopyRecipients ?? 0)
                : copy.clubCopy.bulkNote(data.clubCopyRecipients ?? 0)
              : copy.clubCopy.note,
          ]
        : []),
      // Whose registration this is, under the parent's greeting (§419).
      ...(guardianName ? [copy.guardianIntro(data.participantName)] : []),
      // The number when the message carries one: a settled number, or the provisional one the
      // desk gave, whichever this registration actually has (§286).
      ...(data.alreadyRegistered ? [copy.alreadyRegistered(data.bibNumber ?? null)] : []),
      // …and, on a re-send for a slip (§446), how to register somebody else — the inbox's alone.
      ...(data.anotherPersonHint ? [data.sameBirthDateHint ? copy.sameBirthDateHint : copy.anotherPersonHint] : []),
      /*
        Another person on the address (§446): who the address holds and who the form named, before
        the question — facts of this send, like "you were already registered" above, so a club that
        rewrote the words still says them. Only with the kept form in hand, as the button. One
        outlined box, the values bold (§468; the owner: "trebuie să avem bold pe chestiile
        importante"), so the parent sees at a glance which event and which person the button is for.
      */
      // A family sitting's facts (§519): everybody joining now, each on a line of the one outlined box.
      ...(familySittingShape
        ? [
            familyFactsPart(
              copy.familySitting.facts({
                event: data.eventTitle,
                when: data.eventStartsAtFormatted,
                people: familySittingPeople,
                registered: data.familyRegistered ?? [],
                hours: data.confirmationHours ?? hoursPhrase(locale, DEFAULT_DEADLINES.confirmationHours),
                cap: data.addressCap,
              }),
            ),
          ]
        : []),
      ...(messageType === "REGISTER_ANOTHER_PERSON" && !atAddressCap && !familySittingShape && data.familyPersonName
        ? [
            familyFactsPart(
              copy.familyFacts({
                event: data.eventTitle,
                when: data.eventStartsAtFormatted,
                registered: data.familyRegistered ?? [],
                name: data.familyPersonName,
                birthDate: data.familyPersonBirthDate ?? "",
                hours: data.confirmationHours ?? hoursPhrase(locale, DEFAULT_DEADLINES.confirmationHours),
                cap: data.addressCap,
              }),
            ),
          ]
        : []),
      /*
        The club's own words, with their formatting when it wrote them in the editor (§270).
        A stored document that cannot be read — an older shape, a node an email may not carry —
        falls back to the plain paragraphs beside it rather than to nothing, which is the same
        direction `readEmailCopy` takes with an unreadable setting: a message still goes out.
        Either way a paragraph whose only fields are facts this message lacks is not sent
        (§359): the platform's "only when there is a number", said the one way a text the club
        wrote can.
      */
      ...(writtenBody
        ? emailBodyParts(writtenBody, data as unknown as Record<string, unknown>)
        : written
          ? written.paragraphs.filter((paragraph) => !onlyMissingFacts(paragraph, data as unknown as Record<string, unknown>)).map(fill)
          : familySittingShape
            ? copy.familySitting.body()
            : familyConfirmedShape
              ? [...copy.familyConfirmed.body(data), familyConfirmedPart(familyConfirmedPeople, copy.familyConfirmed.words)]
              : entry.body(data)),
      /*
        Who signs a minor's declaration (§419, §330), after the body whoever wrote it — a fact about
        this registration and the text in force, like the provisional number (§237): on the request
        to sign and on the freed place, which asks the same signature.
      */
      ...(guardianName && (messageType === "COMPLETE_DECLARATION" || messageType === "WAITLIST_SPOT_OFFER")
        ? [copy.minorSigners(data.participantName, data.minorSigns === true)]
        : []),
      /*
        The family's other declarations (§471): that the one link signs them all, one after the other
        — a fact of this send, after the body whoever wrote it, and only when the renderer found some.
      */
      ...(messageType === "COMPLETE_DECLARATION" && data.familyToSign && data.familyToSign.length > 0
        ? [copy.familyToSign(data.familyToSign)]
        : []),
      /*
        A group run's signer's copy (§419): that the document is masked in it, when the text asked
        for one, and always how to have a declaration one did not sign deleted — the address was
        never confirmed, so the message may have reached somebody who signed nothing.
      */
      ...(messageType === "GROUP_RUN_DECLARATION_SIGNED"
        ? [...(data.idDocumentMasked ? [copy.groupRunMasked] : []), copy.groupRunNotYou(data.contactUrl)]
        : []),
      /*
        A night event (§394, the question §382 left open): the reminder of a date that starts after
        dusk says the sunset and to bring a light. After the body, like the provisional number below
        — a fact about this date, not a matter of how the club writes — so a reminder the club
        reworded still says it. Only when the renderer set it, and it sets it only on the reminder.
      */
      ...(messageType === "EVENT_REMINDER" && data.nightEventSunset !== undefined
        ? [
            copy.nightEvent({
              sunset: data.nightEventSunset,
              sunrise: data.nightEventSunrise ?? "",
              start: data.nightEventStart ?? "",
              end: data.nightEventEnd ?? "",
              endSource: data.nightEventEndSource ?? null,
              isGroupRun: data.nightEventIsGroupRun === true,
              after: data.nightEventAfter === true,
            }),
          ]
        : []),
      // What changed and the organizer's own words, after the body and whoever wrote it (§331).
      ...noticeParts(messageType, locale, data),
      // The organizer's message itself, after its one framing sentence (§364).
      ...organizerMessageParts(messageType, data, locale, bulkCopy),
      // A newsletter's own words, and what the platform says around every newsletter message (§445).
      ...newsletterParts(messageType, data),
      ...newsletterLines(messageType, locale, data),
      // After the body, not before it: the number is in the body already, and this only
      // qualifies it (§237).
      ...(data.bibProvisional && data.bibNumber !== undefined
        ? [copy.bibProvisional(data.bibNumber)]
        : []),
      // The club's limit under the link for another person (§389), whoever wrote the words above:
      // the number is the setting's, from the row, and a club text needs no field to state it.
      // In the facts box instead when the kept form is in hand (§468).
      ...(messageType === "REGISTER_ANOTHER_PERSON" && !atAddressCap && !familyGone && !familySittingShape && !data.familyPersonName && data.addressCap !== undefined
        ? [copy.addressCapLine(data.addressCap)]
        : []),
    ],
    action: familySittingShape
      ? actionUrl
        ? { label: copy.familySitting.action(familySittingPeople.length), url: actionUrl }
        : undefined
      : familyConfirmedShape
        ? actionUrl
          ? { label: copy.familyConfirmed.action, url: actionUrl }
          : undefined
        : entry.action && actionUrl
        ? { label: typeof entry.action === "function" ? entry.action(data) : entry.action, url: actionUrl }
        : undefined,
    /*
      «Nu înscriu această persoană» (§468): the same single-use link's other answer, under the
      confirmation button and only beside it — never at the limit, never once the kept form is gone,
      never on a club copy (which carries no action at all, §320).
    */
    secondaryAction:
      messageType === "REGISTER_ANOTHER_PERSON" && !atAddressCap && !familyGone && entry.action && actionUrl && data.familyDeclineUrl
        ? { label: copy.familyDecline, url: data.familyDeclineUrl }
        : undefined,
    image: entry.image?.(data),
    eventFacts: factsBlock,
    links: (() => {
      const own = [
        // «Toate înscrierile mele» first under a family's button (§519): each person's state, before and after the press.
        ...(familySittingShape && data.familyMineUrl ? [{ label: copy.familySitting.mine, url: data.familyMineUrl }] : []),
        ...(entry.links?.(linkData) ?? []),
        // Every newsletter message's way out (§445; Legea 506/2004 art. 12(2)): the subscriber's own page.
        ...((messageType === "NEWSLETTER" || messageType === "NEW_EVENT_ALERT") && data.newsletterManageUrl
          ? [{ label: copy.newsletterWords.manage, url: data.newsletterManageUrl }]
          : []),
      ];
      // The club's archive copy and the staff invitation are not a participant's message.
      if (messageType === "DECLARATION_ARCHIVE" || messageType === "GROUP_RUN_DECLARATION_ARCHIVE" || messageType === "STAFF_INVITATION") {
        return own.length > 0 ? own : undefined;
      }
      const seen = new Set(own.map((link) => link.url));
      return [...own, ...standardLinks(linkData, copy.moreLinks).filter((link) => !seen.has(link.url))];
    })(),
    closing: copy.closing,
    footer: data.replyTo ? copy.footer : undefined,
    // Not on the club's copy either (§320, §324): "this message comes to you about your
    // registration" is addressed to the participant, and the copy lands in the club's mailbox.
    privacy: NOT_A_PARTICIPANT_MESSAGE.has(messageType) || clubCopy
      ? undefined
      : {
          // The confirmation answers a request, as "registration is open" does; the newsletter
          // itself and its alerts name the way out that sits under their button (§445).
          text: (messageType === "REGISTRATION_OPENED" || messageType === "NEWSLETTER_CONFIRM"
            ? copy.privacyFooterInterest
            : messageType === "GROUP_RUN_DECLARATION_SIGNED"
              ? copy.privacyFooterDeclaration
              : NEWSLETTER_MESSAGES.has(messageType)
                ? copy.privacyFooterNewsletter
                : copy.privacyFooter)(controllerName()),
          url: privacyUrl,
        },
  };
}

/**
 * How long the "my registrations" link lives, from the constant it is minted with (`DEFAULT_TOKEN_HOURS`):
 * what a body built without `timingWords` says — the editor's starting text (`platformWords`) — so
 * no path reads "valabil  și".
 */
function defaultLinkLifetime(locale: EmailLocale): string {
  return durationPhrase(locale, DEFAULT_TOKEN_HOURS / 24, "days");
}

/**
 * How long the club keeps an archive copy of a declaration — "3 ani" / "3 years" — from the
 * retention sweep's own constant (§95, §419), so the copy's instruction and what the privacy notice
 * says cannot drift. The mailbox is not swept by the platform: the sentence is the reminder.
 */
export function archivePeriod(locale: EmailLocale): string {
  return durationPhrase(locale, RETENTION_PERIODS.registrationsYearsAfterEvent, "years");
}

/** How long the backoffice keeps the whole identity document after the event (§95), from the same constants. */
export function identityDays(locale: EmailLocale): string {
  return durationPhrase(locale, RETENTION_PERIODS.identityAndHealthDaysAfterEvent, "days");
}

/**
 * The deadlines a message states, as words in one half's language (§377).
 *
 * The renderer and the preview always hand the numbers over; a caller that does not — a test, a
 * fixture — reads the club's defaults, which are exactly the numbers an unset setting has, so a
 * message never goes out with a blank where a duration belongs.
 */
function timingWords(locale: EmailLocale, timings: TemplateData["timings"]): Partial<TemplateData> {
  const numbers = timings ?? { ...DEFAULT_DEADLINES };
  return {
    confirmationHours: hoursPhrase(locale, numbers.confirmationHours),
    holdMinutes: minutesPhrase(locale, numbers.holdMinutes),
    offerHours:
      timings?.offerMinutes !== undefined ? minutesPhrase(locale, timings.offerMinutes) : hoursPhrase(locale, numbers.offerHours),
    reminderHours: numbers.reminderHours > 0 ? leadPhrase(locale, numbers.reminderHours) : "",
    confirmationOpens: timings?.confirmationOpensDays ? daysPhrase(locale, timings.confirmationOpensDays) : undefined,
    // The link's own lifetime (`domain/token-lifetime.ts`), the constant the token is minted with.
    linkLifetime: durationPhrase(locale, timings?.linkDays ?? DEFAULT_TOKEN_HOURS / 24, "days"),
  };
}

/**
 * The messages that carry the event's facts block (§392): the confirmation, the reminder, and the
 * declaration request — which, for a race with a participation window, is the participation
 * confirmation itself (§104), sent at once and again when the window opens. And the newsletter's
 * new-event alert (§445): a subscriber deciding whether to come reads the same when, where,
 * programme, route, cost and links as a runner who registered, from the same function.
 */
const EVENT_FACTS_MESSAGES: ReadonlySet<EmailMessageType> = new Set(["REGISTRATION_CONFIRMED", "EVENT_REMINDER", "COMPLETE_DECLARATION", "NEW_EVENT_ALERT"]);

/**
 * The messages that are not to a participant about their own data (§323), and so carry no
 * privacy line: the club's archive copy and its confirmation notice go to the club's mailboxes,
 * and the staff invitation says what it keeps about the team in its own body.
 */
const NOT_A_PARTICIPANT_MESSAGE: ReadonlySet<EmailMessageType> = new Set([
  "DECLARATION_ARCHIVE",
  // The group run's archive copy (§393), to the club's mailbox like the race's.
  "GROUP_RUN_DECLARATION_ARCHIVE",
  "CLUB_CONFIRMATION_NOTICE",
  "STAFF_INVITATION",
]);

/**
 * Who the controller is, as the privacy line names it (§323): the club's legal name from the
 * environment (`CLUB_LEGAL_NAME`, the same fact the legal templates are filled with), else the
 * club's everyday name. Never a literal of the legal name: the repository is public (§98).
 */
function controllerName(): string {
  return env.CLUB_LEGAL_NAME ?? CLUB_NAME;
}

/** The privacy notice's address in one language, from `APP_BASE_URL` like every link here (§8). */
function privacyNoticeUrl(locale: EmailLocale): string {
  return `${env.APP_BASE_URL}${getPathname({ locale, href: "/legal/privacy" })}`;
}

export function buildOutgoingEmail(params: {
  to: string;
  locale: EmailLocale;
  idempotencyKey: string;
  messageType: EmailMessageType;
  data: TemplateData;
  actionUrl?: string;
  attachments?: OutgoingEmail["attachments"];
  /** The club's own wording for this message (§247), read once per batch by the caller. */
  overrides?: EmailCopy | null;
  /** The club's copies of this one message (§244); empty for every other message type. */
  cc?: readonly string[];
  bcc?: readonly string[];
}): OutgoingEmail {
  const { subject, html, text } = renderBilingual(params.messageType, params.locale, params.data, params.actionUrl, params.overrides);
  return {
    to: params.to,
    subject,
    html,
    text,
    locale: params.locale,
    idempotencyKey: params.idempotencyKey,
    ...(params.attachments && params.attachments.length > 0 ? { attachments: params.attachments } : {}),
    // Absent rather than empty, so a message with no copies is byte-identical to before.
    ...(params.cc && params.cc.length > 0 ? { cc: params.cc } : {}),
    ...(params.bcc && params.bcc.length > 0 ? { bcc: params.bcc } : {}),
  };
}
