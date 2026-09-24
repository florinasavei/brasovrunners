import { describe, expect, it } from "vitest";
import ro from "../../../messages/ro.json";
import { isoWeekdayOf, ruleSentenceFrom } from "@/modules/content/events/ui/RepeatRuleFields";
import { followingIds, presetOf } from "@/modules/content/events/ui/SeriesScope";
import { slugFromTitle } from "@/modules/content/events/ui/slug";
import { ignoreHiddenFields, normalizeForMode } from "@/modules/content/events/service";
import { weekdayNames } from "@/modules/events/ui/series-sentence";
import { isBlankValue } from "@/shared/forms/blank-value";

/**
 * §NNN — the small pure pieces the event editor's boxes stand on: the page address from a title,
 * a blank value (the tab marks), the series scope's presets and its new default, the live rule
 * sentence, and `normalizeForMode`.
 */

describe("§NNN slugFromTitle — the create page's address, from the title", () => {
  it("lowercases, drops the diacritics (comma and cedilla forms), and joins the words with hyphens", () => {
    expect(slugFromTitle("Crosul Tâmpei 2026")).toBe("crosul-tampei-2026");
    expect(slugFromTitle("Alergare de luni — Șprint în Parcul Tractorul")).toBe("alergare-de-luni-sprint-in-parcul-tractorul");
    expect(slugFromTitle("Ştafeta ţării")).toBe("stafeta-tarii");
    expect(slugFromTitle("  ---Hello, World!!  ")).toBe("hello-world");
  });

  it("stays within the 120 characters the schema allows, without a trailing hyphen", () => {
    const long = slugFromTitle(`${"a".repeat(119)} b`);
    expect(long.length).toBeLessThanOrEqual(120);
    expect(long.endsWith("-")).toBe(false);
  });
});

describe("§NNN isBlankValue — what the tabs call unfinished", () => {
  it("reads whitespace and an empty editor document as blank, a word or a picture as not", () => {
    expect(isBlankValue("")).toBe(true);
    expect(isBlankValue("   ")).toBe(true);
    expect(isBlankValue(JSON.stringify({ type: "doc", content: [{ type: "paragraph" }] }))).toBe(true);
    expect(isBlankValue(JSON.stringify({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: " " }] }] }))).toBe(true);
    expect(isBlankValue(JSON.stringify({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Da" }] }] }))).toBe(false);
    expect(isBlankValue(JSON.stringify({ type: "doc", content: [{ type: "image", attrs: { src: "x" } }] }))).toBe(false);
    expect(isBlankValue("Titlu")).toBe(false);
    // A half-typed value never throws.
    expect(isBlankValue('{"type":"doc"')).toBe(false);
  });
});

describe("§NNN the series scope: three words, 'this and the following' by default (reversing §240)", () => {
  const dates = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }];

  it("starts on this date and the ones after it", () => {
    expect(followingIds(dates, "b")).toEqual(["c", "d"]);
    expect(presetOf(dates, "b", new Set(followingIds(dates, "b")))).toBe("following");
  });

  it("names the three presets and a hand-picked set as none of them", () => {
    expect(presetOf(dates, "b", new Set())).toBe("this");
    expect(presetOf(dates, "b", new Set(["a", "c", "d"]))).toBe("all");
    expect(presetOf(dates, "b", new Set(["a"]))).toBeNull();
    // On the last date there is nothing after it: the default is this date alone.
    expect(presetOf(dates, "d", new Set(followingIds(dates, "d")))).toBe("this");
  });
});

describe("§NNN the rule in one live sentence", () => {
  const words = {
    weekly: ro.Event.series.weekly,
    fortnightly: ro.Event.series.fortnightly,
    monthly: ro.Event.series.monthly,
    atTime: ro.Event.series.atTime,
    forever: ro.Admin.editor.repeatRuleLiveForever,
    until: ro.Admin.editor.repeatRuleLiveUntil,
    horizon: ro.Admin.editor.repeatRuleLiveHorizon,
    // Written on the server (`series-sentence.ts#weekdayNames`) and handed to the island (§324).
    weekdayNames: weekdayNames("ro"),
  };

  it("hands the island the seven weekday names, ISO-numbered, in the reader's language", () => {
    expect(weekdayNames("ro")).toEqual({ "1": "luni", "2": "marți", "3": "miercuri", "4": "joi", "5": "vineri", "6": "sâmbătă", "7": "duminică" });
    expect(weekdayNames("en")["7"]).toBe("Sunday");
  });

  it("says the days, the time, and for ever — or until when — and what is made now", () => {
    expect(ruleSentenceFrom(words, { cadence: "WEEKLY", weekdays: [3, 1], time: "18:30", day: "", until: "" }, "ro")).toBe(
      "În fiecare luni și miercuri, la 18:30 — la nesfârșit. Se creează acum datele din următoarele opt săptămâni.",
    );
    expect(ruleSentenceFrom(words, { cadence: "WEEKLY", weekdays: [1], time: "18:30", day: "", until: "2026-12-20" }, "ro")).toContain(
      "— până la 20.12.2026.",
    );
    expect(ruleSentenceFrom(words, { cadence: "MONTHLY", weekdays: [], time: "09:00", day: "11", until: "" }, "ro")).toMatch(/^Lunar, pe 11, la 09:00/);
  });

  it("reads the own day off the start date as it is typed", () => {
    expect(isoWeekdayOf("2026-09-28")).toBe(1);
    expect(isoWeekdayOf("2026-10-04")).toBe(7);
    expect(isoWeekdayOf("")).toBeNull();
  });
});

