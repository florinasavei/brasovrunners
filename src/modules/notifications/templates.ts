import type { EmailLocale, OutgoingEmail } from "@/infrastructure/email/adapter";
import type { EmailMessageType } from "@/db/schema/email-outbox";

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

export function renderContent(content: TemplateContent, locale: EmailLocale): { html: string; text: string } {
  const textLines = [
    content.greeting,
    "",
    ...(content.facts
      ? [content.facts.line, ...content.facts.links.map((link) => `${link.label}: ${link.url}`), ""]
      : []),
    ...content.paragraphs,
    ...(content.image ? ["", `${content.image.caption}: ${content.image.url}`] : []),
    ...(content.action ? ["", `${content.action.label}: ${content.action.url}`] : []),
    "",
    content.closing,
    SIGN_OFF[locale],
    ...(content.footer ? ["", content.footer] : []),
  ];

  const htmlParts = [
    `<p>${escapeHtml(content.greeting)}</p>`,
    // The facts first and bold: what the eye finds on a phone the morning of.
    ...(content.facts
      ? [
          `<p><strong>${escapeHtml(content.facts.line)}</strong>${content.facts.links
            .map((link) => `<br><a href="${link.url}">${escapeHtml(link.label)}</a>`)
            .join("")}</p>`,
        ]
      : []),
    ...content.paragraphs.map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`),
    // A hosted image, never a data URI: several mail clients strip inline data, and a QR that
    // does not render is a participant at the desk with nothing to show.
    ...(content.image
      ? [
          `<p><img src="${content.image.url}" alt="${escapeHtml(content.image.alt)}" width="240" height="240" style="display:block;width:240px;height:240px"></p>`,
          `<p>${escapeHtml(content.image.caption)}</p>`,
        ]
      : []),
    ...(content.action
      ? [`<p><a href="${content.action.url}">${escapeHtml(content.action.label)}</a></p>`]
      : []),
    `<p>${escapeHtml(content.closing)}<br>${escapeHtml(SIGN_OFF[locale])}</p>`,
    ...(content.footer ? [`<p style="color:#666;font-size:13px">${escapeHtml(content.footer)}</p>`] : []),
  ];

  return { html: htmlParts.join("\n"), text: textLines.join("\n") };
}

/** What every template needs beyond the locale — never a rendered body, never a token. */
export type TemplateData = {
  participantName: string;
  eventTitle?: string;
  eventLocationName?: string;
  eventStartsAtFormatted?: string;
  currentStatus?: string;
  /** The desk code and the address of its QR image, on the confirmation and the reminder (BR-REQ-037-08). */
  checkinCode?: string;
  checkinQrUrl?: string;
  /** The event's map link and Strava event link, when set (§81). */
  eventMapUrl?: string;
  eventStravaEventUrl?: string;
  /** "What to bring", the translation's one line (§81). */
  eventChecklist?: string;
  /** Set when the club has a reply address: the footer says to use it. */
  replyTo?: string;
  /** The thank-you's optional link — results, photos (§82). Carried in the payload, not a token. */
  thanksUrl?: string;
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
      subject: "Un loc te așteaptă — semnează declarația",
      body: (d: TemplateData) => [
        `Un loc la ${d.eventTitle ?? "eveniment"} este rezervat pentru tine. Pentru a finaliza înscrierea, citește și semnează declarația pe proprie răspundere.`,
      ],
      action: "Semnează declarația",
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
        ...(d.eventChecklist ? [`Ce să aduci: ${d.eventChecklist}`] : []),
        ...(d.checkinCode
          ? [`La ridicarea numărului de concurs arată codul QR de mai jos sau spune codul ${d.checkinCode}.`]
          : []),
        "Poți gestiona sau anula înscrierea oricând, folosind linkul de mai jos.",
      ],
      action: "Gestionează înscrierea",
      image: (d: TemplateData) => (d.checkinQrUrl ? { url: d.checkinQrUrl, alt: `Cod QR ${d.checkinCode ?? ""}`, caption: `Codul tău: ${d.checkinCode ?? ""}` } : undefined),
    },
    eventReminder: {
      subject: "Ne vedem în curând — detaliile pentru ziua cursei",
      facts: (d: TemplateData) => eventFacts(d, { map: "Harta punctului de întâlnire", strava: "Evenimentul pe Strava" }),
      body: (d: TemplateData) => [
        `${d.eventTitle ?? "Evenimentul"} este peste două zile. Iată ce ai nevoie.`,
        ...(d.eventChecklist ? [`Ce să aduci: ${d.eventChecklist}`] : []),
        ...(d.checkinCode
          ? [`La masă arată codul QR de mai jos sau spune codul ${d.checkinCode}.`]
          : []),
        "Nu poți veni? Anulează înscrierea cu linkul de mai jos — locul tău merge la cineva de pe lista de așteptare.",
      ],
      action: "Nu pot veni — anulez înscrierea",
      image: (d: TemplateData) => (d.checkinQrUrl ? { url: d.checkinQrUrl, alt: `Cod QR ${d.checkinCode ?? ""}`, caption: `Codul tău: ${d.checkinCode ?? ""}` } : undefined),
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
      subject: "A place is waiting — sign the declaration",
      body: (d: TemplateData) => [
        `A place at ${d.eventTitle ?? "the event"} is held for you. To finish registering, read and sign the event declaration.`,
      ],
      action: "Sign the declaration",
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
        ...(d.eventChecklist ? [`What to bring: ${d.eventChecklist}`] : []),
        ...(d.checkinCode ? [`At the desk show the QR code below or say the code ${d.checkinCode}.`] : []),
        "Can't come? Cancel with the link below — your place goes to somebody on the waiting list.",
      ],
      action: "I can't come — cancel my registration",
      image: (d: TemplateData) => (d.checkinQrUrl ? { url: d.checkinQrUrl, alt: `QR code ${d.checkinCode ?? ""}`, caption: `Your code: ${d.checkinCode ?? ""}` } : undefined),
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
    registrationConfirmed: {
      subject: "Your registration is confirmed",
      facts: (d: TemplateData) => eventFacts(d, { map: "Map of the meeting point", strava: "The event on Strava" }),
      body: (d: TemplateData) => [
        `Your registration for ${d.eventTitle ?? "the event"} is confirmed. See you there!`,
        ...(d.eventChecklist ? [`What to bring: ${d.eventChecklist}`] : []),
        ...(d.checkinCode
          ? [`When you pick up your race number, show the QR code below or say the code ${d.checkinCode}.`]
          : []),
        "You can manage or cancel your registration at any time with the link below.",
      ],
      action: "Manage your registration",
      image: (d: TemplateData) => (d.checkinQrUrl ? { url: d.checkinQrUrl, alt: `QR code ${d.checkinCode ?? ""}`, caption: `Your code: ${d.checkinCode ?? ""}` } : undefined),
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
    subject: string;
    body: (d: TemplateData) => string[];
    action?: string;
    facts?: (d: TemplateData) => TemplateContent["facts"];
    image?: (d: TemplateData) => TemplateContent["image"];
  };

  return {
    subject: entry.subject,
    greeting: copy.hi(data.participantName),
    facts: entry.facts?.(data),
    paragraphs: entry.body(data),
    action: entry.action && actionUrl ? { label: entry.action, url: actionUrl } : undefined,
    image: entry.image?.(data),
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
}): OutgoingEmail {
  const content = buildTemplateContent(params.messageType, params.locale, params.data, params.actionUrl);
  const { html, text } = renderContent(content, params.locale);
  return {
    to: params.to,
    subject: content.subject,
    html,
    text,
    locale: params.locale,
    idempotencyKey: params.idempotencyKey,
  };
}
