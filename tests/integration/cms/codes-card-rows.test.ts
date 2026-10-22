import { createTranslator } from "next-intl";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import ro from "../../../messages/ro.json";
import type { AdminDiscountCode } from "@/modules/content/member-codes/repository";
import { withClientWords } from "../../helpers/client-words";

/**
 * §552, drawn by §842 (wave 2) — «Coduri de reducere» on «Pagini» → «Membri» as the house's row folds: the card a `Panel`,
 * each code a row whose line is the partner, the code, its state, its last day and who it is for, with the pencil — the
 * `<summary>` of a fold that holds the code's boxes, then ↑ ↓ and «Ascunde», «Șterge» last. «Adaugă un cod» is the blank
 * boxes in a fold of their own after the list, open by itself only while there is no code. Every form with a required box
 * keeps its submit inside the same fold. The roles: the Administrator manages, the Redactor writes the words (BR-REQ-060-01
 * is the service's; this pins what is drawn).
 */
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }), headers: async () => new Headers() }));
vi.mock("@/auth", () => ({ auth: async () => null, signIn: async () => {}, signOut: async () => {} }));
vi.mock("@/app/[locale]/admin/pages/members/actions", () => ({
  createDiscountCodeAction: async () => null,
  deleteDiscountCodeAction: async () => null,
  moveDiscountCodeAction: async () => {},
  saveDiscountCodeAction: async () => null,
  setDiscountCodeHiddenAction: async () => null,
}));

const { default: CodesCard } = await import("@/app/[locale]/admin/pages/members/CodesCard");

const words = createTranslator({ locale: "ro", messages: ro, namespace: "Admin" });
const refusals = { errors: {}, fields: {}, fieldsIntro: "", fieldError: "", kept: "", keptConflict: "" };

const code = (id: string, overrides: Partial<AdminDiscountCode> = {}): AdminDiscountCode =>
  ({
    id,
    partnerName: "Magazinul",
    code: "BVR15",
    descriptionRo: "15% la încălțăminte.",
    descriptionEn: "15% off shoes.",
    link: null,
    validUntil: null,
    hidden: false,
    tierIds: null,
    version: 1,
    ...overrides,
  }) as AdminDiscountCode;

const CODES = [
  code("11111111-1111-4111-8111-111111111111", { partnerName: "Magazinul", code: "BVR15", validUntil: "2026-12-31" }),
  code("22222222-2222-4222-8222-222222222222", { partnerName: "Sala", code: "SALA10", hidden: true }),
];

function render(props: { codes?: readonly AdminDiscountCode[]; mayManage?: boolean; mayEditWords?: boolean } = {}) {
  const node = CodesCard({
    codes: props.codes ?? CODES,
    today: "2026-10-22",
    locale: "ro",
    words,
    cancel: "Renunță",
    messages: refusals,
    mayManage: props.mayManage ?? true,
    mayEditWords: props.mayEditWords ?? true,
    tiers: [],
  } as never);
  return renderToStaticMarkup(withClientWords(node, "ro")).replaceAll("&#x27;", "'");
}

/** The `<details>` of the markup as [start, end) ranges, nested ones included. */
function foldRanges(html: string): [number, number][] {
  const ranges: [number, number][] = [];
  const open: number[] = [];
  for (const match of html.matchAll(/<details\b|<\/details>/g)) {
    if (match[0] === "</details>") ranges.push([open.pop() ?? 0, (match.index ?? 0) + match[0].length]);
    else open.push(match.index ?? 0);
  }
  return ranges;
}

/** A code's row, by its id. */
function rowOf(html: string, id: string): string {
  const start = html.indexOf(`id="code-${id}"`);
  const from = html.lastIndexOf("<li", start);
  // The row's own `</li>` follows its fold's `</details>`; the tier chips draw no list of their own.
  return html.slice(from, html.indexOf("</li>", html.indexOf("</details>", start)) + "</li>".length);
}

