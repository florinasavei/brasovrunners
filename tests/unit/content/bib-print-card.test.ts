import { type ComponentProps, createElement, type ReactElement } from "react";
import { renderToReadableStream } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { BIB_DOWNLOAD_FORM } from "@/modules/content/events/ui/boxes/BibPrint";

/**
 * BR-REQ-038-01, §NNN — «Alocare și tipărire». The owner, 2026-10-13: «nu înțeleg ce face butonul de
 * „Alocă numerele"… îmi trebuie ceva tooltip pt el». The button says what it does on hover and behind a
 * «?» a thumb can tap, in plain words; «De la» and «Până la» belong to the PDF, under their own heading
 * beside the download buttons, apart from the allocation — the GET form they post to unchanged.
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
  return { Link: ({ children }: { children: unknown }) => h("a", { href: "/admin/events/x/bibs" }, children as string), getPathname: () => "/" };
});

const { BibPrintCard } = await import("@/modules/content/events/ui/boxes/BibPrint");

async function render(props: Partial<Parameters<typeof BibPrintCard>[0]> = {}, language: "ro" | "en" = "ro") {
  locale = language;
  const element = await BibPrintCard({ eventId: "11111111-1111-4111-8111-111111111111", total: 12, unprinted: 0, mayAssign: true, onlyTest: false, attention: false, ...props });
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

describe("§NNN «Alocă numerele» says what it does", () => {
  it("carries the plain words on the button's tooltip and behind its «?», in both languages", async () => {
    const html = await render();
    const row = block(html, "bib-assign-row");
    expect(row).toContain("Alocă numerele");
    const words = `${ro.Admin.bibs.assignHelp}\n${ro.Admin.bibs.assignHelpMore}`;
    // The «?» names it for a screen reader and a thumb; the tooltip's title is the same text.
    expect(row).toContain(`aria-label="${words}"`);
    expect(row).toContain('data-testid="bib-assign-help"');
    for (const fact of ["în ordinea confirmării", "de la primul număr al cursei", "nu primește altul", "Testele nu primesc"]) {
      expect(words).toContain(fact);
    }
    const english = block(await render({}, "en"), "bib-assign-row");
    // React writes an attribute's apostrophe as an entity.
    expect(english).toContain(`aria-label="${en.Admin.bibs.assignHelp}\n${en.Admin.bibs.assignHelpMore}"`.replace(/'/g, "&#x27;"));
    for (const fact of ["in order of confirmation", "from the race's first number", "Nobody who has a number gets another", "Test ones get none"]) {
      expect(`${en.Admin.bibs.assignHelp} ${en.Admin.bibs.assignHelpMore}`).toContain(fact);
    }
  });

  it("is drawn only for whoever may assign", async () => {
    expect(await render({ mayAssign: false })).not.toContain('data-testid="bib-assign-row"');
  });
});

describe("§NNN «De la» and «Până la» belong to the PDF", () => {
  it("sits under its own heading with the two download buttons, apart from the allocation, posting to the sheet's form", async () => {
    const html = await render();
    const range = block(html, "bib-print-range");
    expect(range).toMatch(/<h5[^>]*>[\s\S]*?data-testid="PrintIcon"[\s\S]*?Tipărește doar numerele de la … până la …/);
    // The two boxes and the two buttons, all naming the sheet's GET form.
    expect(range).toMatch(new RegExp(`<input[^>]*name="from"[^>]*form="${BIB_DOWNLOAD_FORM}"|<input[^>]*form="${BIB_DOWNLOAD_FORM}"[^>]*name="from"`));
    expect(range).toMatch(new RegExp(`<input[^>]*name="to"[^>]*form="${BIB_DOWNLOAD_FORM}"|<input[^>]*form="${BIB_DOWNLOAD_FORM}"[^>]*name="to"`));
    expect(range).toContain("Descarcă");
    expect(range).toContain(ro.Admin.bibs.downloadOnePerPage);
    // The allocation is not in the range's block, and comes before it.
    expect(range).not.toContain("Alocă numerele");
    expect(html.indexOf('data-testid="bib-assign-row"')).toBeLessThan(html.indexOf('data-testid="bib-print-range"'));
  });

  it("is not drawn while no number exists", async () => {
    expect(await render({ total: 0 })).not.toContain('data-testid="bib-print-range"');
  });
});
