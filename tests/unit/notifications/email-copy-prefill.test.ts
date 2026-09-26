import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { emailMessageType, type EmailMessageType } from "@/db/schema/email-outbox";
import { fromPlainText, type RichTextDoc } from "@/modules/content/rich-text/domain/schema";
import {
  EMAIL_COPY_PLACEHOLDERS,
  emailCopyKey,
  emailCopySchema,
  placeholdersIn,
  unknownPlaceholders,
  type EmailCopy,
  type EmailCopyPlaceholder,
} from "@/modules/notifications/domain/email-copy";
import { emailBodyToParagraphs, readEmailBody, renderEmailBody } from "@/modules/notifications/domain/email-rich-text";
import {
  EMAIL_SAMPLE,
  EMAIL_SAMPLE_FORMER_WHEN,
  EMAIL_SAMPLE_LITERALS,
  emailSampleLiteralsIn,
} from "@/modules/notifications/domain/email-sample";
import {
  emailCopyPrefill,
  emailSampleActionUrl,
  emailSampleData,
  placeholdersUsedBy,
  replaceSampleValues,
  sampleLanguagesOf,
  sampleValuesIn,
} from "@/modules/notifications/email-copy-fields";
import { buildTemplateContent, renderBilingual, type TemplateData } from "@/modules/notifications/templates";

/**
 * BR-REQ-080-01, `DECISIONS.md` §359 — the editor starts from the platform's words with the
 * fields in them, and no sample value is ever stored as the club's words.
 *
 * The owner, 2026-09-24, with a screenshot of "Confirmă adresa de email": the editable text read
 * "Ai început înscrierea la Crosul de toamnă" — the page's sample event — and a Redactor saving it
 * would have sent that title to every participant of every event. "Also all emails text must
 * include these placeholders!"
 */
/**
 * Every message the club's words editor is under. Not the organizer's message (§364): it is written
 * per send, on the event's page — the page draws no editor for it, the save refuses an entry for it
 * and the send ignores one — so its card is pinned below, on its own.
 */
// The newsletter (§NNN) is written per send too, in its own composer.
type EditedType = Exclude<EmailMessageType, "ORGANIZER_MESSAGE" | "NEWSLETTER">;
const TYPES = (emailMessageType.enumValues as readonly EmailMessageType[]).filter(
  (type): type is EditedType => type !== "ORGANIZER_MESSAGE" && type !== "NEWSLETTER",
);
const LOCALES = ["ro", "en"] as const;

/** What each message's platform text is made of, field by field, in both languages. */
const EXPECTED: Record<EditedType, EmailCopyPlaceholder[]> = {
  // Whose registration, and how long the link lives (§419).
  VERIFY_REGISTRATION_EMAIL: ["participantName", "eventTitle", "confirmationHours"],
  COMPLETE_DECLARATION: ["eventTitle", "holdExpiresAtFormatted"],
  WAITLIST_JOINED: ["eventTitle"],
  // The offer's moment and its length (§419).
  WAITLIST_SPOT_OFFER: ["eventTitle", "holdExpiresAtFormatted", "offerHours"],
  REGISTRATION_CONFIRMED: ["eventTitle", "bibNumber", "checkinCode", "eventChecklist"],
  REGISTRATION_CANCELLED: ["eventTitle"],
  WAITLIST_OFFER_EXPIRED: ["eventTitle"],
  REGISTRATION_MANAGE_LINK: [],
  PROFILE_MANAGE_LINK: [],
  REGISTRATION_STATE_NOTICE: ["eventTitle", "currentStatus"],
  EVENT_REMINDER: ["eventTitle", "bibNumber", "checkinCode", "eventChecklist"],
  EVENT_THANKS: ["eventTitle"],
  DECLARATION_SIGNED: ["eventTitle", "signedAtFormatted"],
  DECLARATION_ARCHIVE: ["participantName", "eventTitle", "signedAtFormatted"],
  BIB_ASSIGNED: ["eventTitle", "bibNumber", "checkinCode"],
  STAFF_INVITATION: ["staffRole", "inviterName"],
  REGISTRATION_OPENED: ["eventTitle"],
  CLUB_CONFIRMATION_NOTICE: ["participantName", "eventTitle", "eventStartsAtFormatted", "bibNumber"],
  EVENT_UPDATE_NOTICE: ["eventTitle"],
  EVENT_CANCELLED: ["eventTitle", "eventStartsAtFormatted"],
  // A group run's self-declaration (§393): the signer's copy and the club's.
  GROUP_RUN_DECLARATION_SIGNED: ["eventTitle", "signedAtFormatted"],
  GROUP_RUN_DECLARATION_ARCHIVE: ["participantName", "eventTitle", "signedAtFormatted"],
  // The link's shape (§389): the event and the link's lifetime, which is the club's email-link window.
  REGISTER_ANOTHER_PERSON: ["eventTitle", "confirmationHours"],
  // The newsletter (§NNN): the confirmation names nothing — the topics and the link's lifetime are
  // the platform's own lines after the words — and the new-event alert names its event.
  NEWSLETTER_CONFIRM: [],
  NEW_EVENT_ALERT: ["eventTitle"],
};

