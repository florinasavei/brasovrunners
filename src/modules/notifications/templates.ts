import type { EmailLocale, OutgoingEmail } from "@/infrastructure/email/adapter";
import type { EmailMessageType } from "@/db/schema/email-outbox";
import { emailBodyParts, readEmailBody, type EmailBodyPart } from "./domain/email-rich-text";
import { copyFor, type EmailCopy, fillPlaceholders } from "./domain/email-copy";
import type { EventChangeKind } from "@/modules/events/domain/event-changes";
import { COLOR } from "@/theme/brand";
import { getPathname } from "@/i18n/navigation";
import { env } from "@/shared/config/env";

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
  /** Further links after the action — the signed declaration as a PDF (§95). */
  links?: { label: string; url: string }[];
  /** Present on the confirmation: the QR the participant shows to pick up their number. */
  image?: { url: string; alt: string; caption: string };
  closing: string;
  /** "Reply to this email with questions" — on every message when the club has a reply address. */
  footer?: string;
  /**
   * Who sends this and where the privacy notice is (§323) — the last line of every participant
   * message: the sentence, then the notice's address in the message's language as a link.
   */
  privacy?: { text: string; url: string };
};

const SIGN_OFF: Record<EmailLocale, string> = {
  ro: "Echipa Brașov Runners",
  en: "The Brașov Runners team",
};

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
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
    ...(content.image ? ["", `${content.image.caption}: ${content.image.url}`] : []),
    ...(content.action ? ["", `${content.action.label}: ${content.action.url}`] : []),
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
  const logo = `<img src="${env.APP_BASE_URL}/brand/logo-email-banner.png" alt="Bra&#536;ov Runners" width="600" style="display:block;width:100%;max-width:600px;height:auto;border:0">`;
  /**
   * The header is a **white banner**, and the message declares itself a light-scheme document
   * (§218; Dani: "this email header looks ugly! it should be a banner with white background").
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
    ...(data.eventLocationNameOther ? { eventLocationName: data.eventLocationNameOther } : {}),
    ...(data.eventProgrammeOther ? { eventProgramme: data.eventProgrammeOther } : {}),
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
  eventLocationName?: string;
  /**
   * The place in the other language's words, for the bilingual message's second half — set only
   * while the place is to be announced (§328), when the "place" is a sentence and not a name.
   */
  eventLocationNameOther?: string;
  eventStartsAtFormatted?: string;
  /** The same instant in the other language's words, for the bilingual message's second half (§96). */
  eventStartsAtFormattedOther?: string;
  /** A race's gun time, "10:00", when it has one apart from the gathering (§71); on the update notice (§331). */
  eventRaceStartsAtFormatted?: string;
  currentStatus?: string;
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
  /** Set when the club has a reply address: the footer says to use it. */
  replyTo?: string;
  /** The thank-you's optional link — results, photos (§82). Carried in the payload, not a token. */
  thanksUrl?: string;
  /** The signed declaration as a PDF, on the confirmation (§95): the same manage token, read-only. */
  declarationPdfUrl?: string;
  /** When it was signed, formatted for the locale — on the declaration's own message. */
  signedAtFormatted?: string;
  /** The event's public page, and the manage page (§96): the deep links under the action. */
  eventUrl?: string;
  /** The rules on that page, when the organizer wrote some (§96). */
  eventRulesUrl?: string;
  /** The programme on that page, when there is one (§96). */
  eventScheduleUrl?: string;
  /** "Linkuri și fișiere" on that page (`#links`), when the event has any (§332); on the confirmation and the reminder. */
  eventLinksUrl?: string;
  /** The programme's rows as lines, in the message's language and in the other's (§117); on the reminder. */
  eventProgramme?: string[];
  eventProgrammeOther?: string[];
  /**
   * When the hold on the place lapses, in the event's zone (§104); on `COMPLETE_DECLARATION`,
   * and only while it is ahead — past it the place is kept for as long as nobody waits (§160).
   */
  holdExpiresAtFormatted?: string;
  /** True when the hold is the participation window's (§104), not the thirty minutes. */
  confirmLater?: boolean;
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
  /** The organizer's own words on that message, plain text, at most 500 characters. */
  organizerNote?: string;
  /** Why the event was cancelled, as the organizer typed it (§331). */
  cancellationReason?: string;
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

