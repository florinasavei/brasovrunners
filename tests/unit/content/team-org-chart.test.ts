import { describe, expect, it } from "vitest";
import {
  responsibilityLines,
  TEAM_RESPONSIBILITIES_MAX_LINES,
  TEAM_RESPONSIBILITY_LINE_MAX,
  TEAM_SUBTITLE_MAX,
  teamBoxFieldsSchema,
  teamMemberFieldsSchema,
  teamReportsToSelf,
} from "@/modules/content/team/fields";

/**
 * §691 — what a card's boxes of the organisational chart accept: the sub-role, the responsibilities,
 * and the parent and placement the save still keeps for their columns though no form posts them
 * since §NNN (the layout is `team-canvas.test.ts`'s now). Fixtures say «Președinte», «Rol A»,
 * «Partener 1»: no person's name, no real role, no partner.
 */

describe("§691 a card's sub-role, responsibilities, parent and placement", () => {
  const base = { name: "Președinte", roleRo: "", roleEn: "", bioRo: "", bioEn: "", photoAssetId: "" };
  const issuesOf = (value: unknown) => {
    const parsed = teamMemberFieldsSchema.safeParse(value);
    return parsed.success ? [] : parsed.error.issues.map((issue) => issue.path.join("."));
  };
  const parse = (value: unknown) => teamMemberFieldsSchema.parse(value);

  it("takes the subtitle and the responsibilities in both languages or in neither, refused on the empty side", () => {
    expect(issuesOf({ ...base, subtitleRo: "Linia a doua" })).toEqual(["subtitleEn"]);
    expect(issuesOf({ ...base, subtitleEn: "Second line" })).toEqual(["subtitleRo"]);
    expect(issuesOf({ ...base, responsibilitiesRo: "Una\nDouă" })).toEqual(["responsibilitiesEn"]);
    expect(issuesOf({ ...base, responsibilitiesEn: "One" })).toEqual(["responsibilitiesRo"]);
    expect(issuesOf({ ...base, subtitleRo: "Linia", subtitleEn: "Line", responsibilitiesRo: "Una", responsibilitiesEn: "One" })).toEqual([]);
    const parsed = parse(base);
    expect(parsed).toMatchObject({ subtitleRo: null, subtitleEn: null, responsibilitiesRo: null, responsibilitiesEn: null, reportsToId: null, placement: "below" });
  });

  it("keeps one responsibility per line, blank lines and stray spaces gone, and reads them back as lines", () => {
    const parsed = parse({ ...base, responsibilitiesRo: "  Una  \r\n\r\n Două   trei \n", responsibilitiesEn: "One\nTwo" });
    expect(parsed.responsibilitiesRo).toBe("Una\nDouă trei");
    expect(responsibilityLines(parsed.responsibilitiesRo)).toEqual(["Una", "Două trei"]);
    expect(responsibilityLines(null)).toEqual([]);
  });

  it("refuses more than twelve lines, and a line over 160 characters, naming the box", () => {
    const twelve = Array.from({ length: TEAM_RESPONSIBILITIES_MAX_LINES }, (_, i) => `Rol ${i + 1}`).join("\n");
    expect(issuesOf({ ...base, responsibilitiesRo: twelve, responsibilitiesEn: twelve })).toEqual([]);
    expect(issuesOf({ ...base, responsibilitiesRo: `${twelve}\nRol 13`, responsibilitiesEn: twelve })).toEqual(["responsibilitiesRo"]);
    const long = "a".repeat(TEAM_RESPONSIBILITY_LINE_MAX + 1);
    expect(issuesOf({ ...base, responsibilitiesRo: "Una", responsibilitiesEn: long })).toEqual(["responsibilitiesEn"]);
    expect(issuesOf({ ...base, subtitleRo: "a".repeat(TEAM_SUBTITLE_MAX + 1), subtitleEn: "b" })).toEqual(["subtitleRo"]);
  });

  it("collapses the subtitle to one line", () => {
    expect(parse({ ...base, subtitleRo: " Linia \n a doua ", subtitleEn: "Line" }).subtitleRo).toBe("Linia a doua");
  });

  it("takes the parent as a card id or nothing, and knows a card asked to answer to itself", () => {
    expect(issuesOf({ ...base, reportsToId: "not-an-id" })).toEqual(["reportsToId"]);
    const id = "0F6C4A36-5D1A-4B8E-9C3D-2A1B0C9D8E7F";
    const parsed = parse({ ...base, reportsToId: id, placement: "beside" });
    expect(parsed.reportsToId).toBe(id.toLowerCase());
    expect(teamReportsToSelf(parsed, id)).toBe(true);
    expect(teamReportsToSelf(parsed, "1f6c4a36-5d1a-4b8e-9c3d-2a1b0c9d8e7f")).toBe(false);
    expect(teamReportsToSelf(parse(base), id)).toBe(false);
  });

  it("writes `below` for a root whatever the placement box says, keeps `beside` only with a parent, and refuses an unknown word", () => {
    expect(parse({ ...base, placement: "beside" }).placement).toBe("below");
    const id = "0f6c4a36-5d1a-4b8e-9c3d-2a1b0c9d8e7f";
    expect(parse({ ...base, reportsToId: id, placement: "beside" }).placement).toBe("beside");
    expect(parse({ ...base, reportsToId: id }).placement).toBe("below");
    expect(issuesOf({ ...base, reportsToId: id, placement: "above" })).toEqual(["placement"]);
  });
});

describe("§691 a box under the chart", () => {
  const issuesOf = (value: unknown) => {
    const parsed = teamBoxFieldsSchema.safeParse(value);
    return parsed.success ? [] : parsed.error.issues.map((issue) => issue.path.join("."));
  };

  it("needs its title in both languages, always, and its text in both or in neither", () => {
    expect(issuesOf({ titleRo: "Responsabilitate colectivă", titleEn: "Shared responsibility" })).toEqual([]);
    expect(issuesOf({ titleRo: "Responsabilitate colectivă", titleEn: "" })).toEqual(["titleEn"]);
    expect(issuesOf({ titleRo: "  ", titleEn: "Shared responsibility" })).toEqual(["titleRo"]);
    expect(issuesOf({ titleRo: "T", titleEn: "T", bodyRo: "Proiectul A." })).toEqual(["bodyEn"]);
    const parsed = teamBoxFieldsSchema.parse({ titleRo: "T", titleEn: "T", bodyRo: "Proiectul A.", bodyEn: "Project A." });
    expect(parsed.bodyRo).toBe("Proiectul A.");
    expect(parsed.bodyRoJson).toMatchObject({ type: "doc" });
    expect(teamBoxFieldsSchema.parse({ titleRo: "T", titleEn: "T" })).toMatchObject({ bodyRo: null, bodyEn: null, bodyRoJson: null, bodyEnJson: null });
  });

  it("refuses a table in the text, as a bio does", () => {
    const table = JSON.stringify({ type: "doc", content: [{ type: "table", content: [{ type: "tableRow", content: [{ type: "tableCell", content: [{ type: "paragraph" }] }] }] }] });
    expect(issuesOf({ titleRo: "T", titleEn: "T", bodyRoBody: table, bodyEnBody: table })).toEqual(["bodyRoBody", "bodyEnBody"]);
  });
});
