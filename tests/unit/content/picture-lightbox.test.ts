import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import RichText from "@/modules/content/rich-text/ui/RichText";
import {
  isPreviewEntry,
  leavePreviewEntry,
  PREVIEW_STATE_KEY,
  previewPopListener,
  pushPreviewEntry,
  type PreviewHistory,
} from "@/modules/content/rich-text/ui/picture-preview-history";
import { withClientWords } from "../../helpers/client-words";

/**
 * BR-REQ-041-01, `DECISIONS.md` §601 — a picture in an event's description (and every other rich
 * text the site renders) opens large in place on a tap, and Back, Escape, the ✕ or a tap closes it.
 * The owner, 2026-10-01: «în descrierea full, când dau click pe o poză, vreau să se facă mare (dar
 * nu deschisă ca și poză) și să o pot închide apoi».
 *
 * The repository has no browser environment for Vitest (no jsdom, and no new dependency), so the
 * island is proven in three parts that need none: the server markup, the history rules it runs on
 * open and close, and the dialog's own markup with MUI's portal replaced by a plain element.
 */

/** MUI's dialog renders into a portal, which a server render leaves empty: a plain element instead. */
vi.mock("@mui/material/Dialog", () => ({
  default: ({ open, children, ...rest }: { open: boolean; children: ReactNode; "aria-labelledby"?: string }) =>
    open ? createElement("div", { role: "dialog", "aria-modal": "true", "aria-labelledby": rest["aria-labelledby"] }, children) : null,
}));

const SRC = "/api/media/0123abcd-0123-4abc-8def-0123456789ab/web.webp";
const doc = (attrs: Record<string, unknown>) => ({
  type: "doc",
  content: [{ type: "image", attrs: { src: SRC, alt: "Start la Tâmpa", caption: "Startul din 2025", width: 2400, height: 1600, ...attrs } }],
});
const withoutStyles = (html: string) => html.replace(/<style[^>]*>[\s\S]*?<\/style>/g, "");

describe("§601 the figure keeps its server markup and gains the preview's button", () => {
  it("wraps the same lazy <img> in a button named by the picture, with no dialog in the page", () => {
    const html = withoutStyles(renderToStaticMarkup(withClientWords(createElement(RichText, { body: doc({}) }))));
    expect(html).toMatch(/^<figure/);
    const button = /<button[^>]*data-testid="picture-preview-trigger"[^>]*>/.exec(html)?.[0] ?? "";
    expect(button).toContain('type="button"');
    expect(button).toContain('aria-haspopup="dialog"');
    expect(button).toContain('aria-label="Mărește poza: Start la Tâmpa"');
    // The picture inside is the one the page always drew: the stored address, its size, lazy.
    const image = /<img[^>]*>/.exec(html)?.[0] ?? "";
    expect(image).toContain(`src="${SRC}"`);
    expect(image).toContain('width="2400"');
    expect(image).toContain('height="1600"');
    expect(image).toContain('loading="lazy"');
    expect(image).toContain('alt="Start la Tâmpa"');
    expect(html.indexOf("<button")).toBeLessThan(html.indexOf("<img"));
    expect(html).toContain("<figcaption");
    expect(html.indexOf("</button>")).toBeLessThan(html.indexOf("<figcaption"));
    // Nothing of the dialog until a tap: no role, no second picture.
    expect(html).not.toContain('role="dialog"');
    expect(html.match(/<img/g)).toHaveLength(1);
  });

  it("speaks English on the English page, and names an unnamed picture plainly", () => {
    const html = renderToStaticMarkup(withClientWords(createElement(RichText, { body: doc({ alt: "" }) }), "en"));
    expect(html).toContain('aria-label="Enlarge the picture"');
  });

  it("keeps a cropped picture's window, as a block <span> a button may hold", () => {
    const html = withoutStyles(
      renderToStaticMarkup(withClientWords(createElement(RichText, { body: doc({ crop: { x: 0.1, y: 0.1, w: 0.5, h: 0.5 } }) }))),
    );
    expect(html).toMatch(/<button[^>]*><span class="[^"]*rt-crop[^"]*"><img/);
  });

  it("leaves a listing card's picture alone — the card is a link already", () => {
    const html = renderToStaticMarkup(withClientWords(createElement(RichText, { body: doc({}), links: false, pictures: "card" })));
    expect(html).toContain('data-testid="card-picture"');
    expect(html).not.toContain("picture-preview-trigger");
  });
});

/** The slice of `History` the preview touches, with the browser's stack behind it. */
function fakeHistory(initial: unknown = { __NA: true, tree: "page" }) {
  const stack: unknown[] = [initial];
  let index = 0;
  const history: PreviewHistory & { stack: unknown[] } = {
    stack,
    get state() {
      return stack[index];
    },
    pushState(state: unknown) {
      stack.splice(index + 1, stack.length, state);
      index += 1;
    },
    back() {
      if (index > 0) index -= 1;
    },
  } as PreviewHistory & { stack: unknown[] };
  return history;
}

