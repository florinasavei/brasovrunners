import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PREFETCHED_PATHNAMES, prefetchFor } from "@/i18n/prefetch";
import { PUBLIC_PAGE_CEILING_SECONDS } from "@/modules/public-cache/page-lifetime";

/**
 * §543 (amending §333, §489) — the public pages are static and the CDN answers them.
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
 * Public routes that stay per request, each with its reason. The rule (§543): a public page is
 * static unless it names here why not. Growing this list is a decision for `DECISIONS.md`, not
 * for this file.
 */
const TOKEN_PAGE = "a token page: the address carries a single-use secret, checked against its hash per request and never cached (AGENTS.md §12.8, §14.5)";
const PER_REQUEST: Record<string, string> = {
  "src/app/[locale]/contact/page.tsx": "the form's render time is the bot check's clock (§149), the flash toast (§427) and ?sent/?error",
  "src/app/[locale]/members/page.tsx": "the sign-in button reads the session (§524)",
  "src/app/[locale]/members-area/page.tsx": "the members' zone reads the session and sends a stranger to the sign-in (§524, AGENTS.md §14.5)",
  "src/app/[locale]/sign-in/page.tsx": "reads the session, ?to= and ?error= (§26)",
  "src/app/[locale]/preview/events/[id]/page.tsx": "staff only: a draft shown to whoever the session says may read it (BR-REQ-060-01)",
  "src/app/[locale]/events/[slug]/register/page.tsx": "the registration form: the draft cookie, the family cookie, the render time (§97, §389)",
  "src/app/[locale]/events/[slug]/declaration/page.tsx": "the group run's signing form (§393)",
  "src/app/[locale]/registrations/mine/page.tsx": "a form that takes an address: ?sent= says its outcome (BR-REQ-036-04)",
  "src/app/[locale]/registrations/resend/page.tsx": "a form that takes an address: ?sent= and ?event= (BR-REQ-036-02)",
  "src/app/[locale]/registrations/confirm/[token]/page.tsx": TOKEN_PAGE,
  "src/app/[locale]/registrations/declare/[token]/page.tsx": TOKEN_PAGE,
  "src/app/[locale]/registrations/family/[token]/page.tsx": TOKEN_PAGE,
  "src/app/[locale]/registrations/list/[token]/page.tsx": TOKEN_PAGE,
  "src/app/[locale]/registrations/manage/[token]/page.tsx": TOKEN_PAGE,
  "src/app/[locale]/registrations/mine/[token]/page.tsx": TOKEN_PAGE,
  "src/app/[locale]/newsletter/confirm/[token]/page.tsx": TOKEN_PAGE,
  "src/app/[locale]/newsletter/manage/[token]/page.tsx": TOKEN_PAGE,
  "src/app/[locale]/events/[slug]/share-image/route.ts": "?shape= — a shared cache keeps it an hour instead",
  "src/app/sitemap.ts": "at the app's root there is no parameter to defer, so a static one would be made at build, with no database in CI",
};

/** Routes that render nothing of their own: they only throw Next's redirect or its 404. */
const NEVER_RENDERED: Record<string, string> = {
  "src/app/[locale]/page.tsx": "a permanent redirect to the listing; the proxy answers /ro and /en before it (§353)",
  "src/app/[locale]/[...rest]/page.tsx": "notFound() for any path no page claims",
};

/** Made at build from the environment alone, the same until the next deploy. */
const BUILT_ONCE: Record<string, string> = {
  "src/app/robots.ts": "reads only the environment (BR-REQ-070-03)",
};

/**
 * Every public route file: a page, a route handler or a metadata picture under `src/app/[locale]/`
 * (the backoffice `admin/` and `devs/` are staff routes, per request by their own layouts), and the
 * app root's metadata routes.
 */
