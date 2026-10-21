import { createTranslator } from "next-intl";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import type { PageTodo } from "@/modules/content/events/domain/page-todos";
import type { EventTodoItem } from "@/modules/event-todos/event-todos";
import { withClientWords } from "../../helpers/client-words";

/**
 * §749, amended by §752 — the card «De făcut pentru pagina evenimentului» as the editor draws it
 * (BR-REQ-050-01, BR-REQ-041-01 criterion 6): the closed line and when it opens by itself, two lists
 * — «Lipsește pe pagină», each row one link to the card that fills it, and «Sarcini», each row a tick
 * box, the words, the priority as a word (not the colour alone), who, by when and a pencil — the order,
 * «Gata» apart, «Ale mele», the role's forms and a reader's none. The forms are plain posts — nothing
 * here needs a script.
 */
const messages = { ro, en };
let language: "ro" | "en" = "ro";

// The dialogs' road line (§NNN) reads the club's roads once per request: no database here.
vi.mock("@/shared/feedback/email-roads-request", () => ({ emailRoadsForThisRequest: async () => ({ groups: { links: "mailgun", confirmations: "mailgun", reminders: "mailgun", announcements: "mailgun", club: "gmail", newsletter: "mailgun" }, gmail: false }) }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }), headers: async () => new Headers() }));
vi.mock("@/auth", () => ({ auth: async () => null, signIn: async () => {}, signOut: async () => {} }));
vi.mock("@/app/[locale]/admin/events/[id]/todo-actions", () => ({
  addEventTodoAction: async () => null,
  editEventTodoAction: async () => null,
  deleteEventTodoAction: async () => null,
  setEventTodoDoneAction: async () => null,
}));
vi.mock("next-intl/server", () => ({
  setRequestLocale: () => {},
  getLocale: async () => language,
  getMessages: async () => messages[language],
  getTranslations: async (namespace: string | { namespace: string }) => {
    const path = typeof namespace === "string" ? namespace : namespace.namespace;
    const scoped = path.split(".").reduce<unknown>((node, key) => (node as Record<string, unknown>)[key], messages[language]) as Record<string, string>;
    return createTranslator({ locale: language, messages: scoped, namespace: undefined });
  },
}));

const { default: EventTodoCard } = await import("@/modules/event-todos/ui/EventTodoCard");

const EVENT = "11111111-1111-4111-8111-111111111111";
const ME = "22222222-2222-4222-8222-222222222222";

const page = (id: string, rule: PageTodo["rule"], priority: PageTodo["priority"], anchor: PageTodo["anchor"], locale: string | null = null): PageTodo => ({ id, rule, locale, priority, anchor });
const item = (id: string, text: string, overrides: Partial<EventTodoItem> = {}): EventTodoItem => ({
  id,
  eventId: EVENT,
  text,
  priority: "NORMAL",
  assigneeStaffUserId: null,
  assigneeName: null,
  dueOn: null,
  doneAt: null,
  doneByName: null,
  createdAt: new Date("2026-10-05T10:00:00.000Z"),
  ...overrides,
});

const base = {
  locale: "ro" as const,
  eventId: EVENT,
  staff: [
    { id: ME, name: "Ana Admin" },
    { id: "33333333-3333-4333-8333-333333333333", name: "Oana Organizator" },
  ],
  languageNames: { ro: "Română", en: "English" },
  mayEdit: true,
  currentStaffId: ME,
  mine: false,
  today: "2026-10-13",
};

async function render(props: Partial<Parameters<typeof EventTodoCard>[0]> & Pick<Parameters<typeof EventTodoCard>[0], "computed" | "items">) {
  return renderToStaticMarkup(withClientWords(await EventTodoCard({ ...base, ...props }), language));
}

/** The text of every row of the open list, in the order it is drawn. */
const order = (html: string) => [...html.matchAll(/data-testid="(event-todo-page-row|event-todo-item)"[^>]*?(?:data-rule="([^"]*)"|data-item-id="([^"]*)")/g)].map((match) => match[2] ?? match[3]);

