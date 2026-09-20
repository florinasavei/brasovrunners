import type { EmailLocale, OutgoingEmail } from "@/infrastructure/email/adapter";
import type { EmailMessageType } from "@/db/schema/email-outbox";
import { COLOR } from "@/theme/brand";
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
  paragraphs: string[];
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
    ...content.paragraphs,
    ...(content.image ? ["", `${content.image.caption}: ${content.image.url}`] : []),
    ...(content.action ? ["", `${content.action.label}: ${content.action.url}`] : []),
    ...(content.links ?? []).map((link) => `${link.label}: ${link.url}`),
    "",
    content.closing,
    SIGN_OFF[locale],
    ...(content.footer ? ["", content.footer] : []),
  ];

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
    ...content.paragraphs.map((text) => paragraph(escapeHtml(text))),
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
  const logo = `<img src="${env.APP_BASE_URL}/brand/logo-white-email.png" alt="Bra&#536;ov Runners" width="180" height="74" style="display:block;width:180px;height:74px;border:0">`;
  return [
    `<div style="max-width:600px;margin:0 auto;font-family:Roboto,Helvetica,Arial,sans-serif;color:${COLOR.ink}">`,
    `<div style="background:${COLOR.blueInk};color:${COLOR.surface};padding:16px 24px;border-radius:12px 12px 0 0">${logo}</div>`,
    `<div style="padding:24px;border:1px solid ${COLOR.line};border-top:0;border-radius:0 0 12px 12px;background:${COLOR.surface}">`,
    ...blocks.flatMap((parts, index) => (index > 0 ? [rule, ...parts] : parts)),
    "</div></div>",
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
): { subject: string; html: string; text: string } {
  const first = buildTemplateContent(messageType, locale, data, actionUrl);
  // The second language repeats the words, not the picture: one QR per message is enough —
  // and its date is its own ("Sunday 11 October", not "duminică").
  const otherData: TemplateData = {
    ...data,
    ...(data.eventStartsAtFormattedOther ? { eventStartsAtFormatted: data.eventStartsAtFormattedOther } : {}),
    ...(data.eventProgrammeOther ? { eventProgramme: data.eventProgrammeOther } : {}),
  };
  const second = { ...buildTemplateContent(messageType, OTHER_LOCALE[locale], otherData, actionUrl), image: undefined };
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
  eventTitle?: string;
  eventLocationName?: string;
  eventStartsAtFormatted?: string;
  /** The same instant in the other language's words, for the bilingual message's second half (§96). */
  eventStartsAtFormattedOther?: string;
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
  /** The staff invitation (§141): who is invited, as what, by whom, and where to sign in. */
  staffRole?: string;
  inviterName?: string;
  staffEmail?: string;
  signInUrl?: string;
};

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