/**
 * Every value of the page's sample that could leak into words, in both languages, as whole words.
 * Not the status: "confirmată" is also the platform's own word in "este confirmată", and the status
 * placeholder is asserted where it belongs (`EXPECTED`).
 */
const SAMPLE_WORDS = [
  ...EMAIL_SAMPLE_LITERALS.map((literal) => literal.value),
  ...LOCALES.flatMap((locale) => [EMAIL_SAMPLE[locale].organizerNote, EMAIL_SAMPLE[locale].cancellationReason]),
  "42",
];
const asWord = (word: string) => new RegExp(`(?<![\\p{L}\\p{N}])${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}\\p{N}])`, "u");

/**
 * A real message's facts, every field present, none of them the sample's: what a send carries.
 * Branches as the starting text takes them — no thank-you link, the thirty-minute hold, no
 * colleague's address (`email-copy-fields.ts` says why for each).
 */
const REAL: TemplateData = {
  participantName: "Maria Ionescu",
  eventTitle: "Maratonul <Bucegi> & prieteni",
  eventLocationName: "Piața Sfatului",
  eventStartsAtFormatted: "sâmbătă, 21 nov. 2026, 10:00",
  eventStartsAtFormattedOther: "Saturday, 21 Nov 2026, 10:00",
  currentStatus: "WAITLISTED",
  checkinCode: "QWE123",
  checkinQrUrl: "https://example.test/qr/QWE123.png",
  bibNumber: 7,
  eventChecklist: "Frontală și apă",
  holdExpiresAtFormatted: "vineri, 20 nov. 2026, 12:00",
  holdExpiresAtFormattedOther: "Friday, 20 Nov 2026, 12:00",
  signedAtFormatted: "joi, 19 nov. 2026, 18:00",
  signedAtFormattedOther: "Thursday, 19 Nov 2026, 18:00",
  staffRole: "Redactor",
  inviterName: "Dan",
  eventUrl: "https://example.test/ro/e",
  manageUrl: "https://example.test/manage",
  declarationPdfUrl: "https://example.test/pdf",
};
const ACTION = "https://example.test/ro/action/secret";

/**
 * The same facts as a send so often has them (`render.ts`): no number yet, no checklist, no desk
 * code, the hold's deadline behind us. `BIB_ASSIGNED` is the one message never queued without a
 * number (`admin-service.ts`, `maintenance.ts`), so it keeps one.
 */
function sparse(messageType: EmailMessageType): TemplateData {
  const data: TemplateData = { ...REAL };
  for (const key of ["eventChecklist", "checkinCode", "checkinQrUrl", "holdExpiresAtFormatted", "holdExpiresAtFormattedOther"] as const) delete data[key];
  if (messageType !== "BIB_ASSIGNED") delete data.bibNumber;
  return data;
}

/** The starting text saved unchanged, in both languages, as the editor would post it. */
function savedPrefill(messageType: EmailMessageType): EmailCopy {
  return emailCopySchema.parse(
    Object.fromEntries(
      LOCALES.map((locale) => {
        const prefill = emailCopyPrefill(messageType, locale);
        return [emailCopyKey(messageType, locale), { subject: prefill.subject, paragraphs: prefill.paragraphs, body: prefill.body }];
      }),
    ),
  );
}

/** The paragraph both the platform's sentences and the club's words are drawn as. */
const P = '<p style="margin:0 0 14px;font-size:16px;line-height:1.5">';

/**
 * Where the starting text starts a paragraph the platform's own message does not (§359,
 * `ownParagraphsOf`): at the sentence the platform tacks on to the one before only when a fact
 * exists — the hold's deadline, the desk code, the number.
 */
const OWN_PARAGRAPH: Partial<Record<EmailMessageType, Record<(typeof LOCALES)[number], string>>> = {
  COMPLETE_DECLARATION: { ro: "Dacă se formează lista de așteptare", en: "If a waiting list forms" },
  WAITLIST_SPOT_OFFER: { ro: "Este al tău dacă", en: "It is yours if" },
  BIB_ASSIGNED: { ro: "Îl ridici la masă", en: "Collect it at the desk" },
  CLUB_CONFIRMATION_NOTICE: { ro: "Numărul de concurs:", en: "Race number:" },
};

/** `BIB_ASSIGNED`'s second sentence as the platform writes it with no desk code — the club's copy. */
const COLLECT_WITHOUT_CODE = { ro: " Îl ridici la masă în ziua cursei.", en: " Collect it at the desk on race day." };

/**
 * The platform's own message as the starting text saved unchanged sends it, for these facts: the
 * same bytes but for a paragraph break before each sentence in `OWN_PARAGRAPH` that the message
 * carries — and, with no desk code, without `BIB_ASSIGNED`'s "collect it at the desk", which the
 * starting text keeps in the one paragraph with the code, so it goes with the code.
 */
