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
import { CHECKPOINT_GLYPH } from "@/modules/events/ui/glyphs";
import EventCheckpoints from "@/modules/events/ui/EventCheckpoints";
import { checkpointFinish, withCutoffClocks } from "@/modules/event-checkpoints/domain/start";

/**
 * §757, §770, BR-REQ-011-01 — the table «Puncte de control» on the event page: the kilometre, the point,
 * what is there (a glyph with its word, «Direcționare» among them), the time limit in words — «Timp
 * limită: 1 h 30 min · se închide la 11:30» — the finish last when the event has a time limit; both
 * languages; nothing without checkpoints; every cell carries its column's word so the table reads as a
 * stack at 320 pixels.
 */
const point = (id: string, km: number, over: Partial<Checkpoint> = {}): Checkpoint => ({
  id,
  nameRo: `Punct ${id}`,
  nameEn: `Point ${id}`,
  km,
  kinds: ["WATER"],
  cutoffMinutes: null,
  cutoffClock: null,
  noteRo: null,
  noteEn: null,
  onProfile: true,
  ...over,
});

type Finish = { km: number | null; limit: string | null; minutes: number | null };
const NO_LIMIT: Finish = { km: 21.1, limit: null, minutes: null };

async function render(checkpoints: Checkpoint[], finish: Finish = NO_LIMIT, locale: "ro" | "en" = "ro") {
  const element = await EventCheckpoints({ checkpoints, finish, locale });
  return element ? renderToStaticMarkup(element) : "";
}

const rowsOf = (html: string) => [...html.matchAll(/<tr data-testid="checkpoint-(?:row|finish)">[^]*?<\/tr>/g)].map((match) => match[0]);

