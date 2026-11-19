import { type ComponentProps, createElement, type ReactElement } from "react";
import { renderToReadableStream } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import type { GivenSpareLine, SpareCard } from "@/modules/content/events/ui/boxes/BibPrint";

/**
 * §989, BR-REQ-038-01 — the spares already given, on «Numere de rezervă pentru înscrierile de la fața locului» (the owner,
 * 2026-11-19: «spre ex. 154 deja e la …»): under the reservation's line and how many are free, «N BIB-uri goale
 * date:» and one line a spare, lowest first, the whole line a link to the registration — «154 → Radu Pop» — the state
 * beside a line that is not confirmed. Names only; the card is drawn for whoever reads the bibs (the page's gate).
 */
const messages = { ro, en } as const;
let locale: "ro" | "en" = "ro";

vi.mock("next-intl/server", async () => {
  const { createTranslator } = await import("next-intl");
  return {
    getTranslations: async (namespace: string) => createTranslator({ locale, messages: messages[locale], namespace: namespace as "Admin" }),
    getLocale: async () => locale,
  };
});
vi.mock("@/i18n/navigation", async () => {
  const { createElement: h } = await import("react");
  // The path a real Link writes, so a line's link can be read: `{ pathname: "/admin/registrations/[id]", params }`.
  const hrefOf = (href: unknown): string => {
    if (typeof href === "string") return href;
    const { pathname, params } = href as { pathname: string; params?: Record<string, string> };
    return Object.entries(params ?? {}).reduce((path, [key, value]) => path.replace(`[${key}]`, value), pathname);
  };
  return { Link: ({ children, href }: { children: unknown; href: unknown }) => h("a", { href: hrefOf(href) }, children as string), getPathname: () => "/" };
});

const { BibPrintCard } = await import("@/modules/content/events/ui/boxes/BibPrint");

const RADU = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const BIANCA = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

async function render(spares: SpareCard, language: "ro" | "en" = "ro") {
  locale = language;
  const element = await BibPrintCard({ eventId: "11111111-1111-4111-8111-111111111111", total: 12, unprinted: 0, mayAssign: true, onlyTest: false, attention: false, spares });
  const { NextIntlClientProvider } = await import("next-intl");
  const stream = await renderToReadableStream(
    createElement(
      NextIntlClientProvider,
      { locale: language, messages: messages[language] } as unknown as ComponentProps<typeof NextIntlClientProvider>,
      element as ReactElement,
    ),
  );
  await stream.allReady;
  return new Response(stream).text();
}

/** The element that carries a test id, from its opening tag to its matching closing one. */
function block(html: string, testId: string): string {
  const at = html.indexOf(`data-testid="${testId}"`);
  expect(at, testId).toBeGreaterThan(-1);
  const start = html.lastIndexOf("<", at);
  const VOID = new Set(["input", "img", "br", "hr", "meta", "link", "source", "col", "area", "wbr"]);
  let depth = 0;
  for (const tag of html.slice(start).matchAll(/<(\/?)([a-zA-Z][\w-]*)([^>]*?)(\/?)>/g)) {
    const [, closing, name, , selfClosing] = tag;
    if (closing) depth -= 1;
    else if (!selfClosing && !VOID.has(name.toLowerCase())) depth += 1;
    if (depth === 0) return html.slice(start, start + (tag.index ?? 0) + tag[0].length);
  }
  return html.slice(start);
}

const given: GivenSpareLine[] = [
  { registrationId: RADU, number: "154", name: "Radu Pop", status: "CONFIRMED" },
  { registrationId: BIANCA, number: "155", name: "Bianca Pop", status: "CANCELLED" },
];
const card = (lines: GivenSpareLine[] = given, free = 8): SpareCard => ({ band: { from: 154, to: 163 }, free, nextFrom: 164, perPrint: 50, given: lines });

describe("§989 the spares given, on the spares' card", () => {
  it("lists each spare given lowest first, the whole line a link to the registration, under how many are still free", async () => {
    const html = block(await render(card()), "bib-spares");
    // How many are still free, the card's own line, before the list.
    expect(html).toContain("Rezervate pentru masă: 154–163, libere încă 8 din 10.");
    const list = block(html, "bib-spares-given");
    expect(html.indexOf('data-testid="bib-spares-state"')).toBeLessThan(html.indexOf('data-testid="bib-spares-given"'));
    expect(list).toContain("2 BIB-uri goale date:");
    expect(list).toContain(`<a href="/admin/registrations/${RADU}">154 → Radu Pop</a>`);
    expect(list).toContain(`<a href="/admin/registrations/${BIANCA}">155 → Bianca Pop</a>`);
    expect(list.indexOf("154 → Radu Pop")).toBeLessThan(list.indexOf("155 → Bianca Pop"));
    expect(list.match(/data-testid="bib-spares-given-line"/g)).toHaveLength(2);
    // A spare on a registration that is over says the state; a confirmed one says none.
    expect(block(list, "bib-spares-given-line")).not.toContain("Anulată");
    expect(list).toContain("Anulată");
    // A name, never an address.
    expect(list).not.toContain("@");
  });

  it("says it in English, one bib in the singular", async () => {
    const list = block(await render(card([given[0]]), "en"), "bib-spares-given");
    expect(list).toContain("1 blank bib given:");
    expect(list).toContain("154 → Radu Pop");
  });

  it("draws no list while no spare is given, and none before a reservation", async () => {
    expect(await render(card([]))).not.toContain('data-testid="bib-spares-given"');
    expect(await render({ band: null, free: 0, nextFrom: 1, perPrint: 50, given })).not.toContain('data-testid="bib-spares-given"');
  });

  it("reads every spare given and still says when every one is given", async () => {
    const html = block(await render(card(given, 0)), "bib-spares");
    expect(html).toContain("Rezervate pentru masă: 154–163, date toate.");
    expect(html).toContain("154 → Radu Pop");
  });
});