/** The bold line and its links, shared by the confirmation and the reminder. */
function eventFacts(d: TemplateData, labels: { map: string; strava: string }) {
  const line = [d.eventStartsAtFormatted, d.eventLocationName].filter(Boolean).join(" · ");
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
      body: (d: TemplateData) => [
        `Ai început înscrierea la ${d.eventTitle ?? "eveniment"}. Pentru a continua, confirmă adresa ta de email.`,
        "Dacă nu ai solicitat această înscriere, poți ignora acest mesaj.",
      ],
      action: "Confirmă adresa de email",
    },
    completeDeclaration: {
      subject: (d: TemplateData) =>
        d.confirmLater
          ? `Ești înscris — confirmă participarea până la ${d.holdExpiresAtFormatted ?? "termen"}`
          : "Un loc te așteaptă — semnează declarația",
      body: (d: TemplateData) => [
        d.confirmLater
          ? `Locul tău la ${d.eventTitle ?? "eveniment"} este rezervat. Cursa e gratuită, așa că îți cerem o confirmare: înscrierea este completă doar cu declarația pe proprie răspundere semnată. Poți semna acum, din linkul de mai jos, sau când îți reamintim cu o săptămână înainte de start.`
          : `Un loc la ${d.eventTitle ?? "eveniment"} este rezervat pentru tine. Înscrierea este completă doar cu declarația pe proprie răspundere semnată — citește-o și semneaz-o din linkul de mai jos.`,
        `Dacă nu apuci online, semnezi declarația pe hârtie la masa de înscrieri, în ziua cursei, înainte să-ți ridici numărul.${d.holdExpiresAtFormatted ? ` Dacă se formează lista de așteptare, locul îți este ținut până la ${d.holdExpiresAtFormatted}; până atunci semnează.` : ""}`,
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
      body: (d: TemplateData) => [
        `S-a eliberat un loc la ${d.eventTitle ?? "eveniment"}. Ai la dispoziție un timp limitat pentru a-l confirma, semnând declarația pe proprie răspundere.`,
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
        `${d.eventTitle ?? "Evenimentul"} este peste două zile. Iată ce ai nevoie.`,
        ...(d.eventProgramme?.length ? [`Programul: ${d.eventProgramme.join("; ")}.`] : []),
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
        `Atașată găsești declarația pe proprie răspundere pe care ai semnat-o pentru ${d.eventTitle ?? "eveniment"}${d.signedAtFormatted ? `, la ${d.signedAtFormatted}` : ""}. Păstreaz-o: este copia ta.`,
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
        `Atașată este declarația pe proprie răspundere semnată de ${d.participantName || "participant"} pentru ${d.eventTitle ?? "eveniment"}${d.signedAtFormatted ? `, la ${d.signedAtFormatted}` : ""}.`,
        // The PDF attached masks the identity document (§320); the sentence says where the whole one is, and until when.
        "Copia pentru arhiva clubului, fără seria și numărul actului de identitate. Se păstrează trei ani după eveniment, ca în nota de confidențialitate; documentul întreg este în PDF-ul cu toate declarațiile de pe pagina evenimentului din backoffice, până la șapte zile după eveniment.",
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
      subject: "Ești în echipa Brașov Runners",
      body: (d: TemplateData) => [
        `${d.inviterName || "Un coleg"} te-a adăugat în echipa care administrează site-ul Brașov Runners, ca ${d.staffRole ?? "membru al echipei"}.`,
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
      subject: "Înscrierile tale la Brașov Runners",
      body: () => [
        "Iată linkul cu care vezi toate înscrierile tale active: starea fiecăreia, codul de acces și codul QR pentru ziua cursei, și posibilitatea de a renunța.",
        "Linkul este valabil 14 zile și doar pentru tine.",
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
        "Înscrierea ta rămâne așa cum era și nu trebuie să faci nimic. Pagina evenimentului are mereu detaliile la zi.",
      ],
      action: "Vezi pagina evenimentului",
    },
    eventCancelled: {
      subject: (d: TemplateData) => `Evenimentul „${d.eventTitle ?? "Brașov Runners"}” a fost anulat`,
      body: (d: TemplateData) => [
        `Ne pare rău: evenimentul „${d.eventTitle ?? "Brașov Runners"}”${d.eventStartsAtFormatted ? `, programat ${d.eventStartsAtFormatted},` : ""} a fost anulat.`,
        "Înscrierea ta rămâne la noi ca înregistrare și nu trebuie să faci nimic: nu e nevoie să o anulezi.",
        `Pentru întrebări, scrie-ne din pagina de contact (linkul „Scrie-ne” de mai jos)${d.replyTo ? " sau răspunde la acest email" : ""}.`,
      ],
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
    footer: "Răspunde la acest email pentru întrebări.",
    /** The club's copy of a participant's message (§320): in front of the subject, and the first line. */
    clubCopy: {
      subject: "[Copie club] ",
      note: "Copie pentru club a mesajului trimis participantului. Legăturile personale, codul QR și atașamentele au fost scoase.",
    },
    /** Who sends it, and the notice (§323); the address follows the sentence. */
    privacyFooter: (club: string) => `Primești acest mesaj de la ${club} pentru înscrierea ta. Cum folosim datele tale:`,
    /** The same for "registration is open" (§146), which answers a request, not a registration. */
    privacyFooterInterest: (club: string) =>
      `Primești acest mesaj de la ${club} pentru că ai cerut să fii anunțat. Cum folosim datele tale:`,
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
        `You started registering for ${d.eventTitle ?? "an event"}. To continue, confirm your email address.`,
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
          ? `Your place at ${d.eventTitle ?? "the event"} is held. The race is free, so we ask for a confirmation: the registration is complete only with the signed declaration of own responsibility. You can sign now, from the link below, or when we remind you a week before the start.`
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
        `A place at ${d.eventTitle ?? "the event"} has opened up. You have limited time to confirm it by signing the event declaration.`,
      ],
      action: "Confirm the place",
    },
    eventReminder: {
      subject: "See you soon — the details for race day",
      facts: (d: TemplateData) => eventFacts(d, { map: "Map of the meeting point", strava: "The event on Strava" }),
      body: (d: TemplateData) => [
        `${d.eventTitle ?? "The event"} is two days away. Here is what you need.`,
        ...(d.eventProgramme?.length ? [`The programme: ${d.eventProgramme.join("; ")}.`] : []),
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
        "The club's archive copy, without the identity document's series and number. Kept three years after the event, as the privacy notice says; the full document is in the event's declarations PDF in the backoffice until seven days after the event.",
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
      subject: "You are on the Brașov Runners team",
      body: (d: TemplateData) => [
        `${d.inviterName || "A colleague"} added you to the team that runs the Brașov Runners website, as ${d.staffRole ?? "a team member"}.`,
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
      subject: "Your registrations at Brașov Runners",
      body: () => [
        "Here is the link to every active registration of yours: the state of each, the access code and QR for race day, and the option to withdraw.",
        "The link is valid for 14 days and only for you.",
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
        "Your registration stays as it was and there is nothing you need to do. The event's page always has the latest details.",
      ],
      action: "See the event's page",
    },
    eventCancelled: {
      subject: (d: TemplateData) => `“${d.eventTitle ?? "Brașov Runners"}” has been cancelled`,
      body: (d: TemplateData) => [
        `We are sorry: “${d.eventTitle ?? "Brașov Runners"}”${d.eventStartsAtFormatted ? `, planned for ${d.eventStartsAtFormatted},` : ""} has been cancelled.`,
        "Your registration stays with us as a record, and there is nothing you need to do: you do not need to cancel it.",
        `For questions, write to us from the contact page (the “Write to us” link below)${d.replyTo ? " or reply to this email" : ""}.`,
      ],
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
    footer: "Reply to this email with questions.",
    clubCopy: {
      subject: "[Club copy] ",
      note: "Club copy of the message sent to the participant. The personal links, the QR code and the attachments have been removed.",
    },
    privacyFooter: (club: string) => `This message comes from ${club} about your registration. How we use your data:`,
    privacyFooterInterest: (club: string) => `This message comes from ${club} because you asked to be told. How we use your data:`,
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
};

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
  let data: TemplateData = { ...given, privacyUrl };
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
    data = { ...data, manageUrl: undefined, listConsentUrl: undefined, declarationPdfUrl: undefined, checkinCode: undefined, checkinQrUrl: undefined, thanksUrl: undefined };
    actionUrl = undefined;
  }
  // TypeScript can't see that every key but "hi"/"closing" shares this shape; the
  // `KEY_BY_MESSAGE_TYPE` map is what actually guarantees it.
  const entry = copy[key] as {
    subject: string | ((d: TemplateData) => string);
    body: (d: TemplateData) => string[];
    /** The archive copy greets the club, not the participant whose name is in the subject. */
    greeting?: (d: TemplateData) => string;
    action?: string;
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
  const written = copyFor(overrides, messageType, locale);
  const writtenBody = written?.body ? readEmailBody(written.body) : null;
  const fill = (text: string) => fillPlaceholders(text, data as unknown as Record<string, unknown>);

  const subject = written
    ? fill(written.subject)
    : typeof entry.subject === "function"
      ? entry.subject(data)
      : entry.subject;

  return {
    // Each half of a bilingual subject carries its own language's mark, so a mailbox filter on
    // either word finds every copy whichever language the runner chose (§96).
    subject: clubCopy ? `${copy.clubCopy.subject}${subject}` : subject,
    greeting: entry.greeting ? entry.greeting(data) : copy.hi(data.participantName),
    facts: entry.facts?.(data),
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
      // What this is, before anything else is read (§320).
      ...(clubCopy ? [copy.clubCopy.note] : []),
      // The number when the message carries one: a settled number, or the provisional one the
      // desk gave, whichever this registration actually has (§286).
      ...(data.alreadyRegistered ? [copy.alreadyRegistered(data.bibNumber ?? null)] : []),
      /*
        The club's own words, with their formatting when it wrote them in the editor (§270).
        A stored document that cannot be read — an older shape, a node an email may not carry —
        falls back to the plain paragraphs beside it rather than to nothing, which is the same
        direction `readEmailCopy` takes with an unreadable setting: a message still goes out.
      */
      ...(writtenBody
        ? emailBodyParts(writtenBody, data as unknown as Record<string, unknown>)
        : written
          ? written.paragraphs.map(fill)
          : entry.body(data)),
      // What changed and the organizer's own words, after the body and whoever wrote it (§331).
      ...noticeParts(messageType, locale, data),
      // After the body, not before it: the number is in the body already, and this only
      // qualifies it (§237).
      ...(data.bibProvisional && data.bibNumber !== undefined
        ? [copy.bibProvisional(data.bibNumber)]
        : []),
    ],
    action: entry.action && actionUrl ? { label: entry.action, url: actionUrl } : undefined,
    image: entry.image?.(data),
    links: (() => {
      const own = entry.links?.(data) ?? [];
      // The club's archive copy and the staff invitation are not a participant's message.
      if (messageType === "DECLARATION_ARCHIVE" || messageType === "STAFF_INVITATION") {
        return own.length > 0 ? own : undefined;
      }
      const seen = new Set(own.map((link) => link.url));
      return [...own, ...standardLinks(data, copy.moreLinks).filter((link) => !seen.has(link.url))];
    })(),
    closing: copy.closing,
    footer: data.replyTo ? copy.footer : undefined,
    // Not on the club's copy either (§320, §324): "this message comes to you about your
    // registration" is addressed to the participant, and the copy lands in the club's mailbox.
    privacy: NOT_A_PARTICIPANT_MESSAGE.has(messageType) || clubCopy
      ? undefined
      : {
          text: (messageType === "REGISTRATION_OPENED" ? copy.privacyFooterInterest : copy.privacyFooter)(controllerName()),
          url: privacyUrl,
        },
  };
}

/**
 * The messages that are not to a participant about their own data (§323), and so carry no
 * privacy line: the club's archive copy and its confirmation notice go to the club's mailboxes,
 * and the staff invitation says what it keeps about the team in its own body.
 */
const NOT_A_PARTICIPANT_MESSAGE: ReadonlySet<EmailMessageType> = new Set([
  "DECLARATION_ARCHIVE",
  "CLUB_CONFIRMATION_NOTICE",
  "STAFF_INVITATION",
]);

/**
 * Who the controller is, as the privacy line names it (§323): the club's legal name from the
 * environment (`CLUB_LEGAL_NAME`, the same fact the legal templates are filled with), else the
 * club's everyday name. Never a literal of the legal name: the repository is public (§98).
 */
function controllerName(): string {
  return env.CLUB_LEGAL_NAME ?? "Brașov Runners";
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
