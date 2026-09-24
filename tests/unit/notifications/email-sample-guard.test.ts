import { describe, expect, it } from "vitest";
import type { EmailMessageType } from "@/db/schema/email-outbox";
import type { EmailCopyPlaceholder } from "@/modules/notifications/domain/email-copy";
import {
  EMAIL_SAMPLE,
  EMAIL_SAMPLE_FORMER_WHEN,
  EMAIL_SAMPLE_LITERALS,
  emailSampleLiteralsIn,
  replaceEmailSampleLiterals,
} from "@/modules/notifications/domain/email-sample";
import { sampleValuesIn } from "@/modules/notifications/email-copy-fields";

/**
 * `DECISIONS.md` §NNN (email follow-up) — the save's guard against the page's sample values finds
 * the sample, and not the club's prose.
 *
 * The re-review of the starting-text change: a value of several words was matched whatever its case,
 * and a hyphen ended a word, so "the autumn cross-country season" was refused as the sample's title
 * and "ne vedem la crosul de toamnă" as the Romanian one. The match is now the value exactly as the
 * sample writes it, as a whole word or phrase on both sides — a hyphen joins, Romanian letters are
 * letters, and an "ă" typed as "a" plus a breve is an "ă".
 *
 * Decided per value (the table below): every value is refused exactly as the sample writes it, in
 * every message, except the role, which is an ordinary word refused only inside the invitation. The
 * bib (42) and the status are never refused as words (`email-copy-prefill.test.ts` holds that they
 * are found only inside the platform's own sentence).
 */
type Decision = { value: string; placeholder?: EmailCopyPlaceholder; everywhere: boolean };

const DECISIONS: readonly Decision[] = [
  { value: "ana.popescu@example.org", everywhere: true },
  ...(["ro", "en"] as const).flatMap((locale): Decision[] => [
    { value: EMAIL_SAMPLE[locale].participantName, placeholder: "participantName", everywhere: true },
    { value: EMAIL_SAMPLE[locale].eventTitle, placeholder: "eventTitle", everywhere: true },
    { value: EMAIL_SAMPLE[locale].eventLocationName, placeholder: "eventLocationName", everywhere: true },
    { value: EMAIL_SAMPLE[locale].eventStartsAtFormatted, placeholder: "eventStartsAtFormatted", everywhere: true },
    ...EMAIL_SAMPLE_FORMER_WHEN[locale].map((value): Decision => ({ value, placeholder: "eventStartsAtFormatted", everywhere: true })),
    { value: EMAIL_SAMPLE[locale].checkinCode, placeholder: "checkinCode", everywhere: true },
    { value: EMAIL_SAMPLE[locale].eventChecklist, placeholder: "eventChecklist", everywhere: true },
    { value: EMAIL_SAMPLE[locale].holdExpiresAtFormatted, placeholder: "holdExpiresAtFormatted", everywhere: true },
    { value: EMAIL_SAMPLE[locale].signedAtFormatted, placeholder: "signedAtFormatted", everywhere: true },
    { value: EMAIL_SAMPLE[locale].staffRole, placeholder: "staffRole", everywhere: false },
    { value: EMAIL_SAMPLE[locale].inviterName, placeholder: "inviterName", everywhere: true },
  ]),
];

const values = (text: string, messageType: EmailMessageType = "EVENT_REMINDER") =>
  emailSampleLiteralsIn(text, messageType).map((literal) => literal.value);

