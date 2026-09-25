/**
 * Open-Meteo's addresses, held in this one module (§402): its own site, which the forecast's credit
 * links to — its data is published under CC BY 4.0, whose one condition is that the source is
 * named, on the page as a link, in the reminder as a word — and its forecast API, which the server
 * asks (`source.ts`). The site is the one literal, a third party's fixed host listed in
 * `scripts/docs-check.mjs` (AGENTS.md §8); the API is derived from it, on its `api.` subdomain.
 */
export const OPEN_METEO_SITE = "https://open-meteo.com/";

/** The forecast API's origin: the site's host under `api.`, never a second literal. */
export const OPEN_METEO_API = `https://api.${new URL(OPEN_METEO_SITE).host}`;
