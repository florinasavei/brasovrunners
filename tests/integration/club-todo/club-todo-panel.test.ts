import { createTranslator } from "next-intl";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import ro from "../../../messages/ro.json";
import type { ClubTodoItem } from "@/modules/club-todo/domain/club-todo";
import { withClientWords } from "../../helpers/client-words";

/**
 * §438, drawn by §842 (wave 2) — «De făcut», the club's own checklist, as the event to-dos' row (§749): one `TodoLine` per
 * line — the tick, a form of its own beside the fold, then the line in words (the text, «Pentru …» and the day as the event
 * rows' chips, the pencil) as the `<summary>` of its fold — whose body holds the door to the editor the line names (§538),
 * ↑ and ↓, the three boxes and «Șterge», last. A reader's line is the words and the chips alone. «Adaugă un rând» is a fold
 * open by itself only while the list is empty. Every form with a required box keeps its submit inside the same fold
 * (BR-REQ-060-01 is the actions'; nothing here needs a script).
 */
vi.mock("@/shared/feedback/email-roads-request", () => ({ emailRoadsForThisRequest: async () => ({ groups: { links: "mailgun", confirmations: "mailgun", reminders: "mailgun", announcements: "mailgun", club: "gmail", newsletter: "mailgun" }, gmail: false }) }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }), headers: async () => new Headers() }));
vi.mock("@/auth", () => ({ auth: async () => null, signIn: async () => {}, signOut: async () => {} }));
vi.mock("@/app/[locale]/admin/tasks/actions", () => ({
  addClubTodoAction: async () => null,
  deleteClubTodoAction: async () => null,
  editClubTodoAction: async () => null,
  moveClubTodoAction: async () => {},
  setClubTodoDoneAction: async () => {},
}));
vi.mock("next-intl/server", () => ({
  setRequestLocale: () => {},
  getLocale: async () => "ro",
  getMessages: async () => ro,
  getTranslations: async (namespace: string) => createTranslator({ locale: "ro", messages: (ro as unknown as Record<string, Record<string, string>>)[namespace], namespace: undefined }),
}));

const { default: ClubTodoPanel } = await import("@/modules/club-todo/ui/ClubTodoPanel");

const line = (id: string, text: string, overrides: Partial<ClubTodoItem> = {}): ClubTodoItem => ({
  id,
  text,
  owner: null,
  done: false,
  doneAt: null,
  by: null,
  createdAt: "2026-10-01T10:00:00.000Z",
  due: null,
  order: 1,
  ...overrides,
});

const ITEMS: ClubTodoItem[] = [
  line("a", "Cardurile pentru voluntari", { owner: "Organizator", due: "2026-10-10", order: 1 }),
  line("start-admin-team-page", ro.Admin.clubTodo.defaults.teamPage.text, { owner: "Administrator", order: 2 }),
  line("c", "Gata de mult", { done: true, doneAt: "2026-10-12T08:00:00.000Z", by: "Ana Admin", order: 3 }),
];

