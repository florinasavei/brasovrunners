import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { findPictureToReplace, picturesCarrying, replacedPictureAttrs, replacePictureInDoc } from "@/modules/content/rich-text/domain/replace-picture";
import { replacementIsFor } from "@/modules/content/rich-text/ui/fill-event";
import { parseRichText } from "@/modules/content/rich-text/domain/schema";

/**
 * «Înlocuiește» on a picture in a text (§NNN; BR-REQ-050-03) — the node update the editor makes,
 * as the pure rule it calls, and the document that rule leaves, through the schema a save parses.
 * The editor itself runs only in a browser; the source checks below pin that it calls this rule
 * on the selected node, uploads through the one `uploadPicture`, and deletes nothing.
 */
const OLD = "/api/media/test/11111111-1111-8111-8111-111111111111/web.webp";
const OTHER = "/api/media/test/33333333-3333-8333-8333-333333333333/web.webp";
const NEW = { src: "/api/media/test/22222222-2222-8222-8222-222222222222/web.webp", width: 900, height: 1200 };

const image = (src: string, extra: Record<string, unknown> = {}) => ({
  type: { name: "image" },
  attrs: { src, alt: "Harta", caption: "Bucla mare", width: 1600, height: 1200, widthPercent: 50, align: "left", crop: { x: 0.1, y: 0.2, w: 0.5, h: 0.5 }, focus: { x: 0.4, y: 0.4 }, ...extra },
});
const paragraph = { type: { name: "paragraph" }, attrs: {} };

/** A document of nodes at fixed positions, with the two methods the search reads. */
function docOf(nodes: Array<[number, ReturnType<typeof image> | typeof paragraph]>) {
  return {
    nodeAt: (position: number) => nodes.find(([at]) => at === position)?.[1] ?? null,
    descendants: (visit: (node: ReturnType<typeof image> | typeof paragraph, position: number) => boolean | void) => {
      for (const [at, node] of nodes) if (visit(node, at) === false) return;
    },
  };
}

