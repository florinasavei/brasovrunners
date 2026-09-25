import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * BR-REQ-060-01, `DECISIONS.md` §256 — every backoffice list behaves the same way.
 *
 * The owner: "I wanna be able to do CRUDs everywhere, and have more consistency!" The verbs
 * were all there; what differed was the shape — the events list had a ⋮ with confirmations, the
 * pages list had two arrows and no verbs at all, the gallery had none, and the staff list had
 * five bare buttons stacked in one row, two of which ended somebody's access without asking.
 *
 * The rule, and this file is what keeps it:
 *
 * - every list is an `AdminTable`, so paging, sorting and the results count read the same;
 * - a row with **two or more** verbs puts them in the shared `RowMenu`;
 * - a row with **one** verb keeps it as a button that confirms — a menu for a single action is
 *   one press more for nothing;
 * - and a destructive verb always asks, wherever it lives.
 */
const LISTS = {
  events: ["src", "app", "[locale]", "admin", "(list)", "page.tsx"],
  pages: ["src", "app", "[locale]", "admin", "pages", "(list)", "page.tsx"],
  albums: ["src", "app", "[locale]", "admin", "gallery", "(list)", "page.tsx"],
  pictures: ["src", "app", "[locale]", "admin", "gallery", "pictures", "page.tsx"],
  staff: ["src", "app", "[locale]", "admin", "staff", "page.tsx"],
  registrations: ["src", "app", "[locale]", "admin", "registrations", "(list)", "page.tsx"],
} as const;

const source = (parts: readonly string[]) => readFileSync(path.join(process.cwd(), ...parts), "utf8");

describe("§256 the backoffice lists are the same shape", () => {
  it("renders every list through AdminTable", () => {
    for (const [name, parts] of Object.entries(LISTS)) {
      expect(source(parts), name).toContain("AdminTable");
    }
  });

  it("puts a row's verbs in the shared menu wherever there is more than one", () => {
    for (const name of ["events", "pages", "albums", "staff"] as const) {
      expect(source(LISTS[name]), name).toContain("RowMenu");
    }
  });

  it("keeps a single verb as a button that asks first", () => {
    // The pictures list deletes and does nothing else; a menu there would be a press for
    // nothing, and the confirmation is what actually matters.
    const pictures = source(LISTS.pictures);
    // The form asks (`ActionForm confirm`, §NNN); the button is a plain submit.
    expect(pictures).toMatch(/<ActionForm\s*action=\{deletePictureAction\}\s*confirm=\{\{/);
    expect(pictures).not.toContain("RowMenu");
  });

  it("never offers a destructive verb without a confirmation", () => {
    /*
      A `SubmitButton` is the plain one: it says what it is doing while the server works and
      asks nothing. Anything that deletes, revokes or takes access away must be a
      `ConfirmSubmitButton` or a `RowMenu` item, both of which carry a dialog — so no list may
      name one of those verbs on a plain button.
    */
    for (const [name, parts] of Object.entries(LISTS)) {
      const text = source(parts);
      const plainButtons = text.split("<SubmitButton").slice(1).map((chunk) => chunk.slice(0, 400));
      for (const button of plainButtons) {
        expect(button, `${name}: a destructive verb on a plain button`).not.toMatch(
          /\.(delete|deleteAlbum|revoke|deactivateAccount|erase|hardDelete)\b/,
        );
      }
    }
  });

  it("uses one menu component, not one per module", () => {
    // It lived in `modules/content/events/ui/EventRowMenu.tsx` while the events list was the
    // only list that had one. Four lists share it now, so it lives in `shared/ui`.
    expect(() => source(["src", "shared", "ui", "RowMenu.tsx"])).not.toThrow();
    expect(() => source(["src", "modules", "content", "events", "ui", "EventRowMenu.tsx"])).toThrow();
  });
});
