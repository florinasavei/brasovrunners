import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import type { AbstractIntlMessages } from "next-intl";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import {
  BACKOFFICE_CLIENT_MESSAGES,
  pickMessages,
  PUBLIC_CLIENT_MESSAGES,
  STAFF_CLIENT_MESSAGES,
} from "@/i18n/client-messages";
import { DATE_FORMATS } from "@/i18n/dates";

/**
 * The client providers carry only the words their islands read (§353, `src/i18n/client-messages.ts`).
 *
 * The root layout used to render `NextIntlClientProvider` bare, and in next-intl 4 a bare provider
 * inherits every message of the request: each public page shipped the whole catalogue, the
 * backoffice's included, for the few keys a header button needs. The providers now name their
 * keys, and a key left out is the failure this file exists to catch — an island showing
 * "Site.nav.more" where a word should be, on a page no unit test renders.
 *
 * **Which provider an island is under** is derived, not declared: the import graph is walked from
 * every route file (page, layout, error, not-found, template, loading) to each `"use client"`
 * file it reaches through value imports. Routes under `src/app/[locale]/admin/` and
 * `src/app/[locale]/devs/` render inside those layouts' nested provider, which carries
 * `BACKOFFICE_CLIENT_MESSAGES`; every other route — `/preview` and `/sign-in` included, which have
 * no such layout — renders under the root's, `PUBLIC_CLIENT_MESSAGES`. An island any public route
 * reaches is held to the public list even if the backoffice uses it too, and one no route reaches
 * is held to it as well: the strict list is the safe side of every doubt.
 *
 * **Which keys an island reads** is read from its syntax tree: every `const x =
 * useTranslations("Ns")`, and every call on `x` — `x("key")`, `x.rich`, `x.raw`, `x.markup`,
 * `x.has`. A literal key, or each branch of a `cond ? "a" : "b"`, needs that message; a template
 * (`` x(`languageCode.${locale}`) ``) needs the sub-tree before its first `${`; anything else —
 * `x(section.segment)`, or `x` handed to a helper — needs the whole namespace.
 *
 * Source-level, like `pickers-backoffice-only.test.ts`: the rule is about what is written.
 */
const ROOT = path.resolve(__dirname, "../../..");
// As `getMessages()` types them: the catalogue has a few arrays (`how` steps), which next-intl reads.
const CATALOGUES = [ro, en] as unknown as AbstractIntlMessages[];
const read = (relative: string) => readFileSync(path.join(ROOT, relative), "utf8").replace(/\r\n/g, "\n");

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const full = path.join(directory, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.(ts|tsx)$/.test(entry) ? [full] : [];
  });
}

const SOURCES = new Map(
  sourceFiles(path.join(ROOT, "src")).map((file) => [
    path.relative(ROOT, file).split(path.sep).join("/"),
    readFileSync(file, "utf8").replace(/\r\n/g, "\n"),
  ]),
);

