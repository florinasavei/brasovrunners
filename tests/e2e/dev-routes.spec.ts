import { readdirSync } from "node:fs";
import path from "node:path";
import { expect, test, type APIRequestContext } from "@playwright/test";
import { signIn } from "./support/featured-event";

/**
 * §370 — every page answers under `next dev`, for a Superadministrator and for a visitor.
 *
 * On 2026-09-24 every backoffice list — events, registrations, legal texts, pages, gallery, the
 * to-do screen, the team — answered 500 under `yarn dev` ("Element type is invalid … got:
 * undefined") while the production build, and so the rest of this suite, served them. The cause
 * was an element handed to a client component as a prop (`AdminSkeleton`'s `Stack divider`),
 * which development's payload can deliver as a lazy wrapper;
 * `tests/unit/shared/server-element-props.test.ts` now refuses that in the source. This is the
 * wider net for the development loop itself (`docs/VIBECODING.md`): whatever else breaks only
 * under `next dev` breaks the page an agent or the owner is looking at, and a production-build
 * suite cannot see it.
 *
 * **Gated, so CI time does not move**: it runs only with `E2E_DEV=1`, where `playwright.config.ts`
 * starts `next dev` instead of a production build, and on the desktop project only — a route
 * answers the same at any width. `yarn test:e2e:dev` is the one command (with `E2E_PORT` set to
 * a `yarn dev` already running, it uses that one). Every route compiles on its first request under
 * `next dev`, so the walk takes minutes rather than seconds, which is why it is not in the routine
 * suite.
 *
 * **Each address is requested twice.** The defect it was written for passed the first render after
 * a compile and failed the ones after it — whether the element arrived whole depended on the
 * order the payload's rows streamed in — so one request per page would have reported green.
 *
 * **The walk.** The backoffice from `/ro/admin` and `/ro/devs`, two links deep — the tabs, then
 * what each tab links to (sub-tabs, "new", an editor) — and then **every backoffice route file**
 * the links did not reach (an event's bibs, messages and urgent notice sit behind a "⋮" menu that
 * renders nothing until it is pressed), its `[id]` filled with one the walk saw for the same
 * parent. A route whose id nothing on the seeded database offers — a registration, an album, a
 * page, a desk code — is named in the report's "not reached" note rather than failed: the seed
 * decides that, not the code. The public site is walked from the sitemap, one link deep, as an
 * anonymous visitor. An address that differs from one already walked only by an id or a filter
 * value is walked a few times, not once per row. Requests only, no browser page: the server render
 * is what failed, and a request costs a fraction of a navigation.
 */
const DEV = process.env.E2E_DEV === "1";

/** How many addresses of one shape (the path with its ids blanked, the query's names) to walk. */
const PER_SHAPE = 3;

const ID_SEGMENT = /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|\d+)$/i;

/** The staff side, which the visitor's walk leaves to the Superadministrator's. */
const STAFF_ROUTE = /^\/(?:ro|en)\/(?:admin|devs)(?:[/?]|$)/;

function shapeOf(address: string): string {
  const url = new URL(address, "http://shape.invalid");
  const pathname = url.pathname
    .split("/")
    .map((segment) => (ID_SEGMENT.test(segment) ? ":id" : segment))
    .join("/");
  return `${pathname}?${[...url.searchParams.keys()].sort().join("&")}`;
}

/** Same-origin links under one of `prefixes`, from a page's HTML, without their fragment. */
function linksIn(html: string, prefixes: readonly string[], skip?: RegExp): string[] {
  const found = new Set<string>();
  for (const match of html.matchAll(/href="(\/[^"#]*)(?:#[^"]*)?"/g)) {
    const address = match[1].replace(/&amp;/g, "&");
    if (address.startsWith("/api/") || skip?.test(address)) continue;
    if (prefixes.some((prefix) => address === prefix || address.startsWith(`${prefix}/`) || address.startsWith(`${prefix}?`))) {
      found.add(address);
    }
  }
  return [...found];
}

/**
 * Every `page.tsx` under `src/app/[locale]/admin` and `/devs`, as its address after the locale:
 * `/admin/events/[id]/bibs`. A route group — `(list)` — is not part of the address.
 */
function staffRouteFiles(): string[] {
  const app = path.resolve(__dirname, "../../src/app/[locale]");
  const found: string[] = [];
  const visit = (directory: string, segments: string[]) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        visit(path.join(directory, entry.name), /^\(.*\)$/.test(entry.name) ? segments : [...segments, entry.name]);
      } else if (entry.name === "page.tsx") {
        found.push(`/${segments.join("/")}`);
      }
    }
  };
  for (const root of ["admin", "devs"]) visit(path.join(app, root), [root]);
  return found;
}

const isParam = (segment: string) => /^\[[^.\]]+\]$/.test(segment);

/** Whether an address after the locale is an instance of a route file's address. */
function instanceOf(route: string, address: string): boolean {
  const want = route.split("/");
  const have = address.split("/");
  return want.length === have.length && want.every((segment, index) => isParam(segment) || segment === have[index]);
}

type Answer = { address: string; status: number };

