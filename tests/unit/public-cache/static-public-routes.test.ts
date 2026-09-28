import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PUBLIC_PAGE_CEILING_SECONDS } from "@/modules/public-cache/page-lifetime";

/**
 * §NNN (amending §333, §489) — the public pages are static and the CDN answers them.
 *
 * Vercel Hobby's Active CPU was at 3 h 02 m of 4 h, with nearly every edge request starting a
 * function: every public page rendered per request. Now a page that is the same for every
 * anonymous visitor is static (ISR), kept by the CDN until a write expires it or its clock turns,
 * and the requests that depend on the reader go to a live twin (`i18n/live-twin.ts`).
 *
 * This pins, per public route, the route-segment config that decides it, and walks each static
 * route's server imports to hold it off the request: a `cookies()` or `headers()` read, or Next's
 * `searchParams`, anywhere on that path renders the page per request again — silently, the build
 * table would just say ƒ. Source-level, like §370's walk: the rule is about what is written.
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
  sourceFiles(path.join(ROOT, "src")).map((file) => [path.relative(ROOT, file).split(path.sep).join("/"), readFileSync(file, "utf8").replace(/\r\n/g, "\n")]),
);

const source = (file: string): string => {
  const text = SOURCES.get(file);
  if (text === undefined) throw new Error(`no such file: ${file}`);
  return text;
};

/** Code without its comments, so a comment that explains `cookies()` is not a read of it. */
const code = (file: string): string => source(file).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

/** The static public routes: made on first visit, kept by the CDN, expired by writes and their clock. */
const STATIC_PAGES = [
  "src/app/[locale]/events/page.tsx",
  "src/app/[locale]/events/[slug]/page.tsx",
  "src/app/[locale]/calendar/page.tsx",
  "src/app/[locale]/faq/page.tsx",
  "src/app/[locale]/team/page.tsx",
  "src/app/[locale]/gallery/page.tsx",
  "src/app/[locale]/gallery/[slug]/page.tsx",
  "src/app/[locale]/pages/[slug]/page.tsx",
  "src/app/[locale]/legal/terms/page.tsx",
  "src/app/[locale]/legal/privacy/page.tsx",
] as const;

/** Static route handlers and pictures: the same lifetime, `force-static` because a GET handler is dynamic without it. */
const STATIC_HANDLERS = [
  "src/app/[locale]/events/calendar.ics/route.ts",
  "src/app/[locale]/events/[slug]/calendar.ics/route.ts",
  "src/app/[locale]/events/[slug]/opengraph-image.tsx",
  "src/app/[locale]/opengraph-image.tsx",
] as const;

/** The live twins: the same page per request, for the visits the static copy cannot answer. */
const LIVE_TWINS = {
  "src/app/[locale]/live/events/page.tsx": "../../events/page",
  "src/app/[locale]/live/events/[slug]/page.tsx": "../../../events/[slug]/page",
  "src/app/[locale]/live/calendar/page.tsx": "../../calendar/page",
} as const;

/**
 * Public routes that stay per request, each with its reason. Growing this list is a decision for
 * `DECISIONS.md`, not for this file.
 */
const PER_REQUEST: Record<string, string> = {
  "src/app/[locale]/contact/page.tsx": "the form's render time is the bot check's clock (§149), the flash toast (§427) and ?sent/?error",
  "src/app/[locale]/members/page.tsx": "the sign-in button reads the session (§524)",
  "src/app/[locale]/events/[slug]/register/page.tsx": "the registration form: the draft cookie, the family cookie, the render time (§97, §389)",
  "src/app/[locale]/events/[slug]/declaration/page.tsx": "the group run's signing form (§393)",
  "src/app/[locale]/events/[slug]/share-image/route.ts": "?shape= — a shared cache keeps it an hour instead",
  "src/app/sitemap.ts": "at the app's root there is no parameter to defer, so a static one would be made at build, with no database in CI",
};

const dynamicOf = (file: string) => /^export const dynamic = "([^"]+)";$/m.exec(source(file))?.[1] ?? null;
const revalidateOf = (file: string) => /^export const revalidate = (\d+);$/m.exec(source(file))?.[1] ?? null;