function platformAsSaved(messageType: EmailMessageType, locale: (typeof LOCALES)[number], data: TemplateData) {
  const platform = renderBilingual(messageType, locale, data, ACTION);
  let { html, text } = platform;
  for (const half of LOCALES) {
    if (messageType === "BIB_ASSIGNED" && (data.clubCopy || !data.checkinCode)) {
      html = html.replace(COLLECT_WITHOUT_CODE[half], "");
      text = text.replace(COLLECT_WITHOUT_CODE[half], "");
      continue;
    }
    const opening = OWN_PARAGRAPH[messageType]?.[half];
    if (!opening) continue;
    // The card puts each paragraph on a line of its own.
    html = html.replace(` ${opening}`, `</p>\n${P}${opening}`);
    text = text.replace(` ${opening}`, `\n${opening}`);
  }
  return { subject: platform.subject, html, text };
}

describe("§359 the editor starts from the platform's words, with the fields", () => {
  for (const messageType of TYPES) {
    for (const locale of LOCALES) {
      it(`${messageType} (${locale}): no sample value, and the fields its platform text uses`, () => {
        const prefill = emailCopyPrefill(messageType, locale);
        const text = [prefill.subject, ...prefill.paragraphs].join("\n");
        for (const word of SAMPLE_WORDS) expect(text, `sample value "${word}"`).not.toMatch(asWord(word));
        expect(unknownPlaceholders(text)).toEqual([]);
        expect([...new Set(placeholdersIn(text))].sort()).toEqual([...EXPECTED[messageType]].sort());
        expect(placeholdersUsedBy(messageType, locale)).toEqual(EMAIL_COPY_PLACEHOLDERS.filter((name) => EXPECTED[messageType].includes(name)));
        // A valid entry as it stands: the box can be saved without touching it.
        expect(emailCopySchema.safeParse({ [emailCopyKey(messageType, locale)]: prefill }).success).toBe(true);
        expect(sampleValuesIn(prefill, messageType, locale)).toEqual([]);
      });
    }
  }

  it("is one paragraph block per paragraph, with the platform's bold as bold and no asterisks", () => {
    const { body, paragraphs } = emailCopyPrefill("REGISTRATION_CONFIRMED", "ro");
    expect(body.content).toHaveLength(paragraphs.length);
    expect(JSON.stringify(body)).not.toContain("**");
    const bib = body.content?.[1] as { content: { text: string; marks?: { type: string }[] }[] };
    expect(bib.content.find((run) => run.text === "{bibNumber}")?.marks).toEqual([{ type: "bold" }]);
    expect(paragraphs[1]).toBe("Numărul tău de concurs: {bibNumber}. Îl primești la masă, în ziua cursei.");
  });

  it("leaves out the platform's lines around the words: the update's new place and time are not the club's to repeat", () => {
    const prefill = emailCopyPrefill("EVENT_UPDATE_NOTICE", "ro");
    expect(prefill.paragraphs.join("\n")).not.toContain("Locul de întâlnire este acum");
    expect(prefill.paragraphs.join("\n")).not.toContain("Data și ora sunt acum");
  });

  it("says the invitation's address as the platform's own fallback, since {staffEmail} is not a field", () => {
    expect(emailCopyPrefill("STAFF_INVITATION", "ro").paragraphs[1]).toMatch(/^Intri cu adresa aceasta:/);
    expect(emailCopyPrefill("STAFF_INVITATION", "en").paragraphs[1]).toMatch(/^You sign in with this address:/);
  });

  it("gives each sentence a fact may be missing from a paragraph of its own, and keeps a paragraph that opens with one whole", () => {
    expect(emailCopyPrefill("COMPLETE_DECLARATION", "ro").paragraphs.slice(1)).toEqual([
      "Dacă nu apuci online, semnezi declarația pe hârtie la masa de înscrieri, în ziua cursei, înainte să-ți ridici numărul.",
      "Dacă se formează lista de așteptare, locul îți este ținut până la {holdExpiresAtFormatted}; până atunci semnează.",
    ]);
    expect(emailCopyPrefill("BIB_ASSIGNED", "en").paragraphs).toEqual([
      "You have number {bibNumber} at {eventTitle}.",
      "Collect it at the desk on race day, with the QR code below or by saying the code {checkinCode}.",
      "If an earlier email gave you a different number, this one replaces it.",
    ]);
    expect(emailCopyPrefill("CLUB_CONFIRMATION_NOTICE", "ro").paragraphs.slice(0, 2)).toEqual([
      "{participantName} și-a confirmat înscrierea la {eventTitle}, {eventStartsAtFormatted}.",
      "Numărul de concurs: {bibNumber}.",
    ]);
    // "Îl primești la masă" leans on the number before it: it goes with it, as the platform's does.
    expect(emailCopyPrefill("REGISTRATION_CONFIRMED", "ro").paragraphs).toContain("Numărul tău de concurs: {bibNumber}. Îl primești la masă, în ziua cursei.");
  });
});

