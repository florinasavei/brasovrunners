import { describe, expect, it } from "vitest";
import { renderContent, type TemplateContent } from "@/modules/notifications/templates";

/**
 * `DECISIONS.md` §309 — `__like this__` is underlined in the HTML and dropped from the plain text,
 * in the platform's own sentences only. A link is never read for the marker: an action token is 43
 * random base64url characters (`generateTokenSecret`), `_` among them, so an address holds `__` in
 * about one message in fifty and must reach the reader exactly as it was minted.
 *
 * Pinned here because a resend's integration test once asserted "no `__` anywhere in the text",
 * addresses included, and failed in CI on a token that happened to hold two underscores (#297).
 */
const TOKEN_WITH_UNDERSCORES = "ab__cd__efGHIJKLMNOPQRSTUVWXYZ0123456789-_x";

const content: TemplateContent = {
  subject: "Confirmat",
  greeting: "Salut,",
  paragraphs: ["__Ești deja înscris__ la acest eveniment."],
  action: { label: "Semnează declarația", url: `https://example.test/ro/inregistrari/declaratie/${TOKEN_WITH_UNDERSCORES}` },
  cannotCome: { label: "Nu mai pot ajunge", url: `https://example.test/ro/inregistrari/gestionare/${TOKEN_WITH_UNDERSCORES}#cancel`, note: "Locul tău trece la altcineva." },
  closing: "Ne vedem la start.",
};

describe("DECISIONS.md §309 the underline marker in the plain text, beside a tokenised link", () => {
  it("drops the marker from the sentence and leaves the addresses as they were minted", () => {
    const rendered = renderContent(content, "ro");
    expect(rendered.text).toContain("Ești deja înscris la acest eveniment.");
    expect(rendered.text).toContain(`Semnează declarația: https://example.test/ro/inregistrari/declaratie/${TOKEN_WITH_UNDERSCORES}`);
    expect(rendered.text).toContain(`/gestionare/${TOKEN_WITH_UNDERSCORES}#cancel`);
    // The words carry no marker; only the addresses may hold underscores.
    expect(rendered.text.replace(/https?:\/\/\S+/g, "<link>")).not.toContain("__");
  });

  it("underlines the sentence in the HTML and never an address", () => {
    const rendered = renderContent(content, "ro");
    expect(rendered.html).toContain(`<u style="text-decoration:underline">Ești deja înscris</u>`);
    expect(rendered.html).toContain(`href="https://example.test/ro/inregistrari/declaratie/${TOKEN_WITH_UNDERSCORES}"`);
  });
});