describe("§NNN the public routes' segment config", () => {
  it.each(STATIC_PAGES)("%s is static, with the public pages' ceiling", (file) => {
    expect(dynamicOf(file)).toBeNull();
    expect(Number(revalidateOf(file))).toBe(PUBLIC_PAGE_CEILING_SECONDS);
    // Next's `searchParams`, read or even named in the props, is a per-request render.
    expect(code(file)).not.toMatch(/\bsearchParams\b/);
  });

  it.each(STATIC_HANDLERS)("%s is force-static, with the public pages' ceiling", (file) => {
    expect(dynamicOf(file)).toBe("force-static");
    expect(Number(revalidateOf(file))).toBe(PUBLIC_PAGE_CEILING_SECONDS);
    expect(code(file)).not.toMatch(/\brequest\.(url|headers|nextUrl)|searchParams\b/);
  });

  it("makes no page at build: the locale layout and every slug route generate no params", () => {
    const generatesNothing = /export function generateStaticParams\(\)[^\n]*\{\n\s*return \[\];\n\}/;
    for (const file of ["src/app/[locale]/layout.tsx", ...[...STATIC_PAGES, ...STATIC_HANDLERS].filter((route) => route.includes("[slug]") && !route.endsWith("opengraph-image.tsx"))]) {
      expect(code(file), file).toMatch(generatesNothing);
    }
    // The feed's only parameter is the locale, and a route handler has no layout to inherit it from.
    expect(code("src/app/[locale]/events/calendar.ics/route.ts")).toMatch(generatesNothing);
  });

  it.each(Object.entries(LIVE_TWINS))("%s renders the static page per request", (file, page) => {
    expect(dynamicOf(file)).toBe("force-dynamic");
    expect(source(file)).toContain(`from "${page}"`);
    expect(source(file)).toMatch(/query=\{searchParams\}/);
  });

  it.each(Object.entries(PER_REQUEST))("%s stays per request: %s", (file) => {
    expect(dynamicOf(file)).toBe("force-dynamic");
  });

  it("gives the one per-request file whose shared-cache lifetime the CDN keeps an explicit public, s-maxage header", () => {
    expect(source("src/app/[locale]/events/[slug]/share-image/route.ts")).toMatch(/"public, max-age=\d+, s-maxage=\d+, stale-while-revalidate=\d+"/);
    expect(readFileSync(path.join(ROOT, "next.config.ts"), "utf8")).toMatch(/source: "\/sitemap\.xml", headers: \[\{ key: "Cache-Control", value: "public, max-age=0, s-maxage=\d+, stale-while-revalidate=\d+" \}\]/);
  });
});

/** Value imports as written: `import type` and `import { type A }` ship nothing. */
function valueImports(text: string): string[] {
  const specifiers: string[] = [];
  for (const match of text.matchAll(/^(?:import|export)\s+(type\s+)?([^;"]*?)\s+from\s+"([^"]+)";/gm)) {
    if (match[1]) continue;
    const named = match[2].trim().match(/^\{([\s\S]*)\}$/)?.[1];
    const onlyTypes = named !== undefined && named.split(",").map((part) => part.trim()).filter(Boolean).every((part) => part.startsWith("type "));
    if (!onlyTypes) specifiers.push(match[3]);
  }
  for (const match of text.matchAll(/\bimport\(\s*"([^"]+)"\s*\)/g)) specifiers.push(match[1]);
  return specifiers;
}

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

const isClient = (file: string) => /^\s*["']use client["']/.test(source(file));

/** Every server file a route reaches, with the chain that reached it. A client island is a boundary: its code runs in the browser. */
function serverClosure(route: string): Map<string, string[]> {
  const chains = new Map<string, string[]>([[route, [route]]]);
  const queue = [route];
  while (queue.length > 0) {
    const current = queue.shift() as string;
    for (const specifier of valueImports(source(current))) {
      const target = resolveImport(current, specifier);
      if (!target || chains.has(target) || isClient(target)) continue;
      chains.set(target, [...(chains.get(current) ?? []), target]);
      queue.push(target);
    }
  }
  return chains;
}

/**
 * The server files a static route reaches that may touch the request, each with why that never
 * happens in a static render. Shrinking this list is the point; growing it is a decision for
 * `DECISIONS.md`.
 */
const REQUEST_READERS_ALLOWED: Record<string, string> = {
  /*
    `headers()` only on a red month's cold miss with no copy (§447): the reader is sent to the
    resting page, and in a static render that read marks the render per request (revalidate 0),
    so the redirect is never the page the CDN keeps. Nothing else in the file touches the request.
  */
  "src/modules/resilience/last-good.ts": "the resting page's way back, on a cold miss only",
  /*
    The session: every static page reaches it only through a Server Action it names as a form's
    `action` (the interest box, the newsletter pop-up), never by calling it while it renders.
  */
};

describe("§NNN a static public route never reads the request while it renders", () => {
  const touchesRequest = (file: string) => /from "next\/headers"/.test(source(file));

  it.each([...STATIC_PAGES, ...STATIC_HANDLERS, "src/app/[locale]/layout.tsx"])("%s reaches no cookie or header read but the known ones", (route) => {
    const offenders = [...serverClosure(route).entries()]
      .filter(([file]) => touchesRequest(file) && !(file in REQUEST_READERS_ALLOWED) && !/\/actions\.ts$/.test(file) && !/"use server"/.test(source(file)))
      .map(([, chain]) => chain.join(" → "));
    expect(offenders).toEqual([]);
  });

  it("walks far enough to meet the one known reader, so the list above cannot go stale", () => {
    for (const allowed of Object.keys(REQUEST_READERS_ALLOWED)) {
      expect(STATIC_PAGES.some((route) => serverClosure(route).has(allowed)), allowed).toBe(true);
    }
    // And the twin, which asks for the session, does reach it: the walk sees what it should.
    expect(serverClosure("src/app/[locale]/live/events/[slug]/page.tsx").has("src/modules/staff-identity/session.ts")).toBe(true);
  });

  it.each([...STATIC_PAGES, "src/app/[locale]/layout.tsx"])("%s never asks who is signed in while it renders", (route) => {
    const readers = [...serverClosure(route).entries()]
      .filter(([file]) => !/\/actions\.ts$/.test(file) && !/"use server"/.test(source(file)))
      .filter(([file]) => file === "src/modules/staff-identity/session.ts")
      .map(([, chain]) => chain.join(" → "));
    expect(readers).toEqual([]);
  });
});