describe("§757 the checkpoints' table on the event page", () => {
  it("is nothing at all with no checkpoints, even with a time limit", async () => {
    expect(await render([], { km: 21.1, limit: "12:00", minutes: 180 })).toBe("");
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

  it("draws a «Direcționare» point with its word and its own glyph, in both languages (§770)", async () => {
    const html = await render([point("a", 5, { kinds: ["DIRECTION"] }), point("b", 9, { kinds: ["WATER", "DIRECTION"] })]);
    const rows = rowsOf(html);
    expect(rows[0]).toContain("Direcționare");
    expect(rows[0]).not.toContain(ro.Event.checkpoints.kinds.WATER);
    expect(rows[1]).toContain("Apă");
    expect(rows[1]).toContain("Direcționare");
    // One glyph per kind: the direction's is not another kind's, so the chips tell the kinds apart.
    expect(CHECKPOINT_GLYPH.DIRECTION).toBeDefined();
    expect(new Set(Object.values(CHECKPOINT_GLYPH)).size).toBe(Object.keys(CHECKPOINT_GLYPH).length);
    const english = rowsOf(await render([point("a", 5, { kinds: ["DIRECTION"] })], NO_LIMIT, "en"));
    expect(english[0]).toContain("Direction");
    expect(english[0]).not.toContain("Direcționare");
  });

  it("draws a «Regrupare» point with its word and the group's glyph, in both languages, and its note says how long (§NNN)", async () => {
    const html = await render([point("a", 5, { kinds: ["REGROUP"], noteRo: "Așteptăm 5 minute", noteEn: "We wait 5 minutes" }), point("b", 9, { kinds: ["WATER", "REGROUP"] })]);
    const rows = rowsOf(html);
    expect(rows[0]).toContain("Regrupare");
    expect(rows[0]).toContain("Așteptăm 5 minute");
    expect(rows[0]).toContain("MuiChip-icon");
    expect(rows[0]).not.toContain(ro.Event.checkpoints.kinds.WATER);
    expect(rows[1]).toContain("Apă");
    expect(rows[1]).toContain("Regrupare");
    expect(CHECKPOINT_GLYPH.REGROUP).toBeDefined();
    const english = rowsOf(await render([point("a", 5, { kinds: ["REGROUP"], noteRo: "Așteptăm 5 minute", noteEn: "We wait 5 minutes" })], NO_LIMIT, "en"));
    expect(english[0]).toContain("Regroup");
    expect(english[0]).toContain("We wait 5 minutes");
    expect(english[0]).not.toContain("Regrupare");
  });

  it("says the time limit in words and the clock it closes at, «Timp limită: 1 h 30 min · se închide la 11:30», and a dash with its words for a point without one", async () => {
    const rows = rowsOf(await render([point("a", 5, { cutoffMinutes: 90, cutoffClock: "11:30" }), point("b", 8)]));
    expect(rows[0]).toContain("Timp limită: 1 h 30 min · se închide la 11:30");
    expect(rows[0]).not.toContain("Ora limită");
    expect(rows[1]).not.toContain("Timp limită");
    expect(rows[1]).toContain(ro.Event.checkpoints.noCutoff);
  });

  it("says only the duration while the event's start has no hour to count it from", async () => {
    const rows = rowsOf(await render([point("a", 5, { cutoffMinutes: 45, cutoffClock: null })]));
    expect(rows[0]).toContain("Timp limită: 45 min");
    expect(rows[0]).not.toContain("se închide");
  });

  it("puts the finish last, with the event's limit and its clock, when the event has a time limit — and not otherwise", async () => {
    const withLimit = rowsOf(await render([point("a", 5, { cutoffMinutes: 60, cutoffClock: "10:00" })], { km: 21.1, limit: "12:00", minutes: 180 }));
    expect(withLimit).toHaveLength(2);
    expect(withLimit[1]).toContain('data-testid="checkpoint-finish"');
    expect(withLimit[1]).toContain(ro.Event.checkpoints.finish);
    expect(withLimit[1]).toContain("21,1 km");
    expect(withLimit[1]).toContain("Timp limită: 3 h · se închide la 12:00");
    expect(rowsOf(await render([point("a", 5)], NO_LIMIT))).toHaveLength(1);
  });

  // §757 amended (the owner, 2026-10-17: «Asta nu e corect pentru că încă nu știm exact la ce oră dăm startul cursei»): the page
  // draws what the event gives it, through the same two functions the event page calls — so the test is the page's, not a copy of it.
  describe("a race whose gun time is not set", () => {
    const race = {
      type: "RACE",
      startsAt: new Date("2026-11-21T07:00:00Z"), // 09:00 in Bucharest: the meeting
      raceStartsAt: null as Date | null,
      endsAt: new Date("2026-11-21T09:00:00Z"), // two hours later
      timezone: "Europe/Bucharest",
      distanceMeters: 21_100,
    };
    const rows = [point("a", 5, { cutoffMinutes: 45 }), point("b", 12, { cutoffMinutes: 90 })];
    const drawn = (event: typeof race, locale: "ro" | "en") => render(withCutoffClocks(rows, event), checkpointFinish(event), locale);

    it("says «Timp limită: 2 h» on the finish and the duration on every point, with no «se închide la», in Romanian", async () => {
      const found = rowsOf(await drawn(race, "ro"));
      expect(found).toHaveLength(3);
      expect(found[0]).toContain("Timp limită: 45 min");
      expect(found[1]).toContain("Timp limită: 1 h 30 min");
      expect(found[2]).toContain('data-testid="checkpoint-finish"');
      expect(found[2]).toContain("Timp limită: 2 h");
      for (const row of found) expect(row).not.toContain("se închide");
    });

    it("says the same in English: «Time limit: 2 h», never «closes at»", async () => {
      const found = rowsOf(await drawn(race, "en"));
      expect(found).toHaveLength(3);
      expect(found[2]).toContain("Time limit: 2 h");
      for (const row of found) expect(row).not.toContain("closes at");
    });

    it("says the clocks as soon as the gun time is set, in both languages", async () => {
      const gun = { ...race, raceStartsAt: new Date("2026-11-21T08:00:00Z"), endsAt: new Date("2026-11-21T10:00:00Z") }; // 10:00 gun, 12:00 end
      const found = rowsOf(await drawn(gun, "ro"));
      expect(found[0]).toContain("Timp limită: 45 min · se închide la 10:45");
      expect(found[2]).toContain("Timp limită: 2 h · se închide la 12:00");
      expect(rowsOf(await drawn(gun, "en"))[2]).toContain("Time limit: 2 h · closes at 12:00");
    });
  });

  it("shows the finish without a distance as a dash the eye sees and words a screen reader reads", async () => {
    const rows = rowsOf(await render([point("a", 5)], { km: null, limit: "12:00", minutes: 180 }));
    expect(rows[1]).toContain('<span aria-hidden="true">—</span>');
    expect(rows[1]).toContain(ro.Event.checkpoints.kmUnknown);
    // The finish has no kinds: no bare dash there either.
    expect(rows[1]).toContain(ro.Event.checkpoints.noKinds);
    expect(rows[1]).toContain("se închide la 12:00");
  });

  it("shows the note under the name, in this language only", async () => {
    const note = { noteRo: "Banane pe masă", noteEn: "Bananas on the table" };
    expect(await render([point("a", 5, note)])).toContain("Banane pe masă");
    expect(await render([point("a", 5, note)])).not.toContain("Bananas");
    const english = await render([point("a", 5, note)], NO_LIMIT, "en");
    expect(english).toContain("Bananas on the table");
    expect(english).not.toContain("Banane");
  });

  it("is in both languages: the heading, the names, the kinds and the time limit", async () => {
    const html = await render([point("a", 5, { cutoffMinutes: 90, cutoffClock: "11:30", kinds: ["TIMING"] })], { km: 21.1, limit: "12:00", minutes: 180 }, "en");
    expect(html).toContain(">Checkpoints</h2>");
    expect(html).toContain("Point a");
    expect(html).not.toContain("Punct a");
    expect(html).toContain("Timing");
    expect(html).toContain("Time limit: 1 h 30 min · closes at 11:30");
    expect(html).not.toContain("Cut-off");
    expect(html).toContain("Finish");
  });

  it("gives every cell its column's word, so the table reads as a stack on a phone, and hides the header row from the eye only", async () => {
    const html = await render([point("a", 5, { cutoffMinutes: 90, cutoffClock: "11:30" })]);
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
    expect(Object.keys(en.Event.checkpoints.kinds).sort()).toEqual(["DIRECTION", "FIRST_AID", "FOOD", "REGROUP", "TIMING", "WATER"]);
    expect(Object.keys(ro.Event.checkpoints.kinds).sort()).toEqual(["DIRECTION", "FIRST_AID", "FOOD", "REGROUP", "TIMING", "WATER"]);
    expect(Object.keys(en.Admin.checkpoints.kinds).sort()).toEqual(["DIRECTION", "FIRST_AID", "FOOD", "REGROUP", "TIMING", "WATER"]);
    expect(Object.keys(ro.Admin.checkpoints.kinds).sort()).toEqual(["DIRECTION", "FIRST_AID", "FOOD", "REGROUP", "TIMING", "WATER"]);
    // «Regrupare» / «Regroup» (§NNN), the same word in the editor and on the page, and the editor's «?» line.
    expect([ro.Event.checkpoints.kinds.REGROUP, ro.Admin.checkpoints.kinds.REGROUP]).toEqual(["Regrupare", "Regrupare"]);
    expect([en.Event.checkpoints.kinds.REGROUP, en.Admin.checkpoints.kinds.REGROUP]).toEqual(["Regroup", "Regroup"]);
    expect(ro.Admin.checkpoints.field.kindsHelp).toContain("așteptăm 5 minute");
    expect(en.Admin.checkpoints.field.kindsHelp).toContain("we wait 5 minutes");
    expect(Object.keys(en.Admin.checkpoints).sort()).toEqual(Object.keys(ro.Admin.checkpoints).sort());
    expect(Object.keys(en.Admin.checkpoints.field).sort()).toEqual(Object.keys(ro.Admin.checkpoints.field).sort());
    for (const key of Object.keys(ro.Admin.errors).filter((name) => name.startsWith("CHECKPOINT"))) {
      expect(en.Admin.errors).toHaveProperty(key);
    }
    for (const key of Object.keys(en.Admin.errors).filter((name) => name.startsWith("CHECKPOINT"))) {
      expect(ro.Admin.errors).toHaveProperty(key);
    }
  });

  it("names the time limit, not a time of the day, in every sentence of both catalogues (§770)", () => {
    expect(ro.Admin.checkpoints.field.cutoff).toBe("Timp limită");
    expect(en.Admin.checkpoints.field.cutoff).toBe("Time limit");
    expect(ro.Admin.checkpoints.field.cutoffHelp).toBe("De la start: până atunci trebuie să treacă ultimul alergător. Lasă gol dacă nu e limită.");
    expect(en.Admin.checkpoints.field.cutoffHelp).toBe("From the start: the last runner has to pass by then. Leave empty for no limit.");
    for (const key of ["CHECKPOINT_CUTOFF_INVALID", "CHECKPOINT_CUTOFF_NO_START", "CHECKPOINT_CUTOFF_AFTER_LATER", "CHECKPOINT_CUTOFF_AFTER_END"] as const) {
      expect(ro.Admin.errors[key], key).toMatch(/Timpul limită/);
      expect(en.Admin.errors[key], key).toMatch(/time limit/i);
    }
    // The time-of-day refusal went with the time of day.
    expect(ro.Admin.errors).not.toHaveProperty("CHECKPOINT_CUTOFF_BEFORE_START");
    expect(en.Admin.errors).not.toHaveProperty("CHECKPOINT_CUTOFF_BEFORE_START");
  });
});