/** The value imports of one file — `import type` ships nothing — and its dynamic `import()`s. */
function valueImports(text: string): string[] {
  const specifiers: string[] = [];
  for (const match of text.matchAll(/^(?:import|export)\s+(type\s+)?([^;"]*?)\s+from\s+"([^"]+)";/gm)) {
    if (match[1]) continue;
    const named = match[2].trim().match(/^\{([\s\S]*)\}$/)?.[1];
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

/** `@/x` and `./x` to the file under `src/` they name; a package, or JSON, is not followed. */
function resolveImport(fromFile: string, specifier: string): string | null {
  let base: string;
  if (specifier.startsWith("@/")) base = `src/${specifier.slice(2)}`;
  else if (specifier.startsWith(".")) base = path.posix.join(path.posix.dirname(fromFile), specifier);
  else return null;
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`]) {
    if (SOURCES.has(candidate)) return candidate;
  }
  return null;
}

const IMPORTS = new Map(
  [...SOURCES].map(([file, text]) => [
    file,
    valueImports(text)
      .map((specifier) => resolveImport(file, specifier))
      .filter((target): target is string => target !== null),
  ]),
);

function reachedFrom(entries: readonly string[]): Set<string> {
  const reached = new Set(entries);
  const queue = [...entries];
  while (queue.length > 0) {
    for (const target of IMPORTS.get(queue.shift() as string) ?? []) {
      if (reached.has(target)) continue;
      reached.add(target);
      queue.push(target);
    }
  }
  return reached;
}

const ROUTE_FILE = /^src\/app\/(?:.*\/)?(?:page|layout|template|error|not-found|global-error|loading|default)\.tsx$/;
const isStaffRoute = (file: string) =>
  file.startsWith("src/app/[locale]/admin/") || file.startsWith("src/app/[locale]/devs/");
const ROUTES = [...SOURCES.keys()].filter((file) => ROUTE_FILE.test(file));
const PUBLIC_REACH = reachedFrom(ROUTES.filter((file) => !isStaffRoute(file)));
const STAFF_REACH = reachedFrom(ROUTES.filter(isStaffRoute));

const isClient = (text: string) => /^(?:\s|\/\/[^\n]*\n|\/\*[\s\S]*?\*\/)*["']use client["']/.test(text);

const HOOKS = new Set(["useTranslations", "useMessages", "useFormatter", "useNow", "useTimeZone", "useExtracted"]);
const METHODS = new Set(["rich", "raw", "markup", "has"]);

type Island = { file: string; needs: string[]; hooks: Set<string>; unreadable: string[] };

/** The keys a literal, a template or a conditional names, or null when it could be any. */
function keysOf(expression: ts.Expression): string[] | null {
  if (ts.isStringLiteralLike(expression)) return [expression.text];
  if (ts.isTemplateExpression(expression)) {
    const head = expression.head.text;
    return [head.slice(0, Math.max(head.lastIndexOf("."), 0))];
  }
  if (ts.isParenthesizedExpression(expression)) return keysOf(expression.expression);
  if (ts.isConditionalExpression(expression)) {
    const whenTrue = keysOf(expression.whenTrue);
    const whenFalse = keysOf(expression.whenFalse);
    return whenTrue && whenFalse ? [...whenTrue, ...whenFalse] : null;
  }
  return null;
}

/** An identifier that names something rather than referring to it: `{ t: 1 }`, `x.t`, `(t) =>`. */
function isNameNotReference(node: ts.Identifier): boolean {
  const parent = node.parent;
  return (
    ((ts.isVariableDeclaration(parent) ||
      ts.isParameter(parent) ||
      ts.isBindingElement(parent) ||
      ts.isPropertyAssignment(parent) ||
      ts.isPropertySignature(parent) ||
      ts.isMethodDeclaration(parent) ||
      ts.isFunctionDeclaration(parent) ||
      ts.isJsxAttribute(parent)) &&
      parent.name === node) ||
    (ts.isPropertyAccessExpression(parent) && parent.name === node) ||
    (ts.isQualifiedName(parent) && parent.right === node) ||
    ts.isImportSpecifier(parent) ||
    ts.isImportClause(parent)
  );
}

function scan(file: string, text: string): Island {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const translators = new Map<string, string>();
  const hooks = new Set<string>();
  const unreadable: string[] = [];
  const needs: string[] = [];

  const findHooks = (node: ts.Node) => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && HOOKS.has(node.expression.text)) {
      hooks.add(node.expression.text);
      if (node.expression.text === "useTranslations") {
        const argument = node.arguments[0];
        const namespace = argument === undefined ? "" : ts.isStringLiteralLike(argument) ? argument.text : null;
        const declaration = node.parent;
        if (
          namespace !== null &&
          ts.isVariableDeclaration(declaration) &&
          declaration.initializer === node &&
          ts.isIdentifier(declaration.name)
        ) {
          translators.set(declaration.name.text, namespace);
        } else {
          unreadable.push(`${file}:${source.getLineAndCharacterOfPosition(node.getStart()).line + 1}`);
        }
      }
    }
    ts.forEachChild(node, findHooks);
  };
  findHooks(source);

  const findLookups = (node: ts.Node) => {
    if (ts.isIdentifier(node) && translators.has(node.text) && !isNameNotReference(node)) {
      const namespace = translators.get(node.text) as string;
      const parent = node.parent;
      let call: ts.CallExpression | undefined;
      if (ts.isCallExpression(parent) && parent.expression === node) call = parent;
      else if (
        ts.isPropertyAccessExpression(parent) &&
        parent.expression === node &&
        METHODS.has(parent.name.text) &&
        ts.isCallExpression(parent.parent) &&
        parent.parent.expression === parent
      ) {
        call = parent.parent;
      }
      const keys = call && call.arguments[0] ? keysOf(call.arguments[0]) : null;
      // No readable key — or the translator itself handed on — means the whole namespace.
      for (const key of keys ?? [""]) needs.push([namespace, key].filter(Boolean).join("."));
    }
    ts.forEachChild(node, findLookups);
  };
  findLookups(source);

  return { file, needs, hooks, unreadable };
}

const ISLANDS = [...SOURCES]
  .filter(([, text]) => isClient(text) && /from\s+"(?:next-intl|use-intl)/.test(text))
  .map(([file, text]) => scan(file, text));

/** An island any public route reaches, or none does, is held to the public list. */
const isStaffOnly = (file: string) => STAFF_REACH.has(file) && !PUBLIC_REACH.has(file);

const covers = (list: readonly string[], need: string) =>
  list.some((entry) => need === entry || need.startsWith(`${entry}.`));

function resolvePath(messages: unknown, dotted: string): unknown {
  return dotted.split(".").reduce<unknown>(
    (node, segment) => (node && typeof node === "object" ? (node as Record<string, unknown>)[segment] : undefined),
    messages,
  );
}

function leaves(messages: unknown, prefix = ""): Array<[string, string]> {
  if (typeof messages === "string") return [[prefix, messages]];
  return Object.entries(messages as Record<string, unknown>).flatMap(([key, value]) =>
    leaves(value, prefix ? `${prefix}.${key}` : key),
  );
}

describe("§353 the client providers carry the words their islands read, and no more", () => {
  it("finds the islands it is about, on the side of the line each one is", () => {
    // A walk that broke would pass every check below on nothing, so it has to find these.
    const byFile = new Map(ISLANDS.map((island) => [island.file, island]));
    for (const file of [
      "src/shared/ui/SiteNav.tsx",
      "src/shared/ui/LocaleSwitcher.tsx",
      "src/shared/ui/ThemeModeToggle.tsx",
      "src/shared/ui/NewBuildNotice.tsx",
      "src/modules/registrations/ui/SignatureField.tsx",
      "src/app/[locale]/error.tsx",
    ]) {
      expect(byFile.has(file), file).toBe(true);
      expect(isStaffOnly(file), `${file} is reached from a public route`).toBe(false);
    }
    for (const file of [
      "src/modules/content/events/ui/SeriesScope.tsx",
      "src/shared/forms/pickers/DateField.tsx",
      "src/shared/forms/pickers/TimeField.tsx",
    ]) {
      expect(byFile.has(file), file).toBe(true);
      expect(isStaffOnly(file), `${file} is reached only from the backoffice`).toBe(true);
    }
    // The conditional keys are read, not skipped: both branches of `canReply ? … : …`.
    expect(byFile.get("src/modules/registrations/ui/SignatureField.tsx")?.needs).toEqual(
      expect.arrayContaining([
        "Registrations.declare.signatureNameWrongReply",
        "Registrations.declare.signatureNameWrong",
      ]),
    );
    // A key built at runtime needs the sub-tree it is built in.
    expect(byFile.get("src/shared/ui/SiteNav.tsx")?.needs).toContain("Site.nav");
    expect(byFile.get("src/shared/ui/LocaleSwitcher.tsx")?.needs).toContain("Site.languageCode");
  });

  it("reads every useTranslations call it meets", () => {
    // `const t = useTranslations("Ns")` is the one form the scan follows; anything else would be
    // an island whose keys nobody checks.
    expect(ISLANDS.flatMap((island) => island.unreadable)).toEqual([]);
  });

  it("finds every word a public island reads in PUBLIC_CLIENT_MESSAGES", () => {
    const missing = ISLANDS.filter((island) => !isStaffOnly(island.file)).flatMap((island) =>
      island.needs.filter((need) => !covers(PUBLIC_CLIENT_MESSAGES, need)).map((need) => `${island.file}: ${need}`),
    );
    expect(missing, "add these to PUBLIC_CLIENT_MESSAGES (src/i18n/client-messages.ts)").toEqual([]);
  });

  it("finds every word a backoffice island reads in BACKOFFICE_CLIENT_MESSAGES", () => {
    const missing = ISLANDS.filter((island) => isStaffOnly(island.file)).flatMap((island) =>
      island.needs.filter((need) => !covers(BACKOFFICE_CLIENT_MESSAGES, need)).map((need) => `${island.file}: ${need}`),
    );
    expect(missing, "add these to STAFF_CLIENT_MESSAGES (src/i18n/client-messages.ts)").toEqual([]);
  });

  it("names nothing no island reads, and nothing twice", () => {
    const publicNeeds = ISLANDS.flatMap((island) => island.needs);
    const staffNeeds = ISLANDS.filter((island) => isStaffOnly(island.file)).flatMap((island) => island.needs);
    const used = (entry: string, needs: string[]) =>
      needs.some((need) => need === entry || need.startsWith(`${entry}.`) || entry.startsWith(`${need}.`));
    // A dead entry is bytes on every page for a word nobody shows.
    expect(PUBLIC_CLIENT_MESSAGES.filter((entry) => !used(entry, publicNeeds))).toEqual([]);
    // A staff entry a public island needs belongs in the public list, where it already reaches the backoffice.
    expect(STAFF_CLIENT_MESSAGES.filter((entry) => !used(entry, staffNeeds))).toEqual([]);
    expect(STAFF_CLIENT_MESSAGES.filter((entry) => covers(PUBLIC_CLIENT_MESSAGES, entry))).toEqual([]);
    expect(new Set(BACKOFFICE_CLIENT_MESSAGES).size).toBe(BACKOFFICE_CLIENT_MESSAGES.length);
  });

  it("names only words both catalogues have", () => {
    for (const entry of BACKOFFICE_CLIENT_MESSAGES) {
      expect(resolvePath(ro, entry), `ro.json: ${entry}`).toBeDefined();
      expect(resolvePath(en, entry), `en.json: ${entry}`).toBeDefined();
    }
  });

  it("keeps the public words to a few kilobytes, and the backoffice's out of them", () => {
    // The whole catalogue was ~250 KB on every page. Raising this budget is a decision, not a fix:
    // a public island that needs a big sub-tree should get its words from its Server Component.
    for (const messages of CATALOGUES) {
      const picked = pickMessages(messages, PUBLIC_CLIENT_MESSAGES);
      expect(Buffer.byteLength(JSON.stringify(picked))).toBeLessThan(8_000);
      expect(Object.keys(picked)).not.toContain("Admin");
      expect(Object.keys(picked)).not.toContain("Devs");
    }
  });

  it("lets no island read the catalogue whole or format by name", () => {
    // `useMessages` would need the whole catalogue on the client, and the providers pass
    // `formats={null}`: an island that formats a date formats one the server already rendered,
    // which §324 forbids — pass it the server's string.
    const offenders = ISLANDS.filter((island) =>
      ["useMessages", "useFormatter", "useExtracted"].some((hook) => island.hooks.has(hook)),
    ).map((island) => island.file);
    expect(offenders).toEqual([]);
    const named = Object.keys(DATE_FORMATS).join("|");
    const byName = new RegExp(`\\{\\s*\\w+\\s*,\\s*(?:date|time)\\s*,\\s*(?:${named})\\s*\\}`);
    for (const messages of CATALOGUES) {
      const offending = leaves(pickMessages(messages, BACKOFFICE_CLIENT_MESSAGES)).filter(([, message]) =>
        byName.test(message),
      );
      expect(offending.map(([key]) => key)).toEqual([]);
    }
  });

  it("wires each provider to its list, and leaves no server-rendered provider bare", () => {
    expect(read("src/app/[locale]/layout.tsx")).toContain(
      "<NextIntlClientProvider messages={pickMessages(messages, PUBLIC_CLIENT_MESSAGES)} formats={null}>",
    );
    for (const layout of ["src/app/[locale]/admin/layout.tsx", "src/app/[locale]/devs/layout.tsx"]) {
      expect(read(layout), layout).toContain(
        "<NextIntlClientProvider messages={pickMessages(messages, BACKOFFICE_CLIENT_MESSAGES)} formats={null}>",
      );
    }
    // A provider rendered from a Server Component with no `messages` inherits every message of
    // the request — the whole catalogue again. One in a client file inherits its parent's instead.
    const bare = [...SOURCES]
      .filter(([, text]) => !isClient(text))
      .flatMap(([file, text]) =>
        [...text.matchAll(/<NextIntlClientProvider\b([^>]*)>/g)]
          .filter((match) => !/\bmessages=/.test(match[1]))
          .map(() => file),
      );
    expect(bare).toEqual([]);
  });
});

describe("pickMessages", () => {
  const messages = {
    A: { one: "1", two: "2", deep: { x: "x", y: "y" } },
    B: { three: "3" },
  };

  it("keeps the named messages, sub-trees and namespaces, nested as in the catalogue", () => {
    expect(pickMessages(messages, ["A.one", "A.deep", "B"])).toEqual({
      A: { one: "1", deep: { x: "x", y: "y" } },
      B: { three: "3" },
    });
  });

  it("leaves out a path the catalogue does not have", () => {
    expect(pickMessages(messages, ["A.missing", "C", "A.one.too-deep"])).toEqual({});
  });

  it("never writes into the catalogue, whichever order an ancestor and its descendant come in", () => {
    const before = JSON.stringify(messages);
    expect(pickMessages(messages, ["A", "A.deep.x"])).toEqual({ A: messages.A });
    expect(pickMessages(messages, ["A.deep.x", "A"])).toEqual({ A: messages.A });
    expect(pickMessages(messages, ["A.deep", "A.deep.x", "A.two"])).toEqual({
      A: { deep: { x: "x", y: "y" }, two: "2" },
    });
    expect(JSON.stringify(messages)).toBe(before);
  });
});
