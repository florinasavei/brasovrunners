import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * BR-REQ-101-01 (§882): the club's file reaches the platform through five doors and no other.
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
    const readers = FILES.filter(({ imports }) => imports.some((specifier) => /(^@club\/|(^|\/)club\/club\.json$)/.test(specifier))).map(({ file }) => file);
    expect(readers).toEqual(["src/club/config.ts"]);
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