describe("§749 the card «De făcut pentru pagina evenimentului»", () => {
  it("says «N de făcut» on its closed line and opens by itself while anything is left", async () => {
    const html = await render({ computed: [page("cover", "cover", "NORMAL", "box-cover")], items: [item("a", "Sună la primărie")] });
    expect(html).toContain("De făcut pentru pagina evenimentului");
    expect(html).toContain("2 de făcut");
    expect(html).toMatch(/<details[^>]*id="box-todos"[^>]*open/);
  });

  it("stays closed, saying nothing is left, when there is nothing to do", async () => {
    const html = await render({ computed: [], items: [item("done", "Gata de mult", { doneAt: new Date("2026-10-10T08:00:00.000Z"), doneByName: "Ana Admin" })] });
    expect(html).toContain("nimic de făcut");
    expect(html).not.toMatch(/<details[^>]*id="box-todos"[^>]*open/);
    expect(html).toContain("Gata (1)");
  });

  it("puts a computed row under «Lipsește pe pagină» as one link to the card that fills it, with no tick, edit or delete", async () => {
    const html = await render({ computed: [page("cover", "cover", "NORMAL", "box-cover")], items: [] });
    expect(html).toContain("Lipsește pe pagină");
    expect(html).toContain('data-testid="event-todo-page-row"');
    expect(html).toContain("Evenimentul nu are fotografie de copertă.");
    // The row is the link: the words are inside the `<a>`, and its name says what it does.
    expect(html).toMatch(/<a [^>]*href="#box-cover"[^>]*data-testid="event-todo-fill"|<a [^>]*data-testid="event-todo-fill"[^>]*href="#box-cover"/);
    expect(html).toContain("Deschide câmpul: Evenimentul nu are fotografie de copertă.");
    expect(html).not.toContain("din pagină");
    expect(html).not.toContain("Șterge");
    expect(html).not.toContain('role="checkbox"');
  });

  it("draws a typed row as a tick box, the words, and the small facts on its line — no «Bifează» button, no panel", async () => {
    const html = await render({ computed: [], items: [item("a", "Banda cu sponsori", { priority: "HIGH", assigneeStaffUserId: ME, assigneeName: "Dani", dueOn: "2026-10-30" })] });
    expect(html).toContain("Sarcini");
    // A real tick box: a submit that carries the state it wants, in a form of its own.
    expect(html).toMatch(/<button[^>]*role="checkbox"[^>]*aria-checked="false"/);
    expect(html).toContain('aria-label="Bifează: Banda cu sponsori"');
    expect(html).toContain('name="done" value="1"');
    expect(html).not.toContain(">Bifează<");
    // The facts: the priority's word, who, the day.
    expect(html).toContain(">Mare<");
    expect(html).toContain("Pentru Dani");
    expect(html).toMatch(/Termen: [^<]*30 oct/);
    // The pencil: the line is the summary of the row's edit form, named for a screen reader.
    expect(html).toContain('data-testid="event-todo-edit-toggle"');
    // The edit line is named by what it shows (the words, the priority, who, the day, «Întârziat»), «Modifică» its description.
    expect(html).toContain('title="Modifică"');
    expect(html).not.toContain('aria-label="Modifică: ');
    expect(html).toContain('title="Modifică"');
  });

  it("adds in one line — the words, the priority, «Adaugă» — and keeps who and the day behind «Mai multe»", async () => {
    const html = await render({ computed: [], items: [] });
    const add = html.slice(html.indexOf('data-testid="event-todo-add"'));
    expect(add).toContain("Adaugă o sarcină");
    expect(add).toContain('name="text"');
    expect(add).toContain('name="priority"');
    expect(add).toContain("Mai multe: cine, termen");
    // «Cine» and «Termen» are inside the «Mai multe» fold, after the add button.
    expect(add.indexOf('name="assignee"')).toBeGreaterThan(add.indexOf("Mai multe: cine, termen"));
    expect(add.indexOf('name="due"')).toBeGreaterThan(add.indexOf("Mai multe: cine, termen"));
    // A short line, not a paragraph: the long explanation is behind the «?».
    expect(html).toContain("Ce lipsește paginii și ce are echipa de făcut.");
    expect(html).toContain('data-testid="quiet-help"');
  });

  it("names the language of a per-language row", async () => {
    const html = await render({ computed: [page("title:en", "title", "HIGH", "box-title", "en")], items: [] });
    expect(html).toContain("Titlul lipsește în English.");
  });

  it("draws each priority as a word, never the colour alone", async () => {
    const html = await render({
      computed: [],
      items: [item("u", "u", { priority: "URGENT" }), item("h", "h", { priority: "HIGH" }), item("n", "n"), item("l", "l", { priority: "LOW" })],
    });
    for (const word of ["Urgentă", "Mare", "Normală", "Mică"]) expect(html).toContain(`>${word}<`);
  });

  it("lists each list in one order: priority, then the due day, then age — «Lipsește pe pagină» first, then «Sarcini»", async () => {
    const html = await render({
      computed: [page("declaration", "declaration", "URGENT", "box-declaration"), page("cover", "cover", "NORMAL", "box-cover")],
      items: [
        item("low", "low", { priority: "LOW" }),
        item("urgent-dated", "urgent dated", { priority: "URGENT", dueOn: "2026-10-20" }),
        item("normal-old", "normal old", { createdAt: new Date("2026-10-01T10:00:00.000Z") }),
        item("normal-sooner", "normal sooner", { dueOn: "2026-10-15" }),
      ],
    });
    expect(order(html)).toEqual(["declaration", "cover", "urgent-dated", "normal-sooner", "normal-old", "low"]);
  });

  it("puts a ticked line under «Gata» with who ticked it, and an overdue day says so", async () => {
    const html = await render({
      computed: [],
      items: [
        item("done", "Terminat", { doneAt: new Date("2026-10-10T08:00:00.000Z"), doneByName: "Oana Organizator" }),
        item("late", "Întârziat", { dueOn: "2026-10-01" }),
      ],
    });
    expect(html).toMatch(/Întârziat: [^<]*1 oct/);
    expect(html).toContain('data-testid="event-todo-overdue"');
    expect(html).toContain("Bifat de Oana Organizator");
    expect(html.indexOf("Gata (1)")).toBeGreaterThan(html.indexOf("Întârziat"));
  });

  it("filters to «Ale mele» through the address, with no script", async () => {
    const mine = item("mine", "al meu", { assigneeStaffUserId: ME, assigneeName: "Ana Admin" });
    const theirs = item("theirs", "al lor", { assigneeStaffUserId: "someone" });
    const html = await render({ computed: [page("cover", "cover", "NORMAL", "box-cover")], items: [mine, theirs], mine: true });
    // The filter is on the club's tasks only (§752: the chips sit inside «Sarcini»); what the page lacks has nobody and stays.
    expect(order(html)).toEqual(["cover", "mine"]);
    expect(html).toContain("?mine=1&amp;todos=1#box-todos-own");
    expect(html).toContain("Ale mele");
  });

  it("gives a role that may write the add form with a priority and a person, and the tick and edit of each line", async () => {
    const html = await render({ computed: [], items: [item("a", "Un rând")] });
    expect(html).toContain('name="priority"');
    expect(html).toContain('name="assignee"');
    expect(html).toContain('name="due"');
    expect(html).toContain("Oana Organizator");
    expect(html).toContain('name="done"');
    expect(html).toContain("Bifează: Un rând");
    expect(html).toContain("Modifică");
    expect(html).toContain("Adaugă o sarcină");
  });

  it("gives a role that only reads the list and no form at all", async () => {
    const html = await render({ computed: [page("cover", "cover", "NORMAL", "box-cover")], items: [item("a", "Un rând")], mayEdit: false });
    expect(html).toContain("o scriu Organizatorul, Administratorul și Superadministratorul");
    expect(html).not.toContain('name="priority"');
    expect(html).not.toContain('name="done"');
    expect(html).not.toContain("Adaugă o sarcină");
    expect(html).not.toContain('role="checkbox"');
    expect(html).toContain("Un rând");
  });

  it("speaks English in English", async () => {
    language = "en";
    try {
      const html = await render({ computed: [page("cover", "cover", "NORMAL", "box-cover")], items: [item("a", "A line", { priority: "URGENT" })], locale: "en" as never });
      expect(html).toContain("To do for the event");
      expect(html).toContain("2 to do");
      expect(html).toContain("Missing from the page");
      expect(html).toContain("Tasks");
      expect(html).toContain(">Urgent<");
      expect(html).toContain("The event has no cover photo.");
    } finally {
      language = "ro";
    }
  });
});

