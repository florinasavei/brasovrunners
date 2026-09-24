import { readFileSync } from "node:fs";
import path from "node:path";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { emailMessageType, type EmailMessageType } from "@/db/schema/email-outbox";
import { EMAIL_COPY_CONDITIONAL_FACTS, EMAIL_COPY_PLACEHOLDERS, emailCopyKey, emailCopySchema } from "@/modules/notifications/domain/email-copy";
import { EMAIL_SAMPLE, EMAIL_SAMPLE_HOLD_EXPIRES_AT, EMAIL_SAMPLE_SIGNED_AT, emailSampleValueOf } from "@/modules/notifications/domain/email-sample";
import {
  emailFieldLegend,
  emailSampleActionUrl,
  emailSampleData,
  emailSampleFor,
  placeholdersFilledBy,
  placeholdersUsedBy,
} from "@/modules/notifications/email-copy-fields";
import { ORGANIZER_MESSAGE_PLACEHOLDERS } from "@/modules/notifications/domain/organizer-message";
import { renderBilingual } from "@/modules/notifications/templates";
import { formatDay } from "@/i18n/dates";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";

/**
 * `DECISIONS.md` §373 (email follow-up) — the fields of an email's words as a legend, like the
 * declaration's tokens (the owner, 2026-09-24: "I like how the placeholders are listed here on the
 * documents — need to have the same on emails, because now they are just plain inline text"), and
 * a sample with a value for every field, each half of a preview in its own language.
 *
 * The legend is rendered to HTML as the server sends it, through next-intl's own translator over
 * the real catalogues, in the backoffice language each case names.
 */
const ui = vi.hoisted(() => ({ locale: "ro" as "ro" | "en" }));

vi.mock("next-intl/server", async () => {
  const { createTranslator } = await import("next-intl");
  const catalogues = {
    ro: (await import("../../../messages/ro.json")).default,
    en: (await import("../../../messages/en.json")).default,
  };
  return {
    getTranslations: async (namespace: string) =>
      createTranslator({ locale: ui.locale, messages: catalogues[ui.locale], namespace: namespace as "Admin" }),
  };
});

const { default: EmailFieldLegend } = await import("@/modules/notifications/ui/EmailFieldLegend");

const TYPES = emailMessageType.enumValues as readonly EmailMessageType[];
const LOCALES = ["ro", "en"] as const;
const CATALOGUE = { ro, en } as const;

async function render(messageType: EmailMessageType, locale: "ro" | "en", emailLocale: "ro" | "en" = locale): Promise<string> {
  ui.locale = locale;
  return renderToStaticMarkup((await EmailFieldLegend({ locale, emailLocale, messageType })) as ReactElement);
}

/** The visible words, without the markup, the entities React writes, or MUI's spacing. */
function text(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ");
}

/** One row of the legend: its term and its description, as the server sent them. */
function rowOf(html: string, name: string): { markup: string; words: string } {
  const start = html.indexOf(`data-field="{${name}}"`);
  expect(start, `a row for {${name}}`).toBeGreaterThan(-1);
  const end = html.indexOf("</dd>", start);
  const markup = html.slice(start, end);
  return { markup, words: text(`<x ${markup}`) };
}

/** The fields in the order the rows are drawn. */
function order(html: string): string[] {
  return [...html.matchAll(/data-field="\{(\w+)\}"/g)].map((match) => match[1]);
}

