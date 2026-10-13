import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";

vi.mock("next-intl/server", async () => {
  const { createTranslator } = await import("next-intl");
  return {
    getTranslations: async ({ locale, namespace }: { locale: "ro" | "en"; namespace: string }) =>
      createTranslator({ locale, messages: (locale === "ro" ? ro : en) as never, namespace: namespace as never }),
  };
});

import type { Checkpoint } from "@/modules/event-checkpoints/domain/checkpoint";
import EventCheckpoints from "@/modules/events/ui/EventCheckpoints";

/**
 * §NNN, BR-REQ-011-01 — the table «Puncte de control» on the event page: the kilometre, the point,
 * what is there (a glyph with its word), the cut-off in words, the finish last when the event has a
 * time limit; both languages; nothing without checkpoints; every cell carries its column's word so the
 * table reads as a stack at 320 pixels.
 */
const point = (id: string, km: number, over: Partial<Checkpoint> = {}): Checkpoint => ({
  id,
  nameRo: `Punct ${id}`,
  nameEn: `Point ${id}`,
  km,
  kinds: ["WATER"],
  cutoff: null,
  noteRo: null,
  noteEn: null,
  ...over,
});

async function render(checkpoints: Checkpoint[], finish: { km: number | null; limit: string | null } = { km: 21.1, limit: null }, locale: "ro" | "en" = "ro") {
  const element = await EventCheckpoints({ checkpoints, finish, locale });
  return element ? renderToStaticMarkup(element) : "";
}

const rowsOf = (html: string) => [...html.matchAll(/<tr data-testid="checkpoint-(?:row|finish)">[^]*?<\/tr>/g)].map((match) => match[0]);

describe("§NNN the checkpoints' table on the event page", () => {
  it("is nothing at all with no checkpoints, even with a time limit", async () => {
    expect(await render([], { km: 21.1, limit: "12:00" })).toBe("");
  });

  it("draws a section under #checkpoints with its heading and a table headed by its four columns", async () => {
    const html = await render([point("a", 5)]);
    expect(html).toContain('id="checkpoints"');
    expect(html).toContain(`>${ro.Event.checkpoints.heading}</h2>`);
    for (const column of ["km", "name", "kinds", "cutoff"] as const) {
      expect(html).toContain(`<th scope="col">${ro.Event.checkpoints.columns[column]}</th>`);
    }
  });

  it("lists the points by distance with the km, the name and what is there as a word", async () => {
    const html = await render([point("b", 12.5, { kinds: ["FOOD", "FIRST_AID"] }), point("a", 5)]);
    const rows = rowsOf(html);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toContain("5 km");
    expect(rows[0]).toContain("Punct a");
    expect(rows[0]).toContain(ro.Event.checkpoints.kinds.WATER);
    expect(rows[1]).toContain("12,5 km");
    expect(rows[1]).toContain(ro.Event.checkpoints.kinds.FOOD);
    expect(rows[1]).toContain(ro.Event.checkpoints.kinds.FIRST_AID);
    // The glyph is beside the word and hidden from a screen reader: the word says it.
    expect(rows[1]).toContain('aria-hidden="true"');
  });

  it("says the cut-off in words, «Ora limită 11:30», and a dash with its words for a point without one", async () => {
    const rows = rowsOf(await render([point("a", 5, { cutoff: "11:30" }), point("b", 8)]));
    expect(rows[0]).toContain("Ora limită 11:30");
    expect(rows[1]).not.toContain("Ora limită");
    expect(rows[1]).toContain(ro.Event.checkpoints.noCutoff);
  });

  it("puts the finish last, with the event's limit, when the event has a time limit — and not otherwise", async () => {
    const withLimit = rowsOf(await render([point("a", 5, { cutoff: "10:00" })], { km: 21.1, limit: "12:00" }));
    expect(withLimit).toHaveLength(2);
    expect(withLimit[1]).toContain('data-testid="checkpoint-finish"');
    expect(withLimit[1]).toContain(ro.Event.checkpoints.finish);
    expect(withLimit[1]).toContain("21,1 km");
    expect(withLimit[1]).toContain("se închide la 12:00");
    expect(withLimit[1]).not.toContain("Ora limită 12:00");
    expect(rowsOf(await render([point("a", 5)], { km: 21.1, limit: null }))).toHaveLength(1);
  });

  it("shows the finish without a distance as a dash", async () => {
    const rows = rowsOf(await render([point("a", 5)], { km: null, limit: "12:00" }));
    expect(rows[1]).toContain("—");
    expect(rows[1]).toContain("se închide la 12:00");
  });

  it("shows the note under the name, in this language only", async () => {
    const note = { noteRo: "Banane pe masă", noteEn: "Bananas on the table" };
    expect(await render([point("a", 5, note)])).toContain("Banane pe masă");
    expect(await render([point("a", 5, note)])).not.toContain("Bananas");
    const english = await render([point("a", 5, note)], { km: 21.1, limit: null }, "en");
    expect(english).toContain("Bananas on the table");
    expect(english).not.toContain("Banane");
  });

  it("is in both languages: the heading, the names, the kinds and the cut-off", async () => {
    const html = await render([point("a", 5, { cutoff: "11:30", kinds: ["TIMING"] })], { km: 21.1, limit: "12:00" }, "en");
    expect(html).toContain(">Checkpoints</h2>");
    expect(html).toContain("Point a");
    expect(html).not.toContain("Punct a");
    expect(html).toContain("Timing");
    expect(html).toContain("Cut-off 11:30");
    expect(html).toContain("Finish");
  });

  it("gives every cell its column's word, so the table reads as a stack on a phone, and hides the header row from the eye only", async () => {
    const html = await render([point("a", 5, { cutoff: "11:30" })]);
    const row = rowsOf(html)[0];
    for (const column of ["km", "name", "kinds", "cutoff"] as const) {
      expect(row).toContain(`data-label="${ro.Event.checkpoints.columns[column]}"`);
    }
    // A real table, with real headers: a screen reader still has them.
    expect(html).toMatch(/<table[^>]*>\s*<thead>/);
    expect(html).toContain('scope="col"');
  });

  it("has the same words in both catalogues", () => {
    expect(Object.keys(en.Event.checkpoints).sort()).toEqual(Object.keys(ro.Event.checkpoints).sort());
    expect(Object.keys(en.Event.checkpoints.kinds).sort()).toEqual(["FIRST_AID", "FOOD", "TIMING", "WATER"]);
    expect(Object.keys(en.Admin.checkpoints).sort()).toEqual(Object.keys(ro.Admin.checkpoints).sort());
    for (const key of Object.keys(ro.Admin.errors).filter((name) => name.startsWith("CHECKPOINT_"))) {
      expect(en.Admin.errors).toHaveProperty(key);
    }
  });
});
