import { describe, expect, it } from "vitest";
import type { RichTextDoc } from "@/modules/content/rich-text/domain/schema";
import { checkNewsletterWords, newsletterFirstLine, NEWSLETTER_BODY_MAX, readPostedNewsletterBody } from "@/modules/newsletter/domain/message";
import {
  confirmLinkState,
  parseSubscriberListQuery,
  subscriberListInUse,
  subscriberListParams,
} from "@/modules/newsletter/domain/subscriber-list";
import { buildSubscribersCsv, CSV_BOM, subscribersCsvFileName } from "@/modules/newsletter/subscribers-csv";
import { emailPictureSrc, newsletterBodyParts, unsupportedNewsletterBlocks } from "@/modules/notifications/domain/email-rich-text";
import { renderBilingual } from "@/modules/notifications/templates";
import { env } from "@/shared/config/env";

const BASE = "https://club.example";
/** A picture stored with a ladder (a version-8 prefix, §414), served by the local route. */
const LADDERED = "/api/media/news/0f8fad5b-d9cb-869f-a165-70867728950e/web.webp";
/** A picture stored before the ladder (a version-4 prefix), on the store's public host. */
const OLD = "https://pub-store.example/news/0f8fad5b-d9cb-469f-a165-70867728950e/web.webp";