describe("§359 what goes out is what went out before", () => {
  for (const messageType of TYPES) {
    for (const locale of LOCALES) {
      it(`${messageType} (${locale}): the starting text saved unchanged sends the platform's message`, () => {
        // Byte for byte, both halves, HTML and plain text — but for the paragraph break before a
        // sentence a fact may be missing from (`OWN_PARAGRAPH`), in three messages.
        expect(renderBilingual(messageType, locale, REAL, ACTION, savedPrefill(messageType))).toEqual(platformAsSaved(messageType, locale, REAL));
        if (!OWN_PARAGRAPH[messageType]) {
          expect(renderBilingual(messageType, locale, REAL, ACTION, savedPrefill(messageType))).toEqual(renderBilingual(messageType, locale, REAL, ACTION));
        }
      });

      it(`${messageType} (${locale}): saved unchanged, it leaves out what the platform leaves out when a fact is missing`, () => {
        // No number, no checklist, no desk code, the hold's deadline past (`sparse`).
        const data = sparse(messageType);
        expect(renderBilingual(messageType, locale, data, ACTION, savedPrefill(messageType))).toEqual(platformAsSaved(messageType, locale, data));
      });

      it(`${messageType} (${locale}): saved unchanged, the club's copy leaves out the desk code's sentence as the platform's does`, () => {
        // Every fact present, but a club copy carries no desk code whatever it is handed (§320).
        const data: TemplateData = { ...REAL, clubCopy: true };
        expect(renderBilingual(messageType, locale, data, ACTION, savedPrefill(messageType))).toEqual(platformAsSaved(messageType, locale, data));
      });

      it(`${messageType} (${locale}): a message the club never rewrote is untouched by everybody else's words`, () => {
        const others = emailCopySchema.parse(
          Object.fromEntries(
            TYPES.filter((other) => other !== messageType).flatMap((other) =>
              LOCALES.map((l) => [emailCopyKey(other, l), { subject: "Altceva {eventTitle}", paragraphs: ["Alte cuvinte, {participantName}."] }]),
            ),
          ),
        );
        expect(renderBilingual(messageType, locale, REAL, ACTION, others)).toEqual(renderBilingual(messageType, locale, REAL, ACTION));
      });
    }
  }

  it("fills a correct override exactly as before: every field, in the subject and in formatted words", () => {
    const overrides = emailCopySchema.parse({
      [emailCopyKey("EVENT_REMINDER", "ro")]: {
        subject: "{eventTitle}: numărul {bibNumber}",
        paragraphs: ["x"],
        body: {
          type: "doc",
          content: [
            { type: "paragraph", content: [{ type: "text", text: "Salut " }, { type: "text", text: "{participantName}", marks: [{ type: "bold" }] }, { type: "text", text: ", codul {checkinCode}." }] },
          ],
        },
      },
    });
    const content = buildTemplateContent("EVENT_REMINDER", "ro", REAL, ACTION, overrides);
    expect(content.subject).toBe("Maratonul <Bucegi> & prieteni: numărul 7");
    expect(JSON.stringify(content.paragraphs)).toContain("Salut <strong>Maria Ionescu</strong>, codul QWE123.");
  });

  it("keeps the preview on the sample: the page renders the sample's values, and hands the editor the fields", () => {
    const html = renderBilingual("VERIFY_REGISTRATION_EMAIL", "ro", emailSampleData("ro"), emailSampleActionUrl("ro")).html;
    expect(html).toContain("Crosul de toamnă");
    const confirmed = renderBilingual("REGISTRATION_CONFIRMED", "en", emailSampleData("en"), emailSampleActionUrl("en")).text;
    for (const value of ["The autumn cross", "EXAMPL", "42", "Water, a rain jacket, good spirits"]) expect(confirmed).toContain(value);

    const page = readFileSync(path.join(process.cwd(), "src/app/[locale]/admin/emails/page.tsx"), "utf8");
    // Per message since the email follow-up (§373): the sample minus the fields the message never carries.
    expect(page).toContain("const sample = emailSampleFor(messageType, emailLocale);");
    expect(page).toContain("renderBilingual(messageType, emailLocale, sample, actionUrl, written.copy)");
    // The Reply-To in force (§NNN), so the prefill's reply line matches the send.
    expect(page).toContain("shipped={emailCopyPrefill(messageType, emailLocale, replyTo)}");
    expect(page).not.toMatch(/buildTemplateContent\(messageType, emailLocale, sample/);
  });
});

/*
  The review of §359: the starting text had every field in it and no condition, so a text saved
  unchanged printed "Ce să aduci:" for an event with no checklist, "Numărul tău de concurs: ." for a
  runner with no number, "…sau spune codul." under a club copy with no QR, and "ținut până la;" on a
  resend after the deadline. The preview, rendered with every sample fact, showed none of it.
*/
describe("§359 a paragraph whose every field is missing is not sent", () => {
  const text = (messageType: EmailMessageType, data: TemplateData) =>
    renderBilingual(messageType, "ro", data, ACTION, savedPrefill(messageType)).text;

  it("sends none of the review's four dangling sentences", () => {
    const confirmed = text("REGISTRATION_CONFIRMED", sparse("REGISTRATION_CONFIRMED"));
    for (const dangling of ["Ce să aduci", "Numărul tău de concurs", "Îl primești la masă", "What to bring", "Your race number"]) expect(confirmed).not.toContain(dangling);
    expect(text("REGISTRATION_CONFIRMED", { ...REAL, clubCopy: true })).not.toContain("spune codul");
    expect(text("EVENT_REMINDER", { ...REAL, clubCopy: true })).not.toContain("say the code");
    const declaration = text("COMPLETE_DECLARATION", sparse("COMPLETE_DECLARATION"));
    expect(declaration).not.toContain("ținut până la");
    // The sentence before it, which names no field, is still there.
    expect(declaration).toContain("înainte să-ți ridici numărul.");
    expect(text("CLUB_CONFIRMATION_NOTICE", sparse("CLUB_CONFIRMATION_NOTICE"))).not.toContain("Numărul de concurs");
    expect(text("BIB_ASSIGNED", { ...REAL, clubCopy: true })).not.toContain("spunând codul");
  });

  const facts = { participantName: "Maria", eventTitle: "Maratonul" };

  it("leaves out a paragraph whose only fields are facts the message lacks, and keeps every other", () => {
    const body = readEmailBody({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Numărul tău: " }, { type: "text", text: "{bibNumber}", marks: [{ type: "bold" }] }, { type: "text", text: "." }] },
        { type: "heading", attrs: { level: 3 }, content: [{ type: "text", text: "Ce să aduci: {eventChecklist}" }] },
        { type: "paragraph", content: [{ type: "text", text: "Ne vedem pe {eventStartsAtFormatted}, la {eventLocationName}." }] },
        // A fact left in it: sent, with the missing one closed up.
        { type: "paragraph", content: [{ type: "text", text: "La {eventTitle}, codul {checkinCode}." }] },
        // The runner's name is no conditional fact: the sentence says what it must without it.
        { type: "paragraph", content: [{ type: "text", text: "Salut {participantName}, locul tău a fost anulat." }] },
        { type: "paragraph", content: [{ type: "text", text: "Ne vedem la start." }] },
      ],
    }) as RichTextDoc;
    expect(renderEmailBody(body, { eventTitle: "Maratonul" }).textLines).toEqual([
      "La Maratonul, codul.",
      "Salut, locul tău a fost anulat.",
      "Ne vedem la start.",
    ]);
    // Stored as typed: the plain paragraphs keep every word, placeholders and all.
    expect(emailBodyToParagraphs(body)).toHaveLength(6);
  });

  it("leaves out such an item of a list and such a paragraph of a quote, and the whole block when nothing is left", () => {
    const item = (words: string) => ({ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: words }] }] });
    const body = readEmailBody({
      type: "doc",
      content: [
        { type: "bulletList", content: [item("Numărul: {bibNumber}"), item("Titlul: {eventTitle}")] },
        { type: "orderedList", content: [item("Codul: {checkinCode}")] },
        { type: "blockquote", content: [{ type: "paragraph", content: [{ type: "text", text: "{eventChecklist}" }] }] },
      ],
    }) as RichTextDoc;
    const rendered = renderEmailBody(body, facts);
    expect(rendered.textLines).toEqual(["- Titlul: Maratonul"]);
    expect(rendered.htmlParts).toHaveLength(1);
    expect(rendered.htmlParts[0]).not.toContain("Numărul");
  });

  it("does the same with plain paragraphs, as an entry written before the editor had formatting", () => {
    const overrides = emailCopySchema.parse({
      [emailCopyKey("EVENT_REMINDER", "ro")]: { subject: "Ne vedem, {participantName}", paragraphs: ["Numărul tău: {bibNumber}.", "Ne vedem la {eventTitle}."] },
    });
    const content = buildTemplateContent("EVENT_REMINDER", "ro", { participantName: "Maria", eventTitle: "Maratonul" }, ACTION, overrides);
    expect(content.paragraphs).toEqual(["Ne vedem la Maratonul."]);
  });
});

