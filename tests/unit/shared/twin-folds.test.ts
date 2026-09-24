import { readFileSync } from "node:fs";
import path from "node:path";
import { type ComponentProps, createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { richTextEditorLabels } from "@/modules/content/rich-text/ui/labels";
import LazyRichTextEditor from "@/modules/content/rich-text/ui/LazyRichTextEditor";
import { createTwinFoldStore, type TwinFoldStore, twinFoldKey } from "@/shared/ui/fold";
import LocaleTabPanels, { TwinFoldProvider } from "@/shared/ui/LocaleTabPanels";

/**
 * §NNN — a fold inside a language strip shares its open state with its twin in the other
 * language (the owner, 2026-09-24: "I would like to keep the expand/collapsed state while changing
 * the language tab in the event editor").
 *
 * Three layers, each proven where it lives: the key a fold and its twins share, the strip's store
 * that holds it, and the fold itself rendered against a store — the way the server renders it
 * (closed, the HTML unchanged) and the way a client renders it once the twin was opened (open in
 * both languages, the editor mounted only on the tab that is on top). The clicks themselves — open
 * in Română, the English twin open; close in English, closed in Română — are
 * `tests/e2e/editor-language-folds.spec.ts`, in a real browser.
 */
const ROOT = process.cwd();
const catalogue = JSON.parse(readFileSync(path.join(ROOT, "messages/ro.json"), "utf8")) as {
  Admin: { richText: Record<string, string> };
};
const rt = Object.assign((key: string) => catalogue.Admin.richText[key], { raw: (key: string) => catalogue.Admin.richText[key] });
const LABELS = richTextEditorLabels(rt as unknown as Parameters<typeof richTextEditorLabels>[0]);

/** The markup without the `<style>` tags Emotion writes beside each element when rendering on a server. */
const markup = (html: string): string => html.replace(/<style[^>]*>[\s\S]*?<\/style>/g, "");

/** The opening tag of the fold around one language's description. */
function foldTag(html: string, name: string): string {
  const tag = html.match(new RegExp(`<details[^>]*data-rich-text-fold="${name.replace(/\./g, "\\.")}"[^>]*>`))?.[0];
  expect(tag, name).toBeDefined();
  return tag as string;
}

const isOpen = (tag: string): boolean => /\sopen(=""|\s|>)/.test(tag);

function description(locale: "ro" | "en") {
  return createElement(LazyRichTextEditor, {
    name: `translations.${locale}.body`,
    label: "Descriere",
    summary: "Descriere",
    emptyHint: "gol",
    initialBody: null,
    accessibleSuffix: locale.toUpperCase(),
    labels: LABELS,
  } as ComponentProps<typeof LazyRichTextEditor>);
}

/** Both languages' descriptions, each under its panel's side of one store, Română on top. */
function strip(store: TwinFoldStore): string {
  const panel = (locale: "ro" | "en", shown: boolean): ReactNode =>
    createElement(
      TwinFoldProvider,
      // The children go in as `createElement`'s third argument, which the props type cannot see.
      { value: { store, locale, shown } } as unknown as ComponentProps<typeof TwinFoldProvider>,
      description(locale),
    );
  return markup(renderToStaticMarkup(createElement("div", null, panel("ro", true), panel("en", false))));
}

describe("§NNN the key a fold shares with its twins", () => {
  it("is the fold's name with the panel's language taken out", () => {
    expect(twinFoldKey("translations.ro.body", "ro")).toBe("translations.*.body");
    expect(twinFoldKey("translations.en.body", "en")).toBe("translations.*.body");
    expect(twinFoldKey("translations.ro.excerptBody", "ro")).not.toBe(twinFoldKey("translations.en.body", "en"));
  });

  it("takes out a whole segment only, and leaves a name without the language as it is", () => {
    // "rules" and "roles" contain no segment that *is* "ro"; a box shared by both languages keys itself.
    expect(twinFoldKey("translations.ro.rules", "ro")).toBe("translations.*.rules");
    expect(twinFoldKey("event.roles", "ro")).toBe("event.roles");
    expect(twinFoldKey("event.bibDesign", "en")).toBe("event.bibDesign");
  });
});

describe("§NNN the strip's store", () => {
  it("answers nothing for a fold never touched, so the server's HTML decides", () => {
    expect(createTwinFoldStore().get("translations.*.body")).toBeUndefined();
  });

  it("holds each fold by its key and tells every subscriber when one changes", () => {
    const store = createTwinFoldStore();
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    store.set("translations.*.body", true);
    expect(store.get("translations.*.body")).toBe(true);
    expect(store.get("translations.*.rules")).toBeUndefined();
    expect(listener).toHaveBeenCalledTimes(1);
    store.set("translations.*.body", false);
    expect(store.get("translations.*.body")).toBe(false);
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
    store.set("translations.*.body", true);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("says nothing when a fold is set to what it already is — the twin's own `toggle` echo ends there", () => {
    const store = createTwinFoldStore();
    const listener = vi.fn();
    store.subscribe(listener);
    store.set("translations.*.body", true);
    store.set("translations.*.body", true);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe("§NNN a fold and its twin, rendered", () => {
  it("are both closed while nothing opened them — the server's HTML is what it was", () => {
    const html = strip(createTwinFoldStore());
    expect(isOpen(foldTag(html, "translations.ro.body"))).toBe(false);
    expect(isOpen(foldTag(html, "translations.en.body"))).toBe(false);
    // Nothing mounted: each language posts its stored document from the hidden field (§96).
    expect(html).not.toContain('data-rich-text="translations.ro.body"');
    expect(html).toMatch(/<input type="hidden"[^>]*name="translations\.ro\.body"/);
  });

  it("are both open once one of them was — and only the language on top mounts its editor", () => {
    const store = createTwinFoldStore();
    store.set(twinFoldKey("translations.ro.body", "ro"), true);
    const html = strip(store);
    expect(isOpen(foldTag(html, "translations.ro.body"))).toBe(true);
    expect(isOpen(foldTag(html, "translations.en.body"))).toBe(true);
    // Română is on top: its editor is drawn. English waits for its tab — two Tiptap instances for
    // one press would be §96's cost back, for a language nobody is looking at yet.
    expect(html).toContain('data-rich-text="translations.ro.body"');
    expect(html).not.toContain('data-rich-text="translations.en.body"');
    expect(html).toMatch(/<input type="hidden"[^>]*name="translations\.en\.body"/);
  });

  it("are both closed again once one of them was closed", () => {
    const store = createTwinFoldStore();
    store.set("translations.*.body", true);
    store.set("translations.*.body", false);
    const html = strip(store);
    expect(isOpen(foldTag(html, "translations.ro.body"))).toBe(false);
    expect(isOpen(foldTag(html, "translations.en.body"))).toBe(false);
  });

  it("do not reach another fold of the strip", () => {
    const store = createTwinFoldStore();
    store.set("translations.*.rules", true);
    const html = strip(store);
    expect(isOpen(foldTag(html, "translations.ro.body"))).toBe(false);
  });

  it("render closed from a real strip on the server, every panel wired to it", () => {
    const html = markup(
      renderToStaticMarkup(
        createElement(LocaleTabPanels, {
          idPrefix: "description",
          panels: [
            { locale: "ro", label: "Română", content: description("ro") },
            { locale: "en", label: "English", content: description("en") },
          ],
        }),
      ),
    );
    expect(isOpen(foldTag(html, "translations.ro.body"))).toBe(false);
    expect(isOpen(foldTag(html, "translations.en.body"))).toBe(false);
  });
});
