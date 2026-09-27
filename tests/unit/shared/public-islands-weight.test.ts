import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * §489 — a client island on a public page never carries the server's configuration, nor Zod.
 *
 * Measured on a production build: the contact page shipped 83 KB of gzipped JavaScript it never
 * ran, the whole of Zod with every one of its languages, because `TurnstileWidget` (a client
 * island) imported the script's address from `registrations/turnstile.ts`, whose first import is
 * `shared/config/env.ts` — and the environment's schema is written in Zod. A client island takes
 * with it everything it imports, used or not; the bundler cannot drop a module whose top level
 * runs code, and `env.ts`'s top level parses the environment.
 *
 * So this walks, from every public route file, through the server's imports to each `"use client"`
 * file it reaches, and then through that island's own imports, and refuses two things there: the
 * server's configuration (`src/shared/config/env.ts` — in a browser it parses an environment that
 * is not there) and the `zod` package (validation is the server's; an island that needs a rule
 * takes a plain function from a `domain/` module).
 *
 * Source-level, like `pickers-backoffice-only.test.ts`: the rule is about what is written.
 */
const ROOT = path.resolve(__dirname, "../../..");

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

/** Value imports as written: `import type` and `import { type A }` ship nothing. */
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
  for (const match of text.matchAll(/^import\s+"([^"]+)";/gm)) specifiers.push(match[1]);
  for (const match of text.matchAll(/\bimport\(\s*"([^"]+)"\s*\)/g)) specifiers.push(match[1]);
  return specifiers;
}

/** A file under `src/` for `@/x` and `./x`; the package name for anything else. */
function resolveImport(fromFile: string, specifier: string): { file: string } | { pkg: string } | null {
  let base: string;
  if (specifier.startsWith("@/")) base = `src/${specifier.slice(2)}`;
  else if (specifier.startsWith(".")) base = path.posix.join(path.posix.dirname(fromFile), specifier);
  else return { pkg: specifier.startsWith("@") ? specifier.split("/").slice(0, 2).join("/") : specifier.split("/")[0] };
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`]) {
    if (SOURCES.has(candidate)) return { file: candidate };
  }
  return null;
}

const isClient = (file: string) => /^\s*["']use client["']/.test(SOURCES.get(file) ?? "");

const ROUTE_FILE = /\/(page|layout|error|not-found|template|loading|default|route|opengraph-image|sitemap|robots)\.tsx?$/;
const PUBLIC_ROUTES = [...SOURCES.keys()].filter(
  (file) =>
    file.startsWith("src/app/") &&
    ROUTE_FILE.test(file) &&
    !file.startsWith("src/app/[locale]/admin/") &&
    !file.startsWith("src/app/[locale]/devs/") &&
    !file.startsWith("src/app/api/"),
);

/** The `"use client"` files the public routes reach through the server's imports. */
const PUBLIC_ISLANDS = (() => {
  const seen = new Set<string>(PUBLIC_ROUTES);
  const queue = [...PUBLIC_ROUTES];
  const islands = new Set<string>();
  while (queue.length > 0) {
    const current = queue.shift() as string;
    if (isClient(current)) {
      islands.add(current);
      continue;
    }
    for (const specifier of valueImports(SOURCES.get(current) ?? "")) {
      const target = resolveImport(current, specifier);
      if (!target || !("file" in target) || seen.has(target.file)) continue;
      seen.add(target.file);
      queue.push(target.file);
    }
  }
  return [...islands].sort();
})();

/** What an island ships: the chain to the first file that imports `wanted`, or null. */
function chainTo(island: string, wanted: (target: { file: string } | { pkg: string }) => boolean): string | null {
  const parent = new Map<string, string | null>([[island, null]]);
  const queue = [island];
  while (queue.length > 0) {
    const current = queue.shift() as string;
    for (const specifier of valueImports(SOURCES.get(current) ?? "")) {
      const target = resolveImport(current, specifier);
      if (!target) continue;
      if (wanted(target)) {
        const chain = [specifier];
        for (let file: string | null = current; file; file = parent.get(file) ?? null) chain.unshift(file);
        return chain.join(" → ");
      }
      if ("file" in target && !parent.has(target.file)) {
        parent.set(target.file, current);
        queue.push(target.file);
      }
    }
  }
  return null;
}

/**
 * Islands that carry one of them today, each with its reason. Shrinking this list is the point;
 * growing it is a decision for `DECISIONS.md`, not for this file.
 */
const KNOWN: Record<string, string> = {
  /*
    The registration form's "open and read" dialog renders the club's legal text in the browser
    with the rich-text renderer (§422), whose schema is Zod and whose video block reads the site's
    address from the configuration. One page, the form, behind a click; its own pass.
  */
  "src/modules/registrations/ui/ReadAndAgree.tsx": "the legal text's renderer, on the registration form",
};

describe("§489 a public page's client islands carry no server code", () => {
  it("finds the islands: the walk reaches the header's and the contact page's", () => {
    expect(PUBLIC_ISLANDS).toContain("src/shared/ui/SiteNav.tsx");
    expect(PUBLIC_ISLANDS).toContain("src/modules/registrations/ui/TurnstileWidget.tsx");
  });

  it("no island imports the server's configuration or Zod", () => {
    const offenders = PUBLIC_ISLANDS.filter((island) => !(island in KNOWN)).flatMap((island) =>
      [
        chainTo(island, (target) => "file" in target && target.file === "src/shared/config/env.ts"),
        chainTo(island, (target) => "pkg" in target && target.pkg === "zod"),
      ].filter((chain): chain is string => chain !== null),
    );
    expect(offenders).toEqual([]);
  });

  it("every known exception is still a public island that still carries it — a fixed one leaves the list", () => {
    for (const island of Object.keys(KNOWN)) {
      expect(PUBLIC_ISLANDS).toContain(island);
      expect(chainTo(island, (target) => ("pkg" in target && target.pkg === "zod") || ("file" in target && target.file === "src/shared/config/env.ts"))).not.toBeNull();
    }
  });

  it("the Turnstile widget takes the script's address from the import-free module", () => {
    const widget = SOURCES.get("src/modules/registrations/ui/TurnstileWidget.tsx") ?? "";
    expect(widget).toContain('from "../domain/turnstile-widget"');
    expect(valueImports(SOURCES.get("src/modules/registrations/domain/turnstile-widget.ts") ?? "")).toEqual([]);
  });
});