describe("§359 a saved text with sample values is found in either language", () => {
  const stale = { subject: "Cancelled: The autumn cross", paragraphs: ["Your registration for The autumn cross was cancelled."] };
  const clean = { subject: "Anulat", paragraphs: ["Înscrierea ta la {eventTitle} a fost anulată."] };

  it("names the English text whichever tab is open, and both languages when both hold one", () => {
    const english = emailCopySchema.parse({ [emailCopyKey("REGISTRATION_CANCELLED", "en")]: stale, [emailCopyKey("REGISTRATION_CANCELLED", "ro")]: clean });
    expect(sampleLanguagesOf(english, "REGISTRATION_CANCELLED")).toEqual(["en"]);
    expect(sampleLanguagesOf(english, "EVENT_REMINDER")).toEqual([]);
    const both = emailCopySchema.parse({
      [emailCopyKey("REGISTRATION_CANCELLED", "en")]: stale,
      [emailCopyKey("REGISTRATION_CANCELLED", "ro")]: { subject: "Anulat: Crosul de toamnă", paragraphs: ["x"] },
    });
    expect(sampleLanguagesOf(both, "REGISTRATION_CANCELLED")).toEqual(["ro", "en"]);
    expect(sampleLanguagesOf({}, "REGISTRATION_CANCELLED")).toEqual([]);
  });

  it("feeds the closed card's marker and the card of cards from both languages, not only the one on screen", () => {
    const page = readFileSync(path.join(process.cwd(), "src/app/[locale]/admin/emails/page.tsx"), "utf8");
    // Every message with words to edit — not the organizer's, written per send (§364).
    expect(page).toContain("const sampleLanguages = mayWrite && !perSend(messageType) ? sampleLanguagesOf(written.copy, messageType) : [];");
    expect(page).toContain("const anySamples = cards.some((card) => card.sampleLanguages.length > 0);");
    expect(page).toMatch(/sampleLanguages\.length > 0\s*\?\s*\{ sampleValues: t\("emails\.copy\.sampleMarker", \{ languages: sampleLanguages/);
  });
});

describe("§359 the save refuses a sample value", () => {
  const entry = (subject: string, paragraphs: string[]) => ({ subject, paragraphs });

  for (const locale of LOCALES) {
    const sample = EMAIL_SAMPLE[locale];
    const values: [string, EmailCopyPlaceholder][] = [
      [sample.participantName, "participantName"],
      [sample.eventTitle, "eventTitle"],
      [sample.eventLocationName, "eventLocationName"],
      [sample.eventStartsAtFormatted, "eventStartsAtFormatted"],
      ...EMAIL_SAMPLE_FORMER_WHEN[locale].map((value): [string, EmailCopyPlaceholder] => [value, "eventStartsAtFormatted"]),
      [sample.checkinCode, "checkinCode"],
      [sample.eventChecklist, "eventChecklist"],
    ];
    for (const [value, placeholder] of values) {
      it(`refuses "${value}" (${locale}) in the subject and in the words, of a message in either language, naming {${placeholder}}`, () => {
        for (const messageLocale of LOCALES) {
          expect(sampleValuesIn(entry(`Ne vedem: ${value}`, ["Bine."]), "VERIFY_REGISTRATION_EMAIL", messageLocale)).toEqual([
            { field: "subject", value, placeholder },
          ]);
          expect(sampleValuesIn(entry("Bine", [`Ne vedem la ${value}.`]), "EVENT_REMINDER", messageLocale)).toEqual([
            { field: "body", value, placeholder },
          ]);
        }
      });
    }
    it(`refuses the sample colleague and inviter in the invitation (${locale}), and the address, naming what goes in its place`, () => {
      expect(sampleValuesIn(entry("Bun venit", [`${sample.inviterName} te-a adăugat ca ${sample.staffRole}.`]), "STAFF_INVITATION", locale)).toEqual([
        { field: "body", value: "Organizator", placeholder: "staffRole" },
        { field: "body", value: "Ion Exemplu", placeholder: "inviterName" },
      ]);
      // A name nobody at the club has, so it is the sample in every message, as the runner's is.
      expect(sampleValuesIn(entry("Salut", [`Semnat, ${sample.inviterName}.`]), "EVENT_REMINDER", locale)).toEqual([
        { field: "body", value: "Ion Exemplu", placeholder: "inviterName" },
      ]);
      expect(sampleValuesIn(entry("Bun venit", [`Intri cu ${sample.staffEmail}.`]), "STAFF_INVITATION", locale)).toEqual([
        { field: "body", value: "ana.popescu@example.org", words: locale === "ro" ? "aceasta" : "this address" },
      ]);
    });
  }

  it("finds every value exactly as the sample writes it, and a single word only as itself", () => {
    // Case-sensitive since the email follow-up (§373): the old starting text carried the value
    // verbatim, and a case-blind match only added club prose (`email-sample-guard.test.ts`).
    expect(emailSampleLiteralsIn("Crosul de toamnă vine.", "EVENT_REMINDER").map((literal) => literal.value)).toEqual(["Crosul de toamnă"]);
    expect(emailSampleLiteralsIn("CROSUL DE TOAMNĂ vine.", "EVENT_REMINDER")).toEqual([]);
    // "for example", "EXAMPLE", "exemplu" are not the desk code.
    expect(emailSampleLiteralsIn("For example, EXAMPLE or exemplu.", "EVENT_REMINDER")).toEqual([]);
  });

  it("accepts the fields, and ordinary words a running club writes", () => {
    const words = entry("Ne vedem la {eventTitle}, {participantName}!", [
      "Numărul tău: {bibNumber}. Codul: {checkinCode}. Ce să aduci: {eventChecklist}. Start: {eventStartsAtFormatted}.",
      "Traseul are 42 de kilometri. Organizatorii te așteaptă; semnat, Florin, Organizator.",
      "Înscrierea ta este confirmată.",
    ]);
    for (const messageType of ["EVENT_REMINDER", "REGISTRATION_CONFIRMED", "REGISTRATION_STATE_NOTICE"] as const) {
      expect(sampleValuesIn(words, messageType, "ro")).toEqual([]);
    }
  });

  it("accepts an invitation the club signs \"Florin\", and finds the old sample inviter only inside the platform's own sentence", () => {
    expect(sampleValuesIn(entry("Bun venit", ["Te așteptăm la prima ședință. Semnat, Florin."]), "STAFF_INVITATION", "ro")).toEqual([]);
    const old = entry("Ești în echipa Brașov Runners", ["Florin te-a adăugat în echipa care administrează site-ul Brașov Runners, ca Organizator."]);
    expect(sampleValuesIn(old, "STAFF_INVITATION", "ro")).toEqual([
      { field: "body", value: "Organizator", placeholder: "staffRole" },
      { field: "body", value: "Florin", placeholder: "inviterName" },
    ]);
    expect(replaceSampleValues(old, "STAFF_INVITATION", "ro").paragraphs).toEqual([
      "{inviterName} te-a adăugat în echipa care administrează site-ul Brașov Runners, ca {staffRole}.",
    ]);
  });

  it("finds the bib and the status where the platform's own sentence carried them, and only there", () => {
    expect(sampleValuesIn(entry("Salut", ["Numărul tău de concurs: **42**."]), "EVENT_REMINDER", "ro")).toEqual([
      { field: "body", value: "42", placeholder: "bibNumber" },
    ]);
    expect(sampleValuesIn(entry("Numărul tău de concurs: 42", ["x"]), "BIB_ASSIGNED", "ro")).toEqual([
      { field: "subject", value: "42", placeholder: "bibNumber" },
    ]);
    expect(sampleValuesIn(entry("Starea", ["Your registration for {eventTitle} currently has this status: confirmed."]), "REGISTRATION_STATE_NOTICE", "en")).toEqual([]);
  });
});

describe("§359 \"Înlocuiește cu câmpurile\" rewrites a saved text to its fields", () => {
  // The thank-you's "results at the link below" is the one branch the sample takes and the starting
  // text does not; the hold's deadline and the time of signing have a sample value since the email
  // follow-up (§373), so the declaration's three messages come back as today's starting text too.
  const STRUCTURAL = new Set<EmailMessageType>(["EVENT_THANKS"]);

  /** What the old editor handed a Redactor: the platform's words rendered with the page's sample. */
  function oldStartingText(messageType: EmailMessageType, locale: "ro" | "en") {
    const shipped = buildTemplateContent(messageType, locale, emailSampleData(locale), emailSampleActionUrl(locale));
    return { subject: shipped.subject, paragraphs: shipped.paragraphs.filter((part): part is string => typeof part === "string") };
  }

  for (const messageType of TYPES) {
    for (const locale of LOCALES) {
      it(`${messageType} (${locale}): the old starting text, saved as plain words and as the old editor's document, comes back with no sample value`, () => {
        const old = oldStartingText(messageType, locale);
        const prefill = emailCopyPrefill(messageType, locale);
        const expected = EXPECTED[messageType];

        // Plain paragraphs, as an entry written before §270 has them.
        const plain = replaceSampleValues(old, messageType, locale);
        expect(sampleValuesIn(plain, messageType, locale)).toEqual([]);
        expect(plain.subject).toBe(prefill.subject);
        for (const name of expected) expect([plain.subject, ...plain.paragraphs].join("\n")).toContain(`{${name}}`);

        // The old editor's document: every paragraph in one block, the asterisks as characters.
        const oldDoc = fromPlainText(old.paragraphs.join("\n\n"));
        const saved = { subject: old.subject, paragraphs: emailBodyToParagraphs(oldDoc), body: oldDoc };
        const formatted = replaceSampleValues(saved, messageType, locale);
        expect(sampleValuesIn(formatted, messageType, locale)).toEqual([]);
        const body = readEmailBody(formatted.body) as RichTextDoc;
        expect(JSON.stringify(body)).not.toContain("**");
        expect(emailSchemaAccepts(messageType, locale, formatted)).toBe(true);
        // Where the old text was the platform's sentence for sentence, the result is today's starting
        // text. Not where the old one took another branch: the thank-you's "results at the link
        // below", which the sample has and the starting text does not (`STRUCTURAL`).
        if (!STRUCTURAL.has(messageType)) {
          expect(formatted.paragraphs).toEqual(prefill.paragraphs);
          expect(body.content).toHaveLength(prefill.paragraphs.length);
        }
      });
    }
  }

  it("keeps the club's own formatting and words, rewriting only the sample values inside each run", () => {
    const doc: RichTextDoc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Hai la " },
            { type: "text", text: "Crosul de toamnă", marks: [{ type: "bold" }] },
            { type: "text", text: ", cu codul EXAMPL. Ne vedem!" },
          ],
        },
      ],
    };
    const result = replaceSampleValues({ subject: "Salut, Ana Popescu", paragraphs: emailBodyToParagraphs(doc), body: doc }, "EVENT_REMINDER", "ro");
    expect(result.subject).toBe("Salut, {participantName}");
    expect(result.body).toEqual({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Hai la " },
            { type: "text", text: "{eventTitle}", marks: [{ type: "bold" }] },
            { type: "text", text: ", cu codul {checkinCode}. Ne vedem!" },
          ],
        },
      ],
    });
    expect(renderEmailBody(result.body as RichTextDoc, { eventTitle: "Maratonul", checkinCode: "QWE123" }).htmlParts[0]).toContain(
      "Hai la <strong>Maratonul</strong>, cu codul QWE123. Ne vedem!",
    );
  });

  it("drops the update notice's two lines the platform adds anyway, rather than sending them twice", () => {
    const old = oldStartingText("EVENT_UPDATE_NOTICE", "ro");
    expect(old.paragraphs.some((paragraph) => paragraph.startsWith("Locul de întâlnire este acum"))).toBe(true);
    expect(replaceSampleValues(old, "EVENT_UPDATE_NOTICE", "ro").paragraphs).toEqual(emailCopyPrefill("EVENT_UPDATE_NOTICE", "ro").paragraphs);
  });
});