describe("§NNN normalizeForMode — what the chosen mode hides is ignored, not refused (extending §111)", () => {
  const fields = {
    registrationMode: "NONE",
    capacity: 20,
    declarationDocumentId: "d",
    participantListVisibility: "NAMES",
    externalProvider: "Asociația X",
    externalRegistrationUrl: "https://entries.example.test",
    confirmationOpensDaysBefore: 7,
    minAge: 16,
    bibStartNumber: 100,
  } as unknown as Parameters<typeof normalizeForMode>[0];

  it("clears the capacity, the declaration and the public list when the mode is not 'here'", () => {
    const none = normalizeForMode(fields);
    expect(none).toMatchObject({ capacity: null, declarationDocumentId: null, participantListVisibility: "HIDDEN", externalProvider: null, externalRegistrationUrl: null });
  });

  it("keeps the organizer's name and link for 'elsewhere', and the window, the age and the numbers always", () => {
    const external = normalizeForMode({ ...fields, registrationMode: "EXTERNAL" } as typeof fields);
    expect(external).toMatchObject({ externalProvider: "Asociația X", externalRegistrationUrl: "https://entries.example.test", capacity: null });
    expect(external).toMatchObject({ confirmationOpensDaysBefore: 7, minAge: 16, bibStartNumber: 100 });
    const internal = normalizeForMode({ ...fields, registrationMode: "INTERNAL" } as typeof fields);
    expect(internal).toMatchObject({ capacity: 20, declarationDocumentId: "d", participantListVisibility: "NAMES", externalProvider: null });
  });
});

describe("§NNN ignoreHiddenFields — what the type or mode hides is replaced before the schema reads it", () => {
  const posted = {
    type: "RACE",
    registrationMode: "INTERNAL",
    capacity: "50",
    declarationDocumentId: "",
    participantListVisibility: "NAMES",
    externalProvider: "",
    externalRegistrationUrl: "www.club.ro",
    confirmationOpensDaysBefore: "99",
  };

  it("replaces a wrong link hidden by 'Pe site', and keeps what 'Pe site' shows and every mode keeps", () => {
    expect(ignoreHiddenFields(posted)).toEqual({ ...posted, externalProvider: null, externalRegistrationUrl: null });
  });

  it("replaces the capacity, the declaration and the list under 'La organizator' and 'Fără'", () => {
    for (const registrationMode of ["EXTERNAL", "NONE"]) {
      expect(ignoreHiddenFields({ ...posted, registrationMode, capacity: "0" })).toMatchObject({
        capacity: null,
        declarationDocumentId: null,
        participantListVisibility: "HIDDEN",
        confirmationOpensDaysBefore: "99",
      });
    }
  });

  it("replaces the whole block on a group run, whatever mode its hidden select still posts", () => {
    expect(ignoreHiddenFields({ ...posted, type: "GROUP_RUN", capacity: "lots" })).toMatchObject({ registrationMode: "NONE", capacity: null, externalRegistrationUrl: null });
  });

  it("adds no key the caller did not send, and leaves an unknown mode or a non-object to the schema", () => {
    expect(ignoreHiddenFields({ registrationMode: "NONE", capacity: "0" })).toEqual({ registrationMode: "NONE", capacity: null });
    expect(ignoreHiddenFields({ registrationMode: "SOMETIMES", capacity: "0" })).toEqual({ registrationMode: "SOMETIMES", capacity: "0" });
    expect(ignoreHiddenFields(null)).toBeNull();
    expect(ignoreHiddenFields("fields")).toBe("fields");
  });

  it("replaces the waiting list's length where 'Pe site' is hidden, the capacity's kin (the waiting-list cap)", () => {
    expect(ignoreHiddenFields({ ...posted, registrationMode: "NONE", waitlistCapacity: "-3" })).toMatchObject({ capacity: null, waitlistCapacity: null });
    expect(ignoreHiddenFields({ ...posted, type: "GROUP_RUN", waitlistCapacity: "5" })).toMatchObject({ waitlistCapacity: null });
    // Shown under "Pe site": checked as typed.
    expect(ignoreHiddenFields({ ...posted, waitlistCapacity: "5" })).toMatchObject({ waitlistCapacity: "5" });
    // Not sent, not added: a caller that never mentioned the limit never lifts it.
    expect(ignoreHiddenFields({ ...posted, registrationMode: "NONE" })).not.toHaveProperty("waitlistCapacity");
  });

});

describe("§NNN normalizeForMode and the waiting list's length (the waiting-list cap)", () => {
  const base = { type: "RACE", registrationMode: "NONE", capacity: null, declarationDocumentId: null, participantListVisibility: "HIDDEN" } as const;

  it("stores no length where nothing queues, and writes nothing when the caller never sent one", () => {
    expect(normalizeForMode({ ...base, waitlistCapacity: 10 } as unknown as Parameters<typeof normalizeForMode>[0])).toMatchObject({ waitlistCapacity: null });
    expect(normalizeForMode(base as unknown as Parameters<typeof normalizeForMode>[0]).waitlistCapacity).toBeUndefined();
    expect(normalizeForMode({ ...base, registrationMode: "INTERNAL", waitlistCapacity: 10 } as unknown as Parameters<typeof normalizeForMode>[0])).toMatchObject({ waitlistCapacity: 10 });
  });
});
