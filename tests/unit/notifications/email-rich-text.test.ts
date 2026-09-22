import { describe, expect, it } from "vitest";
import {
  emailBodyParts,
  emailBodyToParagraphs,
  isEmailBodyEmpty,
  readEmailBody,
  renderEmailBody,
  unsupportedEmailBlocks,
} from "@/modules/notifications/domain/email-rich-text";
import type { RichTextDoc } from "@/modules/content/rich-text/domain/schema";
import { buildTemplateContent, renderContent, type TemplateData } from "@/modules/notifications/templates";

/**
 * BR-REQ-080-01, `DECISIONS.md` §270 — the club's words for a message carry their formatting,
 * and only the formatting an inbox can draw.
 *
 * What these assert, in order of what would hurt most if it broke: a picture, a film or a table
 * never reaches a message; every style is inline, because a mail client drops a stylesheet; the
 * plain-text half says the same thing as the formatted one; and a mark can only ever wrap text
 * that has already been escaped.
 */
describe("DECISIONS.md §270 the club writes an email in the rich-text editor", () => {
  const doc = (content: unknown[]): RichTextDoc => ({ type: "doc", content }) as RichTextDoc;
  const p = (text: string, marks?: unknown[]) => ({
    type: "paragraph",
    content: [{ type: "text", text, ...(marks ? { marks } : {}) }],
  });

  const sample: TemplateData = {
    participantName: "Ana Popescu",
    eventTitle: "Crosul de toamnă",
    bibNumber: 42,
  };

  it("refuses the three an inbox cannot draw, and names them", () => {
    const withTable = doc([
      p("Programul:"),
      { type: "table", content: [{ type: "tableRow", content: [{ type: "tableCell", content: [p("09:00")] }] }] },
    ]);
    expect(unsupportedEmailBlocks(withTable)).toEqual(["table"]);
    // `readEmailBody` is what the save calls: a document carrying one of the three is not a
    // body, so the plain paragraphs beside it stay in force and a message still goes out.
    expect(readEmailBody(withTable)).toBeNull();
    expect(
      readEmailBody(doc([{ type: "youtube", attrs: { videoId: "dQw4w9WgXcQ" } }])),
    ).toBeNull();
    expect(
      readEmailBody(doc([{ type: "image", attrs: { src: "https://example.test/11111111-1111-4111-8111-111111111111/web.webp" } }])),
    ).toBeNull();
  });

  it("writes bold, italic and links as inline styles, never classes", () => {
    const body = readEmailBody(
      doc([
        p("Numărul tău este 42.", [{ type: "bold" }]),
        p("cursiv", [{ type: "italic" }]),
        p("regulament", [{ type: "link", attrs: { href: "https://example.test/reguli" } }]),
      ]),
    );
    const { htmlParts } = renderEmailBody(body as RichTextDoc, sample);
    expect(htmlParts[0]).toContain("<strong>Numărul tău este 42.</strong>");
    expect(htmlParts[1]).toContain("<em>cursiv</em>");
    expect(htmlParts[2]).toContain('<a href="https://example.test/reguli" style="color:');
    // Every part carries its own `style`, and none of them carries a class: a mail client keeps
    // the first and drops the second.
    for (const part of htmlParts) {
      expect(part).toContain('style="');
      expect(part).not.toContain("class=");
    }
  });

  it("escapes the words before a mark wraps them", () => {
    const body = readEmailBody(doc([p("<script>alert(1)</script>", [{ type: "bold" }])]));
    const { htmlParts } = renderEmailBody(body as RichTextDoc, {});
    expect(htmlParts[0]).toContain("&lt;script&gt;");
    expect(htmlParts[0]).not.toContain("<script>");
  });

  it("fills the placeholders in the words, and leaves them alone when storing them", () => {
    const body = readEmailBody(doc([p("Salut {participantName}, numărul tău este {bibNumber}.")])) as RichTextDoc;
    expect(renderEmailBody(body, sample).textLines[0]).toBe("Salut Ana Popescu, numărul tău este 42.");
    // Stored, the club's own sentence keeps its fields: deriving the plain paragraphs must not
    // silently remove them.
    expect(emailBodyToParagraphs(body)).toEqual(["Salut {participantName}, numărul tău este {bibNumber}."]);
  });

  it("says the same thing in both halves of a list", () => {
    const body = readEmailBody(
      doc([
        { type: "bulletList", content: [{ type: "listItem", content: [p("Apă")] }, { type: "listItem", content: [p("Haină")] }] },
      ]),
    ) as RichTextDoc;
    const parts = emailBodyParts(body, {});
    expect(parts).toHaveLength(1);
    expect(parts[0].html).toContain("<li>Apă</li>");
    expect(parts[0].text).toEqual(["- Apă", "- Haină"]);
  });

  it("knows an empty document from one with words in it", () => {
    expect(isEmailBodyEmpty({ type: "doc", content: [] })).toBe(true);
    expect(isEmailBodyEmpty(readEmailBody(doc([p("ceva")])))).toBe(false);
  });

  it("puts the club's formatted words into the message the participant receives", () => {
    const body = readEmailBody(doc([p("Vino la {eventTitle}.", [{ type: "bold" }])]));
    const content = buildTemplateContent("REGISTRATION_CONFIRMED", "ro", sample, "https://example.test/x", {
      "REGISTRATION_CONFIRMED:ro": {
        subject: "Confirmat",
        paragraphs: ["Vino la {eventTitle}."],
        body,
      },
    });
    const rendered = renderContent(content, "ro");
    expect(rendered.html).toContain("<strong>Vino la Crosul de toamnă.</strong>");
    // The plain half carries the sentence without the markers.
    expect(rendered.text).toContain("Vino la Crosul de toamnă.");
    expect(rendered.text).not.toContain("<strong>");
  });
});
