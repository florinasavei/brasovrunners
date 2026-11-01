import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * BR-REQ-101-01 (§882): the club's file reaches the platform through five doors and no other — and its legal clauses,
 * `club/legal.json`, through one: the legal texts' module (§NNN).
 *
 * `src/club/config.ts` is the only importer of `club/club.json`, and only `theme/brand.ts`, `events/domain/place.ts`,
 * `i18n/dates.ts`, `events/domain/sun.ts` and `shared/config/env.ts` import it: every other file reads the names
 * those export (`CLUB_NAME`, `CLUB_LOCALITY`, `CLUB_TIME_ZONE`…), so a club's identity has one way in and a later
 * change knows the five places to look. And `config.ts` itself carries neither Zod nor the environment, because the
 * theme brings it into every public client island (`tests/unit/shared/public-islands-weight.test.ts`) — which is
 * also why `club/guard-words.json` has no door at all: the literal guard reads it, the application never does.
 */
const ROOT = path.resolve(__dirname, "../../..");

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const full = path.join(directory, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.(ts|tsx|mts|mjs|js)$/.test(entry) ? [full] : [];
  });
}

const relative = (file: string) => path.relative(ROOT, file).split(path.sep).join("/");

/** Every module specifier a file names: static imports and re-exports, `import()` and `require()`. */
function specifiers(text: string): string[] {
  return [
    ...text.matchAll(/(?:^|[\s;])(?:import|export)\s[^"'`;]*?from\s*["']([^"']+)["']/g),
    ...text.matchAll(/(?:^|[\s;])import\s*["']([^"']+)["']/g),
    ...text.matchAll(/\b(?:import|require)\(\s*["']([^"']+)["']\s*\)/g),
  ].map((match) => match[1]);
}

/** Whether a specifier, written in `file`, names `src/club/config.ts`. */
function namesConfig(file: string, specifier: string): boolean {
  if (specifier === "@/club/config" || specifier === "@/club/config.ts") return true;
  if (!specifier.startsWith(".")) return false;
  const target = relative(path.resolve(path.dirname(file), specifier));
  return target === "src/club/config" || target === "src/club/config.ts";
}

const FILES = [...sourceFiles(path.join(ROOT, "src")), ...sourceFiles(path.join(ROOT, "scripts"))].map((file) => ({
  file: relative(file),
  imports: specifiers(readFileSync(file, "utf8")),
  full: file,
}));

describe("BR-REQ-101-01: the club's file has one way into the platform (§882)", () => {
  it("is imported by src/club/config.ts alone", () => {
    const readers = FILES.filter(({ imports }) => imports.some((specifier) => /(^@club\/club(\.json)?$|(^|\/)club\/club\.json$)/.test(specifier))).map(({ file }) => file);
    expect(readers).toEqual(["src/club/config.ts"]);
  });

  it("and the tooling's names (club/infra.json) by nothing under src/: only the scripts read it (§NNN)", () => {
    const readers = FILES.filter(({ file, imports }) => file.startsWith("src/") && imports.some((specifier) => /(^|\/)infra(\.json)?$/.test(specifier))).map(({ file }) => file);
    expect(readers).toEqual([]);
    const text = FILES.filter(({ file }) => file.startsWith("src/")).filter(({ full }) => /club\/infra/.test(readFileSync(full, "utf8"))).map(({ file }) => file);
    expect(text).toEqual([]);
  });

  it("and the club's legal clauses, club/legal.json, only by the legal texts' module (§NNN)", () => {
    const readers = FILES.filter(({ imports }) => imports.some((specifier) => /(^@club\/legal(\.json)?$|(^|\/)club\/legal\.json$)/.test(specifier))).map(({ file }) => file);
    expect(readers).toEqual(["src/modules/legal-documents/templates/club-facts.ts"]);
    expect(readers.every((file) => file.startsWith("src/modules/legal-documents/"))).toBe(true);
  });

  it("names nothing in the club's folder but club.json, decor.json and legal.json, each through its own door (§884, §885)", () => {
    const named = FILES.flatMap(({ file, imports }) => imports.filter((specifier) => specifier.startsWith("@club/")).map((specifier) => `${file} → ${specifier}`)).sort();
    expect(named).toEqual([
      "src/club/config.ts → @club/club.json",
      "src/club/decor.ts → @club/decor.json",
      "src/modules/legal-documents/templates/club-facts.ts → @club/legal.json",
    ]);
  });

  /**
   * BR-REQ-101-01 (§NNN): the mountains drawing is the club's (`club/decor.json`), and only its readers carry it. The
   * theme's door (`config.ts`) brings `club.json` into every client island, so the drawing has a door of its own,
   * `src/club/decor.ts`, which only `MountainMark` (a Server Component: an inline SVG in the HTML, no script) and the
   * calendar picture's canvas files (loaded with the dialog, on a click) import — and `MountainMark` in turn only the
   * pages and sections that draw it. Neither `brand.ts` nor `config.ts` imports it, and none of its readers is a
   * `"use client"` file: the one island that reaches it, the picture's dialog, is `lazy()` behind its button.
   */
  it("and decor.json is read only by the drawing's readers", () => {
    const importersOf = (target: string) =>
      FILES.filter(({ full, imports }) =>
        imports.some((specifier) => {
          if (specifier === `@/${target}`) return true;
          return specifier.startsWith(".") && relative(path.resolve(path.dirname(full), specifier)).replace(/\.tsx?$/, "") === `src/${target}`;
        }),
      )
        .map(({ file }) => file)
        .sort();
    expect(importersOf("club/decor")).toEqual([
      "src/modules/events/ui/calendar-image-frame.ts",
      "src/modules/events/ui/calendar-image-poster-cells.ts",
      "src/modules/events/ui/calendar-image-poster-formats.ts",
      "src/modules/events/ui/calendar-image-poster-heads.ts",
      "src/modules/events/ui/calendar-image-week.ts",
      "src/shared/ui/MountainMark.tsx",
    ]);
    expect(importersOf("shared/ui/MountainMark")).toEqual([
      "src/app/[locale]/calendar/page.tsx",
      "src/modules/design/ui/LookSection.tsx",
      "src/modules/home/ui/HomePicture.tsx",
      "src/modules/home/ui/PhotoStrip.tsx",
      "src/shared/ui/LookWatermark.tsx",
    ]);
    const isClient = (file: string) => /^\s*["']use client["']/.test(readFileSync(path.join(ROOT, file), "utf8"));
    for (const file of [...importersOf("club/decor"), ...importersOf("shared/ui/MountainMark")]) expect(isClient(file), file).toBe(false);
  });

  it("and the guard words by nothing the application builds: no file under src/ or scripts/ imports club/guard-words.json", () => {
    const readers = FILES.filter(({ imports }) => imports.some((specifier) => /(^|\/)guard-words(\.json)?$/.test(specifier))).map(({ file }) => file);
    expect(readers).toEqual([]);
  });

  it("whose config is imported only by brand.ts, place.ts, dates.ts, sun.ts and env.ts", () => {
    const importers = FILES.filter(({ full, imports }) => imports.some((specifier) => namesConfig(full, specifier)))
      .map(({ file }) => file)
      .sort();
    expect(importers).toEqual([
      "src/i18n/dates.ts",
      "src/modules/events/domain/place.ts",
      "src/modules/events/domain/sun.ts",
      "src/shared/config/env.ts",
      "src/theme/brand.ts",
    ]);
  });

  it("and the config carries neither Zod nor the environment", () => {
    const config = FILES.find(({ file }) => file === "src/club/config.ts");
    const schema = FILES.find(({ file }) => file === "src/club/schema.ts");
    for (const entry of [config, schema]) {
      expect(entry).toBeDefined();
      for (const specifier of entry?.imports ?? []) {
        expect(specifier).not.toBe("zod");
        expect(specifier).not.toMatch(/shared\/config\/env/);
      }
    }
  });

  it("finds an import written any of the ways a module names another", () => {
    expect(specifiers('import { CLUB } from "@/club/config";\nexport { x } from "../club/config";\nconst y = await import("@/club/config");')).toEqual([
      "@/club/config",
      "../club/config",
      "@/club/config",
    ]);
    expect(namesConfig(path.join(ROOT, "src/theme/brand.ts"), "../club/config")).toBe(true);
    expect(namesConfig(path.join(ROOT, "src/theme/brand.ts"), "./config")).toBe(false);
  });
});