/** The letter the owner asked to be able to write: a bold line, a link, a list and a picture. */
const LETTER: RichTextDoc = {
  type: "doc",
  content: [
    { type: "paragraph", content: [{ type: "text", text: "Sâmbătă testăm pantofi", marks: [{ type: "bold" }] }] },
    {
      type: "paragraph",
      content: [
        { type: "text", text: "Detalii pe " },
        { type: "text", text: "pagina evenimentului", marks: [{ type: "link", attrs: { href: "https://club.example/ro/evenimente/test" } }] },
        { type: "text", text: "." },
      ],
    },
    {
      type: "bulletList",
      content: [
        { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Adu șosete" }] }] },
        { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Vino la 9:00" }] }] },
      ],
    },
    {
      type: "image",
      attrs: { src: LADDERED, alt: "Pantofii de test", caption: "Modelele de anul acesta", width: 2400, height: 1600, widthPercent: 75, align: "left", crop: null },
    },
  ],
};

describe("§NNN the newsletter's letter in the rich-text editor", () => {
  it("carries a bold line, a link, a list and a picture into the HTML and the text alternative", () => {
    const parts = newsletterBodyParts(LETTER, BASE);
    const html = parts.map((part) => part.html).join("\n");
    const text = parts.flatMap((part) => part.text).join("\n");

    expect(html).toContain("<strong>Sâmbătă testăm pantofi</strong>");
    expect(html).toMatch(/<a href="https:\/\/club\.example\/ro\/evenimente\/test" style="[^"]*">pagina evenimentului<\/a>/);
    expect(html).toMatch(/<ul style="[^"]*"><li>Adu șosete<\/li><li>Vino la 9:00<\/li><\/ul>/);
    // The picture: absolute from the base, the rung twice the card's width, its alt, 75 % of the card.
    expect(html).toContain(`<img src="${BASE}/api/media/news/0f8fad5b-d9cb-869f-a165-70867728950e/1280w.webp" alt="Pantofii de test" width="413"`);
    expect(html).toContain("Modelele de anul acesta");
    // Centred whatever side the page floats it to: a mail client floats nothing reliably.
    expect(html).not.toContain("float");

    expect(text).toContain("Sâmbătă testăm pantofi");
    expect(text).toContain("Detalii pe pagina evenimentului.");
    expect(text).toContain("- Adu șosete");
    expect(text).toContain("- Vino la 9:00");
    expect(text).toContain(`[Pantofii de test] ${BASE}/api/media/news/0f8fad5b-d9cb-869f-a165-70867728950e/1280w.webp`);
    expect(text).toContain("Modelele de anul acesta");
  });

  it("sends the whole message through the one template: the letter in both halves, every picture absolute from APP_BASE_URL", () => {
    const message = renderBilingual(
      "NEWSLETTER",
      "ro",
      { participantName: "", newsletterSubject: "Știri", newsletterSubjectOther: "News", newsletterBodyDoc: LETTER, newsletterBodyDocOther: LETTER, newsletterManageUrl: `${env.APP_BASE_URL}/ro/noutati/abonament/EXAMPLE` },
      undefined,
    );
    expect(message.html).toContain("<strong>Sâmbătă testăm pantofi</strong>");
    expect(message.html).toContain(`src="${env.APP_BASE_URL}/api/media/news/`);
    expect(message.html).not.toMatch(/src="\/api\/media/);
    const [romanian, english] = message.text.split("— — —");
    expect(romanian).toContain("- Adu șosete");
    expect(english).toContain("- Adu șosete");
  });

  it("keeps a picture already on the store's public host as it is, and a picture with no ladder at its master", () => {
    const image = LETTER.content?.[3] as Extract<NonNullable<RichTextDoc["content"]>[number], { type: "image" }>;
    expect(emailPictureSrc({ ...image, attrs: { ...image.attrs, src: OLD } }, BASE)).toBe(OLD);
    expect(emailPictureSrc({ ...image, attrs: { ...image.attrs, width: 900 } }, `${BASE}/`)).toBe(`${BASE}${LADDERED}`);
  });

  it("refuses a film and a table by name, a picture from elsewhere as unreadable, and counts the ceiling on the words", () => {
    const withFilm: RichTextDoc = { type: "doc", content: [...(LETTER.content ?? []), { type: "youtube", attrs: { videoId: "dQw4w9WgXcQ", caption: "", widthPercent: 100, align: "block", poster: null, posterSource: null } }] };
    expect(unsupportedNewsletterBlocks(withFilm)).toEqual(["youtube"]);
    const film = checkNewsletterWords({ subject: { ro: "a", en: "b" }, body: { ro: JSON.stringify(withFilm), en: JSON.stringify(LETTER) } });
    expect(film.issues).toEqual([{ box: "newsletterBodyRo", problem: "unsupported", names: ["youtube"] }]);

    const foreign = JSON.stringify({ type: "doc", content: [{ type: "image", attrs: { src: "https://elsewhere.example/cat.jpg", alt: "" } }] });
    expect(readPostedNewsletterBody(foreign)).toBe("invalid");
    // The stored key's own shape on another host — the schema takes it, the letter does not.
    const tracker = (src: string) => JSON.stringify({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Salut" }] }, { type: "image", attrs: { src, alt: "" } }] });
    const lookalike = "https://tracker.example/news/0f8fad5b-d9cb-869f-a165-70867728950e/web.webp";
    expect(readPostedNewsletterBody(tracker(lookalike), "https://pub-store.example")).toBe("invalid");
    expect(readPostedNewsletterBody(tracker(lookalike), null)).toBe("invalid");
    expect(readPostedNewsletterBody(tracker("https://pub-store.example.tracker.example/news/0f8fad5b-d9cb-869f-a165-70867728950e/web.webp"), "https://pub-store.example")).toBe("invalid");
    expect(readPostedNewsletterBody(tracker(OLD), "https://pub-store.example/")).not.toBe("invalid");
    expect(readPostedNewsletterBody(tracker(LADDERED), null)).not.toBe("invalid");
    expect(checkNewsletterWords({ subject: { ro: "a", en: "b" }, body: { ro: tracker(lookalike), en: JSON.stringify(LETTER) } }).issues).toEqual([
      { box: "newsletterBodyRo", problem: "unsupported", names: [] },
    ]);

    // The JSON of a long letter is far longer than its words: only the words are counted.
    const words = "x".repeat(NEWSLETTER_BODY_MAX - 10);
    const long: RichTextDoc = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: words, marks: [{ type: "bold" }, { type: "italic" }] }] }] };
    expect(JSON.stringify(long).length).toBeGreaterThan(NEWSLETTER_BODY_MAX);
    expect(checkNewsletterWords({ subject: { ro: "a", en: "b" }, body: { ro: JSON.stringify(long), en: JSON.stringify(LETTER) } }).issues).toEqual([]);

    // A field in braces inside the letter is refused by name, as in plain text.
    const braces: RichTextDoc = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Salut {participantName}" }] }] };
    expect(checkNewsletterWords({ subject: { ro: "a", en: "b" }, body: { ro: JSON.stringify(LETTER), en: JSON.stringify(braces) } }).issues).toEqual([
      { box: "newsletterBodyEn", problem: "placeholder", names: ["participantName"] },
    ]);
  });

  it("says a letter's first line of words for the sends' history, a plain old send's too", () => {
    expect(newsletterFirstLine(LETTER)).toBe("Sâmbătă testăm pantofi");
    expect(newsletterFirstLine("\n  Salut,\n\nrestul")).toBe("Salut,");
    expect(newsletterFirstLine("y".repeat(300), 20)).toBe(`${"y".repeat(19)}…`);
  });
});

