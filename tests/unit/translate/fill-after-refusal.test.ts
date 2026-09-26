import { readFileSync } from "node:fs";
import path from "node:path";
import { type ComponentProps, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { RichTextDoc } from "@/modules/content/rich-text/domain/schema";
import { richTextEditorLabels } from "@/modules/content/rich-text/ui/labels";
import RichTextEditor from "@/modules/content/rich-text/ui/RichTextEditor";
import { RecallProvider } from "@/shared/forms/recall";

/**
 * §464, after review — a translation filled into a rich-text fold that was still shut must survive a
 * refused save. The fold mounts its editor from the translation (`LazyRichTextEditor` passes it as
 * `override`); the editor wrapper used to swap in the form's recalled value whenever one existed,
 * so the fold opened on the old English and its hidden box posted that on the next save.
 *
 * The fold's own state change (the window event, then the press that opens it) needs a browser;
 * what the wrapper mounts from is proven here, on the server's render of the hidden value.
 */
const ROOT = process.cwd();
const catalogue = JSON.parse(readFileSync(path.join(ROOT, "messages/ro.json"), "utf8")) as {
  Admin: { richText: Record<string, string> };
};
const rt = Object.assign((key: string) => catalogue.Admin.richText[key], { raw: (key: string) => catalogue.Admin.richText[key] });
const LABELS = richTextEditorLabels(rt as unknown as Parameters<typeof richTextEditorLabels>[0]);

const NAME = "translations.en.body";
const doc = (text: string): RichTextDoc =>
  ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] }) as RichTextDoc;

function render(override: RichTextDoc | null): string {
  const recall = {
    value: {
      values: { [NAME]: [JSON.stringify(doc("Old recalled English"))] },
      fields: ["translations.en.title"],
      generation: 1,
      fieldError: "",
    },
  } as unknown as ComponentProps<typeof RecallProvider>;
  const editor = createElement(RichTextEditor, {
    name: NAME,
    label: "Description",
    initialBody: null,
    labels: LABELS,
    override,
  } as ComponentProps<typeof RichTextEditor>);
  return renderToStaticMarkup(createElement(RecallProvider, recall, editor));
}

/** The hidden box the form posts under the editor's name, decoded. */
function posted(html: string): string {
  const value = html.match(new RegExp(`<input type="hidden"[^>]*name="${NAME.replace(/\./g, "\\.")}"[^>]*value="([^"]*)"`))?.[1];
  expect(value, "hidden value").toBeDefined();
  return (value as string).replace(/&quot;/g, '"').replace(/&amp;/g, "&");
}

describe("§464 a translation filled into a shut fold, after a refused save", () => {
  it("is the document the editor mounts from and posts, not the recalled English", () => {
    const html = render(doc("Freshly translated English"));
    expect(posted(html)).toContain("Freshly translated English");
    expect(posted(html)).not.toContain("Old recalled English");
  });

  it("leaves the recalled document in place when nothing was filled (§315 unchanged)", () => {
    expect(posted(render(null))).toContain("Old recalled English");
  });
});