async function render(props: { items?: readonly ClubTodoItem[]; mayEdit?: boolean } = {}) {
  const node = await ClubTodoPanel({ locale: "ro", items: props.items ?? ITEMS, mayEdit: props.mayEdit ?? true, owner: undefined, today: "2026-10-22" });
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

/** A row's markup, by its line's id. */
function rowOf(html: string, id: string): string {
  const start = html.indexOf(`data-item-id="${id}"`);
  const from = html.lastIndexOf("<li", start);
  return html.slice(from, html.indexOf("</li>", start) + "</li>".length);
}

describe("§842 the club's «De făcut» as the event to-dos' row", () => {
  it("draws each line as the tick beside a closed fold whose summary is the words, the chips and the pencil", async () => {
    const html = await render();
    const row = rowOf(html, "a");
    // The tick: a 44-pixel checkbox, its own form, outside the fold.
    expect(row).toMatch(/<form[^>]*data-testid="club-todo-tick-form"/);
    expect(row).toMatch(/<button[^>]*role="checkbox"[^>]*aria-checked="false"/);
    expect(row).toContain('aria-label="Bifează: Cardurile pentru voluntari"');
    expect(row).toContain('title="Bifează"');
    expect(row.indexOf('data-testid="club-todo-tick-form"')).toBeLessThan(row.indexOf("<details"));
    // The line: a closed fold, its summary the text, «Pentru …» and the day as chips, and the pencil.
    expect(row).toMatch(/<details[^>]*data-testid="club-todo-edit"(?![^>]*\sopen)[^>]*>/);
    const summary = row.slice(row.indexOf("<summary"), row.indexOf("</summary>"));
    expect(summary).toContain('data-testid="club-todo-edit-toggle"');
    expect(summary).toContain('title="Modifică"');
    expect(summary).toContain("Cardurile pentru voluntari");
    expect(summary).toMatch(/data-testid="club-todo-owner"[\s\S]*Pentru Organizator/);
    // Past its day: the event rows' word, the chip filled in the error colour.
    expect(summary).toMatch(/data-testid="club-todo-overdue" class="[^"]*MuiChip-filled[^"]*MuiChip-colorError/);
    expect(summary).toContain("Întârziat:");
    expect(summary).toContain('data-testid="EditIcon"');
    // Nothing that is a control of its own inside the summary: no link, no button.
    expect(summary).not.toMatch(/<a\s|<button/);
  });

  it("opens onto the door to the editor, ↑ and ↓, the boxes and «Șterge» last", async () => {
    const html = await render();
    const row = rowOf(html, "start-admin-team-page");
    const body = row.slice(row.indexOf("</summary>"));
    const door = body.indexOf('data-testid="club-todo-link"');
    const up = body.indexOf("Mai sus: ");
    const text = body.indexOf('name="text"');
    const save = body.indexOf(">Salvează<");
    const erase = body.indexOf(">Șterge<");
    expect(door).toBeGreaterThan(-1);
    expect(body).toContain('href="/ro/admin/pages/team"');
    expect(up).toBeGreaterThan(door);
    // The last open line has ↑ and no ↓.
    expect(body).not.toContain("Mai jos: ");
    expect(text).toBeGreaterThan(up);
    expect(save).toBeGreaterThan(text);
    expect(erase).toBeGreaterThan(save);
    // The first line has ↓ and no ↑.
    const first = rowOf(html, "a");
    expect(first).toContain("Mai jos: ");
    expect(first).not.toContain("Mai sus: ");
  });

  it("strikes a ticked line through under «Arată terminate», with who ticked it, and offers no move", async () => {
    const html = await render();
    expect(html).toMatch(/<details[^>]*data-testid="club-todo-done"/);
    expect(html).toContain("Arată terminate (1)");
    const row = rowOf(html, "c");
    expect(row).toMatch(/<button[^>]*role="checkbox"[^>]*aria-checked="true"/);
    expect(row).toContain('aria-label="Debifează: Gata de mult"');
    expect(row).toMatch(/data-testid="club-todo-text"[^>]*>Gata de mult/);
    expect(row).toContain("line-through");
    expect(row).toContain("Bifat de Ana Admin, ");
    expect(row).not.toContain("Mai sus");
    expect(row).not.toContain("Mai jos");
  });

  it("gives a reader the words and the chips alone — no tick, no fold, no pencil — and the door under the words", async () => {
    const html = await render({ mayEdit: false });
    expect(html).not.toContain('role="checkbox"');
    expect(html).not.toContain('data-testid="club-todo-edit"');
    expect(html).not.toContain('data-testid="club-todo-add"');
    for (const id of ["a", "c"]) {
      expect(rowOf(html, id)).not.toContain("<summary");
      expect(rowOf(html, id)).not.toContain('data-testid="EditIcon"');
    }
    const row = rowOf(html, "start-admin-team-page");
    expect(row).toContain('data-testid="club-todo-link"');
    expect(row).toContain("Pentru Administrator");
    expect(row).not.toContain("<form");
  });

  it("keeps «Adaugă un rând» closed while the list has lines, and opens it by itself on an empty list", async () => {
    expect(await render()).toMatch(/<details[^>]*data-testid="club-todo-add"(?![^>]*\sopen)[^>]*>/);
    expect(await render({ items: [] })).toMatch(/<details[^>]*data-testid="club-todo-add"[^>]*\sopen/);
  });

  it("never leaves a required box in a closed fold without its submit beside it", async () => {
    const html = await render();
    expect(html).not.toMatch(/\sform="/);
    const folds = foldRanges(html);
    const forms = [...html.matchAll(/<form\b[\s\S]*?<\/form>/g)];
    const required = forms.filter((form) => /\srequired(=|\s|>)/.test(form[0]));
    // The add form and the three lines' edit forms.
    expect(required).toHaveLength(4);
    for (const form of required) {
      expect(form[0]).toMatch(/<button[^>]*type="submit"/);
      // Inside a fold, wholly: the submit is seen whenever the boxes are.
      const at = form.index ?? 0;
      expect(folds.some(([start, end]) => start < at && at + form[0].length <= end)).toBe(true);
    }
  });
});