/*
  The organizer's message beside §359 (§364): written per send, so its card on `/admin/emails`
  previews the one sample message — from the same constant as every other preview — and carries
  neither the words editor nor the sample-value marker.
*/
describe("§364 the organizer's message on the page of every email", () => {
  it("previews the sample message from the one sample constant, each half in its own language", () => {
    for (const locale of LOCALES) {
      const data = emailSampleData(locale);
      const other = locale === "ro" ? "en" : "ro";
      expect(data.organizerSubject).toBe(EMAIL_SAMPLE[locale].organizerSubject);
      expect(data.organizerBodyOther).toBe(EMAIL_SAMPLE[other].organizerBody);
    }
    const preview = renderBilingual("ORGANIZER_MESSAGE", "ro", emailSampleData("ro"), emailSampleActionUrl("ro"));
    // The English half reads the English title, as the send does (`render.ts`).
    expect(preview.subject).toBe("Vreme rea la Crosul de toamnă: startul se mută la 10:00 / Bad weather at The autumn cross: the start moves to 10:00");
    const [romanian, english] = preview.text.split("— — —");
    expect(romanian).toContain("Salut, Ana Popescu!");
    expect(english).toContain("Hi, Ana Popescu!");
    expect(english).toContain("A message from the organizers of The autumn cross");
    expect(english).not.toContain("Prognoza anunță");
  });

  it("gives every message's second half the other language's title, the organizer's message included (§373, email follow-up)", () => {
    // Every message's second half now reads its own language's title (§373), not the registrant's
    // repeated — the fix §354 left undone for anything but the organizer's message, generalised
    // once the read was shared per event per batch rather than paid again per message.
    const verify = renderBilingual("VERIFY_REGISTRATION_EMAIL", "ro", emailSampleData("ro"), emailSampleActionUrl("ro"));
    const withoutOther = renderBilingual(
      "VERIFY_REGISTRATION_EMAIL",
      "ro",
      { ...emailSampleData("ro"), eventTitleOther: undefined, eventChecklistOther: undefined },
      emailSampleActionUrl("ro"),
    );
    expect(verify).not.toEqual(withoutOther);
    expect(verify.text.split("— — —")[1]).toContain("The autumn cross");
    expect(withoutOther.text.split("— — —")[1]).toContain("Crosul de toamnă");
  });

  it("is no sample value the save refuses: its sample holds placeholders and ordinary words", () => {
    for (const locale of LOCALES) {
      for (const text of [EMAIL_SAMPLE[locale].organizerSubject, EMAIL_SAMPLE[locale].organizerBody]) {
        expect(unknownPlaceholders(text)).toEqual([]);
        expect(emailSampleLiteralsIn(text, "ORGANIZER_MESSAGE")).toEqual([]);
      }
    }
  });

  it("draws no editor and no sample-value marker for it, and says where it is written", () => {
    const page = readFileSync(path.join(process.cwd(), "src/app/[locale]/admin/emails/page.tsx"), "utf8");
    // The newsletter is the other message written per send (§NNN).
    expect(page).toContain('return messageType === "ORGANIZER_MESSAGE" || messageType === "NEWSLETTER";');
    expect(page).toContain("const own = perSend(messageType) ? null : copyFor(written.copy, messageType, emailLocale);");
    expect(page).toContain("mayWrite && !perSend(messageType) ? sampleLanguagesOf(written.copy, messageType) : []");
    expect(page).toMatch(/editor: perSend\(messageType\) \? \(\s*<Alert severity="info"[^>]*data-testid="email-per-send"/);
  });
});

function emailSchemaAccepts(messageType: EmailMessageType, locale: "ro" | "en", entry: unknown): boolean {
  return emailCopySchema.safeParse({ [emailCopyKey(messageType, locale)]: entry }).success;
}
