import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import RowNoteDialog from "@/shared/ui/RowNoteDialog";

/**
 * `RowNoteDialog` — a row's press and its dialog: «Adaugă o notă» on the registrations' and the volunteers' lists, and, with
 * other words, «Scrie decizia» / «Modifică decizia» on the «Voluntari» list (§NNN, BR-REQ-050-02).
 *
 * The press is what the server draws, and is rendered here: a link that works with no script, 44 pixels tall, its glyph asked
 * by name. The dialog is a portal, which a Node render does not draw (as `confirm-dialog.test.ts` says of the house's other
 * dialog), so what it does with the caller's three optional words is read from the source: the box opens on `defaultValue`,
 * `optional` lets it be saved empty, and a caller that passes none of them — the notes — gets the control as it always was.
 */
const ROOT = path.resolve(__dirname, "../../..");
const source = readFileSync(path.join(ROOT, "src/shared/ui/RowNoteDialog.tsx"), "utf8").replace(/\r\n/g, "\n");

const messages = { errors: {}, fields: {}, fieldsIntro: "", fieldError: "", kept: "", keptConflict: "" };
const base = {
  action: async () => null,
  messages,
  fields: { uiLocale: "ro", volunteerId: "v1" },
  fallbackHref: "/ro/admin/volunteers/v1#note-interne",
  label: "Adaugă o notă",
  ariaLabel: "Adaugă o notă la Ana Pop",
  title: "Notă internă pentru Ana Pop",
  help: "Doar organizatorii văd notele.",
  boxName: "body",
  boxLabel: "Adaugă o notă",
  limitText: "Cel mult 2000 de caractere.",
  max: 2000,
  saveLabel: "Salvează nota",
  cancelLabel: "Renunță",
  settledKey: "0",
};
const drawn = (props: Partial<Parameters<typeof RowNoteDialog>[0]> = {}) => renderToStaticMarkup(createElement(RowNoteDialog, { ...base, ...props }));
const pressOf = (html: string) => /<a\b[^>]*>[\s\S]*?<\/a>/.exec(html)?.[0] ?? "";

describe("RowNoteDialog — the press, as the server draws it", () => {
  it("is a link to the fallback address with the person's name in its accessible name, the plus before its words, and no dialog drawn while shut", () => {
    const html = drawn();
    const press = pressOf(html);
    expect(press).toContain('href="/ro/admin/volunteers/v1#note-interne"');
    expect(press).toContain('aria-label="Adaugă o notă la Ana Pop"');
    expect(press).toContain('aria-haspopup="dialog"');
    expect(press).toContain('data-testid="note-add-open"');
    expect(press).toContain('data-testid="AddIcon"');
    expect(press).toContain("Adaugă o notă</span>");
    // The glyph says nothing to a screen reader: the words do.
    expect(press).toMatch(/<svg[^>]*aria-hidden="true"/);
    // Shut: only the press. The dialog is drawn in the browser, on the press.
    expect(html).not.toContain('role="dialog"');
    expect(html).not.toContain("<textarea");
    expect(html).not.toContain("Notă internă pentru Ana Pop");
  });

  it("draws the pencil for a line that is changed, asked by its name, and takes the caller's own mark for the press", () => {
    const press = pressOf(drawn({ label: "Modifică decizia", ariaLabel: "Modifică decizia: Ana Pop", icon: "edit", testId: "decision-open", dialogTestId: "decision-dialog", defaultValue: "rezervă", optional: true }));
    expect(press).toContain('data-testid="EditIcon"');
    expect(press).not.toContain('data-testid="AddIcon"');
    expect(press).toContain('data-testid="decision-open"');
    expect(press).toContain('aria-label="Modifică decizia: Ana Pop"');
    expect(press).toContain("Modifică decizia</span>");
    // The line as it stands is in the dialog's box, never in the page as drawn.
    expect(press).not.toContain("rezervă");
  });

  it("is a thumb's target: the link is at least 44 pixels tall", () => {
    expect(source).toMatch(/component="a"[\s\S]*?minHeight: 44,/);
    expect(source.match(/sx=\{\{ minHeight: 44 \}\}/g)).toHaveLength(2);
  });
});

describe("RowNoteDialog — the dialog, as the source writes it", () => {
  it("keeps the notes' control as it was for a caller that says nothing more: a required empty box, the plus, the notes' marks", () => {
    expect(source).toMatch(/defaultValue = "",\n\s*optional = false,\n\s*icon = "add",\n\s*testId = "note-add-open",\n\s*dialogTestId = "note-add-dialog",/);
  });

  it("opens the box on the line as it stands, and lets it be saved empty only when the caller says so", () => {
    expect(source).toMatch(/<RecallField[\s\S]*?required=\{!optional\}[\s\S]*?defaultValue=\{defaultValue\}[\s\S]*?slotProps=\{\{ htmlInput: \{ maxLength: max \} \}\}\s*\/>/);
    // One box, by the caller's name, with the limit under it.
    expect(source.match(/<RecallField\b/g)).toHaveLength(1);
    expect(source).toMatch(/name=\{boxName\}\s+label=\{boxLabel\}/);
    expect(source).toContain("helperText={limitText}");
  });

  it("marks the dialog, its form and its help line by the caller's name for them", () => {
    expect(source).toContain("data-testid={dialogTestId}");
    expect(source).toContain("data-testid={`${dialogTestId}-form`}");
    expect(source).toContain("data-testid={`${dialogTestId}-help`}");
  });

  it("closes when a save has landed — the settled key moved — and never from an effect", () => {
    expect(source).toMatch(/if \(seen !== settledKey\) \{\s*setSeen\(settledKey\);\s*setOpen\(false\);\s*\}/);
    expect(source).not.toContain("useEffect");
  });

  it("is handed everything as words: it imports nothing of the notes, the volunteers or the registrations, and no catalogue", () => {
    const imports = [...source.matchAll(/from "([^"]+)"/g)].map((match) => match[1]);
    expect(imports.filter((specifier) => specifier.startsWith("@/modules/") || specifier.startsWith("@/db/") || specifier.startsWith("@/app/"))).toEqual([]);
    expect(imports).not.toContain("next-intl");
    // The two glyphs the press may wear, one file each (never the barrel).
    expect(imports.filter((specifier) => specifier.startsWith("@mui/icons-material"))).toEqual(["@mui/icons-material/Add", "@mui/icons-material/Edit"]);
  });
});
