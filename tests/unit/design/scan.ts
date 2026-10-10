import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { expect } from "vitest";

/**
 * The scanning half of the design system's guards (§NNN): one walk of `src/`, the helpers the three
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

/** Where a rule found something: the file, the line, and the text that matched. */
export type Hit = { file: string; line: number; text: string };

const lineOf = (source: Source, node: ts.Node): number => source.tree.getLineAndCharacterOfPosition(node.getStart(source.tree)).line + 1;

/**
 * Every string, template and no-substitution literal, comments never included, with its line and
 * the name of the attribute or property it is the value of (`href`, `to`, `color`…), if any.
 */
export type StringLiteral = { text: string; line: number; name?: string };

export function stringLiterals(source: Source): StringLiteral[] {
  const found: StringLiteral[] = [];
  const nameOf = (node: ts.Node): string | undefined => {
    let parent = node.parent;
    if (parent && ts.isJsxExpression(parent)) parent = parent.parent;
    if (parent && ts.isJsxAttribute(parent)) return parent.name.getText(source.tree);
    if (parent && ts.isPropertyAssignment(parent) && parent.initializer === node) {
      const key = parent.name;
      return ts.isIdentifier(key) || ts.isStringLiteral(key) ? key.text : undefined;
    }
    return undefined;
  };
  const visit = (node: ts.Node) => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
      found.push({ text: node.text, line: lineOf(source, node), name: nameOf(node) });
    }
    ts.forEachChild(node, visit);
  };
  visit(source.tree);
  return found;
}

/**
 * Every static `import … from "x"`, `export … from "x"`, and dynamic `import("x")` of one file, with
 * what it names: the default and the named bindings. A namespace import (`import * as M`), an
 * `export * from` and a dynamic `import()` name `*`: all of the module.
 */
export type ImportFact = { specifier: string; names: string[]; typeOnly: boolean; line: number };

export function importFacts(source: Source): ImportFact[] {
  const found: ImportFact[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const clause = node.importClause;
      const names: string[] = [];
      if (clause?.name) names.push("default");
      const bindings = clause?.namedBindings;
      if (bindings && ts.isNamedImports(bindings)) {
        for (const element of bindings.elements) names.push((element.propertyName ?? element.name).text);
      } else if (bindings && ts.isNamespaceImport(bindings)) names.push("*");
      found.push({ specifier: node.moduleSpecifier.text, names, typeOnly: Boolean(clause?.isTypeOnly), line: lineOf(source, node) });
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      const names: string[] = [];
      if (!node.exportClause || ts.isNamespaceExport(node.exportClause)) names.push("*");
      else for (const element of node.exportClause.elements) names.push((element.propertyName ?? element.name).text);
      found.push({ specifier: node.moduleSpecifier.text, names, typeOnly: node.isTypeOnly, line: lineOf(source, node) });
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && node.arguments.length > 0) {
      const argument = node.arguments[0];
      if (ts.isStringLiteral(argument) || ts.isNoSubstitutionTemplateLiteral(argument)) {
        found.push({ specifier: argument.text, names: ["*"], typeOnly: false, line: lineOf(source, node) });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source.tree);
  return found;
}

/** `count` is how many times the listed file may offend: a listed file may not offend more. */
export type Entry = { path: string; reason: string; count: number };

/** Group hits by file. */
export function byFile(hits: Hit[]): Map<string, Hit[]> {
  const grouped = new Map<string, Hit[]>();
  for (const hit of hits) grouped.set(hit.file, [...(grouped.get(hit.file) ?? []), hit]);
  return grouped;
}

const show = (hits: Hit[]) => hits.map((hit) => `${hit.file}:${hit.line} — ${hit.text}`);

/**
 * The ratchet (§NNN). `found` is what the scan found, by file, `allowed` the reviewed list of
 * today's offenders (each with the count it is pinned at), `pinned` the number of entries the list
 * must have and the sum of their counts (a count raised in one entry passes no longer). Ways to fail, each with its remedy: a new offender, or a listed file that offends more
 * than its count (fix it — the list never grows, and each hit is printed as `file:line — text`), a
 * stale entry (the file no longer offends, or offends less than its count: delete or lower the
 * entry and the pin), a pin that disagrees with the list.
 */
export function holdRatchet(rule: string, found: Map<string, Hit[]>, allowed: readonly Entry[], pinned: { entries: number; hits: number }, how: string) {
  const listed = new Map(allowed.map((entry) => [entry.path, entry]));
  expect(listed.size, `${rule}: a path is listed twice`).toBe(allowed.length);
  for (const entry of allowed) {
    expect(entry.reason.trim().length, `${rule}: ${entry.path} has no reason`).toBeGreaterThan(10);
    expect(entry.count, `${rule}: ${entry.path} has no count`).toBeGreaterThan(0);
  }

  const fresh = [...found.entries()].filter(([file]) => !listed.has(file)).flatMap(([, hits]) => show(hits)).sort();
  expect(fresh, `${rule}: new offenders. ${how} The allowlist never grows.`).toEqual([]);

  const more = allowed.filter((entry) => (found.get(entry.path)?.length ?? 0) > entry.count).flatMap((entry) => show(found.get(entry.path) ?? []));
  expect(more, `${rule}: a listed file offends more than its count. ${how} Every hit of the file is shown.`).toEqual([]);

  const known = new Set(SOURCES.map((source) => source.file));
  const gone = allowed.filter((entry) => !known.has(entry.path)).map((entry) => entry.path);
  expect(gone, `${rule}: listed files that no longer exist — delete the entries and lower PINNED.${rule}`).toEqual([]);

  const fixed = allowed.filter((entry) => !found.has(entry.path)).map((entry) => entry.path);
  expect(fixed, `${rule}: listed files that no longer offend — delete the entries and lower PINNED.${rule}`).toEqual([]);

  const fewer = allowed.filter((entry) => (found.get(entry.path)?.length ?? 0) < entry.count).map((entry) => `${entry.path}: ${found.get(entry.path)?.length} found, count ${entry.count}`);
  expect(fewer, `${rule}: a listed file offends less than its count — lower the count in guards-allowlist.ts`).toEqual([]);

  expect(allowed.length, `${rule}: the list and PINNED.${rule}.entries disagree — a shrink edits both`).toBe(pinned.entries);
  expect(
    allowed.reduce((sum, entry) => sum + entry.count, 0),
    `${rule}: the entries' counts and PINNED.${rule}.hits disagree — raising or lowering a count edits both`,
  ).toBe(pinned.hits);
}
