import type { EmailLocale, OutgoingEmail } from "@/infrastructure/email/adapter";
import type { EmailMessageType } from "@/db/schema/email-outbox";

/**
 * The ten message types of AGENTS.md §16.3 (BR-REQ-080-01), in Romanian and English.
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
  /** Present only when the message carries an action link. */
  action?: { label: string; url: string };
  closing: string;
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
    ...content.paragraphs,
    ...(content.action ? ["", `${content.action.label}: ${content.action.url}`] : []),
    "",
    content.closing,
    SIGN_OFF[locale],
  ];

  const htmlParts = [
    `<p>${escapeHtml(content.greeting)}</p>`,
    ...content.paragraphs.map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`),
    ...(content.action
      ? [`<p><a href="${content.action.url}">${escapeHtml(content.action.label)}</a></p>`]
      : []),
    `<p>${escapeHtml(content.closing)}<br>${escapeHtml(SIGN_OFF[locale])}</p>`,
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
};

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
      body: (d: TemplateData) => [
        `Înscrierea ta la ${d.eventTitle ?? "eveniment"} este confirmată. Te așteptăm${d.eventLocationName ? ` la ${d.eventLocationName}` : ""}${d.eventStartsAtFormatted ? `, ${d.eventStartsAtFormatted}` : ""}.`,
        "Poți gestiona sau anula înscrierea oricând, folosind linkul de mai jos.",
      ],
      action: "Gestionează înscrierea",
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
      subject: "Linkul tău de gestionare a profilului",
      body: () => ["Iată linkul cu care poți edita profilul tău public de alergător."],
      action: "Gestionează profilul",
    },
    registrationStateNotice: {
      subject: "Starea înscrierii tale",
      body: (d: TemplateData) => [
        `Înscrierea ta la ${d.eventTitle ?? "eveniment"} are starea: ${d.currentStatus ?? "necunoscută"}.`,
      ],
    },
    closing: "Alergare plăcută,",
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
    registrationConfirmed: {
      subject: "Your registration is confirmed",
      body: (d: TemplateData) => [
        `Your registration for ${d.eventTitle ?? "the event"} is confirmed. See you${d.eventLocationName ? ` at ${d.eventLocationName}` : ""}${d.eventStartsAtFormatted ? `, ${d.eventStartsAtFormatted}` : ""}.`,
        "You can manage or cancel your registration at any time using the link below.",
      ],
      action: "Manage your registration",
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
      subject: "Your profile management link",
      body: () => ["Here is the link to edit your public runner profile."],
      action: "Manage your profile",
    },
    registrationStateNotice: {
      subject: "Your registration status",
      body: (d: TemplateData) => [
        `Your registration for ${d.eventTitle ?? "the event"} currently has this status: ${d.currentStatus ?? "unknown"}.`,
      ],
    },
    closing: "Happy running,",
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
  const entry = copy[key] as { subject: string; body: (d: TemplateData) => string[]; action?: string };

  return {
    subject: entry.subject,
    greeting: copy.hi(data.participantName),
    paragraphs: entry.body(data),
    action: entry.action && actionUrl ? { label: entry.action, url: actionUrl } : undefined,
    closing: copy.closing,
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
