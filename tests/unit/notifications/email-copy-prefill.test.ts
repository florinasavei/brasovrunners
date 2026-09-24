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
  sampleValuesIn,
} from "@/modules/notifications/email-copy-fields";
import { buildTemplateContent, renderBilingual, type TemplateData } from "@/modules/notifications/templates";

/**
 * BR-REQ-080-01, `DECISIONS.md` §NNN — the editor starts from the platform's words with the
 * fields in them, and no sample value is ever stored as the club's words.
 *
 * The owner, 2026-09-24, with a screenshot of "Confirmă adresa de email": the editable text read
 * "Ai început înscrierea la Crosul de toamnă" — the page's sample event — and a Redactor saving it
 * would have sent that title to every participant of every event. "Also all emails text must
 * include these placeholders!"
 */
const TYPES = emailMessageType.enumValues as readonly EmailMessageType[];
const LOCALES = ["ro", "en"] as const;

/** What each message's platform text is made of, field by field, in both languages. */
const EXPECTED: Record<EmailMessageType, EmailCopyPlaceholder[]> = {
  VERIFY_REGISTRATION_EMAIL: ["eventTitle"],
  COMPLETE_DECLARATION: ["eventTitle", "holdExpiresAtFormatted"],
  WAITLIST_JOINED: ["eventTitle"],
  WAITLIST_SPOT_OFFER: ["eventTitle"],
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

describe("§NNN the editor starts from the platform's words, with the fields", () => {
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
});

describe("§NNN what goes out is what went out before", () => {
  for (const messageType of TYPES) {
    for (const locale of LOCALES) {
      it(`${messageType} (${locale}): the starting text saved unchanged sends exactly the platform's message`, () => {
        // Byte for byte, both halves, HTML and plain text: the club's text is the platform's own.
        expect(renderBilingual(messageType, locale, REAL, ACTION, savedPrefill(messageType))).toEqual(
          renderBilingual(messageType, locale, REAL, ACTION),
        );
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
    expect(page).toContain("const sample = emailSampleData(emailLocale);");
    expect(page).toContain("renderBilingual(messageType, emailLocale, sample, actionUrl, written.copy)");
    expect(page).toContain("shipped={emailCopyPrefill(messageType, emailLocale)}");
    expect(page).not.toMatch(/buildTemplateContent\(messageType, emailLocale, sample/);
  });
});

describe("§NNN the save refuses a sample value", () => {
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
        { field: "body", value: "Florin", placeholder: "inviterName" },
      ]);
      expect(sampleValuesIn(entry("Bun venit", [`Intri cu ${sample.staffEmail}.`]), "STAFF_INVITATION", locale)).toEqual([
        { field: "body", value: "ana.popescu@example.org", words: locale === "ro" ? "aceasta" : "this address" },
      ]);
    });
  }

  it("finds a value of several words whatever its case, and a single word only as itself", () => {
    expect(emailSampleLiteralsIn("CROSUL DE TOAMNĂ vine.", "EVENT_REMINDER").map((literal) => literal.value)).toEqual(["Crosul de toamnă"]);
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

describe("§NNN \"Înlocuiește cu câmpurile\" rewrites a saved text to its fields", () => {
  const STRUCTURAL = new Set<EmailMessageType>(["COMPLETE_DECLARATION", "DECLARATION_SIGNED", "DECLARATION_ARCHIVE", "EVENT_THANKS"]);

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
        const expected = EXPECTED[messageType].filter((name) => name !== "holdExpiresAtFormatted" && name !== "signedAtFormatted");

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
        // text. Not where the old one took another branch: the hold's deadline and the time of signing,
        // which the sample never had, and the thank-you's "results at the link below", which it did.
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

function emailSchemaAccepts(messageType: EmailMessageType, locale: "ro" | "en", entry: unknown): boolean {
  return emailCopySchema.safeParse({ [emailCopyKey(messageType, locale)]: entry }).success;
}