describe("§601 Back closes the preview instead of leaving the page", () => {
  it("pushes one entry on open that keeps the router's own state", () => {
    const history = fakeHistory();
    pushPreviewEntry(history);
    expect(history.stack).toHaveLength(2);
    expect(history.state).toEqual({ __NA: true, tree: "page", [PREVIEW_STATE_KEY]: true });
    expect(isPreviewEntry(history.state)).toBe(true);
    // A second open on top of an open one adds nothing.
    pushPreviewEntry(history);
    expect(history.stack).toHaveLength(2);
  });

  it("closes on the Back gesture, and then does not step back a second time", () => {
    const history = fakeHistory();
    const close = vi.fn();
    pushPreviewEntry(history);
    const onPop = previewPopListener(history, close);
    history.back(); // the gesture
    onPop();
    expect(close).toHaveBeenCalledTimes(1);
    expect(leavePreviewEntry(history)).toBe(false);
    expect(history.state).toEqual({ __NA: true, tree: "page" });
  });

  it("takes its entry off again when the ✕, Escape or a tap closes it", () => {
    const history = fakeHistory();
    pushPreviewEntry(history);
    expect(leavePreviewEntry(history)).toBe(true);
    expect(history.state).toEqual({ __NA: true, tree: "page" });
    expect(isPreviewEntry(history.state)).toBe(false);
  });

  it("ignores a popstate that lands on another preview entry", () => {
    const history = fakeHistory({ [PREVIEW_STATE_KEY]: true });
    const close = vi.fn();
    previewPopListener(history, close)();
    expect(close).not.toHaveBeenCalled();
    expect(isPreviewEntry(null)).toBe(false);
    expect(isPreviewEntry("x")).toBe(false);
  });
});

describe("§601 the preview itself", () => {
  it("is a modal dialog named by the picture, with the ✕ and its word, the picture contained", async () => {
    const { default: PictureLightboxDialog } = await import("@/modules/content/rich-text/ui/PictureLightboxDialog");
    const html = withoutStyles(
      renderToStaticMarkup(
        createElement(PictureLightboxDialog, {
          open: true,
          onClose: () => {},
          src: SRC,
          srcSet: `${SRC.replace("web.webp", "w960.webp")} 960w, ${SRC} 2400w`,
          alt: "Start la Tâmpa",
          caption: "Startul din 2025",
          closeLabel: ro.Picture.close,
          title: "Start la Tâmpa",
        }),
      ),
    );
    const labelledBy = /aria-labelledby="([^"]+)"/.exec(html)?.[1];
    expect(labelledBy).toBeTruthy();
    expect(html).toContain(`id="${labelledBy}"`);
    expect(html).toMatch(new RegExp(`id="${labelledBy}"[^>]*>Start la Tâmpa<`));
    expect(html).toContain('aria-modal="true"');
    expect(html).toMatch(/<button[^>]*>.*<svg[^>]*data-testid="CloseIcon".*Închide<\/button>/);
    expect(html).toContain('sizes="100vw"');
    expect(html).toContain("Startul din 2025");
    // The pinch-zoom: the picture's wrapper takes every finger and zooms with one transform, at 1×.
    const wrapper = /<div[^>]*data-testid="picture-preview-zoom"[^>]*>/.exec(html)?.[0] ?? "";
    expect(wrapper).toContain("touch-action:none");
    expect(wrapper).toContain("transform:translate(0px, 0px) scale(1)");
    expect(wrapper).not.toContain("will-change");
    // The picture's container is not a button: the ✕ is the only one.
    expect(html.match(/<button/g)).toHaveLength(1);
  });

  it("closes on Escape and a tap through MUI's dialog, Back through the history, and loads only on a tap", () => {
    const island = readFileSync(path.join(process.cwd(), "src/modules/content/rich-text/ui/PictureLightbox.tsx"), "utf8");
    const dialog = readFileSync(path.join(process.cwd(), "src/modules/content/rich-text/ui/PictureLightboxDialog.tsx"), "utf8");
    // The dialog's onClose is MUI's Escape and backdrop; the ✕ calls the same close, and the layer
    // only after `isTap` — a pinch's or a pan's end never closes it.
    expect(dialog).toMatch(/<Dialog[\s\S]*?onClose=\{onClose\}/);
    expect(dialog).not.toMatch(/onClick=\{onClose\}/);
    expect(dialog).toMatch(/!isTap\(start\.down, up\)\)[\s\S]*?setTimeout\(onClose, TAP_MS\)/);
    // A new finger cancels a tap's pending close, so a pinch begun right after a tap keeps the preview.
    expect(dialog).toMatch(/const onPointerDown = [^{]*\{\s*(?:\/\/[^\n]*\s*)?if \(closeTimer\.current\) \{ clearTimeout\(closeTimer\.current\); closeTimer\.current = null; \}/);
    expect(dialog).toMatch(/data-testid="picture-preview"[\s\S]*?touchAction: "none"/);
    expect(dialog).toMatch(/onPointerUp=\{\(event\) => onPointerEnd\(event, false\)\}/);
    expect(dialog).toContain("minHeight: 44");
    // The dialog is a separate chunk, fetched the first time a picture is tapped (§577).
    expect(island).toContain('lazy(() => import("./PictureLightboxDialog"))');
    expect(island).toMatch(/\{loaded && \(/);
    expect(island).toContain('window.addEventListener("popstate", listener)');
    // §318: the island takes plain values from the server, never an element or a component.
    expect(island).toMatch(/src: string;\s+srcSet\?: string;\s+alt: string;\s+caption: string;/);
  });

  it("has its words in both languages", () => {
    for (const catalogue of [ro, en]) {
      expect(Object.keys(catalogue.Picture).sort()).toEqual(["close", "open", "openNamed", "title"]);
    }
    expect(ro.Picture.close).toBe("Închide");
    expect(en.Picture.close).toBe("Close");
  });
});
