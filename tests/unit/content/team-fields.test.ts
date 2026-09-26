import { describe, expect, it } from "vitest";
import { normalizeTeamText, TEAM_BIO_MAX, teamMemberFieldsSchema } from "@/modules/content/team/fields";
import { pairFor } from "@/modules/content/team/repository";
import { canEditTeamPage, canShowTeamMember, STAFF_ROLES } from "@/modules/staff-identity/domain/roles";

/** §NNN — what a card of «Echipa» accepts, and who may write one or put it on the site. */
describe("§NNN a team card's fields", () => {
  const base = { name: "Dani", roleRo: "", roleEn: "", bioRo: "", bioEn: "", photoAssetId: "" };
  const issuesOf = (value: unknown) => {
    const parsed = teamMemberFieldsSchema.safeParse(value);
    return parsed.success ? [] : parsed.error.issues.map((issue) => issue.path.join("."));
  };

  it("needs a name on one line, and nothing else", () => {
    expect(issuesOf(base)).toEqual([]);
    expect(issuesOf({ ...base, name: "   " })).toEqual(["name"]);
    expect(issuesOf({ ...base, name: "Dani\nPopescu" })).toEqual(["name"]);
  });

  it("refuses each pair written in one language, on the empty side", () => {
    expect(issuesOf({ ...base, roleRo: "Organizator" })).toEqual(["roleEn"]);
    expect(issuesOf({ ...base, roleEn: "Organizer" })).toEqual(["roleRo"]);
    expect(issuesOf({ ...base, bioRo: "Câteva cuvinte." })).toEqual(["bioEn"]);
    expect(issuesOf({ ...base, bioEn: "A few words." })).toEqual(["bioRo"]);
    expect(issuesOf({ ...base, roleRo: "Organizator", roleEn: "Organizer" })).toEqual([]);
  });

  it("counts the limit after line breaks are made one, as the browser counted them", () => {
    const paragraph = "a".repeat(TEAM_BIO_MAX / 2 - 1);
    const typed = `${paragraph}\r\n\r\n${paragraph}`;
    expect(normalizeTeamText(typed)).toHaveLength(TEAM_BIO_MAX);
    expect(issuesOf({ ...base, bioRo: typed, bioEn: typed })).toEqual([]);
    expect(issuesOf({ ...base, bioRo: `${typed}a`, bioEn: typed })).toEqual(["bioRo"]);
  });

  it("keeps a paragraph break and drops the rest of the blank lines", () => {
    expect(normalizeTeamText("  Unu.  \n\n\n\n  Doi.\t\t trei ")).toBe("Unu.\n\nDoi. trei");
  });

  it("takes a picture id or nothing", () => {
    expect(issuesOf({ ...base, photoAssetId: "not-an-id" })).toEqual(["photoAssetId"]);
    const parsed = teamMemberFieldsSchema.parse({ ...base, photoAssetId: "0F6C4A36-5D1A-4B8E-9C3D-2A1B0C9D8E7F" });
    expect(parsed.photoAssetId).toBe("0f6c4a36-5d1a-4b8e-9c3d-2a1b0c9d8e7f");
    expect(teamMemberFieldsSchema.parse(base).photoAssetId).toBeNull();
  });

  it("reads a pair only when both languages are written", () => {
    expect(pairFor("ro", "Antrenor", "Coach")).toBe("Antrenor");
    expect(pairFor("en", "Antrenor", "Coach")).toBe("Coach");
    expect(pairFor("en", "Antrenor", null)).toBeNull();
    expect(pairFor("ro", "Antrenor", " ")).toBeNull();
  });
});

describe("§NNN who writes the cards and who puts them on the site", () => {
  it("gives the words to the Redactor and above but not the Organizer, the site to the Administrator", () => {
    const writes = STAFF_ROLES.filter(canEditTeamPage);
    const shows = STAFF_ROLES.filter(canShowTeamMember);
    expect(writes).toEqual(["COPYWRITER", "ADMIN", "SUPERADMIN"]);
    expect(shows).toEqual(["ADMIN", "SUPERADMIN"]);
  });
});
