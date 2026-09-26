import { getTranslations } from "next-intl/server";
import { routing } from "@/i18n/routing";
import { RESTING_RETRY_SECONDS, safeBackPath } from "@/modules/resilience/domain/resting-page";

/**
 * The short resting page (§NNN) — «Pagina se reîncarcă în câteva minute».
 *
 * Where a public page sends its reader while the month's budget is red, when its read missed the
 * data cache and no last good copy stood behind it: the database was not asked, on purpose, and
 * the read is being refreshed in the background. A route handler rather than a page because it
 * must say `200` with `Retry-After` (a crawler then comes back later instead of indexing an error),
 * and because it must read nothing — no database, no data cache, no layout that does either.
 *
 * Both languages on one page: the reader arrives from either, and the address it came from is the
 * only thing it carries (`back`, a path on this site — `safeBackPath` refuses anything else). The
 * page goes back there by itself after `Retry-After`, and offers the link at once.
 */
export const dynamic = "force-dynamic";

const escape = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

export async function GET(request: Request): Promise<Response> {
  const back = safeBackPath(new URL(request.url).searchParams.get("back"));
  const sections = await Promise.all(
    routing.locales.map(async (locale) => {
      const t = await getTranslations({ locale, namespace: "Offline" });
      return `<section lang="${locale}"><h1>${escape(t("reloadingTitle"))}</h1><p>${escape(t("reloadingBody"))}</p><p><a href="${escape(back)}">${escape(t("reloadingLink"))}</a></p></section>`;
    }),
  );

  const html = `<!doctype html>
<html lang="${routing.defaultLocale}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<meta http-equiv="refresh" content="${RESTING_RETRY_SECONDS};url=${escape(back)}">
<title>${escape((await getTranslations({ locale: routing.defaultLocale, namespace: "Offline" }))("reloadingTitle"))}</title>
<style>
:root { color-scheme: light dark; }
body { margin: 0; padding: 32px 16px; font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; line-height: 1.5; }
main { max-width: 40rem; margin: 0 auto; }
section + section { margin-top: 32px; padding-top: 24px; border-top: 1px solid rgba(127, 127, 127, 0.4); }
h1 { font-size: 1.375rem; margin: 0 0 8px; }
a { display: inline-block; min-height: 44px; line-height: 44px; }
</style>
</head>
<body><main data-testid="resting-page">${sections.join("")}</main></body>
</html>`;

  return new Response(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Retry-After": String(RESTING_RETRY_SECONDS),
      "Cache-Control": "no-store, max-age=0",
      "X-Robots-Tag": "noindex",
    },
  });
}