describe("§373 the fields of an email's words, as a legend", () => {
  for (const locale of LOCALES) {
    const words = CATALOGUE[locale].Admin.emails.copy.legend;

    for (const messageType of TYPES) {
      it(`${messageType} (${locale}): every field once, with what it is and the preview's value for it`, async () => {
        const html = await render(messageType, locale);
        const filled = new Set(placeholdersFilledBy(messageType));
        expect(order(html).sort()).toEqual([...EMAIL_COPY_PLACEHOLDERS].sort());
        for (const name of EMAIL_COPY_PLACEHOLDERS) {
          const row = rowOf(html, name);
          expect(row.words).toContain(`{${name}}`);
          expect(row.words).toContain(words.fields[name]);
          if (filled.has(name)) {
            // Exactly the sample's value in the language being edited — what the preview shows.
            expect(row.markup).toContain(`<em>${emailSampleValueOf(name, locale)}</em>`);
            expect(row.markup).not.toContain('data-muted="true"');
          } else {
            expect(row.markup).toContain('data-muted="true"');
            expect(row.words).toContain(words.notFilled);
            expect(row.markup).not.toContain("<em>");
          }
        }
      });
    }

    it(`lists the fields the platform's text uses first, marked, and the ones the message never carries last (${locale})`, async () => {
      const html = await render("REGISTRATION_CONFIRMED", locale);
      const used = placeholdersUsedBy("REGISTRATION_CONFIRMED", locale);
      const filled = placeholdersFilledBy("REGISTRATION_CONFIRMED");
      expect(used).toEqual(["eventTitle", "bibNumber", "checkinCode", "eventChecklist"]);
      const drawn = order(html);
      expect(drawn.slice(0, used.length)).toEqual(used);
      // Then the rest the message carries, then the rest — each group in the closed set's order.
      expect(drawn.slice(used.length)).toEqual([
        ...EMAIL_COPY_PLACEHOLDERS.filter((name) => filled.includes(name) && !used.includes(name)),
        ...EMAIL_COPY_PLACEHOLDERS.filter((name) => !filled.includes(name)),
      ]);
      expect(drawn.slice(-3)).toEqual(["holdExpiresAtFormatted", "staffRole", "inviterName"]);
      for (const name of used) expect(rowOf(html, name).words).toContain(words.usedMark);
      for (const name of drawn.slice(used.length)) expect(rowOf(html, name).words).not.toContain(words.usedMark);
      // The facts a send may lack say so; the name and the title do not.
      expect(rowOf(html, "bibNumber").words).toContain(words.mayBeMissing);
      expect(rowOf(html, "eventTitle").words).not.toContain(words.mayBeMissing);
      // A field the message never carries is not "may be missing": it is never there.
      expect(rowOf(html, "holdExpiresAtFormatted").words).not.toContain(words.mayBeMissing);
    });
  }

  it("dims the invitation's fields everywhere but the invitation, and the event's in the invitation", async () => {
    const reminder = await render("EVENT_REMINDER", "ro");
    expect(rowOf(reminder, "staffRole").markup).toContain('data-muted="true"');
    expect(rowOf(reminder, "inviterName").markup).toContain('data-muted="true"');
    const invitation = await render("STAFF_INVITATION", "ro");
    expect(order(invitation).slice(0, 2)).toEqual(["staffRole", "inviterName"]);
    expect(rowOf(invitation, "staffRole").markup).toContain("<em>Organizator</em>");
    for (const name of ["eventTitle", "eventChecklist", "bibNumber", "currentStatus"]) {
      expect(rowOf(invitation, name).markup, name).toContain('data-muted="true"');
    }
  });

  it("is a named card, closed, whose closed line counts the fields and the ones used here", async () => {
    // Emotion's style tags aside, the whole legend is one fold.
    const html = (await render("REGISTRATION_CONFIRMED", "ro")).replace(/<style[^>]*>[\s\S]*?<\/style>/g, "");
    expect(html.startsWith("<details")).toBe(true);
    expect(html.endsWith("</details>")).toBe(true);
    expect(html.match(/<details[^>]*>/)?.[0]).not.toMatch(/\sopen/);
    expect(html).toContain('id="email-fields-REGISTRATION_CONFIRMED"');
    expect(html).toMatch(/<summary[^>]*><h4[^>]*>Câmpurile pe care le poți folosi<span[^>]*>12 câmpuri · 4 câmpuri folosite aici<\/span><\/h4><\/summary>/);
    expect(text(html)).toContain(ro.Admin.emails.copy.legend.intro);
    expect(text(html)).toContain(ro.Admin.emails.copy.legend.missing);

    expect(text(await render("VERIFY_REGISTRATION_EMAIL", "ro"))).toContain("12 câmpuri · 1 câmp folosit aici");
    expect(text(await render("PROFILE_MANAGE_LINK", "ro"))).toContain("12 câmpuri · niciunul folosit aici");
    expect(text(await render("REGISTRATION_CONFIRMED", "en"))).toContain("The fields you can use 12 fields · 4 fields used here");
  });

  it("gives the examples of the language being edited, whatever the backoffice's language", async () => {
    const html = await render("EVENT_REMINDER", "ro", "en");
    expect(rowOf(html, "eventTitle").markup).toContain("<em>The autumn cross</em>");
    expect(rowOf(html, "eventTitle").words).toContain(ro.Admin.emails.copy.legend.fields.eventTitle);
  });

  it("has what every field is, in both catalogues", () => {
    for (const name of EMAIL_COPY_PLACEHOLDERS) {
      expect(ro.Admin.emails.copy.legend.fields[name], `ro ${name}`).toBeTruthy();
      expect(en.Admin.emails.copy.legend.fields[name], `en ${name}`).toBeTruthy();
    }
  });

  it("replaces the one inline sentence that listed the fields", () => {
    const editor = readFileSync(path.join(process.cwd(), "src/modules/notifications/ui/EmailCopyEditor.tsx"), "utf8");
    expect(editor).not.toContain("email-copy-placeholders");
    expect(editor).not.toContain("placeholdersUsed");
    expect(editor).toContain("<EmailFieldLegend locale={locale} emailLocale={emailLocale} messageType={messageType} />");
    for (const catalogue of [ro, en]) {
      expect(catalogue.Admin.emails.copy).not.toHaveProperty("placeholders");
      expect(catalogue.Admin.emails.copy).not.toHaveProperty("placeholdersUsed");
    }
    // The emails' legend and the declaration's are one layout.
    const tokens = readFileSync(path.join(process.cwd(), "src/modules/legal-documents/ui/TokenLegend.tsx"), "utf8");
    expect(tokens).toContain('import FieldLegend from "@/shared/ui/FieldLegend";');
  });
});