describe("§NNN the guard refuses the sample exactly as it writes it", () => {
  it("looks for every value the table decides, and nothing else", () => {
    const decided = [...new Set(DECISIONS.map((decision) => decision.value))].sort();
    expect(EMAIL_SAMPLE_LITERALS.map((literal) => literal.value).sort()).toEqual(decided);
  });

  for (const decision of DECISIONS) {
    it(`refuses "${decision.value}" wherever a sentence puts it${decision.everywhere ? "" : " — in the invitation only"}`, () => {
      const messageType: EmailMessageType = decision.everywhere ? "EVENT_REMINDER" : "STAFF_INVITATION";
      for (const sentence of [
        `${decision.value} vine.`,
        `Ne vedem la ${decision.value}.`,
        `Ne vedem la ${decision.value}`,
        `„${decision.value}”, spune clubul.`,
        `(${decision.value})`,
        `**${decision.value}**`,
        `Linia întâi\n${decision.value}\nLinia a treia`,
        `The ${decision.value}'s page.`,
      ]) {
        expect(values(sentence, messageType), sentence).toContain(decision.value);
      }
      if (!decision.everywhere) expect(values(`Ne vedem la ${decision.value}.`, "EVENT_REMINDER")).toEqual([]);
    });
  }

  it("finds a value typed with a letter and a combining accent as the letter itself (NFC)", () => {
    const decomposed = "Crosul de toamnă";
    expect(decomposed).not.toBe(EMAIL_SAMPLE.ro.eventTitle);
    expect(values(`Hai la ${decomposed}!`)).toEqual([EMAIL_SAMPLE.ro.eventTitle]);
    // And the button rewrites what the warning found.
    expect(replaceEmailSampleLiterals(`Hai la ${decomposed}!`, "EVENT_REMINDER", "ro")).toBe("Hai la {eventTitle}!");
  });

  it("names the field and saves the value's place for it, in the subject and the words", () => {
    expect(sampleValuesIn({ subject: "Salut, Ana Popescu", paragraphs: ["Ne vedem pe vineri, 2 oct. 2026, 18:30."] }, "COMPLETE_DECLARATION", "ro")).toEqual([
      { field: "subject", value: "Ana Popescu", placeholder: "participantName" },
      { field: "body", value: "vineri, 2 oct. 2026, 18:30", placeholder: "holdExpiresAtFormatted" },
    ]);
  });
});

describe("§NNN the guard leaves the club's own prose alone", () => {
  const prose: [string, string][] = [
    // Case: the sample's words in the club's own case are the club's words.
    ["the title in lower case", "Ne vedem la crosul de toamnă al clubului, ca în fiecare an."],
    ["the English title in lower case", "Join us for the autumn cross this year."],
    ["the title shouting", "CROSUL DE TOAMNĂ se apropie!"],
    ["the runner in lower case", "Mulțumim, ana popescu, pentru ajutor."],
    // A hyphen makes one word of both sides.
    ["a compound after the title", "The autumn cross-country season starts in October."],
    ["a double-barrelled surname", "Felicitări, Ana Popescu-Ionescu!"],
    ["a compound before the name", "Ion Exemplu-Ionescu și ex-Ana Popescu au alergat."],
    ["a compound of the role", "Organizator-șef este Dan."],
    // Romanian letters are letters: a word that goes on is another word.
    ["a genitive of the inviter", "Mulțumiri lui Ion Exemplului."],
    ["the role with its article", "Organizatorul te așteaptă."],
    ["the code inside a longer word", "EXAMPLE, EXAMPLES și exampl nu sunt codul."],
    ["the code followed by a letter with a diacritic", "EXAMPLĂ nu e un cod."],
    ["a combining mark after the title", "Crosul de toamnă̱ nu e titlul."],
    ["the place without diacritics", "Ne întâlnim la Statia de telecabina Tampa."],
  ];
  for (const [what, sentence] of prose) {
    it(`accepts ${what}`, () => {
      expect(values(sentence, "STAFF_INVITATION")).toEqual([]);
      expect(sampleValuesIn({ subject: "Salut", paragraphs: [sentence] }, "STAFF_INVITATION", "ro")).toEqual([]);
      // And "Înlocuiește cu câmpurile" leaves it as it is.
      expect(replaceEmailSampleLiterals(sentence, "STAFF_INVITATION", "ro")).toBe(sentence.normalize("NFC"));
    });
  }

  it("rewrites the sample and leaves the club's compound beside it", () => {
    expect(replaceEmailSampleLiterals("The autumn cross-country season ends at The autumn cross.", "EVENT_REMINDER", "en")).toBe(
      "The autumn cross-country season ends at {eventTitle}.",
    );
  });
});