describe("§NNN the picture's node, replaced", () => {
  it("takes the new address and size, keeps the words, the width share and the placement, and clears the crop and the card's centre", () => {
    const next = replacedPictureAttrs(image(OLD).attrs, NEW);
    expect(next).toEqual({
      src: NEW.src,
      alt: "Harta",
      caption: "Bucla mare",
      width: 900,
      height: 1200,
      widthPercent: 50,
      align: "left",
      crop: null,
      focus: null,
    });
  });

  it("leaves a document the save accepts, with every other block where it was", () => {
    const before = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Înainte" }] },
        { type: "image", attrs: image(OLD).attrs },
        { type: "paragraph", content: [{ type: "text", text: "După" }] },
      ],
    };
    const after = { ...before, content: before.content.map((block) => (block.type === "image" ? { ...block, attrs: replacedPictureAttrs(block.attrs as Record<string, unknown>, NEW) } : block)) };
    const parsed = parseRichText(after);
    expect(parsed.content?.map((block) => block.type)).toEqual(["paragraph", "image", "paragraph"]);
    expect(parsed.content?.[0]).toEqual(parseRichText(before).content?.[0]);
    expect(parsed.content?.[2]).toEqual(parseRichText(before).content?.[2]);
    const picture = parsed.content?.[1];
    expect(picture?.type === "image" && picture.attrs).toMatchObject({ src: NEW.src, alt: "Harta", caption: "Bucla mare", crop: null, focus: null });
  });

  it("finds the picture at the position it was selected at, or by its address once text moved it, or not at all", () => {
    expect(findPictureToReplace(docOf([[0, paragraph], [7, image(OLD)]]), 7, OLD)).toBe(7);
    // Text typed above it during the upload: the address finds it where it went.
    expect(findPictureToReplace(docOf([[0, paragraph], [12, image(OLD)]]), 7, OLD)).toBe(12);
    // Another picture now at the old position is never the one replaced.
    expect(findPictureToReplace(docOf([[7, image("/api/media/test/other/web.webp")], [20, image(OLD)]]), 7, OLD)).toBe(20);
    // Removed while the upload ran: nothing is changed.
    expect(findPictureToReplace(docOf([[0, paragraph]]), 7, OLD)).toBeNull();
  });

  it("is wired in the editor: the selected node, the one upload, no delete at upload time, and the other language told", () => {
    const ROOT = path.resolve(__dirname, "../../..");
    const editor = readFileSync(path.join(ROOT, "src/modules/content/rich-text/ui/RichTextEditor.tsx"), "utf8");
    const body = editor.slice(editor.indexOf("const replaceImage = async"), editor.indexOf("const replaceFileInputRef"));
    expect(body).toContain("uploadPicture(file, setChosen)");
    expect(body).toContain("findPictureToReplace(editor.state.doc, selectedAt, oldSrc)");
    expect(body).toContain("replacedPictureAttrs(node.attrs, uploaded)");
    expect(body).not.toMatch(/fetch\(|DELETE|deleteMedia/);
    expect(editor).toContain('data-testid="rich-text-image-replace"');
    const ro = JSON.parse(readFileSync(path.join(ROOT, "messages/ro.json"), "utf8"));
    const en = JSON.parse(readFileSync(path.join(ROOT, "messages/en.json"), "utf8"));
    expect(ro.Admin.richText.imageReplace).toBe("Înlocuiește");
    expect(en.Admin.richText.imageReplace).toBe("Replace");
    expect(body).toContain("announcePictureReplaced(");
    // Every box of the form listens: the mounted editor and the fold not opened yet.
    expect(editor).toContain("RICH_TEXT_PICTURE_REPLACED_EVENT, onReplaced");
    const lazy = readFileSync(path.join(ROOT, "src/modules/content/rich-text/ui/LazyRichTextEditor.tsx"), "utf8");
    expect(lazy).toContain("RICH_TEXT_PICTURE_REPLACED_EVENT, onReplaced");
    expect(lazy).toContain("replacePictureInDoc(");
    expect(ro.Admin.richText.imageReplaceHelp).not.toContain("În fiecare limbă separat");
    expect(ro.Admin.richText.imageReplaceHelp).toContain("celeilalte limbi se schimbă și ea");
    expect(en.Admin.richText.imageReplaceHelp).not.toContain("In each language separately");
    expect(en.Admin.richText.imageReplaceHelp).toContain("other language's text changes too");
  });

  it("reaches the other language's document: every image carrying the old address, each keeping its own words", () => {
    const english = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Before" }] },
        { type: "image", attrs: { ...image(OLD).attrs, alt: "The map", caption: "The long loop" } },
        { type: "image", attrs: image(OTHER).attrs },
      ],
    };
    const after = replacePictureInDoc(english, OLD, NEW);
    expect(after).not.toBeNull();
    const parsed = parseRichText(after);
    const [, replaced, other] = parsed.content ?? [];
    expect(replaced?.type === "image" && replaced.attrs).toMatchObject({ src: NEW.src, width: 900, height: 1200, alt: "The map", caption: "The long loop", crop: null, focus: null });
    // Another picture is not touched, nor the paragraph before it.
    expect(other?.type === "image" && other.attrs).toMatchObject({ src: OTHER, alt: "Harta" });
    expect(parsed.content?.[0]).toEqual(parseRichText(english).content?.[0]);
    // A document that does not name the picture is left as it was.
    expect(replacePictureInDoc({ type: "doc", content: [{ type: "paragraph" }] }, OLD, NEW)).toBeNull();
    // The mounted editor's search: every position carrying the address.
    expect(picturesCarrying(docOf([[0, paragraph], [7, image(OLD)], [9, image("/x")], [14, image(OLD)]]), OLD)).toEqual([7, 14]);
  });

  it("is heard only by boxes of the form that pressed", () => {
    const form = {} as HTMLFormElement;
    const other = {} as HTMLFormElement;
    const detail = { oldSrc: OLD, picture: NEW, form };
    expect(replacementIsFor(detail, { form } as HTMLInputElement)).toBe(true);
    expect(replacementIsFor(detail, { form: other } as HTMLInputElement)).toBe(false);
    expect(replacementIsFor({ ...detail, form: null }, { form: other } as HTMLInputElement)).toBe(true);
    expect(replacementIsFor({ ...detail, oldSrc: "" }, { form } as HTMLInputElement)).toBe(false);
  });

  it("speaks one word everywhere a picture is replaced: the album, the text, the team card and the bib", () => {
    const ROOT = path.resolve(__dirname, "../../..");
    for (const [locale, word] of [["ro", "Înlocuiește"], ["en", "Replace"]] as const) {
      const words = JSON.parse(readFileSync(path.join(ROOT, `messages/${locale}.json`), "utf8"));
      expect(words.Admin.gallery.replacePhoto).toBe(word);
      expect(words.Admin.richText.imageReplace).toBe(word);
      expect(words.Admin.team.photoReplace).toBe(word);
      expect(words.Admin.editor.bibDesign.picture.replace).toBe(word);
    }
  });
});
