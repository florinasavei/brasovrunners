import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { type RichTextDoc, richTextSchema } from "@/modules/content/rich-text/domain/schema";
import { storedTeamDoc, TEAM_BIO_MAX, teamDocFromPlain, teamFieldName, teamMemberFieldsSchema } from "@/modules/content/team/fields";
import { guessTeamLinkKind, MAX_TEAM_LINKS, readTeamLinks, teamLinkHost } from "@/modules/content/team/links";

/**
 * §474 — «Echipa» grows up: the words about a person are a rich text in both languages or neither,
 * without a table; a card carries up to twelve typed links (§491, six until then), each https, each label both languages or
 * neither; and a card from before — plain words, one link — reads as it did.
 */
const doc = (...paragraphs: string[]): RichTextDoc => ({
  type: "doc",
  content: paragraphs.map((text) => ({ type: "paragraph" as const, content: [{ type: "text" as const, text }] })),
});
const picture: RichTextDoc = richTextSchema.parse({
  type: "doc",
  content: [{ type: "image", attrs: { src: "/api/media/0f6c4a36-5d1a-4b8e-9c3d-2a1b0c9d8e7f/web.webp", alt: "Ana la start", width: 800, height: 600 } }],
});
const table: RichTextDoc = {
  type: "doc",
  content: [
    {
      type: "table",
      content: [{ type: "tableRow", content: [{ type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "5 km" }] }] }] }],
    },
  ] as RichTextDoc["content"],
};

const base = { name: "Ana Popescu", roleRo: "", roleEn: "", photoAssetId: "" };
const rich = (ro: RichTextDoc | string, en: RichTextDoc | string) => ({
  bioRoBody: typeof ro === "string" ? ro : JSON.stringify(ro),
  bioEnBody: typeof en === "string" ? en : JSON.stringify(en),
});
const issuesOf = (value: unknown) => {
  const parsed = teamMemberFieldsSchema.safeParse(value);
  return parsed.success ? [] : parsed.error.issues.map((issue) => teamFieldName(issue.path));
};

describe("§474 the words about a person, in the rich-text editor", () => {
  it("keeps both documents and their words, and a picture with no words counts as written", () => {
    const parsed = teamMemberFieldsSchema.parse({ ...base, ...rich(doc("Aleargă.", "De zece ani."), doc("Runs.", "For ten years.")) });
    expect(parsed.bioRoJson).toEqual(doc("Aleargă.", "De zece ani."));
    expect(parsed.bioRo).toBe("Aleargă.\nDe zece ani.");
    expect(parsed.bioEn).toBe("Runs.\nFor ten years.");

    const pictures = teamMemberFieldsSchema.parse({ ...base, ...rich(picture, picture) });
    expect(pictures.bioRoJson?.content?.[0]?.type).toBe("image");
    // The picture's alt text is its words, as the renderer's plain projection reads it.
    expect(pictures.bioRo).toBe("Ana la start");
  });

  it("refuses one language written and the other empty, on the editor's box", () => {
    expect(issuesOf({ ...base, ...rich(doc("Aleargă."), "") })).toEqual(["bioEnBody"]);
    expect(issuesOf({ ...base, ...rich(JSON.stringify({ type: "doc", content: [] }), picture) })).toEqual(["bioRoBody"]);
    expect(issuesOf({ ...base, ...rich("", "") })).toEqual([]);
    expect(teamMemberFieldsSchema.parse({ ...base, ...rich("", "") })).toMatchObject({ bioRo: null, bioEn: null, bioRoJson: null, bioEnJson: null });
  });

  it("refuses a table, a document the renderer does not know, and words past the limit", () => {
    // A table the renderer accepts on a page — refused here for the card's width, not its shape.
    expect(richTextSchema.safeParse(table).success).toBe(true);
    expect(issuesOf({ ...base, ...rich(table, doc("5 km")) })).toEqual(["bioRoBody"]);
    expect(issuesOf({ ...base, ...rich(JSON.stringify({ type: "doc", content: [{ type: "script" }] }), doc("x")) })).toContain("bioRoBody");
    expect(issuesOf({ ...base, ...rich("not json", doc("x")) })).toContain("bioRoBody");
    const long = "a".repeat(TEAM_BIO_MAX + 1);
    expect(issuesOf({ ...base, ...rich(doc(long), doc("x")) })).toEqual(["bioRoBody"]);
  });

  it("reads a card from before the editor as paragraphs, one per line", () => {
    expect(teamDocFromPlain("Unu.\n\nDoi.\nTrei.")).toEqual(doc("Unu.", "Doi.", "Trei."));
    expect(storedTeamDoc(null, "Unu.")).toEqual(doc("Unu."));
    expect(storedTeamDoc(null, "  ")).toBeNull();
    // A stored document wins over the words beside it, and one nobody can read falls back to them.
    expect(storedTeamDoc(doc("Nou."), "Vechi.")).toEqual(doc("Nou."));
    expect(storedTeamDoc({ type: "nonsense" }, "Vechi.")).toEqual(doc("Vechi."));
  });
});