/** A small crawler: one `seen` set, one budget per shape, two requests per address. */
function crawler(request: APIRequestContext) {
  const seen = new Set<string>();
  const perShape = new Map<string, number>();
  const failed: Answer[] = [];

  const admit = (address: string) => {
    if (seen.has(address)) return false;
    const shape = shapeOf(address);
    const count = perShape.get(shape) ?? 0;
    if (count >= PER_SHAPE) return false;
    perShape.set(shape, count + 1);
    seen.add(address);
    return true;
  };

  /** Two requests; the second one's HTML, or "" when the address failed or is not a page. */
  const visit = async (address: string): Promise<string> => {
    let html = "";
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await request.get(address, { timeout: 180_000 });
      if (response.status() >= 500) {
        failed.push({ address, status: response.status() });
        return "";
      }
      if (attempt === 1 && (response.headers()["content-type"] ?? "").includes("text/html")) html = await response.text();
    }
    return html;
  };

  /** From `start`, `depth` links deep; a redirect is followed and judged by where it lands. */
  const walk = async (start: readonly string[], prefixes: readonly string[], depth: number, skip?: RegExp) => {
    let frontier = start.filter(admit);
    for (let level = 0; level <= depth && frontier.length > 0; level += 1) {
      const next: string[] = [];
      for (const address of frontier) {
        const html = await visit(address);
        if (level < depth) next.push(...linksIn(html, prefixes, skip).filter(admit));
      }
      frontier = next;
    }
  };

  return { seen, failed, admit, visit, walk };
}

test.describe("§370 every page answers under next dev", () => {
  test.skip(!DEV, "a next dev check — run it with `yarn test:e2e:dev`");
  test.skip(() => test.info().project.name !== "desktop", "a route answers the same at any width");
  // Every route compiles on its first request; minutes, not the suite's usual seconds.
  test.setTimeout(30 * 60_000);

  test("every backoffice route a Superadministrator can reach", async ({ page }) => {
    await signIn(page, "Dev Superadministrator");
    // `page.request` carries the browser context's cookies, so these are the signed-in answers.
    const crawl = crawler(page.request);
    await crawl.walk(["/ro/admin", "/ro/devs"], ["/ro/admin", "/ro/devs"], 2);

    // Then the route files the links did not reach, each `[param]` filled from an address the
    // walk saw for the same parent: `/admin/events/[id]` gives `/admin/events/[id]/bibs` its id.
    const walked = [...crawl.seen].map((address) => new URL(address, "http://walked.invalid").pathname.replace(/^\/ro(?=\/)/, ""));
    const routes = staffRouteFiles();
    // `/admin/events/new` is its own route, not `/admin/events/[id]` with the id "new".
    const staticRoutes = new Set(routes.filter((route) => !route.split("/").some(isParam)));
    const isInstance = (route: string, address: string) =>
      instanceOf(route, address) && (route === address || !staticRoutes.has(address));
    const known = new Map<string, string>();
    for (const route of routes) {
      const instance = walked.find((address) => isInstance(route, address));
      if (!instance) continue;
      const want = route.split("/");
      const have = instance.split("/");
      want.forEach((segment, index) => {
        if (isParam(segment)) known.set(want.slice(0, index + 1).join("/"), have.slice(0, index + 1).join("/"));
      });
    }
    const notReached: string[] = [];
    for (const route of routes) {
      if (walked.some((address) => isInstance(route, address))) continue;
      const segments = route.split("/");
      let filled = route;
      for (let end = segments.length; end > 0; end -= 1) {
        const prefix = segments.slice(0, end).join("/");
        const concrete = known.get(prefix);
        if (concrete) {
          filled = [concrete, ...segments.slice(end)].join("/");
          break;
        }
      }
      if (filled.split("/").some(isParam)) notReached.push(route);
      else if (crawl.admit(`/ro${filled}`)) await crawl.visit(`/ro${filled}`);
    }

    await test.info().attach("walked", { body: [...crawl.seen].join("\n"), contentType: "text/plain" });
    if (notReached.length > 0) test.info().annotations.push({ type: "not reached", description: notReached.join(", ") });
    expect(crawl.seen.size).toBeGreaterThan(10);
    expect(crawl.failed).toEqual([]);
  });

  test("every public route in the sitemap, and what those pages link to", async ({ request }) => {
    const sitemap = await (await request.get("/sitemap.xml")).text();
    const listed = new Set<string>(["/ro", "/en", "/ro/autentificare"]);
    for (const match of sitemap.matchAll(/(?:<loc>|href=")(https?:\/\/[^<"]+)/g)) {
      const url = new URL(match[1].replace(/&amp;/g, "&"));
      listed.add(`${url.pathname}${url.search}`);
    }
    const crawl = crawler(request);
    await crawl.walk([...listed], ["/ro", "/en"], 1, STAFF_ROUTE);

    await test.info().attach("walked", { body: [...crawl.seen].join("\n"), contentType: "text/plain" });
    expect(crawl.seen.size).toBeGreaterThan(5);
    expect(crawl.failed).toEqual([]);
  });
});
