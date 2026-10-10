import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { expect } from "vitest";

/**
 * The scanning half of the design system's guards (§694): one walk of `src/`, the helpers the three
 * tests share, and the ratchet itself. The three tests say what they refuse; this says how a source
 * file is read and how a list of today's offenders is held to shrinking.
 *
 * Source-level, like `server-element-props.test.ts`: no DOM, no server. A file is parsed with the
 * TypeScript the project already has, so a comment, a regular expression and a string are told apart
 * by the parser rather than by a regex that has met `//` inside a URL.
 */
export const ROOT = path.resolve(__dirname, "../../..");

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const full = path.join(directory, entry);
    if (statSync(full).isDirectory()) return entry === "migrations" ? [] : sourceFiles(full);
    return /\.(ts|tsx)$/.test(entry) ? [full] : [];
  });
}

export type Source = { file: string; text: string; tree: ts.SourceFile };

/** Every `.ts` and `.tsx` under `src/`, but the migrations, parsed; `file` is repo-relative with `/`. */
export const SOURCES: Source[] = sourceFiles(path.join(ROOT, "src")).map((full) => {
  const text = readFileSync(full, "utf8").replace(/\r\n/g, "\n");
  const file = path.relative(ROOT, full).split(path.sep).join("/");
  const tree = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  return { file, text, tree };
});

/** Every string, template and no-substitution literal's text, comments never included. */
export function stringTexts(source: Source): string[] {
  const found: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
      found.push(node.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source.tree);
  return found;
}

/** Every `import … from "x"` / `export … from "x"` of one file with what it names: the default and the named bindings. */
export type ImportFact = { specifier: string; names: string[]; typeOnly: boolean };

export function importFacts(source: Source): ImportFact[] {
  const found: ImportFact[] = [];
  for (const statement of source.tree.statements) {
    if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
      const clause = statement.importClause;
      const names: string[] = [];
      if (clause?.name) names.push("default");
      const bindings = clause?.namedBindings;
      if (bindings && ts.isNamedImports(bindings)) {
        for (const element of bindings.elements) names.push((element.propertyName ?? element.name).text);
      }
      found.push({ specifier: statement.moduleSpecifier.text, names, typeOnly: Boolean(clause?.isTypeOnly) });
    } else if (ts.isExportDeclaration(statement) && statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)) {
      found.push({ specifier: statement.moduleSpecifier.text, names: [], typeOnly: statement.isTypeOnly });
    }
  }
  return found;
}

export type Entry = { path: string; reason: string };

/**
 * The ratchet (§694). `offenders` is what the scan found, `allowed` the reviewed list of today's
 * offenders, `pinned` the number the list must have. Three ways to fail, each with its remedy:
 * a new offender (fix it — the list never grows), a stale entry (the file no longer offends or
 * no longer exists: delete the entry and lower the pin), a pin that disagrees with the list.
 */
export function holdRatchet(rule: string, offenders: Set<string>, allowed: readonly Entry[], pinned: number, how: string) {
  const listed = new Set(allowed.map((entry) => entry.path));
  expect(listed.size, `${rule}: a path is listed twice`).toBe(allowed.length);
  for (const entry of allowed) expect(entry.reason.trim().length, `${rule}: ${entry.path} has no reason`).toBeGreaterThan(10);

  const fresh = [...offenders].filter((file) => !listed.has(file)).sort();
  expect(fresh, `${rule}: new offenders. ${how} The allowlist never grows.`).toEqual([]);

  const known = new Set(SOURCES.map((source) => source.file));
  const gone = allowed.filter((entry) => !known.has(entry.path)).map((entry) => entry.path);
  expect(gone, `${rule}: listed files that no longer exist — delete the entries and lower PINNED.${rule}`).toEqual([]);

  const fixed = allowed.filter((entry) => !offenders.has(entry.path)).map((entry) => entry.path);
  expect(fixed, `${rule}: listed files that no longer offend — delete the entries and lower PINNED.${rule}`).toEqual([]);

  expect(allowed.length, `${rule}: the list and PINNED.${rule} disagree — a shrink edits both`).toBe(pinned);
}