describe("§474 a person's links", () => {
  const row = (overrides: Record<string, string>) => ({ kind: "STRAVA", url: "", labelRo: "", labelEn: "", ...overrides });

  it("keeps the rows in order, drops the spare line, and writes the first to §459's column", () => {
    const parsed = teamMemberFieldsSchema.parse({
      ...base,
      links: [
        row({ url: "https://www.strava.com/athletes/1" }),
        row({ kind: "WEBSITE", url: "HTTPS://ana-alearga.example", labelRo: "Blogul meu", labelEn: "My blog" }),
        row({ kind: "OTHER" }),
      ],
    });
    expect(parsed.links).toEqual([
      { kind: "STRAVA", url: "https://www.strava.com/athletes/1", labelRo: null, labelEn: null },
      { kind: "WEBSITE", url: "https://ana-alearga.example", labelRo: "Blogul meu", labelEn: "My blog" },
    ]);
    expect(parsed.link).toBe("https://www.strava.com/athletes/1");
    expect(teamMemberFieldsSchema.parse({ ...base, links: [] })).toMatchObject({ links: [], link: null });
  });

  it("names a refused row by its place on the screen", () => {
    expect(issuesOf({ ...base, links: [row({ url: "https://strava.com/a" }), row({ url: "http://strava.com/b" })] })).toEqual(["links[1].url"]);
    expect(issuesOf({ ...base, links: [row({ url: "javascript:alert(1)" })] })).toEqual(["links[0].url"]);
    expect(issuesOf({ ...base, links: [row({ labelRo: "Profil" })] })).toEqual(["links[0].url", "links[0].labelEn"]);
    expect(issuesOf({ ...base, links: [row({ kind: "TIKTOK", url: "https://tiktok.com/@ana" })] })).toEqual(["links[0].kind"]);
  });

  it("stops at twelve (§491), and takes twelve", () => {
    expect(MAX_TEAM_LINKS).toBe(12);
    const rows = (count: number) => Array.from({ length: count }, (_, index) => row({ url: `https://example.org/${index}` }));
    expect(issuesOf({ ...base, links: rows(MAX_TEAM_LINKS + 1) })).toEqual(["links"]);
    expect(teamMemberFieldsSchema.parse({ ...base, links: rows(MAX_TEAM_LINKS) }).links).toHaveLength(MAX_TEAM_LINKS);
  });

  it("holds the database's CHECK to the same number: the schema and the migration that added it say `<= MAX_TEAM_LINKS` (§491)", () => {
    const schema = readFileSync("src/db/schema/team.ts", "utf8");
    expect(schema).toContain(`jsonb_array_length(\${t.links}) <= ${MAX_TEAM_LINKS} AND`);
    const migration = readFileSync("src/db/migrations/0094_team_links_twelve.sql", "utf8");
    expect(migration).toContain(`jsonb_array_length("team_members"."links") <= ${MAX_TEAM_LINKS} AND`);
    expect(migration).toMatch(/^-- expand: /m);
  });

  it("reads §459's one link as a row of its guessed kind when a caller posts no list", () => {
    expect(teamMemberFieldsSchema.parse({ ...base, link: "https://instagram.com/ana" }).links).toEqual([
      { kind: "INSTAGRAM", url: "https://instagram.com/ana", labelRo: null, labelEn: null },
    ]);
    expect(guessTeamLinkKind("https://www.strava.com/athletes/1")).toBe("STRAVA");
    expect(guessTeamLinkKind("https://m.facebook.com/ana")).toBe("FACEBOOK");
    expect(guessTeamLinkKind("https://notstrava.com/x")).toBe("WEBSITE");
  });

  it("reads a stored list leniently, a stored half label as none, and a card from before by its one link", () => {
    expect(
      readTeamLinks([
        { kind: "STRAVA", url: "https://strava.com/a", labelRo: "Profil", labelEn: null },
        { kind: "SOMETHING_NEW", url: "https://example.org" },
        { kind: "WEBSITE", url: "http://example.org" },
        "nonsense",
      ]),
    ).toEqual([
      { kind: "STRAVA", url: "https://strava.com/a", labelRo: null, labelEn: null },
      { kind: "OTHER", url: "https://example.org", labelRo: null, labelEn: null },
    ]);
    expect(readTeamLinks(null, "https://strava.com/athletes/1")).toEqual([{ kind: "STRAVA", url: "https://strava.com/athletes/1", labelRo: null, labelEn: null }]);
    // The list wins, even empty: a card whose links were all removed shows none.
    expect(readTeamLinks([], "https://strava.com/athletes/1")).toEqual([]);
    expect(readTeamLinks(null, null)).toEqual([]);
    expect(teamLinkHost("https://www.ana-alearga.example/despre")).toBe("ana-alearga.example");
  });
});
