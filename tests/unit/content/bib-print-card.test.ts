import { type ComponentProps, createElement, type ReactElement } from "react";
import { renderToReadableStream } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { BIB_DOWNLOAD_FORM } from "@/modules/content/events/ui/boxes/BibPrint";

/**
 * BR-REQ-038-01, §759 — «Alocare și tipărire». The owner, 2026-10-13: «nu înțeleg ce face butonul de
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

describe("§759 «Alocă numerele» says what it does", () => {
  it("carries the plain words on the button's tooltip and behind its «?», in both languages", async () => {
    const html = await render();
    const row = block(html, "bib-assign-row");
    expect(row).toContain("Alocă numerele");
    const words = `${ro.Admin.bibs.assignHelp}\n${ro.Admin.bibs.assignHelpMore}`;
    // The «?» names it for a screen reader and a thumb; the tooltip's title is the same text.
    expect(row).toContain(`aria-label="${words}"`);
    expect(row).toContain('data-testid="bib-assign-help"');
    // The special guests draw from their own series (`pickBibNumber`'s «hidden»), so «the race's first number» alone was not true.
    for (const fact of ["în ordinea confirmării", "de la primul număr liber al cursei", "invitații speciali, din seria lor", "nu primește altul", "Înscrierile de test nu primesc număr"]) {
      expect(words).toContain(fact);
    }
    const english = block(await render({}, "en"), "bib-assign-row");
    // React writes an attribute's apostrophe as an entity.
    expect(english).toContain(`aria-label="${en.Admin.bibs.assignHelp}\n${en.Admin.bibs.assignHelpMore}"`.replace(/'/g, "&#x27;"));
    for (const fact of ["in order of confirmation", "from the race's first free number", "special guests, from their own series", "Nobody gets a second", "Test registrations get none"]) {
      expect(`${en.Admin.bibs.assignHelp} ${en.Admin.bibs.assignHelpMore}`).toContain(fact);
    }
  });

  it("is drawn only for whoever may assign", async () => {
    expect(await render({ mayAssign: false })).not.toContain('data-testid="bib-assign-row"');
  });
});

describe("§759 «De la» and «Până la» belong to the PDF", () => {
  it("sits under its own heading with the two download buttons, apart from the allocation, posting to the sheet's form", async () => {
    const html = await render();
    const range = block(html, "bib-print-range");
    // A heading that names the print, never «doar» over a button that says «toate» (§759): the range is the help's.
    expect(range).toMatch(/<h5[^>]*>[\s\S]*?data-testid="PrintIcon"[\s\S]*?Tipărește numerele \(PDF\)/);
    expect(range).toContain("De la / Până la: doar o parte, de exemplu 1–50. Goale: toate.");
    expect(range).not.toMatch(/Tipărește doar/);
    expect(range).toContain("Descarcă toate numerele (PDF)");
    const english = block(await render({}, "en"), "bib-print-range");
    expect(english).toMatch(/<h5[^>]*>[\s\S]*?Print the numbers \(PDF\)/);
    expect(english).toContain("From / To: only part of them, 1–50 for example. Empty: all.");
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

describe("§895 «Elită — doar numele pe BIB» beside the spares", () => {
  const elite = {
    entries: [
      { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", name: "Eliud Kipchoge", bibNumber: 7 },
      { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", name: "Faith Kipyegon", bibNumber: null },
    ],
    previewSrc: "/api/admin/events/11111111-1111-4111-8111-111111111111/bibs/preview?sample=1&locale=ro&elite=1",
    downloadHref: "/api/admin/events/11111111-1111-4111-8111-111111111111/bibs?locale=ro&elite=1",
  };

  it("is a closed fold with how many on its closed line, the names with their numbers, the sheet and a sample", async () => {
    const html = await render({ elite });
    const card = block(html, "bib-elite");
    expect(card.startsWith("<details")).toBe(true);
    expect(card.slice(0, card.indexOf(">"))).not.toMatch(/\bopen\b/);
    expect(card).toMatch(/data-testid="MilitaryTechIcon"[\s\S]*?Elită — doar numele pe BIB/);
    expect(card).toContain("2 nume");
    expect(card).toContain("Eliud Kipchoge");
    expect(card).toContain("nr. 7");
    expect(card).toContain("Faith Kipyegon");
    // The sheet: a link-button with its glyph, 44 pixels tall, the count in its words.
    const download = block(card, "bib-elite-download");
    expect(download).toContain(`href="${elite.downloadHref.replace(/&/g, "&amp;")}"`);
    expect(download).toContain('data-testid="PictureAsPdfIcon"');
    expect(download).toContain("Descarcă BIB-urile de elită (2)");
    // One elite bib as it prints, from the preview route's `elite=1`.
    expect(block(card, "bib-elite-sample")).toContain(elite.previewSrc.replace(/&/g, "&amp;"));
    // Not a registration: the card says so.
    expect(card).toContain("Nu sunt înscrieri");
  });

  it("gives the Administrator the add form and each line's «Șterge», every control naming a form outside the save form", async () => {
    const card = block(await render({ elite }), "bib-elite");
    expect(card).toMatch(/<input[^>]*name="eliteName"[^>]*form="bib-elite-add"|<input[^>]*form="bib-elite-add"[^>]*name="eliteName"/);
    expect(card).toMatch(/<input[^>]*name="eliteNumber"[^>]*form="bib-elite-add"|<input[^>]*form="bib-elite-add"[^>]*name="eliteNumber"/);
    expect(card).toContain("Adaugă pe lista de elită");
    for (const entry of elite.entries) expect(card).toContain(`form="bib-elite-delete-${entry.id}"`);
    expect(card.match(/data-testid="DeleteIcon"/g)).toHaveLength(2);
  });

  it("is read-only for the Organizer: no add, no delete, the sheet still hers", async () => {
    const card = block(await render({ elite, mayAssign: false }), "bib-elite");
    expect(card).not.toContain('name="eliteName"');
    expect(card).not.toContain("bib-elite-delete-");
    expect(card).toContain(ro.Admin.bibs.eliteReadOnly);
    expect(card).toContain('data-testid="bib-elite-download"');
  });

  it("says the list is empty, offers no sheet, and is not drawn where no bib prints", async () => {
    const empty = block(await render({ elite: { ...elite, entries: [] } }), "bib-elite");
    expect(empty).toContain("nicio persoană");
    expect(empty).toContain('data-testid="bib-elite-empty"');
    expect(empty).not.toContain('data-testid="bib-elite-download"');
    expect(await render({ elite: null })).not.toContain('data-testid="bib-elite"');
    // In English too.
    expect(block(await render({ elite }, "en"), "bib-elite")).toContain("Elite — the name only on the bib");
  });

  // §897: a registration marked «Elită» on the registrations list prints on the same sheet, so the card lists it.
  it("lists the registrations marked «Elită» read-only, «înscris», in its count and its sheet's, and says where they are marked", async () => {
    const registered = [{ id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", name: "Ana Pop", bibNumber: 12 }];
    const card = block(await render({ elite: { ...elite, registered } }), "bib-elite");
    const line = block(card, "bib-elite-registered");
    expect(line).toContain("Ana Pop");
    expect(line).toContain("înscris");
    expect(line).toContain("nr. 12");
    // Read-only: no delete of its own, only the list's two.
    expect(line).not.toContain("bib-elite-delete-");
    expect(card.match(/data-testid="DeleteIcon"/g)).toHaveLength(2);
    expect(card).toContain("3 nume");
    expect(block(card, "bib-elite-download")).toContain("Descarcă BIB-urile de elită (3)");
    expect(block(card, "bib-elite-registered-help")).toContain("«Marchează ca elită»");
    // The ordinary sheet prints them too, elite-style: one line says so while there is one, so nobody prints them twice.
    expect(block(card, "bib-elite-registered-once")).toContain(ro.Admin.bibs.eliteRegisteredOnce);
    expect(block(await render({ elite }), "bib-elite")).not.toContain('data-testid="bib-elite-registered-once"');
    // A marked registration alone is still something to print: no «empty» line, the sheet offered.
    const alone = block(await render({ elite: { ...elite, entries: [], registered } }), "bib-elite");
    expect(alone).not.toContain('data-testid="bib-elite-empty"');
    expect(alone).toContain("1 nume");
    expect(alone).toContain('data-testid="bib-elite-download"');
    // In English too.
    expect(block(await render({ elite: { ...elite, registered } }, "en"), "bib-elite-registered")).toContain("registered");
  });

  it("opens itself and the print card on the way back from its own add or delete, and is closed otherwise", async () => {
    // `?saved=eliteAdded|eliteDeleted` (`actions.ts#backToEliteCard`): a soft navigation the hash opener never sees.
    const opened = await render({ elite, eliteSaved: true });
    expect(opened).toMatch(/<details[^>]*data-testid="bib-print"[^>]*open=""/);
    expect(opened).toMatch(/<details[^>]*data-testid="bib-elite"[^>]*open=""/);
    const closed = await render({ elite });
    expect(closed).not.toMatch(/<details[^>]*data-testid="bib-elite"[^>]*open=""/);
  });
});
