import { describe, expect, it } from "vitest";
import clubEn from "@club/messages/en.json";
import clubRo from "@club/messages/ro.json";
import baseEn from "../../../messages/en.json";
import baseRo from "../../../messages/ro.json";
import { CLUB } from "@/club/config";
import { catalogueOf, mergeCatalogue, unstamped } from "@/i18n/catalogue";

/**
 * BR-REQ-101-01 (§NNN): the platform's catalogues (`messages/<locale>.json`) are neutral, and this club's own sentences —
 * its home page, its places, its history, its plan — are `club/messages/<locale>.json`, laid over them by
 * `src/i18n/catalogue.ts`. The overlay may only say again, in the club's words, what the platform already says: every key
 * it holds is a key of the platform's catalogue, with the same arguments, in both languages, under the club's stamp.
 *
 * One sub-tree is the club's alone and has no platform sentence under it: `OVERLAY_ONLY` — a section a page draws only
 * when the club's overlay carries it (`/admin/design`'s «Planul», `PlanSection`), so a club without one simply has none.
 */
const OVERLAY_ONLY = ["Admin.design.plan"];

type Tree = { [key: string]: unknown };

/** Every leaf by its dotted key; an array is one leaf (it replaces whole). */
function leaves(value: unknown, prefix = ""): Record<string, string | string[]> {
  if (typeof value === "string" || Array.isArray(value)) return { [prefix]: value as string | string[] };
  if (!value || typeof value !== "object") return {};
  return Object.assign({}, ...Object.entries(value).map(([key, child]) => leaves(child, prefix ? `${prefix}.${key}` : key)));
}

/** The arguments a message names — `{club}`, `{count, plural…}` — sorted, as `i18n/messages.test.ts` reads them. */
const argumentsOf = (message: string) => [...message.matchAll(/\{(\w+)/g)].map((match) => match[1]).sort();
/** Each string's arguments, in order — a list's items one by one, and the strings inside a list of objects (the staff guide's sections) too. */
const argumentsOfLeaf = (leaf: unknown): string[][] =>
  typeof leaf === "string" ? [argumentsOf(leaf)] : Array.isArray(leaf) ? leaf.flatMap(argumentsOfLeaf) : leaf && typeof leaf === "object" ? Object.values(leaf).flatMap(argumentsOfLeaf) : [];

const overlayOnly = (key: string) => OVERLAY_ONLY.some((root) => key === root || key.startsWith(`${root}.`));

const OVERLAY = { ro: unstamped(clubRo, CLUB.slug), en: unstamped(clubEn, CLUB.slug) };
const BASE = { ro: leaves(baseRo), en: leaves(baseEn) };

describe("BR-REQ-101-01: the club's own sentences overlay the platform's neutral catalogue (§NNN)", () => {
  it("is stamped with this club's slug, and refuses another club's overlay", () => {
    expect((clubRo as Tree).$club).toBe(CLUB.slug);
    expect((clubEn as Tree).$club).toBe(CLUB.slug);
    expect(() => unstamped({ $club: "someone-else", Home: {} }, CLUB.slug)).toThrow(/another club/);
    expect(() => unstamped({ Home: {} }, CLUB.slug)).toThrow(/\$club/);
    expect(unstamped({ $club: CLUB.slug, Home: { a: "b" } }, CLUB.slug)).toEqual({ Home: { a: "b" } });
  });

  it("holds the same keys in Romanian and English", () => {
    expect(Object.keys(leaves(OVERLAY.en)).sort()).toEqual(Object.keys(leaves(OVERLAY.ro)).sort());
  });

  it("says again only what the platform says: every overlay key is a key of the platform's catalogue, but the club-only sub-tree", () => {
    for (const locale of ["ro", "en"] as const) {
      const strays = Object.keys(leaves(OVERLAY[locale])).filter((key) => !overlayOnly(key) && !(key in BASE[locale]));
      expect(strays, `club/messages/${locale}.json`).toEqual([]);
      // and the club-only sub-tree is the overlay's alone: the platform has nothing there to overlay
      for (const root of OVERLAY_ONLY) expect(Object.keys(BASE[locale]).filter((key) => key.startsWith(`${root}.`)), root).toEqual([]);
    }
  });

  it("gives each overlay sentence the arguments of the platform's sentence it replaces — and of its other language", () => {
    for (const locale of ["ro", "en"] as const) {
      for (const [key, leaf] of Object.entries(leaves(OVERLAY[locale]))) {
        if (overlayOnly(key)) continue;
        const base = BASE[locale][key];
        expect(Array.isArray(leaf), `${locale} ${key}: a list replaces a list`).toBe(Array.isArray(base));
        expect(argumentsOfLeaf(leaf), `${locale} ${key}`).toEqual(argumentsOfLeaf(base));
      }
    }
    for (const [key, leaf] of Object.entries(leaves(OVERLAY.ro))) expect(argumentsOfLeaf(leaves(OVERLAY.en)[key]), key).toEqual(argumentsOfLeaf(leaf));
  });

  it("keeps the platform's two catalogues in step with each other: the same keys, the same arguments", () => {
    expect(Object.keys(BASE.en).sort()).toEqual(Object.keys(BASE.ro).sort());
    for (const [key, leaf] of Object.entries(BASE.ro)) expect(argumentsOfLeaf(BASE.en[key]), key).toEqual(argumentsOfLeaf(leaf));
  });

  it("merges objects key by key and lets a string or a list replace the platform's whole, writing to neither", () => {
    const base = { A: { a: "1", b: "2", list: ["x", "y"] }, B: { c: "3" } };
    const overlay = { A: { b: "two", list: ["z"] }, C: { d: "4" } };
    const frozen = JSON.stringify(base);
    const merged = mergeCatalogue(base, overlay);
    expect(merged).toEqual({ A: { a: "1", b: "two", list: ["z"] }, B: { c: "3" }, C: { d: "4" } });
    expect(JSON.stringify(base)).toBe(frozen);
    expect(merged.B).toBe(base.B);
  });

  it("is what a page reads: the club's sentence where it has one, the platform's everywhere else", () => {
    for (const locale of ["ro", "en"] as const) {
      const merged = leaves(catalogueOf(locale));
      const overlay = leaves(OVERLAY[locale]);
      for (const [key, leaf] of Object.entries(overlay)) expect(merged[key], key).toEqual(leaf);
      for (const [key, leaf] of Object.entries(BASE[locale])) if (!(key in overlay)) expect(merged[key], key).toEqual(leaf);
      expect(catalogueOf(locale)).toBe(catalogueOf(locale));
    }
  });
});
