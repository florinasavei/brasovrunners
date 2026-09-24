import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { createTheme } from "@mui/material/styles";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import SubNav from "@/shared/ui/SubNav";

/**
 * BR-REQ-041-01 (the current entry is not colour alone; 44-pixel targets), `DECISIONS.md` §265 and
 * §NNN — every backoffice sub-navigation is one row of secondary tabs.
 *
 * The owner, 2026-09-24, on the configuration screen's "Stare | General | Emailuri | Anti-robot"
 * and the to-do screen's "De făcut | Anti-robot | Costuri | Sistem": "I do not like the
 * subtabs/buttons of the configs and todos". They were pill buttons, the current one filled blue
 * with a shadow, which read as actions rather than as parts of the page, and at 320 pixels they
 * wrapped into a second row of buttons.
 *
 * Rendered to HTML the way the server sends it: `SubNav` is a Server Component with no client
 * code, so this markup — and the CSS Emotion writes beside it — is everything a browser with
 * JavaScript off gets, the underline included.
 */
const ROOT = path.resolve(__dirname, "../../..");
const read = (relative: string) => readFileSync(path.join(ROOT, relative), "utf8").replace(/\r\n/g, "\n");

const ITEMS = [
  { href: "/ro/devs", label: "Stare", active: true },
  { href: "/ro/devs?panel=general", label: "General" },
  { href: "/ro/devs?panel=email", label: "Emailuri" },
  { href: "/ro/admin/tasks?panel=botCheck", label: "Anti-robot" },
];

const html = renderToStaticMarkup(createElement(SubNav, { label: "Configurația acestui mediu", items: ITEMS }));
/** The markup alone, without the `<style>` tags Emotion writes beside each element on a server. */
const markup = html.replace(/<style[^>]*>[\s\S]*?<\/style>/g, "");
/** Every CSS rule Emotion wrote, as one string. */
const css = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((match) => match[1]).join("");

/** The `css-…` class Emotion gave the first element matching `tag`. */
function emotionClass(tag: RegExp): string {
  const element = markup.match(tag)?.[0] ?? "";
  const name = element.match(/class="[^"]*\b(css-[\w-]+)/)?.[1];
  if (!name) throw new Error(`no Emotion class on ${tag}`);
  return name;
}

/** The declarations of `.<className><suffix>{…}`, exactly that selector. */
function rule(className: string, suffix = ""): string {
  const escaped = `.${className}${suffix}`.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return css.match(new RegExp(`${escaped}\\{([^}]*)\\}`))?.[1] ?? "";
}

const primary = createTheme().palette.primary.main;

describe("§NNN SubNav as the server renders it", () => {
  it("is a labelled <nav> holding a list of plain links, one per entry, with the hrefs as given", () => {
    expect(markup).toMatch(/^<nav [^>]*aria-label="Configurația acestui mediu"/);
    expect(markup).toContain("<ul");
    expect(markup.match(/<li\b/g)).toHaveLength(ITEMS.length);
    const links = [...markup.matchAll(/<a\b[^>]*href="([^"]*)"[^>]*>([^<]*)<\/a>/g)].map((match) => [match[1], match[2]]);
    expect(links).toEqual(ITEMS.map((item) => [item.href.replace(/&/g, "&amp;"), item.label]));
  });

  it("marks the current entry, and only that one, with aria-current=page", () => {
    expect(markup.match(/aria-current=/g)).toHaveLength(1);
    expect(markup).toMatch(/<a\b[^>]*href="\/ro\/devs"[^>]*aria-current="page"[^>]*>Stare<\/a>|<a\b[^>]*aria-current="page"[^>]*href="\/ro\/devs"[^>]*>Stare<\/a>/);
  });

  it("draws no button, no fill, no shadow and no glyph", () => {
    expect(markup).not.toContain("<button");
    expect(markup).not.toMatch(/Mui(Button|Chip|Tab)-/);
    expect(markup).not.toContain("<svg");
    const entry = emotionClass(/<a\b[^>]*>/);
    expect(rule(entry)).not.toMatch(/box-shadow|background-color/);
    expect(rule(entry, '[aria-current="page"]')).not.toMatch(/box-shadow|background-color/);
  });

  it("underlines the current entry in the primary colour, at 600 weight, styled from aria-current itself", () => {
    const entry = emotionClass(/<a\b[^>]*>/);
    // Every entry keeps a 2-px underline, transparent, so the current one is not taller.
    expect(rule(entry)).toContain("border-bottom:2px solid");
    expect(rule(entry)).toContain("border-color:transparent");
    expect(rule(entry)).toContain("font-weight:500");
    expect(rule(entry)).toContain("min-height:44px");
    expect(rule(entry)).toContain("white-space:nowrap");
    const current = rule(entry, '[aria-current="page"]');
    expect(current).toContain(`border-color:${primary}`);
    expect(current).toContain(`color:${primary}`);
    expect(current).toContain("font-weight:600");
  });

  it("shows keyboard focus with a ring drawn inside the entry, where the scrolling row cannot clip it", () => {
    const entry = emotionClass(/<a\b[^>]*>/);
    const focus = rule(entry, ":focus-visible");
    expect(focus).toContain("outline:2px solid");
    expect(focus).toContain("outline-offset:-2px");
  });

  it("is one line that scrolls sideways under a thin rule, never a second row", () => {
    const row = emotionClass(/<nav\b[^>]*>/);
    expect(rule(row)).toContain("overflow-x:auto");
    expect(rule(row)).toContain("border-bottom:1px solid");
    const list = emotionClass(/<ul\b[^>]*>/);
    expect(rule(list)).toContain("display:flex");
    expect(rule(list)).toContain("flex-wrap:nowrap");
    // An entry never shrinks below its words, so a long row overflows (and scrolls) instead.
    expect(rule(emotionClass(/<li\b[^>]*>/))).toMatch(/flex:none|flex:0 0 auto/);
  });
});

describe("§NNN one look for every backoffice sub-navigation", () => {
  it("is a Server Component that imports no MUI button", () => {
    const source = read("src/shared/ui/SubNav.tsx");
    expect(source).not.toMatch(/^"use client"/m);
    expect(source).not.toMatch(/@mui\/material\/(Button|Tabs|Tab|Chip)"/);
  });

  it("is what the gallery's two halves, the configuration, the to-do screen and the email previews use", () => {
    const gallery = read("src/modules/content/gallery/ui/GallerySubNav.tsx");
    expect(gallery).toContain('from "@/shared/ui/SubNav"');
    expect(gallery).not.toContain("GlyphButtonLink");
    for (const file of [
      "src/app/[locale]/admin/tasks/page.tsx",
      "src/app/[locale]/devs/page.tsx",
      "src/modules/notifications/ui/ParticipantEmailsPanel.tsx",
    ]) {
      expect(read(file), file).toMatch(/<SubNav\s[^>]*?label=/);
    }
  });

  it("leaves no pill-button navigation behind: no current entry drawn as a filled button", () => {
    const offenders: string[] = [];
    const walk = (directory: string) => {
      for (const entry of readdirSync(path.join(ROOT, directory), { withFileTypes: true })) {
        const relative = `${directory}/${entry.name}`;
        if (entry.isDirectory()) walk(relative);
        else if (/\.tsx$/.test(entry.name) && /\? "contained" : "outlined"/.test(read(relative))) offenders.push(relative);
      }
    };
    walk("src");
    expect(offenders).toEqual([]);
  });
});
