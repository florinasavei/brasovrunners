import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { type ComponentProps, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BOXED_DISCLOSURE_SX } from "@/shared/ui/disclosure";
import { type FoldNode, type FoldOpenWhen, fragmentId, openFoldsAround, opensByItself } from "@/shared/ui/fold";
import Panel from "@/shared/ui/Panel";

/**
 * `DECISIONS.md` §336 — a backoffice fold starts closed and opens by itself only for what the
 * reader must see (the owner, 2026-09-23: "I would like the accordions to be closed by
 * default").
 *
 * The rule is written once, in `shared/ui/fold.ts`, and `Panel` is its one reader; rendered to
 * HTML here the way the server sends it, because whether the `<details>` carries `open` is the
 * whole behaviour — with JavaScript off it is the only thing that decides what is in view.
 */
const ROOT = process.cwd();
const read = (relative: string) => readFileSync(path.join(ROOT, relative), "utf8");

/** The markup without the `<style>` tags Emotion writes beside each element when rendering on a server. */
const markup = (html: string): string => html.replace(/<style[^>]*>[\s\S]*?<\/style>/g, "");

function panel(props: { collapsible?: boolean; openWhen?: FoldOpenWhen; level?: 2 | 3 }): string {
  return markup(
    renderToStaticMarkup(
      createElement(
        Panel,
        // The children go in as `createElement`'s third argument, which the props type cannot see.
        { title: "Planul Mailgun", aside: "Planul Free · 3 din 100 azi", ...props } as unknown as ComponentProps<typeof Panel>,
        "corpul",
      ),
    ),
  );
}

/** Whether the rendered `<details>` opening tag carries the `open` attribute. */
const isOpen = (html: string): boolean => /<details[^>]*\sopen(=""|\s|>)/.test(html);

describe("§336 the open rule", () => {
  it("is closed with no reason, and with every reason false", () => {
    expect(opensByItself(undefined)).toBe(false);
    expect(opensByItself({})).toBe(false);
    expect(opensByItself({ refused: false, saved: false, attention: false, inUse: false })).toBe(false);
  });

  it("opens for each reason on its own", () => {
    expect(opensByItself({ refused: true })).toBe(true);
    expect(opensByItself({ saved: true })).toBe(true);
    expect(opensByItself({ attention: true })).toBe(true);
    expect(opensByItself({ inUse: true })).toBe(true);
  });
});

describe("§336 a collapsible Panel as the server renders it", () => {
  it("is a closed <details> by default — the heading and the aside in the summary, the body out of sight", () => {
    const html = panel({ collapsible: true });
    expect(html).toMatch(/^<details/);
    expect(isOpen(html)).toBe(false);
    // The summary is rendered while the fold is shut, and the heading is a real h2 inside it:
    // what a screen reader's heading list and the e2e suite find a closed panel by (§269).
    expect(html).toMatch(/<summary[^>]*><h2[^>]*>Planul Mailgun<span[^>]*>Planul Free · 3 din 100 azi<\/span><\/h2><\/summary>/);
  });

  it("opens with a refusal from its own form", () => {
    expect(isOpen(panel({ collapsible: true, openWhen: { refused: true } }))).toBe(true);
  });

  it("opens after its own save", () => {
    expect(isOpen(panel({ collapsible: true, openWhen: { saved: true } }))).toBe(true);
  });

  it("opens with a warning that asks for action", () => {
    expect(isOpen(panel({ collapsible: true, openWhen: { attention: true } }))).toBe(true);
  });

  it("opens while something in it shapes the page", () => {
    expect(isOpen(panel({ collapsible: true, openWhen: { inUse: true } }))).toBe(true);
  });

  it("stays closed when the page names reasons and none holds", () => {
    expect(isOpen(panel({ collapsible: true, openWhen: { refused: false, saved: false, attention: false } }))).toBe(false);
  });

  it("draws a fold inside a panel with an h3, so the heading list has the screen's shape", () => {
    expect(panel({ collapsible: true, level: 3 })).toMatch(/<summary[^>]*><h3/);
  });

  it("leaves a panel that does not fold as an open section, whatever it is told", () => {
    const html = panel({ openWhen: { saved: true } });
    expect(html).toMatch(/^<section/);
    expect(html).not.toContain("<details");
  });
});

/** A `<details>` or any other element, as far as `openFoldsAround` reads one. */
function node(tagName: string, parentElement: FoldNode | null, open?: boolean): FoldNode {
  return { tagName, parentElement, open };
}

