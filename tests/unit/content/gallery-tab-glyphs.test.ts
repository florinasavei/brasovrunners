import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import en from "../../../messages/en.json";

/**
 * §318 as amended, §813 — a glyph before each of «Galerie»' two tabs (the owner, 2026-10-18:
 * «vreau și la subtaburi să am iconițe»): the album for «Albume», the picture for «Imagini». Rendered the
 * way the server sends it, as `settings-tab-glyphs.test.ts` does for «Setări».
 */
const lang = vi.hoisted(() => ({ current: "ro" as "ro" | "en" }));
vi.mock("next-intl/server", async () => {
  const { createTranslator } = await import("next-intl");
  const all = { ro: (await import("../../../messages/ro.json")).default, en: (await import("../../../messages/en.json")).default };
  return {
    getTranslations: async (namespace: string) =>
      createTranslator({ locale: lang.current, messages: all[lang.current], namespace: namespace as "Admin" }),
  };
});
vi.mock("@/i18n/navigation", () => ({ getPathname: ({ href }: { href: string }) => href }));

const { default: GallerySubNav } = await import("@/modules/content/gallery/ui/GallerySubNav");

async function row(active: "albums" | "pictures", locale: "ro" | "en" = "ro"): Promise<string> {
  lang.current = locale;
  return renderToStaticMarkup((await GallerySubNav({ locale, active })) as ReactElement).replace(/<style[^>]*>[\s\S]*?<\/style>/g, "");
}

function anchors(html: string): { inner: string; text: string }[] {
  return [...html.matchAll(/<a [^>]*>([\s\S]*?)<\/a>/g)].map((match) => ({ inner: match[1], text: match[1].replace(/<[^>]+>/g, "") }));
}

describe("§318 / §813 a glyph on both sub-tabs of «Galerie»", () => {
  it("draws «Albume» and «Imagini», each with an aria-hidden picture before its words", async () => {
    const tabs = anchors(await row("albums"));
    expect(tabs.map((tab) => tab.text)).toEqual(["Albume", "Imagini"]);
    for (const tab of tabs) {
      expect(tab.inner, tab.text).toMatch(/^<span[^>]*aria-hidden="true"[^>]*><svg[^>]*aria-hidden="true"/);
      expect(tab.inner.match(/<svg/g), tab.text).toHaveLength(1);
    }
  });

  it("gives each its own picture: the album, then the photo", async () => {
    const tabs = anchors(await row("pictures"));
    expect(tabs.map((tab) => tab.inner.match(/data-testid="(\w+)Icon"/)?.[1])).toEqual(["PhotoAlbum", "Image"]);
  });

  it("marks the current tab by aria-current, and in English draws the same pictures", async () => {
    const html = await row("pictures", "en");
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
    expect(html).toMatch(/aria-current="page"[^>]*>[\s\S]*?data-testid="ImageIcon"/);
    expect(anchors(html).map((tab) => tab.text)).toEqual([en.Admin.gallery.tabAlbums, en.Admin.gallery.tabPictures]);
  });
});
