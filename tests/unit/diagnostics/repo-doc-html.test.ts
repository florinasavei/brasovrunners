import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { marked } from "marked";
import RepoDocHtml from "@/modules/diagnostics/ui/RepoDocHtml";

/**
 * GitHub task lists (`- [ ]` / `- [x]`), rendered by `marked` — the one renderer `/devs/docs`
 * and `/admin/tasks`'s «Aplicația» / «The app» panel share (`repo-docs.ts`,
 * `RepoDocHtml.tsx`, `DECISIONS.md` §88, §NNN). `docs/QUEUE.md`'s "Building"/"Ready" tables
 * carry no task lists today, but the "Later" section is a plain bullet list that would become
 * one the moment somebody ticks an item off in the file — this is what keeps it readable
 * either way, without touching the renderer again.
 */
describe("§NNN task lists in a rendered repository document", () => {
  it("marked already renders a task-list item as a disabled checkbox with the item's text", async () => {
    const html = await marked.parse("- [ ] not done\n- [x] done\n", { gfm: true, breaks: false });
    expect(html).toContain('<input disabled="" type="checkbox">');
    expect(html).toContain('<input checked="" disabled="" type="checkbox">');
    expect(html).toContain("not done");
    expect(html).toContain("done");
  });

  it("RepoDocHtml renders that markup as-is, styled by the one shared rule", () => {
    const html = renderToStaticMarkup(createElement(RepoDocHtml, { html: "<ul><li><input disabled type=\"checkbox\"> Ship it</li></ul>" }));
    // The Box carries Emotion's generated class, but the actual `<input>` — disabled, unticked,
    // the text beside it — is the server's own markup, untouched by the wrapper.
    expect(html).toContain('<input disabled type="checkbox">');
    expect(html).toContain("Ship it");
  });

  it("has one rule for `input[type=checkbox]`, so the two pages cannot drift apart", async () => {
    const { REPO_DOC_HTML_SX } = await import("@/modules/diagnostics/ui/RepoDocHtml");
    expect(REPO_DOC_HTML_SX).toHaveProperty("& input[type='checkbox']");
  });
});
