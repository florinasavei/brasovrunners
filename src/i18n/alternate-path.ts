import { routing } from "./routing";

/**
 * Reading a localized URL back into the route that produced it.
 *
 * The navigation helpers go one way — internal route plus params, out comes a localized path.
 * A language switcher needs the other direction: the visitor is on
 * `/ro/evenimente/tura-pe-tampa` and wants the same page in English, so something has to
 * recognise that path as `/events/[slug]` with `slug = tura-pe-tampa` before the English URL
 * can be built.
 *
 * Pure, and driven by `routing.pathnames` rather than by a second copy of the route table, so a
 * new route is understood here the moment it is declared there.
 *
 * The slug itself is deliberately *not* translated here. Slugs are editorial data — the same
 * event is `tura-pe-tampa` and `tampa-trail` — so only the database knows the pair. This
 * returns the parsed route and leaves that lookup to the caller (BR-REQ-040-01 criterion 5:
 * never build an alternate URL by swapping the prefix).
 */

type InternalRoute = keyof typeof routing.pathnames;
export type Locale = (typeof routing.locales)[number];

export type ParsedPath = {
  locale: Locale;
  route: InternalRoute;
  params: Record<string, string>;
};

function isLocale(value: string | undefined): value is Locale {
  return value !== undefined && (routing.locales as readonly string[]).includes(value);
}

/** The external template for one internal route in one locale, e.g. `/evenimente/[slug]`. */
function templateFor(route: InternalRoute, locale: Locale): string {
  const pathnames: Record<string, string | Record<string, string>> = routing.pathnames;
  const entry = pathnames[route];
  return typeof entry === "string" ? entry : entry[locale];
}

/**
 * Match one external template against a path, returning its parameters.
 *
 * Templates are literals in `routing.ts`, never visitor input, so building a regex from one is
 * safe; the path being matched is escaped nowhere because it is only ever *tested*, and every
 * capture is a single segment.
 */
function matchTemplate(template: string, path: string): Record<string, string> | undefined {
  const templateSegments = template.split("/").filter(Boolean);
  const pathSegments = path.split("/").filter(Boolean);
  if (templateSegments.length !== pathSegments.length) return undefined;

  const params: Record<string, string> = {};
  for (const [index, segment] of templateSegments.entries()) {
    const dynamic = /^\[(.+)\]$/.exec(segment);
    if (dynamic) {
      params[dynamic[1]] = decodeURIComponent(pathSegments[index]);
      continue;
    }
    if (segment !== pathSegments[index]) return undefined;
  }
  return params;
}

/**
 * Which page is this, in which locale? `undefined` when the path is not one of ours — an
 * unknown URL, an asset, something a visitor typed — and the caller then falls back to a page
 * that certainly exists rather than guessing.
 */
export function parseLocalizedPath(pathname: string): ParsedPath | undefined {
  const [maybeLocale, ...rest] = pathname.split("?")[0].split("/").filter(Boolean);
  if (!isLocale(maybeLocale)) return undefined;

  const remainder = `/${rest.join("/")}`;
  const routes = Object.keys(routing.pathnames) as InternalRoute[];

  // Static routes win over dynamic ones: `/events` must not be read as `/events/[slug]` with an
  // empty slug, and a future `/events/next` would otherwise be swallowed by the slug route.
  const byPrecedence = [...routes].sort((a, b) => Number(a.includes("[")) - Number(b.includes("[")));

  for (const route of byPrecedence) {
    const params = matchTemplate(templateFor(route, maybeLocale), remainder);
    if (params) return { locale: maybeLocale, route, params };
  }

  return undefined;
}