const T = {
  ro: {
    hi: (name: string) => `Salut, ${name},`,
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
        ...(d.bibNumber ? [`Numărul tău de concurs: ${d.bibNumber}. Îl primești la masă, în ziua cursei.`] : []),
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
        ...(d.eventUrl ? [{ label: "Pagina evenimentului", url: d.eventUrl }] : []),
        ...(d.eventScheduleUrl ? [{ label: "Programul evenimentului", url: d.eventScheduleUrl }] : []),
        ...(d.eventRulesUrl ? [{ label: "Regulamentul evenimentului", url: d.eventRulesUrl }] : []),
        ...(d.declarationPdfUrl ? [{ label: "Declarația pe care ai semnat-o (PDF)", url: d.declarationPdfUrl }] : []),
      ],
    },
    eventReminder: {
      subject: "Ne vedem în curând — detaliile pentru ziua cursei",
      facts: (d: TemplateData) => eventFacts(d, { map: "Harta punctului de întâlnire", strava: "Evenimentul pe Strava" }),
      body: (d: TemplateData) => [
        `${d.eventTitle ?? "Evenimentul"} este peste două zile. Iată ce ai nevoie.`,
        ...(d.eventProgramme?.length ? [`Programul: ${d.eventProgramme.join("; ")}.`] : []),
        ...(d.bibNumber ? [`Numărul tău de concurs: ${d.bibNumber}.`] : []),
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
        `Ți-am dat numărul ${d.bibNumber ?? "—"} la ${d.eventTitle ?? "eveniment"}. Îl ridici la masă în ziua cursei${d.checkinCode ? `, cu codul QR de mai jos sau spunând codul ${d.checkinCode}` : ""}.`,
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
        "Copia pentru arhiva clubului. Se păstrează 3 ani după eveniment, ca în nota de informare; același document este și în PDF-ul cu toate declarațiile de pe pagina evenimentului din backoffice.",
      ],
    },
    staffInvitation: {
      subject: "Ești în echipa Brașov Runners",
      body: (d: TemplateData) => [
        `${d.inviterName || "Un coleg"} te-a adăugat în echipa care administrează site-ul Brașov Runners, ca ${d.staffRole ?? "membru al echipei"}.`,
        `Intri cu adresa ${d.staffEmail ?? "aceasta"}: dacă nu ai încă un cont, îl faci din pagina de autentificare, cu exact această adresă (contul e legat de adresă). Accesul începe la prima autentificare.`,
      ],
      action: "Intră în backoffice",
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
    closing: "Alergare plăcută,",
    footer: "Răspunde la acest email pentru întrebări.",
  },
  en: {
    hi: (name: string) => `Hi ${name},`,
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
        ...(d.bibNumber ? [`Your race number: ${d.bibNumber}.`] : []),
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
        `You have number ${d.bibNumber ?? "—"} at ${d.eventTitle ?? "the event"}. Collect it at the desk on race day${d.checkinCode ? `, with the QR code below or by saying the code ${d.checkinCode}` : ""}.`,
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
        "The club's archive copy. Kept for 3 years after the event, as the privacy notice says; the same document is in the all-declarations PDF on the event's backoffice page.",
      ],
    },
    staffInvitation: {
      subject: "You are on the Brașov Runners team",
      body: (d: TemplateData) => [
        `${d.inviterName || "A colleague"} added you to the team that runs the Brașov Runners website, as ${d.staffRole ?? "a team member"}.`,
        `You sign in with ${d.staffEmail ?? "this address"}: if you have no account yet, create one at the sign-in page with exactly this address (the account is tied to the address). Access begins at your first sign-in.`,
      ],
      action: "Open the backoffice",
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
        ...(d.eventUrl ? [{ label: "The event's page", url: d.eventUrl }] : []),
        ...(d.eventScheduleUrl ? [{ label: "The event's programme", url: d.eventScheduleUrl }] : []),
        ...(d.eventRulesUrl ? [{ label: "The event's rules", url: d.eventRulesUrl }] : []),
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
    closing: "Happy running,",
    footer: "Reply to this email with questions.",
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
};

/**
 * Every message type's content, for one locale, given the data the renderer looked up.
 * `actionUrl` is undefined for the message types that carry none — `REGISTRATION_STATE_NOTICE`
 * (§16.3: "carries no scoped token and creates none") and the two waiting-list notices, which
 * point participants back at the ordinary event page rather than at a fresh action link.
 */
export function buildTemplateContent(
  messageType: EmailMessageType,
  locale: EmailLocale,
  data: TemplateData,
  actionUrl: string | undefined,
): TemplateContent {
  const copy = T[locale];
  const key = KEY_BY_MESSAGE_TYPE[messageType];
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

  return {
    subject: typeof entry.subject === "function" ? entry.subject(data) : entry.subject,
    greeting: entry.greeting ? entry.greeting(data) : copy.hi(data.participantName),
    facts: entry.facts?.(data),
    paragraphs: entry.body(data),
    action: entry.action && actionUrl ? { label: entry.action, url: actionUrl } : undefined,
    image: entry.image?.(data),
    links: entry.links?.(data),
    closing: copy.closing,
    footer: data.replyTo ? copy.footer : undefined,
  };
}

export function buildOutgoingEmail(params: {
  to: string;
  locale: EmailLocale;
  idempotencyKey: string;
  messageType: EmailMessageType;
  data: TemplateData;
  actionUrl?: string;
  attachments?: OutgoingEmail["attachments"];
}): OutgoingEmail {
  const { subject, html, text } = renderBilingual(params.messageType, params.locale, params.data, params.actionUrl);
  return {
    to: params.to,
    subject,
    html,
    text,
    locale: params.locale,
    idempotencyKey: params.idempotencyKey,
    ...(params.attachments && params.attachments.length > 0 ? { attachments: params.attachments } : {}),
  };
}
