import { describe, expect, it } from "vitest";
import { buildOrgChart, type OrgChartCard, type OrgChartNode } from "@/modules/content/team/domain/org-chart";
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
 * §NNN — «Echipa» as an organisational chart: the pure layout over the shown cards, and what a
 * card's new boxes accept. Fixtures say «Președinte», «Rol A», «Partener 1»: no person's name, no
 * real role, no partner.
 */

const card = (id: string, reportsToId: string | null = null, placement: "below" | "beside" = "below"): OrgChartCard => ({ id, reportsToId, placement });
const ids = (nodes: readonly OrgChartNode<OrgChartCard>[]) => nodes.map((node) => node.card.id);

describe("§NNN buildOrgChart", () => {
  it("puts cards with no relations in one tier, as roots, in the list's order, and says there is no relation", () => {
    const chart = buildOrgChart([card("a"), card("b"), card("c")]);
    expect(chart.hasRelations).toBe(false);
    expect(ids(chart.roots)).toEqual(["a", "b", "c"]);
    expect(chart.tiers).toHaveLength(1);
    expect(ids(chart.tiers[0]!)).toEqual(["a", "b", "c"]);
  });

  it("hangs children under their parent in position order, tier by tier", () => {
    const chart = buildOrgChart([card("p"), card("c2", "p"), card("c1", "p"), card("g", "c2")]);
    expect(chart.hasRelations).toBe(true);
    expect(ids(chart.roots)).toEqual(["p"]);
    // The list's order, not the alphabet: c2 was listed before c1.
    expect(ids(chart.roots[0]!.children)).toEqual(["c2", "c1"]);
    expect(ids(chart.roots[0]!.children[0]!.children)).toEqual(["g"]);
    expect(chart.tiers.map(ids)).toEqual([["p"], ["c2", "c1"], ["g"]]);
  });

  it("attaches a beside card to its parent at the parent's tier, after it, with its own children under it", () => {
    const chart = buildOrgChart([card("p"), card("adv", "p", "beside"), card("c", "p"), card("x", "adv")]);
    const root = chart.roots[0]!;
    expect(ids(root.beside)).toEqual(["adv"]);
    expect(ids(root.children)).toEqual(["c"]);
    expect(ids(root.beside[0]!.children)).toEqual(["x"]);
    expect(chart.tiers.map(ids)).toEqual([["p", "adv"], ["c", "x"]]);
  });

  it("makes a child whose parent is not among the shown cards a root — a hidden or deleted parent drops nobody", () => {
    const chart = buildOrgChart([card("p"), card("orphan", "hidden-one"), card("c", "p")]);
    expect(ids(chart.roots)).toEqual(["p", "orphan"]);
    expect(chart.hasRelations).toBe(true);
    // A card whose only relation is to a hidden parent is no relation at all: the grid stands.
    expect(buildOrgChart([card("a"), card("b", "gone")]).hasRelations).toBe(false);
  });

  it("terminates on a stale cycle in the data, keeping every card exactly once", () => {
    const chart = buildOrgChart([card("a", "b"), card("b", "a"), card("c", "a"), card("d")]);
    const all: string[] = [];
    const walk = (nodes: readonly OrgChartNode<OrgChartCard>[]) => {
      for (const node of nodes) {
        all.push(node.card.id);
        walk(node.beside);
        walk(node.children);
      }
    };
    walk(chart.roots);
    expect([...all].sort()).toEqual(["a", "b", "c", "d"]);
    // `d` is the real root; the cycle's first card in the list's order becomes a root behind it.
    expect(ids(chart.roots)).toEqual(["d", "a"]);
    expect(ids(chart.roots[1]!.children)).toEqual(["b", "c"]);
  });

  it("never lets a card be its own parent, whatever the row says", () => {
    const chart = buildOrgChart([card("a", "a")]);
    expect(ids(chart.roots)).toEqual(["a"]);
    expect(chart.hasRelations).toBe(false);
  });
});

describe("§NNN a card's sub-role, responsibilities, parent and placement", () => {
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

describe("§NNN a box under the chart", () => {
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
