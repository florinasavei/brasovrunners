import path from "node:path";

/**
 * Which module a source file imports, by where the module is rather than by how the import spells it — for the guards
 * that hold a list of the files allowed to read something (`tests/unit/volunteers/plan-never-leaves.test.ts`,
 * `tests/unit/registrations/raffle-never-leaves.test.ts`).
 *
 * Those guards found a reader by the words it uses: a column's name, or the module's path as the `@/` alias writes it
 * (`modules/volunteers/plan`). But a file beside the module imports it as `./plan`, one folder down as `../plan`, from
 * another module as `../volunteers/plan` — none of which carries the alias's path — so a new reader in the module's own
 * folder, the likeliest place for one, was invisible to the guard that exists to see it (the review of 2026-11-16, §NNN).
 * Here every specifier a file names is resolved against that file's own folder and compared with the module's place on
 * disk, so the spelling no longer matters.
 */

/** Every module specifier in a source text: `from "…"`, a bare `import "…"`, `import("…")` and `require("…")`. */
const SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|\bimport\s+)(["'])([^"'\n]+)\1/g;

/** A module's place without what an import may leave out: the extension, and `/index`. */
const moduleOf = (file: string): string => path.normalize(file).replace(/\.(tsx?|mjs|js)$/, "").replace(/[\\/]index$/, "");

/**
 * Whether `source` — the text of the file at `file` — imports the module at `modulePath`, by the `@/` alias (`srcRoot` is
 * what it stands for) or by a relative path of any depth. All three paths are absolute; `modulePath` with or without its
 * extension. A package's name (`drizzle-orm`) is no file and never matches.
 */
export function importsModule(file: string, source: string, modulePath: string, srcRoot: string): boolean {
  const wanted = moduleOf(modulePath);
  for (const match of source.matchAll(SPECIFIER)) {
    const specifier = match[2];
    const resolved = specifier.startsWith("@/") ? path.join(srcRoot, specifier.slice(2)) : specifier.startsWith(".") ? path.resolve(path.dirname(file), specifier) : null;
    if (resolved !== null && moduleOf(resolved) === wanted) return true;
  }
  return false;
}