describe("§842 «Coduri de reducere» as row folds", () => {
  it("is one card, closed, its count on its line, with the codes' glyph", () => {
    const html = render();
    expect(html).toMatch(/<details[^>]*id="members-codes"[^>]*data-testid="members-codes"(?![^>]*\sopen)/);
    expect(html).toMatch(/<h2[^>]*>[\s\S]*?data-testid="LocalOfferIcon"[\s\S]*?Coduri de reducere[\s\S]*?2 coduri/);
  });

  it("says each code in words on a closed line: the partner, the code, its state, its day, who it is for, and the pencil", () => {
    const html = render();
    const first = rowOf(html, CODES[0].id);
    expect(first).toMatch(/<details[^>]*data-testid="code-row-edit"(?![^>]*\sopen)[^>]*>/);
    const summary = first.slice(first.indexOf("<summary"), first.indexOf("</summary>"));
    expect(summary).toContain('data-testid="code-row-toggle"');
    expect(summary).toContain('title="Modifică"');
    expect(summary).toMatch(/data-testid="code-partner"[^>]*>Magazinul</);
    expect(summary).toMatch(/data-testid="code-code"[^>]*>BVR15</);
    expect(summary).toContain(ro.Admin.members.codes.shown);
    expect(summary).toContain("Până ");
    expect(summary).toMatch(/data-testid="code-tiers-chip"[\s\S]*Pentru: Toți membrii/);
    expect(summary).toContain('data-testid="EditIcon"');
    expect(summary).not.toMatch(/<a\s|<button|<input/);
    // A hidden code says so on its line.
    const second = rowOf(html, CODES[1].id);
    expect(second.slice(second.indexOf("<summary"), second.indexOf("</summary>"))).toContain(ro.Admin.members.codes.hidden);
  });

  it("opens onto the boxes, then the moves and «Ascunde», then «Șterge» last", () => {
    const html = render();
    const row = rowOf(html, CODES[0].id);
    const body = row.slice(row.indexOf("</summary>"));
    const partner = body.indexOf('name="partnerName"');
    const save = body.indexOf(">Salvează<");
    const down = body.indexOf("Mai jos: codul Magazinul");
    const hide = body.indexOf(">Ascunde<");
    const erase = body.indexOf(">Șterge<");
    expect(partner).toBeGreaterThan(-1);
    expect(save).toBeGreaterThan(partner);
    expect(down).toBeGreaterThan(save);
    expect(hide).toBeGreaterThan(down);
    expect(erase).toBeGreaterThan(hide);
    expect(body).not.toContain("Mai sus: codul Magazinul");
    expect(rowOf(html, CODES[1].id)).toContain(">Arată<");
  });

  it("puts «Adaugă un cod» after the list, closed while there are codes and open by itself when there is none", () => {
    const html = render();
    expect(html).toMatch(/<details[^>]*data-testid="code-add-fold"(?![^>]*\sopen)[^>]*>/);
    expect(html.indexOf('data-testid="code-add-fold"')).toBeGreaterThan(html.indexOf(`id="code-${CODES[1].id}"`));
    const empty = render({ codes: [] });
    expect(empty).toMatch(/<details[^>]*data-testid="code-add-fold"[^>]*\sopen/);
    expect(empty).toContain('data-testid="codes-empty"');
  });

  it("gives the Redactor the boxes of the words and no verb; a role with neither, the line alone", () => {
    const words = render({ mayManage: false });
    expect(words).not.toContain('data-testid="code-add-fold"');
    expect(words).not.toContain(">Șterge<");
    expect(words).not.toContain(">Ascunde<");
    expect(words).toContain('name="partnerName"');
    expect(words).toContain(ro.Admin.members.codes.wordsOnly);
    const none = render({ mayManage: false, mayEditWords: false });
    expect(none).not.toContain('data-testid="code-row-edit"');
    expect(none).not.toContain("<form");
    expect(none).toMatch(/data-testid="code-partner"[^>]*>Magazinul</);
  });

  it("never leaves a required box in a closed fold without its submit beside it", () => {
    const html = render();
    expect(html).not.toMatch(/\sform="/);
    const folds = foldRanges(html);
    const forms = [...html.matchAll(/<form\b[\s\S]*?<\/form>/g)];
    const required = forms.filter((form) => /\srequired(=|\s|>)/.test(form[0]));
    // The add form and the two codes' own forms.
    expect(required).toHaveLength(3);
    for (const form of required) {
      expect(form[0]).toMatch(/<button[^>]*type="submit"/);
      const at = form.index ?? 0;
      // Inside the code's own fold (or «Adaugă un cod»), not merely the card: the innermost fold around the form holds it whole.
      const inner = folds.filter(([start, end]) => start < at && at < end).sort((a, b) => b[0] - a[0])[0];
      expect(inner).toBeDefined();
      expect(at + form[0].length).toBeLessThanOrEqual(inner[1]);
      expect(html.slice(inner[0], inner[0] + 200)).toMatch(/data-testid="(code-row-edit|code-add-fold)"/);
    }
  });
});
