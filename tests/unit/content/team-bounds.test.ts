import { describe, expect, it } from "vitest";
import { MAX_TEAM_LINK_ROW_INDEX, teamLinkRowsOf } from "@/modules/content/team/links";
import { TEAM_META_DESCRIPTION_MAX, teamMetaDescription } from "@/modules/content/team/meta-description";

/**
 * `DECISIONS.md` §NNN — the review nits of «Echipa» (§459, §474): the links' row index a save reads
 * is bounded, and the page's meta description is about 160 characters of the introduction, never
 * the whole of it.
 */
function form(entries: Array<[string, string]>): FormData {
  const data = new FormData();
  for (const [name, value] of entries) data.append(name, value);
  return data;
}

describe("§NNN «Echipa»'s links: the row index a save reads is bounded", () => {
  it("gathers the editor's rows by index, a hole as the spare line", () => {
    const rows = teamLinkRowsOf(
      form([
        ["links.present", "1"],
        ["links[0].kind", "STRAVA"],
        ["links[0].url", "https://www.strava.com/athletes/1"],
        ["links[2].url", "https://example.org"],
      ]),
    );
    expect(rows).toEqual([{ kind: "STRAVA", url: "https://www.strava.com/athletes/1" }, {}, { url: "https://example.org" }]);
  });

  it("skips an index past the editor's own rows rather than growing an array to it", () => {
    const rows = teamLinkRowsOf(
      form([
        ["links.present", "1"],
        ["links[0].url", "https://example.org"],
        [`links[${MAX_TEAM_LINK_ROW_INDEX}].url`, "https://example.net"],
        [`links[${MAX_TEAM_LINK_ROW_INDEX + 1}].url`, "https://example.com"],
        ["links[99999999].url", "https://example.com"],
      ]),
    );
    expect(rows).toHaveLength(MAX_TEAM_LINK_ROW_INDEX + 1);
    expect(rows?.at(-1)).toEqual({ url: "https://example.net" });
    expect(JSON.stringify(rows)).not.toContain("example.com");
  });

  it("reads no list when the form carried no editor for it", () => {
    expect(teamLinkRowsOf(form([["links[0].url", "https://example.org"]]))).toBeUndefined();
  });
});

describe("§NNN «Echipa»'s meta description is a search result's length", () => {
  it("keeps a short introduction whole, whitespace folded", () => {
    expect(teamMetaDescription("  Suntem clubul\n de alergare  din Brașov. ")).toBe("Suntem clubul de alergare din Brașov.");
  });

  it("takes the first sentence of a long introduction when it fits", () => {
    const intro = `Alergăm împreună în fiecare săptămână. ${"Pe munte, pe asfalt, pe orice vreme. ".repeat(10)}`;
    expect(teamMetaDescription(intro)).toBe("Alergăm împreună în fiecare săptămână.");
  });

  it("cuts a long first sentence at a whole word, with an ellipsis, within the limit", () => {
    const intro = `${"cuvânt ".repeat(60)}sfârșit.`;
    const description = teamMetaDescription(intro);
    expect(description.length).toBeLessThanOrEqual(TEAM_META_DESCRIPTION_MAX);
    expect(description.endsWith("cuvânt…")).toBe(true);
  });
});
