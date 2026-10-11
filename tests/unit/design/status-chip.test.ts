import { describe, expect, it } from "vitest";
import { GLYPHS } from "@/modules/events/ui/glyphs";
import { STATUS_GLYPHS } from "@/shared/ui/status-glyphs";
import { SOURCES } from "./scan";

/**
 * §694's amendment — the backoffice's status chip and its own registry. The public table
 * (`modules/events/ui/glyphs.ts`, drawn by `GlyphChip`) keeps only the names public pages draw, so a
 * visitor never downloads a backoffice icon; `status-glyphs.ts` (drawn by `StatusChip`) holds the rest.
 * A tripwire, source-level like the other design tests: each table is held to its own surface.
 */
const STATUS_USERS_ALLOWED = [
  "src/app/[locale]/admin/",
  "src/app/[locale]/members-area/",
  "src/modules/content/shop/",
  "src/modules/design/",
];

/** The files a visitor's pages are made of: everything that is not the backoffice, the design page or the members' zone. */
const isPublicFile = (file: string): boolean =>
  !file.startsWith("src/app/[locale]/admin/") &&
  !file.startsWith("src/app/[locale]/members-area/") &&
  !file.startsWith("src/app/[locale]/preview/") &&
  !file.startsWith("src/modules/design/") &&
  !file.startsWith("src/modules/content/") &&
  !file.startsWith("src/modules/staff-identity/") &&
  !file.endsWith("/glyphs.ts");

const quoted = (name: string) => new RegExp(`["'\`]${name}["'\`]|GLYPHS\\.${name}\\b|GLYPHS\\["${name}"\\]`);

describe("§694 the status chip keeps the public glyph table public", () => {
  it("the two tables share no name", () => {
    const shared = Object.keys(STATUS_GLYPHS).filter((name) => name in GLYPHS);
    expect(shared).toEqual([]);
  });

  it("no public file draws a status chip", () => {
    const offenders = SOURCES.filter((source) => /from "@\/shared\/ui\/StatusChip"/.test(source.text))
      .map((source) => source.file)
      .filter((file) => !STATUS_USERS_ALLOWED.some((prefix) => file.startsWith(prefix)));
    expect(offenders).toEqual([]);
  });

  it("every status name is drawn by a file that imports StatusChip", () => {
    const users = SOURCES.filter((source) => /from "@\/shared\/ui\/StatusChip"|from "@\/shared\/ui\/status-glyphs"/.test(source.text));
    for (const name of Object.keys(STATUS_GLYPHS)) {
      expect(
        users.some((source) => quoted(name).test(source.text)),
        `status glyph ${name} is drawn nowhere`,
      ).toBe(true);
    }
  });

  it("every plain public name is drawn by a public file", () => {
    const publicSources = SOURCES.filter((source) => isPublicFile(source.file));
    const plain = Object.keys(GLYPHS).filter((name) => !name.includes(":"));
    for (const name of plain) {
      expect(
        publicSources.some((source) => quoted(name).test(source.text)),
        `public glyph ${name} is drawn by no public file`,
      ).toBe(true);
    }
  });
});