/** Whether the `<details>` with this id is drawn open. */
const foldOpen = (html: string, id: string) => {
  const tag = html.match(new RegExp(`<details[^>]*id="${id}"[^>]*>`))?.[0];
  if (!tag) throw new Error(`no fold ${id}`);
  return /\sopen(?:=""|\s|>)/.test(tag);
};

/** The closed line of a fold: from its opening tag to the end of its `<summary>`. */
const summaryOf = (html: string, id: string) => {
  const from = html.indexOf(`id="${id}"`);
  expect(from, id).toBeGreaterThan(-1);
  return html.slice(from, html.indexOf("</summary>", from));
};

const text = (html: string) => html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");

describe("§752 amended — the card's two folds, closed by default, each with a summary line", () => {
  const someTasks = [
    item("late", "Întârziată", { priority: "HIGH", assigneeStaffUserId: ME, assigneeName: "Ana Admin", dueOn: "2026-10-01" }),
    item("mine", "A mea", { assigneeStaffUserId: ME, assigneeName: "Ana Admin" }),
    item("low", "Oricine", { priority: "LOW" }),
    item("done", "Terminat", { doneAt: new Date("2026-10-10T08:00:00.000Z"), doneByName: "Ana Admin" }),
  ];

  it("draws «Lipsește pe pagină» and «Sarcini» as two named folds inside the card, both shut on arrival", async () => {
    const html = await render({ computed: [page("cover", "cover", "NORMAL", "box-cover")], items: someTasks });
    expect(html).toContain('data-testid="event-todos-page"');
    expect(html).toContain('data-testid="event-todos-own"');
    expect(foldOpen(html, "box-todos")).toBe(true);
    expect(foldOpen(html, "box-todos-page")).toBe(false);
    expect(foldOpen(html, "box-todos-own")).toBe(false);
    // Each is a heading inside its summary (level 3, under the card's own), so a screen reader finds a shut fold by name.
    expect(summaryOf(html, "box-todos-page")).toMatch(/<h3[^>]*>[\s\S]*Lipsește pe pagină/);
    expect(summaryOf(html, "box-todos-own")).toMatch(/<h3[^>]*>[\s\S]*Sarcini/);
    // The two are siblings in the card, a step apart: neither holds the other.
    expect(html.indexOf('id="box-todos-own"')).toBeGreaterThan(html.indexOf('id="box-todos-page"'));
    expect(html.slice(html.indexOf('id="box-todos-page"'), html.indexOf('id="box-todos-own"'))).toContain("</details>");
  });

  it("puts a glyph before each fold's words", async () => {
    const html = await render({ computed: [page("cover", "cover", "NORMAL", "box-cover")], items: someTasks });
    expect(summaryOf(html, "box-todos-page")).toMatch(/<svg[^>]*aria-hidden="true"[^>]*data-testid="AssignmentLateIcon"[\s\S]*?Lipsește pe pagină/);
    expect(summaryOf(html, "box-todos-own")).toMatch(/<svg[^>]*aria-hidden="true"[^>]*data-testid="PlaylistAddCheckIcon"[\s\S]*?Sarcini/);
  });

  it("says on the shut «Lipsește pe pagină» how many rows and the most pressing priority as a chip", async () => {
    const html = await render({ computed: [page("cover", "cover", "NORMAL", "box-cover"), page("declaration", "declaration", "URGENT", "box-declaration")], items: [] });
    const line = summaryOf(html, "box-todos-page");
    expect(text(line)).toContain("2 rânduri");
    expect(line).toMatch(/data-testid="event-todo-fold-priority"/);
    expect(line).toContain(">Urgentă<");
    expect(line).not.toContain(">Normală<");
  });

  it("declines «rând» the way Romanian does", async () => {
    const one = await render({ computed: [page("cover", "cover", "NORMAL", "box-cover")], items: [] });
    expect(text(summaryOf(one, "box-todos-page"))).toContain("1 rând ");
    const many = await render({ computed: Array.from({ length: 20 }, (_, index) => page(`t${index}`, "cover", "LOW", "box-cover")), items: [] });
    expect(text(summaryOf(many, "box-todos-page"))).toContain("20 de rânduri");
  });

  it("keeps «Lipsește pe pagină» drawn, shut, saying «nimic nu lipsește» when nothing is missing", async () => {
    const html = await render({ computed: [], items: someTasks });
    const line = summaryOf(html, "box-todos-page");
    expect(text(line)).toContain("nimic nu lipsește");
    expect(line).not.toContain("event-todo-fold-priority");
    expect(foldOpen(html, "box-todos-page")).toBe(false);
    expect(html).toContain("Pagina are tot ce îi trebuie.");
    expect(html).not.toContain('data-testid="event-todos-page-list"');
  });

  it("says on the shut «Sarcini» how many are left, how many are mine, how many are late, and the most pressing priority", async () => {
    const html = await render({ computed: [], items: someTasks });
    const line = summaryOf(html, "box-todos-own");
    expect(text(line)).toContain("3 de făcut");
    expect(text(line)).toContain("2 ale mele");
    // One task is «1 a mea», never «1 ale mele».
    const one = await render({ computed: [], items: [item("m", "A mea", { assigneeStaffUserId: ME, assigneeName: "Ana Admin" })] });
    expect(text(summaryOf(one, "box-todos-own"))).toContain("1 a mea");
    expect(text(summaryOf(one, "box-todos-own"))).not.toContain("1 ale mele");
    expect(text(line)).toContain("1 întârziată");
    expect(line).toContain(">Mare<");
    expect(line).not.toContain(">Mică<");
    // A ticked task is not counted.
    expect(text(line)).not.toContain("4 de făcut");
  });

  it("leaves «ale mele» and «întârziate» out when there are none, and speaks the plural", async () => {
    const none = await render({ computed: [], items: [item("a", "a"), item("b", "b")] });
    const line = text(summaryOf(none, "box-todos-own"));
    expect(line).toContain("2 de făcut");
    expect(line).not.toContain("ale mele");
    expect(line).not.toContain("întârziat");
    const late = await render({ computed: [], items: [item("a", "a", { dueOn: "2026-10-01" }), item("b", "b", { dueOn: "2026-10-02" })] });
    expect(text(summaryOf(late, "box-todos-own"))).toContain("2 întârziate");
  });

  it("says «nicio sarcină deschisă» with no chip when no task is open", async () => {
    const html = await render({ computed: [], items: [someTasks[3]] });
    const line = summaryOf(html, "box-todos-own");
    expect(text(line)).toContain("nicio sarcină deschisă");
    expect(line).not.toContain("event-todo-fold-priority");
  });

  it("counts over all the data, never over «Ale mele»", async () => {
    const all = await render({ computed: [page("cover", "cover", "NORMAL", "box-cover")], items: someTasks });
    const filtered = await render({ computed: [page("cover", "cover", "NORMAL", "box-cover")], items: someTasks, mine: true });
    // «Ale mele» opens «Sarcini»: the one difference is the fold's `open`, not a word of its line.
    expect(summaryOf(filtered, "box-todos-own").replace(' open=""', "")).toBe(summaryOf(all, "box-todos-own"));
    expect(text(summaryOf(filtered, "box-todos-page"))).toBe(text(summaryOf(all, "box-todos-page")));
    expect(text(filtered)).toContain("4 de făcut");
  });

  it("holds the filter chips, the add row and «Mai multe» inside «Sarcini», and only the rows inside «Lipsește pe pagină»", async () => {
    const html = await render({ computed: [page("cover", "cover", "NORMAL", "box-cover")], items: someTasks });
    const pageFold = html.slice(html.indexOf('id="box-todos-page"'), html.indexOf('id="box-todos-own"'));
    const ownFold = html.slice(html.indexOf('id="box-todos-own"'));
    // Nothing of «Sarcini» above or inside the first fold…
    for (const own of ['aria-label="Ce rânduri arăt"', 'data-testid="event-todo-add"', "Mai multe: cine, termen", 'name="priority"']) {
      expect(pageFold, own).not.toContain(own);
      expect(ownFold, own).toContain(own);
    }
    expect(html.slice(0, html.indexOf('id="box-todos-page"'))).not.toContain('aria-label="Ce rânduri arăt"');
    // …and the order inside «Sarcini»: chips, then the add row, then the rows.
    expect(ownFold.indexOf('aria-label="Ce rânduri arăt"')).toBeLessThan(ownFold.indexOf('data-testid="event-todo-add"'));
    expect(ownFold.indexOf('data-testid="event-todo-add"')).toBeLessThan(ownFold.indexOf('data-testid="event-todos-list"'));
    // The page fold holds its row as the one link, and the priority chip.
    expect(pageFold).toContain('data-testid="event-todo-fill"');
    expect(pageFold).toContain('data-testid="event-todo-priority"');
  });

  it("opens «Sarcini» alone for a refusal of its forms", async () => {
    const html = await render({ computed: [page("cover", "cover", "NORMAL", "box-cover")], items: someTasks, error: "Nu ai voie." });
    expect(foldOpen(html, "box-todos-own")).toBe(true);
    expect(foldOpen(html, "box-todos-page")).toBe(false);
    expect(html).toContain("Nu ai voie.");
  });

  it("opens «Sarcini» alone for a press that just worked", async () => {
    const html = await render({ computed: [page("cover", "cover", "NORMAL", "box-cover")], items: someTasks, saved: true });
    expect(foldOpen(html, "box-todos-own")).toBe(true);
    expect(foldOpen(html, "box-todos-page")).toBe(false);
  });

  it("opens «Sarcini» alone while «Ale mele» is on", async () => {
    const html = await render({ computed: [page("cover", "cover", "NORMAL", "box-cover")], items: someTasks, mine: true });
    expect(foldOpen(html, "box-todos-own")).toBe(true);
    expect(foldOpen(html, "box-todos-page")).toBe(false);
  });

  it("keeps «Sarcini» open for «Toate» too: the chips' addresses carry the marker, and the marker holds the fold", async () => {
    const html = await render({ computed: [page("cover", "cover", "NORMAL", "box-cover")], items: someTasks, inUse: true });
    expect(foldOpen(html, "box-todos-own")).toBe(true);
    expect(foldOpen(html, "box-todos-page")).toBe(false);
    // Both chips keep the fold in use, with or without scripts.
    expect(html).toMatch(/href="[^"]*\?todos=1#box-todos-own"/);
    expect(html).toMatch(/href="[^"]*\?mine=1&amp;todos=1#box-todos-own"/);
  });

  it("opens the shut card itself for a press that just worked, even when nothing is left open", async () => {
    const html = await render({ computed: [], items: [], saved: true });
    expect(foldOpen(html, "box-todos")).toBe(true);
    expect(foldOpen(html, "box-todos-own")).toBe(true);
    const refused = await render({ computed: [], items: [], error: "Nu ai voie." });
    expect(foldOpen(refused, "box-todos")).toBe(true);
    const calm = await render({ computed: [], items: [] });
    expect(foldOpen(calm, "box-todos")).toBe(false);
  });

  it("does not tell a reader «clubul n-a scris nimic» while the page lacks rows or ticked tasks exist", async () => {
    const lacking = await render({ computed: [page("cover", "cover", "NORMAL", "box-cover")], items: [], mayEdit: false });
    const ownLacking = lacking.slice(lacking.indexOf('id="box-todos-own"'));
    expect(ownLacking).not.toContain("clubul n-a scris nimic aici");
    expect(ownLacking).toContain("Nicio sarcină deschisă.");
    expect(ownLacking).not.toContain("Scrie una mai sus");
    const ticked = await render({ computed: [], items: [someTasks[3]], mayEdit: false });
    expect(ticked).not.toContain("clubul n-a scris nimic aici");
    expect(ticked).toContain("Gata (1)");
    // Nothing at all: the all-clear stays true, for a reader too.
    const nothing = await render({ computed: [], items: [], mayEdit: false });
    expect(nothing).toContain("clubul n-a scris nimic aici");
  });

  it("puts the priority chip of a shut line in a span, never a div inside the heading", async () => {
    const html = await render({ computed: [page("declaration", "declaration", "URGENT", "box-declaration")], items: [] });
    expect(summaryOf(html, "box-todos-page")).toMatch(/<span[^>]*data-testid="event-todo-fold-priority"[^>]*MuiChip-root/);
    expect(summaryOf(html, "box-todos-page")).not.toMatch(/<div[^>]*(?:MuiChip-root|event-todo-fold-priority)/);
  });

  it("opens nothing else by itself: not for an urgent row, not for an overdue task, not for one of mine", async () => {
    const html = await render({ computed: [page("declaration", "declaration", "URGENT", "box-declaration")], items: [item("a", "a", { priority: "URGENT", dueOn: "2026-10-01", assigneeStaffUserId: ME })] });
    expect(foldOpen(html, "box-todos-page")).toBe(false);
    expect(foldOpen(html, "box-todos-own")).toBe(false);
  });

  it("gives each fold and each row an address, so a hash opens the fold around it (OpenFoldFromHash)", async () => {
    const html = await render({ computed: [page("cover", "cover", "NORMAL", "box-cover")], items: [item("a", "Un rând")] });
    const pageAt = html.indexOf('id="box-todos-page"');
    const ownAt = html.indexOf('id="box-todos-own"');
    const pageRowAt = html.indexOf('id="event-todo-page-cover"');
    const ownRowAt = html.indexOf('id="event-todo-own-a"');
    expect(pageRowAt).toBeGreaterThan(pageAt);
    expect(pageRowAt).toBeLessThan(ownAt);
    expect(ownRowAt).toBeGreaterThan(ownAt);
    // The chips point at «Sarcini», so a press lands on it open.
    expect(html).toContain("#box-todos-own");
  });

  it("keeps both folds for a role that only reads, with no form in either", async () => {
    const html = await render({ computed: [page("cover", "cover", "NORMAL", "box-cover")], items: someTasks, mayEdit: false });
    expect(html).toContain('id="box-todos-page"');
    expect(html).toContain('id="box-todos-own"');
    expect(text(summaryOf(html, "box-todos-own"))).toContain("3 de făcut");
    expect(html).not.toContain('data-testid="event-todo-add"');
    expect(html).not.toContain('role="checkbox"');
  });

  it("speaks English on the shut lines", async () => {
    language = "en";
    try {
      const html = await render({
        computed: [page("cover", "cover", "NORMAL", "box-cover"), page("declaration", "declaration", "URGENT", "box-declaration")],
        items: someTasks,
        locale: "en" as never,
      });
      expect(text(summaryOf(html, "box-todos-page"))).toContain("2 rows");
      expect(text(summaryOf(html, "box-todos-own"))).toContain("3 to do");
      expect(text(summaryOf(html, "box-todos-own"))).toContain("2 mine");
      expect(text(summaryOf(html, "box-todos-own"))).toContain("1 overdue");
      const none = await render({ computed: [], items: [], locale: "en" as never });
      expect(text(summaryOf(none, "box-todos-page"))).toContain("nothing is missing");
      expect(text(summaryOf(none, "box-todos-own"))).toContain("no open tasks");
    } finally {
      language = "ro";
    }
  });
});