function publicRouteFiles(): string[] {
  const routeFile = /\/(page\.tsx|route\.ts|opengraph-image\.tsx|twitter-image\.tsx|icon\.tsx)$/;
  return [...SOURCES.keys()]
    .filter((file) => (file.startsWith("src/app/[locale]/") && !/^src\/app\/\[locale\]\/(admin|devs)\//.test(file) && routeFile.test(file)) || /^src\/app\/(robots|sitemap|manifest)\.ts$/.test(file))
    .sort();
}

const dynamicOf = (file: string) => /^export const dynamic = "([^"]+)";$/m.exec(source(file))?.[1] ?? null;
const revalidateOf = (file: string) => /^export const revalidate = (\d+);$/m.exec(source(file))?.[1] ?? null;

describe("§543 the public routes' segment config", () => {
  it("names every public route: static, a live twin, per request with its reason, or rendering nothing", () => {
    const named = [...STATIC_PAGES, ...STATIC_HANDLERS, ...Object.keys(LIVE_TWINS), ...Object.keys(PER_REQUEST), ...Object.keys(NEVER_RENDERED), ...Object.keys(BUILT_ONCE)];
    // Each named once…
    expect(named.filter((file, index) => named.indexOf(file) !== index)).toEqual([]);
    // …and a route nobody named — a new page that would silently be static or per request — fails here.
    expect(publicRouteFiles()).toEqual([...named].sort());
  });

  it.each(Object.entries(NEVER_RENDERED))("%s renders nothing: %s", (file) => {
    expect(dynamicOf(file)).toBeNull();
    expect(code(file)).toMatch(/\b(notFound|permanentRedirect|redirect)\(/);
  });

  it.each(Object.entries(BUILT_ONCE))("%s is made at build: %s", (file) => {
    expect(dynamicOf(file)).toBeNull();
    expect(code(file)).not.toMatch(/from "next\/headers"|\bsearchParams\b/);
  });

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
    `headers()` only on a red month's cold miss with no copy (§447), and on a production server
    only in a render Next answers per request (`renderKind() === "request"`: a live twin, a form, a
    token page): in a static render it sets revalidate 0 before throwing and Next answers 500
    («Page changed from static to dynamic at runtime»), not the resting page. There the way back is
    the site's root and the redirect is held a minute (`tests/unit/resilience/resting-page.test.ts`).
    Nothing else in the file touches the request.
  */
  "src/modules/resilience/last-good.ts": "the resting page's way back, on a cold miss only",
  /*
    The session: every static page reaches it only through a Server Action it names as a form's
    `action` (the interest box, the newsletter pop-up), never by calling it while it renders.
  */
};

describe("§543 a static public route never reads the request while it renders", () => {
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

  /*
    A fetch with `cache: "no-store"` (or `next: { revalidate: 0 }`), `unstable_noStore()` or
    `connection()` made while a static page renders marks that render dynamic: Next 16 sets its
    revalidate to 0 and throws, and at runtime an ISR page answers 500 («Page changed from static to
    dynamic at runtime») — only inside `unstable_cache` is a no-store fetch harmless, and whether a
    call sits inside one is not something a source walk can see. So no server file a static route
    reaches writes any of them (§543, a review finding: the weather's stale refresh was a bare
    no-store fetch). A request that must never be stored names no cache mode inside `unstable_cache`.
  */
  const optsOutOfStatic = (file: string) =>
    /\bcache:\s*["']no-store["']|\brevalidate:\s*0\b|\bunstable_noStore\b|\bconnection\s*\(\s*\)/.test(code(file));

  /**
   * Files a static route reaches that write one, each with why no static render runs it. Empty since
   * §543, and shrinking it was the point: `diagnostics/neon.ts` stood here while the budget governor's
   * background refresh ran inside a page's render — a request of the render's own, which shortened
   * the page to the shared reading's fifteen minutes and would have made it dynamic had it been a
   * no-store one. A render is now told the last known level (`diagnostics/budget-level.ts`) and
   * reaches no Neon request at all (the test below).
   */
  const NO_STORE_ALLOWED: Record<string, string> = {};

  it.each([...STATIC_PAGES, ...STATIC_HANDLERS, "src/app/[locale]/layout.tsx"])("%s reaches no no-store fetch, noStore() or connection()", (route) => {
    const offenders = [...serverClosure(route).entries()]
      .filter(([file]) => optsOutOfStatic(file) && !(file in NO_STORE_ALLOWED) && !/\/actions\.ts$/.test(file) && !/"use server"/.test(source(file)))
      .map(([, chain]) => chain.join(" → "));
    expect(offenders).toEqual([]);
  });

  it.each([...STATIC_PAGES, ...STATIC_HANDLERS, "src/app/[locale]/layout.tsx"])("%s reaches no request to Neon's API: the governor's level is the last known one (§543)", (route) => {
    const closure = serverClosure(route);
    const neon = ["src/modules/diagnostics/neon.ts", "src/modules/diagnostics/neon-budget.ts"].filter((file) => closure.has(file)).map((file) => (closure.get(file) ?? []).join(" → "));
    expect(neon).toEqual([]);
  });

  it("walks far enough to meet the governor's level, and would flag Neon's reader were it reached", () => {
    // The public cache reads the level on every read; the walk sees the module that answers it…
    expect(serverClosure("src/app/[locale]/events/page.tsx").has("src/modules/diagnostics/budget-level.ts")).toBe(true);
    // …which makes no request and knows no cache mode.
    expect(code("src/modules/diagnostics/budget-level.ts")).not.toMatch(/\bfetch\(|from "\.\/neon"|from "\.\/neon-budget"/);
    // And the file the governor's reading lives in writes a no-store fetch: reached from a static route, the test above fails on it.
    expect(optsOutOfStatic("src/modules/diagnostics/neon.ts")).toBe(true);
  });

  it("walks far enough to meet the forecast's source, and would see a no-store fetch in it", () => {
    for (const route of ["src/app/[locale]/events/page.tsx", "src/app/[locale]/events/[slug]/page.tsx"]) {
      expect(serverClosure(route).has("src/modules/weather/source.ts"), route).toBe(true);
    }
    expect(optsOutOfStatic("src/modules/weather/source.ts")).toBe(false);
    // The pattern itself, on the line the review found.
    expect(/\bcache:\s*["']no-store["']/.test('headers: {}, cache: "no-store",')).toBe(true);
  });

  it.each([...STATIC_PAGES, "src/app/[locale]/layout.tsx"])("%s never asks who is signed in while it renders", (route) => {
    const readers = [...serverClosure(route).entries()]
      .filter(([file]) => !/\/actions\.ts$/.test(file) && !/"use server"/.test(source(file)))
      .filter(([file]) => file === "src/modules/staff-identity/session.ts")
      .map(([, chain]) => chain.join(" → "));
    expect(readers).toEqual([]);
  });
});

/**
 * The links a static page renders (§543). Next prefetches a `<Link>` as soon as it is in view, and a
 * prefetch of a per-request address — the contact form, «Membri», the register form, a live twin —
 * starts a function on a visit the CDN otherwise answers alone. So every Next link a static page can
 * render either names a static page at its bare address literally, or says its `prefetch`: `false`,
 * or `prefetchFor(href)` (`i18n/prefetch.ts`), which allows only the static pages.
 */
describe("§543 a static public page never prefetches a per-request address", () => {
  /** Every file a route reaches, server and client alike: the header and the footer are client islands, and their links are what is prefetched. */
  function wholeClosure(routes: readonly string[]): Set<string> {
    const seen = new Set(routes);
    const queue = [...routes];
    while (queue.length > 0) {
      const current = queue.shift() as string;
      for (const specifier of valueImports(source(current))) {
        const target = resolveImport(current, specifier);
        if (target && !seen.has(target)) {
          seen.add(target);
          queue.push(target);
        }
      }
    }
    return seen;
  }

  const STATIC_ROOTS = [...STATIC_PAGES, "src/app/[locale]/layout.tsx", "src/app/[locale]/not-found.tsx", "src/app/[locale]/error.tsx"];

  /** The names a file gives Next's link: `next/link`'s default, or `Link` from `@/i18n/navigation` (MUI's `Link` is a plain `<a>`, never prefetched). */
  function nextLinkNames(text: string): string[] {
    const names: string[] = [];
    for (const match of text.matchAll(/^import\s+(\w+)\s+from\s+"next\/link";/gm)) names.push(match[1]);
    for (const match of text.matchAll(/^import\s+\{([^}]*)\}\s+from\s+"@\/i18n\/navigation";/gm)) {
      for (const part of match[1].split(",").map((piece) => piece.trim())) {
        const named = /^Link(?:\s+as\s+(\w+))?$/.exec(part);
        if (named) names.push(named[1] ?? "Link");
      }
    }
    return names;
  }

  /** Every opening JSX element in `text` that renders one of `names`, as written (braces balanced). */
  function linkElements(text: string, names: readonly string[]): { line: number; element: string }[] {
    const found: { line: number; element: string }[] = [];
    for (const match of text.matchAll(/<([A-Z][\w.]*)\b/g)) {
      let depth = 0;
      let end = match.index + 1;
      for (; end < text.length; end += 1) {
        const char = text[end];
        if (char === "{") depth += 1;
        else if (char === "}") depth -= 1;
        else if (char === ">" && depth === 0 && text[end - 1] !== "=") break;
      }
      const element = text.slice(match.index, end + 1);
      const rendersLink = names.includes(match[1]) || names.some((name) => element.includes(`component={${name}}`));
      if (rendersLink) found.push({ line: text.slice(0, match.index).split("\n").length, element });
    }
    return found;
  }

  /** A literal href to a static page at its bare address, or to an anchor on this page. */
  function literallyStatic(element: string): boolean {
    const plain = /\shref="([^"]*)"/.exec(element)?.[1];
    if (plain !== undefined) return plain.startsWith("#") || prefetchFor(plain) === undefined;
    const object = /\shref=\{\{\s*pathname:\s*"([^"]+)"([\s\S]*?)\}\s*\}/.exec(element);
    if (object) return !/\bquery\b/.test(object[2]) && prefetchFor(object[1]) === undefined;
    return false;
  }

  /** Links whose href is an expression but always a static page, each with why. Shrinking this is the point. */
  const LINKS_TO_STATIC_PAGES: Record<string, string> = {
    "src/modules/events/ui/CalendarEventChip.tsx": "an event's own page, from getPathname of /events/[slug] (EventCalendar)",
  };

  it("walks the header, the footer and the link wrappers", () => {
    const closure = wholeClosure(STATIC_ROOTS);
    for (const file of ["src/shared/ui/SiteNav.tsx", "src/shared/ui/SiteFooter.tsx", "src/shared/ui/ButtonLink.tsx", "src/shared/ui/ChipLink.tsx", "src/modules/events/ui/RegistrationDoorButton.tsx"]) {
      expect(closure.has(file), file).toBe(true);
    }
  });

  it("every Next link a static page can render names a static page, or says its prefetch", () => {
    const offenders: string[] = [];
    for (const file of [...wholeClosure(STATIC_ROOTS)].sort()) {
      // Comments out, their lines kept, so a line number below is the file's own.
      const text = source(file).replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, " ")).replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
      const names = nextLinkNames(text);
      if (names.length === 0 || file in LINKS_TO_STATIC_PAGES) continue;
      for (const { line, element } of linkElements(text, names)) {
        const says = /\sprefetch=\{(false|prefetchFor\()/.test(element);
        if (!says && !literallyStatic(element)) offenders.push(`${file}:${line} ${element.replace(/\s+/g, " ").slice(0, 120)}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("prefetches exactly the static public pages", () => {
    const pathnameOf = (file: string) => file.replace(/^src\/app\/\[locale\]/, "").replace(/\/page\.tsx$/, "");
    expect([...PREFETCHED_PATHNAMES].sort()).toEqual(STATIC_PAGES.map(pathnameOf).sort());
  });
});