describe("§373 which fields a message carries", () => {
  for (const messageType of TYPES) {
    for (const locale of LOCALES) {
      it(`${messageType} (${locale}): the platform's own text names no field its message never carries`, () => {
        const filled = placeholdersFilledBy(messageType);
        for (const name of placeholdersUsedBy(messageType, locale)) expect(filled, name).toContain(name);
      });

      it(`${messageType} (${locale}): the preview without the fields it never carries is the platform's message unchanged`, () => {
        expect(renderBilingual(messageType, locale, emailSampleFor(messageType, locale), emailSampleActionUrl(locale))).toEqual(
          renderBilingual(messageType, locale, emailSampleData(locale), emailSampleActionUrl(locale)),
        );
      });
    }
  }

  it("previews a field the club wrote into a message that never carries it as nothing, as the send does", () => {
    const copy = emailCopySchema.parse({
      [emailCopyKey("EVENT_REMINDER", "ro")]: { subject: "Ne vedem", paragraphs: ["Rolul: {staffRole}. Titlul: {eventTitle}."] },
      [emailCopyKey("STAFF_INVITATION", "ro")]: { subject: "Bun venit", paragraphs: ["Rolul: {staffRole}."] },
    });
    expect(renderBilingual("EVENT_REMINDER", "ro", emailSampleFor("EVENT_REMINDER", "ro"), emailSampleActionUrl("ro"), copy).text).toContain(
      "Rolul:. Titlul: Crosul de toamnă.",
    );
    expect(renderBilingual("STAFF_INVITATION", "ro", emailSampleFor("STAFF_INVITATION", "ro"), emailSampleActionUrl("ro"), copy).text).toContain(
      "Rolul: Organizator.",
    );
  });

  it("fills the organizer's message with exactly its own closed set (§373, email follow-up): the settled bib, never the status", () => {
    const filled = placeholdersFilledBy("ORGANIZER_MESSAGE");
    expect(filled.sort()).toEqual([...ORGANIZER_MESSAGE_PLACEHOLDERS].sort());
    expect(filled).toContain("bibNumber");
    expect(filled).not.toContain("currentStatus");
    expect(filled).not.toContain("checkinCode");
  });

  it("marks as 'may be missing' only the conditional facts a message carries", () => {
    for (const messageType of TYPES) {
      for (const entry of emailFieldLegend(messageType, "ro")) {
        expect(entry.mayBeMissing, `${messageType} ${entry.name}`).toBe(entry.filled && EMAIL_COPY_CONDITIONAL_FACTS.has(entry.name));
      }
    }
  });
});