describe("§NNN the «Abonați» list's address and states", () => {
  it("reads only real topics and states from the address, and writes back only what narrows it", () => {
    const query = parseSubscriberListQuery({ q: "  ana@example.org ", topic: "GEAR_TESTING", state: "pending", saved: "x" });
    expect(query).toEqual({ q: "ana@example.org", topic: "GEAR_TESTING", state: "pending" });
    expect(subscriberListParams(query).toString()).toBe("q=ana%40example.org&topic=GEAR_TESTING&state=pending");
    expect(subscriberListInUse(query)).toBe(true);
    // The retired topic is no filter (§517), and neither is a word that is not a state.
    const nothing = parseSubscriberListQuery({ topic: "DISCOUNTS", state: "maybe" });
    expect(nothing).toEqual({ q: "", topic: null, state: null });
    expect(subscriberListParams(nothing).toString()).toBe("");
    expect(subscriberListInUse(nothing)).toBe(false);
  });

  it("says what a pending row's confirmation link is doing: live until when, on its way, or expired", () => {
    const now = new Date("2026-10-01T10:00:00.000Z");
    const later = new Date("2026-10-02T10:00:00.000Z");
    const earlier = new Date("2026-09-30T10:00:00.000Z");
    expect(confirmLinkState({ confirmedAt: earlier, liveConfirmUntil: later, confirmationQueued: true }, now)).toEqual({ kind: "confirmed" });
    expect(confirmLinkState({ confirmedAt: null, liveConfirmUntil: later, confirmationQueued: true }, now)).toEqual({ kind: "sending" });
    expect(confirmLinkState({ confirmedAt: null, liveConfirmUntil: later, confirmationQueued: false }, now)).toEqual({ kind: "live", expiresAt: later });
    expect(confirmLinkState({ confirmedAt: null, liveConfirmUntil: earlier, confirmationQueued: false }, now)).toEqual({ kind: "expired" });
    expect(confirmLinkState({ confirmedAt: null, liveConfirmUntil: null, confirmationQueued: false }, now)).toEqual({ kind: "expired" });
  });
});

describe("§NNN the subscribers' CSV", () => {
  const header = { email: "Adresa", language: "Limba", topics: "Teme", state: "Starea", subscribed: "Abonat din", confirmed: "Confirmat la" };

  it("starts with a BOM, keeps the table's columns and escapes the way the registrations export does", () => {
    const csv = buildSubscribersCsv(header, [
      {
        email: "=HYPERLINK(\"x\")@example.org",
        language: "RO",
        topics: "Evenimente mari; Voluntariat",
        state: "Confirmat",
        subscribedAt: new Date("2026-09-01T08:00:00.000Z"),
        confirmedAt: new Date("2026-09-01T08:05:00.000Z"),
      },
      { email: "ion,pop@example.org", language: "EN", topics: "Toate noutățile", state: "În așteptare", subscribedAt: new Date("2026-09-02T08:00:00.000Z"), confirmedAt: null },
    ]);
    expect(csv.startsWith(CSV_BOM)).toBe(true);
    const lines = csv.slice(CSV_BOM.length).split("\r\n");
    expect(lines[0]).toBe("Adresa,Limba,Teme,Starea,Abonat din,Confirmat la");
    // A formula is neutralized with an apostrophe, and a quote doubled inside a quoted cell.
    expect(lines[1]).toBe(`"'=HYPERLINK(""x"")@example.org",RO,Evenimente mari; Voluntariat,Confirmat,2026-09-01T08:00:00.000Z,2026-09-01T08:05:00.000Z`);
    // A comma is quoted; a pending row's «Confirmat la» is empty.
    expect(lines[2]).toBe(`"ion,pop@example.org",EN,Toate noutățile,În așteptare,2026-09-02T08:00:00.000Z,`);
    expect(lines).toHaveLength(3);
  });

  it("names the file with the club's date", () => {
    expect(subscribersCsvFileName("2026-09-28")).toBe("newsletter-abonati-2026-09-28.csv");
  });
});