describe("§336 a #fragment opens the fold it names", () => {
  it("opens the fold the fragment names, and every fold it sits inside", () => {
    // `#email-EVENT_REMINDER`: the message's card, inside the closed card of all the messages.
    const master = node("DETAILS", node("MAIN", null), false);
    const stack = node("DIV", master);
    const card = node("DETAILS", stack, false);
    expect(openFoldsAround(card)).toBe(2);
    expect(card.open).toBe(true);
    expect(master.open).toBe(true);
  });

  it("opens the folds around an element inside one — a refusal summary, a named box", () => {
    const fold = node("details", null, false);
    const form = node("FORM", fold);
    const summary = node("DIV", form);
    expect(openFoldsAround(summary)).toBe(1);
    expect(fold.open).toBe(true);
  });

  it("counts nothing when everything is already open, or nothing is found", () => {
    const open = node("DETAILS", null, true);
    expect(openFoldsAround(node("DIV", open))).toBe(0);
    expect(openFoldsAround(null)).toBe(0);
    expect(openFoldsAround(node("SECTION", node("MAIN", null)))).toBe(0);
  });

  it("reads the id out of the address's fragment", () => {
    expect(fragmentId("#contact-recipients")).toBe("contact-recipients");
    expect(fragmentId("contact-recipients")).toBe("contact-recipients");
    expect(fragmentId("#email-EVENT_REMINDER")).toBe("email-EVENT_REMINDER");
    expect(fragmentId("#caut%C4%83")).toBe("caută");
    expect(fragmentId("")).toBeNull();
    expect(fragmentId("#")).toBeNull();
    // A malformed escape names nothing rather than throwing in the shell.
    expect(fragmentId("#%E2")).toBeNull();
  });

  it("is run by the backoffice shell, on every staff page", () => {
    const shell = read("src/modules/staff-identity/ui/BackofficeShell.tsx");
    expect(shell).toMatch(/import OpenFoldFromHash from "@\/shared\/ui\/OpenFoldFromHash"/);
    expect(shell).toContain("<OpenFoldFromHash />");
    const island = read("src/shared/ui/OpenFoldFromHash.tsx");
    expect(island.startsWith('"use client"')).toBe(true);
    expect(island).toContain('addEventListener("hashchange"');
    expect(island).toMatch(/openFoldsAround\(target\)/);
  });
});

describe("§336 a kept form's refusal is never folded away", () => {
  it("opens the folds around the summary before focusing it, with JavaScript on", () => {
    const form = read("src/shared/forms/ActionForm.tsx");
    const effect = form.slice(form.indexOf("useEffect(() => {"), form.indexOf("}, [state]);"));
    expect(effect).toMatch(/openFoldsAround\(summary\.current\);\s*summary\.current\?\.focus\(\);/);
  });

  it("shows a closed fold's body while a refusal summary is inside it, with JavaScript off", () => {
    // The refusal summary's id is `form-refusal`, or `form-refusal-<scope>` on a page of several.
    const rule = BOXED_DISCLOSURE_SX["&:not([open]):has([id^='form-refusal'])::details-content"];
    expect(rule).toEqual({ contentVisibility: "visible", display: "block" });
    expect(read("src/shared/forms/ActionForm.tsx")).toMatch(/REFUSAL_SUMMARY_ID = "form-refusal"/);
  });
});

/** Every `.tsx` under a directory, recursively. */
const tsxUnder = (relative: string): string[] =>
  readdirSync(path.join(ROOT, relative), { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".tsx"))
    .map((entry) => path.relative(ROOT, path.join(entry.parentPath, entry.name)).split(path.sep).join("/"));

describe("§336 the rule is written once", () => {
  it("leaves no panel deciding its own open state", () => {
    // `defaultOpen` was the per-page boolean the rule replaced; a panel that wants to open says
    // why through `openWhen`, and `Panel` is the one place that turns reasons into `open`.
    for (const file of tsxUnder("src")) {
      expect(read(file), file).not.toMatch(/<Panel[^>]*\bdefaultOpen\b/);
    }
    expect(read("src/shared/ui/Panel.tsx")).toContain("open={opensByItself(openWhen) || undefined}");
  });
});

/**
 * "A closed fold that says nothing is a fold nobody opens" (`Panel`'s `aside`). The two folds
 * this change closed that had no aside — adding a colleague, and the registrations' search and
 * filters when nothing is filtered — say one line in their summary like the others.
 */
describe("§336 a closed fold says what is inside it", () => {
  it("the staff invite says what 'Add' does, with the Zitadel key and without it", () => {
    const page = read("src/app/[locale]/admin/staff/page.tsx");
    expect(page).toMatch(
      /<Panel[\s\S]*?title=\{t\("staff\.inviteTitle"\)\}[\s\S]*?aside=\{invitesSend \? t\("staff\.inviteAsideSends"\) : t\("staff\.inviteAsideManual"\)\}[\s\S]*?id="staff-invite"/,
    );
  });

  it("the registrations' filters say the list is whole when nothing narrows it", () => {
    const page = read("src/app/[locale]/admin/registrations/(list)/page.tsx");
    const panelStart = page.indexOf('title={t("panels.filters")}');
    const tag = page.slice(panelStart, page.indexOf('data-testid="registrations-filters"', panelStart));
    expect(tag).toContain('t("registrations.filtersInUse")');
    expect(tag).toContain('t("registrations.filterAutoFeatured"');
    expect(tag).toContain('t("registrations.filtersNone")');
    expect(tag).not.toMatch(/:\s*undefined\s*\}/);
  });

  it("has the words in both languages", async () => {
    const ro = (await import("../../../messages/ro.json")).default;
    const en = (await import("../../../messages/en.json")).default;
    for (const messages of [ro, en]) {
      expect(messages.Admin.staff.inviteAsideSends).toBeTruthy();
      expect(messages.Admin.staff.inviteAsideManual).toBeTruthy();
      expect(messages.Admin.registrations.filtersNone).toBeTruthy();
    }
  });
});
