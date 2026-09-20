import { describe, expect, it } from "vitest";
import { planEventDescription } from "@/modules/events/domain/description";

/**
 * BR-REQ-011-01 criterion 11 and `DECISIONS.md` §187 — the event page has one description slot,
 * under the title, and which field fills it takes two predicates rather than one.
 *
 * The defect these assertions exist against: the page guarded both of its slots with
 * `isRichTextEmpty`, which is defined over the plain text, while `EventExcerpt` has always
 * guarded itself with `hasRichTextContent`, which counts a picture. A long description that was
 * only a picture or only a film was therefore "empty": it did not render, and the summary
 * rendered in its place. The owner, having written one: "rezumatul apare înainte descrierii
 * full".
 */
const doc = (...content: unknown[]) => ({ type: "doc", content });
const paragraph = (text: string) => ({ type: "paragraph", content: [{ type: "text", text }] });
// The address has to be one this site stored, or `readRichText` drops the node and the test
// would be asserting about an empty document rather than about a picture (`rich-text.test.ts`).
const STORED = "/api/media/local/3f2a1b4c-0000-4000-8000-000000000000/web.webp";
const picture = (alt = "", caption = "") => ({
  type: "image",
  attrs: { src: STORED, alt, caption, width: 1200, height: 800, widthPercent: 100 },
});
const film = (caption = "") => ({ type: "youtube", attrs: { videoId: "dQw4w9WgXcQ", caption } });

describe("BR-REQ-011-01 criterion 11 — which description the page shows", () => {
  it("shows the long description and not the summary, when the long one has words", () => {
    const plan = planEventDescription(doc(paragraph("Traseul urcă pe Tâmpa.")));
    expect(plan).toEqual({ showsSummary: false, showsBody: true });
  });

  it("shows the summary when there is no long description at all", () => {
    expect(planEventDescription(null)).toEqual({ showsSummary: true, showsBody: false });
    expect(planEventDescription(doc())).toEqual({ showsSummary: true, showsBody: false });
  });

  it("shows the summary when the long description is only empty paragraphs", () => {
    // What the editor leaves behind when somebody types and deletes: a document, no words.
    expect(planEventDescription(doc(paragraph(""), paragraph("   ")))).toEqual({
      showsSummary: true,
      showsBody: false,
    });
  });

  it("shows BOTH when the long description is a picture with nothing said about it", () => {
    // The defect. The picture must render — it is what the organizer wrote — and the page must
    // still have words, which only the summary can supply. One predicate cannot answer both.
    expect(planEventDescription(doc(picture()))).toEqual({ showsSummary: true, showsBody: true });
  });

  it("shows both for a film with no caption, for the same reason", () => {
    expect(planEventDescription(doc(film()))).toEqual({ showsSummary: true, showsBody: true });
  });

  it("treats a captioned picture as words, so the summary steps aside", () => {
    // A caption is the page's prose; two sentences in two voices under one title is the
    // duplication §156 removed.
    expect(planEventDescription(doc(picture("Start", "Startul de anul trecut")))).toEqual({
      showsSummary: false,
      showsBody: true,
    });
  });

  it("never hides the long description while showing nothing in its place", () => {
    // The property, stated rather than sampled: there is no document for which the page renders
    // neither field while the long one holds something.
    for (const body of [null, doc(), doc(paragraph("")), doc(picture()), doc(film()), doc(paragraph("da"))]) {
      const plan = planEventDescription(body);
      expect(plan.showsSummary || plan.showsBody).toBe(true);
    }
  });
});
