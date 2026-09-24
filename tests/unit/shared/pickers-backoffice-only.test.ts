import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The date and time pickers (`shared/forms/pickers`, `DECISIONS.md` §345) reach the backoffice
 * and nowhere else. `PickerProvider`'s own JSDoc names this file.
 *
 * The registry review of §318 (`action-icons.test.ts`) found the same shape of bug once: a
 * lookup reached from a public page ships the whole thing to every visitor, used there or not.
 * `@mui/x-date-pickers` and Day.js are a few hundred kilobytes gzipped — a heavier mistake than a
 * dead glyph — so the same walk is run here: backwards from each picker module, through every
 * value import in `src/`, to whatever route ends up carrying it.
 *
 * Source-level, like `action-icons.test.ts`: the suite runs in Node with no DOM, and the rule is
 * about what is written, not about what one render happens to produce.
 */
const ROOT = path.resolve(__dirname, "../../..");
const read = (relative: string) => readFileSync(path.join(ROOT, relative), "utf8").replace(/\r\n/g, "\n");

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const full = path.join(directory, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.(ts|tsx)$/.test(entry) ? [full] : [];
  });
}

const SOURCES = sourceFiles(path.join(ROOT, "src")).map((file) => ({
  file: path.relative(ROOT, file).split(path.sep).join("/"),
  text: readFileSync(file, "utf8").replace(/\r\n/g, "\n"),
}));

/**
 * The value imports of one file, as written: `import type` is erased and ships nothing, and so
 * is `import { type A, type B }`. A side-effect import names no binding and is skipped by the
 * pattern, which never crosses a quote or a semicolon.
 */
function valueImports(text: string): string[] {
  const specifiers: string[] = [];
  for (const match of text.matchAll(/^(?:import|export)\s+(type\s+)?([^;"]*?)\s+from\s+"([^"]+)";/gm)) {
    if (match[1]) continue;
    const clause = match[2].trim();
    const named = clause.match(/^\{([\s\S]*)\}$/)?.[1];
    const onlyTypes =
      named !== undefined &&
      named
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean)
        .every((part) => part.startsWith("type "));
    if (!onlyTypes) specifiers.push(match[3]);
  }
  for (const match of text.matchAll(/\bimport\(\s*"([^"]+)"\s*\)/g)) specifiers.push(match[1]);
  return specifiers;
}

const FILES = new Set(SOURCES.map((source) => source.file));

/** `@/x` and `./x` to the file under `src/` they name; a package, or JSON, is not followed. */
function resolveImport(fromFile: string, specifier: string): string | null {
  let base: string;
  if (specifier.startsWith("@/")) base = `src/${specifier.slice(2)}`;
  else if (specifier.startsWith(".")) base = path.posix.join(path.posix.dirname(fromFile), specifier);
  else return null;
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`]) {
    if (FILES.has(candidate)) return candidate;
  }
  return null;
}

/** Who imports each file: the import graph, backwards. */
const IMPORTERS = (() => {
  const importers = new Map<string, Set<string>>();
  for (const { file, text } of SOURCES) {
    for (const specifier of valueImports(text)) {
      const target = resolveImport(file, specifier);
      if (!target) continue;
      if (!importers.has(target)) importers.set(target, new Set());
      importers.get(target)?.add(file);
    }
  }
  return importers;
})();

/** Every file that reaches `start` through value imports, `start` included. */
function reaching(start: string): Set<string> {
  const reached = new Set([start]);
  const queue = [start];
  while (queue.length > 0) {
    const current = queue.shift() as string;
    for (const importer of IMPORTERS.get(current) ?? []) {
      if (reached.has(importer)) continue;
      reached.add(importer);
      queue.push(importer);
    }
  }
  return reached;
}

/**
 * The one route this suite lets a picker reach: `/admin`, whose layout is the only place
 * `PickerProvider` is mounted (the last test below). `/devs` wears the same chrome (§119), but
 * its own layout mounts no `PickerProvider`, so a picker dropped onto a `/devs` page would pass
 * a check that allowed `/devs/` too and then throw at runtime for want of the localization
 * context. This copies `action-icons.test.ts`'s own `isBackofficeRoute`, which rightly allows
 * both — an icon needs no provider, so it really does reach either route safely — and that
 * shape of check does not carry over to a component a provider has to be mounted for (§345).
 */
const isBackofficeRoute = (file: string) => file.startsWith("src/app/[locale]/admin/");

const PICKER_PROVIDER = "src/shared/forms/pickers/PickerProvider.tsx";
const DATE_FIELD = "src/shared/forms/pickers/DateField.tsx";
const TIME_FIELD = "src/shared/forms/pickers/TimeField.tsx";

describe("the date and time pickers never reach a public page", () => {
  it("PickerProvider reaches only /admin routes, where it is mounted", () => {
    const reached = reaching(PICKER_PROVIDER);
    const routes = [...reached].filter((file) => file.startsWith("src/app/"));
    expect(routes.filter((file) => !isBackofficeRoute(file))).toEqual([]);
    // The walk finds a route, so a mistake that broke it would fail loudly rather than pass on nothing.
    expect(routes.length).toBeGreaterThan(0);
    expect(reached.has("src/app/[locale]/admin/layout.tsx"), "the backoffice's one mount point").toBe(true);
  });

  it("DateField and TimeField reach only /admin routes, where PickerProvider is mounted", () => {
    for (const start of [DATE_FIELD, TIME_FIELD]) {
      const reached = reaching(start);
      const routes = [...reached].filter((file) => file.startsWith("src/app/"));
      expect(routes.filter((file) => !isBackofficeRoute(file)), start).toEqual([]);
      expect(routes.length, start).toBeGreaterThan(0);
    }
  });

  it("is not imported, directly or at all, by the public registration or event pages", () => {
    const reachedFromDate = reaching(DATE_FIELD);
    const reachedFromTime = reaching(TIME_FIELD);
    for (const file of [
      "src/app/[locale]/events/[slug]/register/page.tsx",
      "src/app/[locale]/page.tsx",
      "src/app/[locale]/events/[slug]/page.tsx",
      "src/app/[locale]/contact/page.tsx",
    ]) {
      expect(reachedFromDate.has(file), file).toBe(false);
      expect(reachedFromTime.has(file), file).toBe(false);
    }
  });

  it("reaches the event editor and the album form, where the boxes actually are", () => {
    const reachedFromDate = reaching(DATE_FIELD);
    expect(reachedFromDate.has("src/modules/content/events/ui/WallTimeField.tsx")).toBe(true);
    expect(reachedFromDate.has("src/modules/content/events/ui/RepeatFields.tsx")).toBe(true);
    expect(reachedFromDate.has("src/modules/content/events/ui/ScheduleRowsEditor.tsx")).toBe(true);
    expect(reachedFromDate.has("src/modules/content/gallery/ui/AlbumFieldsForm.tsx")).toBe(true);
    expect(reachedFromDate.has("src/app/[locale]/admin/events/new/page.tsx")).toBe(true);
  });

  it("PickerProvider is mounted above the backoffice's own children, never below a public one", () => {
    const layout = read("src/app/[locale]/admin/layout.tsx");
    expect(layout).toMatch(/<PickerProvider>\{children\}<\/PickerProvider>/);
  });
});
