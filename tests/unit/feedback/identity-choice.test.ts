import { createTranslator } from "next-intl";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { FeedbackAudience, FeedbackField } from "@/modules/feedback/domain/branches";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";

/**
 * BR-REQ-070-04, `DECISIONS.md` §678 — the first box of every «Spune-ne ceva» form, rendered on the
 * server as a visitor's browser receives it: «Cum vrei să trimiți?» with «Anonim» checked by default and
 * a sentence under each radio; the name (80 characters at most), the way back and «Cine să afle?» in the
 * named-only part the CSS hides while «Anonim» is checked; «Cine să afle?» only with two readers, the
 * safety person by her first name and never an address. The page draws none of it while the notice in
 * force does not name the named mode (`namedModeFor`, in `branches.test.ts`).
 */
let locale: "ro" | "en" = "ro";

vi.mock("next-intl/server", () => ({
  getTranslations: async (namespace: string) => createTranslator({ locale, messages: locale === "ro" ? ro : en, namespace: namespace as "Tell" }),
}));

const { default: IdentityChoice } = await import("@/modules/feedback/ui/IdentityChoice");
const { default: IncognitoIcon } = await import("@/modules/feedback/ui/IncognitoIcon");

type Options = { wayBack?: "email" | "contact"; named?: boolean; audiences?: FeedbackAudience[]; audience?: FeedbackAudience; invalid?: FeedbackField[]; inLocale?: "ro" | "en" };

async function render({ wayBack = "email", named = false, audiences = ["club", "person"], audience = "club", invalid = [], inLocale = "ro" }: Options = {}) {
  locale = inLocale;
  return renderToStaticMarkup(
    await IdentityChoice({ wayBack, named, invalid: new Set(invalid), kept: () => undefined, safetyName: "Maria", audiences, audience }),
  );
}

/** The radios in the order drawn, each with its name, value and whether it is checked. */
function radios(html: string) {
  return [...html.matchAll(/<input[^>]*type="radio"[^>]*>/g)].map(([tag]) => ({
    name: /name="([^"]*)"/.exec(tag)?.[1],
    value: /value="([^"]*)"/.exec(tag)?.[1],
    checked: /\schecked(=""|\s|\/|>)/.test(tag),
  }));
}

describe("BR-REQ-070-04 «Cum vrei să trimiți?» (§678)", () => {
  it("opens with the identity choice, «Anonim» checked, in the prescribed words, a sentence under each radio", async () => {
    const html = await render();
    expect(/<input[^>]*>/.exec(html)?.[0]).toContain('name="identity"');
    expect(radios(html).slice(0, 2)).toEqual([
      { name: "identity", value: "anonymous", checked: true },
      { name: "identity", value: "named", checked: false },
    ]);
    for (const words of ["Cum vrei să trimiți?", "Anonim", "Nu ne spui cine ești.", "Cu nume și prenume", "Ca să te putem căuta și să-ți răspundem."]) expect(html).toContain(words);
    const english = await render({ inLocale: "en" });
    for (const words of ["How do you want to send it?", "Anonymous", "You do not tell us who you are.", "With my name", "So we can find you and answer."]) expect(english).toContain(words);
  });

  it("draws the incognito hat and glasses before «Anonim» and a person before «Cu nume și prenume», both `aria-hidden`, inside the radio's label (§NNN)", async () => {
    for (const inLocale of ["ro", "en"] as const) {
      const html = await render({ inLocale });
      const labels = [...html.matchAll(/<label[\s\S]*?<\/label>/g)].map(([label]) => label);
      const anonymous = labels.find((label) => label.includes('value="anonymous"')) ?? "";
      const named = labels.find((label) => label.includes('value="named"')) ?? "";
      expect(anonymous).toMatch(/<svg[^>]*aria-hidden="true"[^>]*data-testid="IncognitoIcon"|<svg[^>]*data-testid="IncognitoIcon"[^>]*aria-hidden="true"/);
      expect(named).toMatch(/<svg[^>]*aria-hidden="true"[^>]*data-testid="PersonOutlinedIcon"|<svg[^>]*data-testid="PersonOutlinedIcon"[^>]*aria-hidden="true"/);
      // The glyph comes before the words, never after.
      expect(anonymous.indexOf("IncognitoIcon")).toBeLessThan(anonymous.indexOf(inLocale === "ro" ? "Anonim" : "Anonymous"));
      expect(named.indexOf("PersonOutlinedIcon")).toBeLessThan(named.indexOf(inLocale === "ro" ? "Cu nume și prenume" : "With my name"));
      // The span the browser test finds them by (MUI drops its own test ids from a production build).
      expect(anonymous).toContain('data-testid="feedback-identity-anonymous"');
      expect(named).toContain('data-testid="feedback-identity-named"');
      // One glyph each: none on «Cine să afle?»'s answers.
      expect(html.match(/data-testid="IncognitoIcon"/g)).toHaveLength(1);
      expect(html.match(/data-testid="PersonOutlinedIcon"/g)).toHaveLength(1);
    }
  });

  it("draws «IncognitoIcon» as one path on the 24-unit grid, taking fontSize and colour like every Material glyph (§NNN)", async () => {
    const html = renderToStaticMarkup(createElement(IncognitoIcon, { fontSize: "small", color: "primary" }));
    expect(html).toContain('viewBox="0 0 24 24"');
    expect(html).toContain('data-testid="IncognitoIcon"');
    expect(html).toContain("MuiSvgIcon-fontSizeSmall");
    expect(html).toContain("MuiSvgIcon-colorPrimary");
    expect(html.match(/<path\b/g)).toHaveLength(1);
  });

  it("checks «Cu nume și prenume» for a refused named post", async () => {
    expect(radios(await render({ named: true })).slice(0, 2).map((radio) => radio.checked)).toEqual([false, true]);
  });

  it("puts the name — 80 characters at most, never `required` — the way back and «Cine să afle?» in the part «Anonim» hides", async () => {
    const html = await render();
    const namedOnly = /<div[^>]*data-named-only=""[\s\S]*$/.exec(html)?.[0] ?? "";
    expect(namedOnly).toMatch(/<input[^>]*name="name"[^>]*maxLength="80"|<input[^>]*maxLength="80"[^>]*name="name"/i);
    expect(namedOnly).toContain('name="email"');
    expect(namedOnly).toContain('name="audience"');
    expect(html).not.toMatch(/<input[^>]*name="name"[^>]*\srequired/);
    expect(await render({ wayBack: "contact" })).toContain('name="contact"');
  });

  it("offers «Clubul» and the safety person by her first name, never an address, the branch's own reader checked", async () => {
    const html = await render({ audience: "person" });
    expect(radios(html).slice(2)).toEqual([
      { name: "audience", value: "club", checked: false },
      { name: "audience", value: "person", checked: true },
    ]);
    for (const words of ["Cine să afle?", "Clubul", "Maria", "Doar Maria, persoana desemnată de club pentru siguranță. Confidențial."]) expect(html).toContain(words);
    // Nothing shaped like an address (the stylesheet's `@media` aside): the component is never given one.
    expect(html).not.toMatch(/[\w.+-]+@[\w-]+\.[a-z]{2,}/i);
  });

  it("draws no «Cine să afle?» with one reader or none", async () => {
    for (const audiences of [["club"], ["person"], []] as FeedbackAudience[][]) {
      const html = await render({ audiences });
      expect(html).not.toContain('name="audience"');
      expect(html).not.toContain("Cine să afle?");
    }
  });
});
