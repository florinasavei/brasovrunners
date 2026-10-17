import { describe, expect, it } from "vitest";
import { checkpointBox, gpxProposalBox } from "@/modules/event-checkpoints/domain/checkpoint";
import { gpxPreviewFields, postedCheckpoints, postedGpxPicks } from "@/modules/event-checkpoints/posted";
import { isRichTextField, isTranslatableEnglishField, romanianTwinCandidates } from "@/modules/translate/domain/fields";

/**
 * §464, §757 — «Tradu din română» beside an event's checkpoint names: the list's English name and note (`cp[<n>].nameEn`,
 * `cp[<n>].noteEn`) and the GPX preview's English name (`gp[<n>].nameEn`) are on the allowlist, each finds its Romanian twin
 * by the pair's own spelling, and the preview's boxes are named apart from the list's so a name is one box on the page.
 */
describe("§757 the checkpoints' English boxes may be translated", () => {
  it("allows a point's English name and note in the list and the preview's English name, and nothing else of the card", () => {
    for (const name of ["cp[0].nameEn", "cp[7].noteEn", "cp[123].nameEn", "gp[0].nameEn", "gp[12].nameEn"]) {
      expect(isTranslatableEnglishField(name), name).toBe(true);
      expect(isRichTextField(name), name).toBe(false);
    }
    for (const name of ["cp[0].nameRo", "cp[0].noteRo", "cp[0].km", "cp[0].kinds", "cp[0].id", "cp[0].cutoffHours", "cp[].nameEn", "cp[1234].nameEn", "cp[0].nameEn.x", "gp[0].nameRo", "gp[0].noteEn", "gp[].nameEn", "gpxKey", "pick"]) {
      expect(isTranslatableEnglishField(name), name).toBe(false);
    }
  });

  it("finds each English box's Romanian twin by the …Ro / …En spelling the card draws", () => {
    expect(romanianTwinCandidates(checkpointBox(3, "nameEn"))[0]).toBe(checkpointBox(3, "nameRo"));
    expect(romanianTwinCandidates(checkpointBox(3, "noteEn"))[0]).toBe(checkpointBox(3, "noteRo"));
    expect(romanianTwinCandidates(gpxProposalBox(2, "nameEn"))[0]).toBe(gpxProposalBox(2, "nameRo"));
  });

  it("names the preview's boxes apart from the list's: the same row number never names a box of both forms", () => {
    for (const at of [0, 1, 9]) {
      for (const field of ["nameRo", "nameEn"] as const) expect(gpxProposalBox(at, field)).not.toBe(checkpointBox(at, field));
    }
    expect(gpxProposalBox(2, "nameEn")).toBe("gp[2].nameEn");
  });
});

describe("§757 what the two forms post, read by name", () => {
  const posted = (entries: [string, string][]) => {
    const form = new FormData();
    for (const [name, value] of entries) form.append(name, value);
    return form;
  };

  it("reads each ticked proposal's two names from the preview's boxes, in the order ticked", () => {
    const form = posted([
      ["pick", "0"],
      ["pick", "2"],
      ["gp[0].nameRo", "Izvor"],
      ["gp[0].nameEn", "Spring"],
      ["gp[1].nameRo", "Not ticked"],
      ["gp[1].nameEn", "Not ticked"],
      ["gp[2].nameRo", "Cabana"],
      ["gp[2].nameEn", ""],
    ]);
    expect(postedGpxPicks(form)).toEqual([
      { at: 0, nameRo: "Izvor", nameEn: "Spring" },
      { at: 2, nameRo: "Cabana", nameEn: "" },
    ]);
  });

  it("ignores a tick that is not a small whole number, and reads no `cp[…]` box as a preview's name", () => {
    const form = posted([
      ["pick", "x"],
      ["pick", "1000"],
      ["pick", "-1"],
      ["pick", "1"],
      ["cp[1].nameRo", "A list row's name"],
      ["cp[1].nameEn", "A list row's English name"],
    ]);
    expect(postedGpxPicks(form)).toEqual([{ at: 1, nameRo: "", nameEn: "" }]);
  });

  it("keeps the list's rows to `cp[…]` — the preview's boxes are no row of the list", () => {
    const form = posted([
      ["cp[0].id", ""],
      ["cp[0].nameRo", "Izvor"],
      ["cp[0].nameEn", "Spring"],
      ["gp[0].nameRo", "From the preview"],
      ["gp[0].nameEn", "From the preview"],
    ]);
    expect(postedCheckpoints(form).map((row) => [row.index, row.nameRo, row.nameEn])).toEqual([[0, "Izvor", "Spring"]]);
  });

  it("says a refusal's boxes in the preview's spelling, and leaves any other name alone", () => {
    expect(gpxPreviewFields(["cp[2].nameEn", "cp[0].km", "gpxKey", "event.title"])).toEqual(["gp[2].nameEn", "gp[0].km", "gpxKey", "event.title"]);
    expect(gpxPreviewFields([])).toEqual([]);
  });
});