describe("§373 the sample has every field, and each half of a preview its own language", () => {
  it("gives every field a value in both languages, the two dates through the send path's own format", () => {
    for (const locale of LOCALES) {
      for (const name of EMAIL_COPY_PLACEHOLDERS) expect(emailSampleValueOf(name, locale), `${locale} ${name}`).not.toBe("");
      const inSentence = (at: Date) => formatDay(at, { locale, timeZone: "Europe/Bucharest", style: "long", withTime: true, position: "inline" });
      expect(EMAIL_SAMPLE[locale].holdExpiresAtFormatted).toBe(inSentence(EMAIL_SAMPLE_HOLD_EXPIRES_AT));
      expect(EMAIL_SAMPLE[locale].signedAtFormatted).toBe(inSentence(EMAIL_SAMPLE_SIGNED_AT));
    }
    expect(EMAIL_SAMPLE.ro.holdExpiresAtFormatted).toBe("vineri, 2 oct. 2026, 18:30");
    expect(EMAIL_SAMPLE.en.signedAtFormatted).toBe("Monday, 28 Sept 2026, 19:42");
  });

  it("previews the declaration's hold and the time of signing, each half in its own words", () => {
    const declaration = renderBilingual("COMPLETE_DECLARATION", "ro", emailSampleFor("COMPLETE_DECLARATION", "ro"), emailSampleActionUrl("ro")).text;
    expect(declaration).toContain("locul îți este ținut până la vineri, 2 oct. 2026, 18:30");
    expect(declaration).toContain("the place is held for you until Friday, 2 Oct 2026, 18:30");
    const signed = renderBilingual("DECLARATION_SIGNED", "en", emailSampleFor("DECLARATION_SIGNED", "en"), emailSampleActionUrl("en")).text;
    expect(signed).toContain("you signed for The autumn cross, on Monday, 28 Sept 2026, 19:42");
    expect(signed).toContain("ai semnat-o pentru Crosul de toamnă, pe luni, 28 sept. 2026, 19:42");
  });

  for (const locale of LOCALES) {
    const other = locale === "ro" ? "en" : "ro";
    it(`shows the second half of a ${locale} preview with the ${other} sample's title, place and checklist`, () => {
      const message = renderBilingual("REGISTRATION_CONFIRMED", locale, emailSampleFor("REGISTRATION_CONFIRMED", locale), emailSampleActionUrl(locale));
      const [first, second] = message.text.split("\n— — —\n");
      for (const [half, own, foreign] of [
        [first, EMAIL_SAMPLE[locale], EMAIL_SAMPLE[other]],
        [second, EMAIL_SAMPLE[other], EMAIL_SAMPLE[locale]],
      ] as const) {
        expect(half).toContain(own.eventTitle);
        expect(half).toContain(own.eventLocationName);
        expect(half).toContain(own.eventChecklist);
        expect(half).not.toContain(foreign.eventTitle);
        expect(half).not.toContain(foreign.eventChecklist);
      }
      const update = renderBilingual("EVENT_UPDATE_NOTICE", locale, emailSampleFor("EVENT_UPDATE_NOTICE", locale), emailSampleActionUrl(locale));
      expect(update.subject).toContain(EMAIL_SAMPLE.ro.eventTitle);
      expect(update.subject).toContain(EMAIL_SAMPLE.en.eventTitle);
    });

    it(`previews {currentStatus} of a ${locale} REGISTRATION_STATE_NOTICE with each half in its own words, matching the legend's example`, async () => {
      const message = renderBilingual(
        "REGISTRATION_STATE_NOTICE",
        locale,
        emailSampleFor("REGISTRATION_STATE_NOTICE", locale),
        emailSampleActionUrl(locale),
      );
      const [first, second] = message.text.split("\n— — —\n");
      expect(first).toContain(EMAIL_SAMPLE[locale].currentStatus);
      expect(second).toContain(EMAIL_SAMPLE[other].currentStatus);

      const legendHtml = await render("REGISTRATION_STATE_NOTICE", locale);
      expect(rowOf(legendHtml, "currentStatus").markup).toContain(`<em>${EMAIL_SAMPLE[locale].currentStatus}</em>`);
    });
  }
});
