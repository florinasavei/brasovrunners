import clubEn from "@club/messages/en.json";
import clubRo from "@club/messages/ro.json";
import baseEn from "../../messages/en.json";
import baseRo from "../../messages/ro.json";
import { CLUB_SLUG } from "@/theme/brand";

/**
 * The words the platform says, as this club says them (§887): the platform's catalogue
 * (`messages/<locale>.json`, neutral — every club can live with it) with the club's own sentences
 * (`club/messages/<locale>.json`) laid over it. The **only** file under `src/` that imports either
 * (`tests/unit/club/import-surface.test.ts`): the request's configuration (`request.ts`) and every
 * reader outside a request — the legal texts' merge values, the emails' words, the calendar's —
 * read this, so a page, an email and a PDF never say two different things.
 *
 * The rules of the overlay (`club/README.md`): objects merge key by key, a string or an array replaces
 * the platform's whole, and the file carries a `"$club"` stamp — the club's `slug` — which is checked and
 * taken off before the merge, so an overlay copied from another club's folder fails loudly instead of
 * dressing this one in its words. Merged once per process and per language, sharing every sub-tree the
 * overlay does not touch with the platform's catalogue (nothing is copied but the path to a change).
 */

/** The catalogue's shape — the platform's, which every overlay key also has (`tests/unit/club/overlay.test.ts`). */
export type Catalogue = typeof baseRo;
export type CatalogueLocale = "ro" | "en";

type Tree = { [key: string]: unknown };

const isTree = (value: unknown): value is Tree => typeof value === "object" && value !== null && !Array.isArray(value);

/** Objects merge, strings and arrays replace; neither side is written to. */
export function mergeCatalogue<T>(base: T, overlay: unknown): T {
  if (!isTree(base) || !isTree(overlay)) return (overlay === undefined ? base : overlay) as T;
  const merged: Tree = { ...base };
  for (const [key, value] of Object.entries(overlay)) merged[key] = isTree(merged[key]) && isTree(value) ? mergeCatalogue(merged[key], value) : value;
  return merged as T;
}

/** The overlay without its `"$club"` stamp, which must name this club — else the folder is another club's. */
export function unstamped(overlay: unknown, slug: string, file = "club/messages"): Tree {
  if (!isTree(overlay)) throw new Error(`${file}: an overlay is a JSON object`);
  const { $club, ...words } = overlay;
  if ($club !== slug) throw new Error(`${file}: "$club" is ${JSON.stringify($club)}, but this club's slug is "${slug}" — the overlay belongs to another club`);
  return words;
}

const BASE: Record<CatalogueLocale, Catalogue> = { ro: baseRo, en: baseEn as Catalogue };
const CLUB: Record<CatalogueLocale, unknown> = { ro: clubRo, en: clubEn };
const merged: Partial<Record<CatalogueLocale, Catalogue>> = {};

/** The merged catalogue of a language — Romanian for anything but `en`, as every reader outside a request did. */
export function catalogueOf(locale: string): Catalogue {
  const language: CatalogueLocale = locale === "en" ? "en" : "ro";
  merged[language] ??= mergeCatalogue(BASE[language], unstamped(CLUB[language], CLUB_SLUG, `club/messages/${language}.json`));
  return merged[language];
}
