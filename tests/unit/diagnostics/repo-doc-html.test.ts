import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import RepoDocHtml from "@/modules/diagnostics/ui/RepoDocHtml";
import { renderRepoDoc } from "@/modules/diagnostics/repo-docs";

/**
 * GitHub task lists (`- [ ]` / `- [x]`), rendered by `marked` — the one renderer `/devs/docs`
 * and `/admin/tasks`'s «Aplicația» / «The app» panel share (`repo-docs.ts`,
 * `RepoDocHtml.tsx`, `DECISIONS.md` §88, §NNN). `docs/QUEUE.md`'s "Building"/"Ready" tables
 * carry no task lists today, but § Later is a real GFM task list on purpose (`docs/DISPATCHER.md`
 * §NNN) — this is what proves the repository's own renderer, `renderRepoDoc`, turns it into a
 * real disabled checkbox rather than testing `marked` on its own.
 */
describe("§NNN task lists in a rendered repository document", () => {
  it("renderRepoDoc turns docs/QUEUE.md's § Later checkboxes into disabled checkbox inputs", async () => {
    const doc = await renderRepoDoc("QUEUE");
    expect(doc).not.toBeNull();
    expect(doc?.html).toContain('<input disabled="" type="checkbox">');
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
