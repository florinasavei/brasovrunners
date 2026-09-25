import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import RepoDocHtml from "@/modules/diagnostics/ui/RepoDocHtml";
import { renderRepoDocMarkdown } from "@/modules/diagnostics/repo-docs";

/**
 * GitHub task lists (`- [ ]` / `- [x]`), rendered by `marked` — the one renderer `/devs/docs`
 * and `/admin/tasks`'s «Aplicația» / «The app» panel share (`repo-docs.ts`, `RepoDocHtml.tsx`,
 * `DECISIONS.md` §88, §NNN). This runs the fixture below through `renderRepoDocMarkdown` — the
 * exact function `renderRepoDoc` calls — rather than depending on a tracked document's own
 * content: a live doc's task list can empty out (the dispatcher clears § Later) without turning
 * this test unrelated-red.
 */
describe("task lists in a rendered repository document", () => {
  it("renderRepoDocMarkdown turns a GFM task list into disabled checkbox inputs", async () => {
    const html = await renderRepoDocMarkdown("## Later\n\n- [ ] Ship the queue tab\n- [x] Write the review\n");
    expect(html).toContain('<input disabled="" type="checkbox">');
    expect(html).toContain('<input checked="" disabled="" type="checkbox">');
    expect(html).toContain("Ship the queue tab");
  });

  it("RepoDocHtml renders that markup as-is, styled by the one shared rule", () => {
    const html = renderToStaticMarkup(createElement(RepoDocHtml, { html: "<ul><li><input disabled type=\"checkbox\"> Ship it</li></ul>" }));
    // The Box carries Emotion's generated class, but the actual `<input>` — disabled, unticked,
    // the text beside it — is the server's own markup, untouched by the wrapper.
    expect(html).toContain('<input disabled type="checkbox">');
    expect(html).toContain("Ship it");
  });
});
