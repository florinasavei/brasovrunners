import { type ComponentProps, createElement, type ReactElement } from "react";
import { renderToReadableStream } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { type BibDesign, DEFAULT_BIB_DESIGN, DEFAULT_BIB_MEMBER_DESIGN } from "@/modules/registrations/bib-design";
import { BIB_MEMBER_MARK_PATHS, BIB_MEMBER_MARKS } from "@/modules/registrations/bib-member-mark";

/**
 * BR-REQ-038-01, §NNN (amending §750) — the bib designer in named sections. The owner, 2026-10-13, of
 * «Cum arată numărul de concurs»: «Aici am nevoie de separatoare și iconițe, că nu mai înțeleg nimic...».
 *
 * The panel is six folds, top to bottom as the number prints — «Antet», «Numărul», «Numele», «Subsol și
 * sponsori», «Profilul și urgențele», «Membrii» — each a heading with its glyph and a closed line, closed
 * until opened; every field sits in the section it prints in, every picture place is a named sub-card
 * with its «Calitate» row inside it. Rendered as the server draws it, in both languages.
 */
const messages = { ro, en } as const;
let locale: "ro" | "en" = "ro";

vi.mock("next-intl/server", async () => {
  const { createTranslator } = await import("next-intl");
  return {
    getTranslations: async (namespace: string) => createTranslator({ locale, messages: messages[locale], namespace: namespace as "Admin" }),
    getLocale: async () => locale,
  };
});
vi.mock("@/db/client", () => ({ getDb: () => ({}) }));
vi.mock("@/modules/event-checkpoints/checkpoints", () => ({ listCheckpoints: async () => [] }));
vi.mock("@/modules/media/storage", () => ({ isStorageConfigured: () => true }));
vi.mock("@/modules/registrations/bib-pictures", () => ({ readBibPictureFacts: async () => new Map() }));
vi.mock("@/modules/contact/shown-address", () => ({ shownContactAddressesOrDefault: async () => ["club@example.test"] }));

const { default: BibDesignPanel } = await import("@/modules/content/events/ui/BibDesignPanel");

const EVENT_ID = "11111111-1111-4111-8111-111111111111";

async function render(design: BibDesign = DEFAULT_BIB_DESIGN, language: "ro" | "en" = "ro", hasRouteGpx = true): Promise<string> {
  locale = language;
  const element = await BibDesignPanel({ eventId: EVENT_ID, design, bibStartNumber: 7, bibColour: null, hasRouteGpx });
  const { NextIntlClientProvider } = await import("next-intl");
  const stream = await renderToReadableStream(
    createElement(
      NextIntlClientProvider,
      { locale: language, messages: messages[language] } as unknown as ComponentProps<typeof NextIntlClientProvider>,
      element as ReactElement,
    ),
  );
  await stream.allReady;
  return new Response(stream).text();
}

const SECTIONS = ["header", "number", "name", "footer", "profile", "members"] as const;

/** One section's markup: from its `<details>` to the next section's (or the panel's last line). */
function section(html: string, name: (typeof SECTIONS)[number]): string {
  const start = html.indexOf(`data-testid="bib-section-${name}"`);
  expect(start, `the section ${name} is drawn`).toBeGreaterThan(-1);
  const next = SECTIONS.slice(SECTIONS.indexOf(name) + 1)
    .map((later) => html.indexOf(`data-testid="bib-section-${later}"`))
    .find((at) => at > -1);
  return html.slice(html.lastIndexOf("<details", start), next === undefined ? undefined : html.lastIndexOf("<details", next));
}

/** A group's radios as drawn: each one's value and whether the server checked it, in any attribute order. */
function radios(html: string, name: string): Array<{ value: string; checked: boolean }> {
  return [...html.matchAll(new RegExp(`<input[^>]*name="${name.replace(/\./g, "\\.")}"[^>]*>`, "g"))].map((match) => ({
    value: /value="([^"]*)"/.exec(match[0])?.[1] ?? "",
    checked: /\bchecked\b/.test(match[0]),
  }));
}

/** Whether `needle` sits inside a block `ShownWhen` hides right now. */
function hiddenAround(html: string, needle: string): boolean {
  const at = html.indexOf(needle);
  expect(at, needle).toBeGreaterThan(-1);
  // The elements open at that point, read off the markup's own tags: any of them a hidden block?
  const VOID = new Set(["input", "img", "br", "hr", "meta", "link", "source", "col", "area", "wbr"]);
  const open: boolean[] = [];
  for (const tag of html.slice(0, at).matchAll(/<(\/?)([a-zA-Z][\w-]*)([^>]*?)(\/?)>/g)) {
    const [, closing, name, attributes, selfClosing] = tag;
    if (closing) open.pop();
    else if (!selfClosing && !VOID.has(name.toLowerCase())) open.push(/data-hidden-block/.test(attributes));
  }
  // The needle's own tag may still be open (`at` is inside it): its attributes count too.
  const own = html.slice(html.lastIndexOf("<", at), at);
  return open.includes(true) || /data-hidden-block/.test(own);
}

describe("§NNN the bib designer in named sections", () => {
  it("draws six folds in the order the number prints, each closed, with a glyph and a closed line", async () => {
    const html = await render();
    const order = SECTIONS.map((name) => html.indexOf(`data-testid="bib-section-${name}"`));
    expect(order.every((at) => at > -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    const titles = ["Antet", "Numărul", "Numele", "Subsol și sponsori", "Profilul și urgențele", "Membrii"];
    const glyphs = ["VerticalAlignTopIcon", "NumbersIcon", "BadgeIcon", "VerticalAlignBottomIcon", "TerrainIcon", "CardMembershipIcon"];
    SECTIONS.forEach((name, index) => {
      const part = section(html, name);
      // A fold of its own, closed until opened (§336), its heading one level under the designer's.
      expect(part.startsWith("<details"), name).toBe(true);
      expect(part.slice(0, part.indexOf(">")), name).not.toMatch(/\bopen\b/);
      expect(part, name).toMatch(new RegExp(`<h5[^>]*>[\\s\\S]*?data-testid="${glyphs[index]}"[\\s\\S]*?${titles[index]}`));
    });
    // The closed lines say what each holds: the club's colour, the size and how 7 is written, where the name sits.
    expect(section(html, "header")).toContain("Culoarea clubului");
    expect(section(html, "number")).toContain("Normal · 7");
    expect(section(html, "name")).toContain("Sub număr");
    expect(section(html, "footer")).toContain("fără bandă cu sponsori");
    expect(section(html, "profile")).toContain("nimic");
    expect(section(html, "members")).toContain("oprit");
  });

  it("puts every field in the section it prints in", async () => {
    const html = await render();
    const within: Record<(typeof SECTIONS)[number], string[]> = {
      header: ["event.bibColour", "event.bibDesign.showLogo", "event.bibDesign.showEventTitle", "event.bibDesign.showDate", "event.bibDesign.showDistance", "event.bibDesign.headerImageSrc"],
      number: ["event.bibDesign.numberScale", "event.bibDesign.numberFormat", "event.bibDesign.cutMarks"],
      name: ["event.bibDesign.showName", "event.bibDesign.namePosition"],
      footer: ["event.bibDesign.sponsorImageSrc", "event.bibDesign.sponsorPlace", "event.bibDesign.numberStubs", "event.bibDesign.footerText", "event.bibDesign.showEmail"],
      profile: [
        "event.bibDesign.showProfile",
        "event.bibDesign.profileSource",
        "event.bibDesign.profileImageSrc",
        "event.bibDesign.showProfileFigures",
        "event.bibDesign.profileOrientation",
        "event.bibDesign.showCheckpoints",
        "event.bibDesign.showCheckpointTimes",
        "event.bibDesign.showEmergency",
        "event.bibDesign.emergencyLabel",
        "event.bibDesign.emergencyPhoneLabel",
        "event.bibDesign.emergencyPhone",
        "event.bibDesign.emergencyPhone2Label",
        "event.bibDesign.emergencyPhone2",
        "event.bibDesign.emergencyUpsideDown",
      ],
      members: ["event.bibDesign.member.enabled", "event.bibDesign.member.style", "event.bibDesign.member.label", "event.bibDesign.member.mark", "event.bibDesign.member.markShape"],
    };
    for (const name of SECTIONS) {
      const part = section(html, name);
      for (const field of within[name]) expect(part, `${field} in ${name}`).toContain(`name="${field}"`);
    }
    // The band's colour is the header's now, never twice on the form.
    expect(html.split('name="event.bibColour"').length - 1).toBe(1);
  });

  it("draws each picture place as a named sub-card, its glyph before its title and its «Calitate» row inside it", async () => {
    const html = await render();
    for (const [place, name, glyph] of [
      ["bib-picture-header", "header", "ImageIcon"],
      ["bib-picture-sponsors", "footer", "HandshakeIcon"],
      ["bib-picture-profile", "profile", "ImageIcon"],
      ["bib-picture-member-card", "members", "ImageIcon"],
      ["bib-picture-member-header", "members", "ImageIcon"],
    ] as const) {
      const part = section(html, name);
      const start = part.indexOf(`data-testid="${place}"`);
      expect(start, place).toBeGreaterThan(-1);
      const card = part.slice(start, part.indexOf("</fieldset>", part.indexOf('data-testid="image-quality"', start)) + 11);
      expect(card, place).toMatch(new RegExp(`<legend[^>]*>[\\s\\S]*?data-testid="${glyph}"`));
      // The quality row is inside the place's own fieldset, its shorter line with it.
      expect(card, place).toContain('data-testid="image-quality"');
      expect(card, place).toContain("Mare pentru sigle și text, Medie pentru fotografii.");
    }
  });

  it("offers the profile's two sources, the figures ticked and the orientation normal by default, each radio with its glyph", async () => {
    const part = section(await render(), "profile");
    expect(radios(part, "event.bibDesign.profileSource")).toEqual([
      { value: "gpx", checked: true },
      { value: "picture", checked: false },
    ]);
    expect(part).toContain("Desenat din traseul evenimentului (GPX)");
    expect(part).toContain("O poză încărcată");
    expect(part).toMatch(/data-testid="RouteIcon"[\s\S]*?Desenat din traseul/);
    expect(part).toMatch(/<input[^>]*name="event.bibDesign.showProfileFigures"[^>]*checked/);
    expect(part).toContain("Arată distanța și diferența de nivel lângă profil");
    expect(radios(part, "event.bibDesign.profileOrientation")).toEqual([
      { value: "normal", checked: true },
      { value: "turned", checked: false },
    ]);
    expect(part).toContain("Întors, ca să-l citească alergătorul");
    expect(part).toMatch(/data-testid="ScreenRotationAltIcon"[\s\S]*?Întors, ca să-l citească/);
    // Everything the profile decides shows only while it is ticked.
    expect(hiddenAround(part, 'data-testid="bib-profile-source"')).toBe(true);
    // Ticked: the profile's picture shows only with «O poză încărcată»; the checkpoints' ticks only with the GPX.
    const drawn = section(await render({ ...DEFAULT_BIB_DESIGN, showProfile: true }), "profile");
    expect(hiddenAround(drawn, 'data-testid="bib-profile-source"')).toBe(false);
    expect(hiddenAround(drawn, 'data-testid="bib-picture-profile"')).toBe(true);
    expect(hiddenAround(drawn, 'name="event.bibDesign.showCheckpoints"')).toBe(false);
    const picture = section(await render({ ...DEFAULT_BIB_DESIGN, showProfile: true, profileSource: "picture" }), "profile");
    expect(hiddenAround(picture, 'data-testid="bib-picture-profile"')).toBe(false);
    expect(hiddenAround(picture, 'name="event.bibDesign.showCheckpoints"')).toBe(true);
  });

  it("says why the GPX draws nothing when the event has none, and never greys the profile's tick: a picture needs no GPX", async () => {
    const part = section(await render(DEFAULT_BIB_DESIGN, "ro", false), "profile");
    expect(part).toContain("Evenimentul nu are GPX: încarcă-l în „Traseul” sau alege o poză.");
    expect(part).not.toMatch(/<input[^>]*name="event.bibDesign.showProfile"[^>]*disabled/);
  });

  it("asks the phone's label and two numbers with their names, the first number keeping its label for the e2e", async () => {
    const part = section(await render(), "profile");
    for (const words of ["Eticheta telefonului", "Numele de lângă primul telefon", "Telefonul organizatorilor", "Al doilea telefon (opțional)", "Numele de lângă al doilea telefon"]) {
      expect(part).toContain(words);
    }
    expect(part).toMatch(/name="event.bibDesign.emergencyLabel"[^>]*maxlength="40"|maxlength="40"[^>]*name="event.bibDesign.emergencyLabel"/i);
  });

  it("offers the member mark's six shapes, the star chosen, each drawn from the path the bib prints", async () => {
    const design: BibDesign = { ...DEFAULT_BIB_DESIGN, member: { ...DEFAULT_BIB_MEMBER_DESIGN, enabled: true, mark: true } };
    const part = section(await render(design), "members");
    expect(radios(part, "event.bibDesign.member.markShape")).toEqual(BIB_MEMBER_MARKS.map((mark) => ({ value: mark, checked: mark === "star" })));
    for (const mark of BIB_MEMBER_MARKS) {
      if (mark === "logo") continue;
      expect(part).toContain(`d="${BIB_MEMBER_MARK_PATHS[mark]}"`);
    }
    // The logo is the club's own lockup file, never recoloured.
    expect(part).toMatch(/<img[^>]*src="\/brand\/logo\.svg"/);
    for (const words of ["Steluță", "Sigla clubului", "Inimă", "Fulger", "Alergător", "Bifă"]) expect(part).toContain(words);
    // The shapes show only while the mark is ticked.
    const unticked = section(await render({ ...design, member: { ...design.member, mark: false } }), "members");
    expect(hiddenAround(unticked, 'data-testid="bib-member-mark-shape"')).toBe(true);
  });

  it("is the same panel in English, every section named in English", async () => {
    const html = await render(DEFAULT_BIB_DESIGN, "en");
    const titles = ["Header", "The number", "The name", "Footer and sponsors", "Profile and emergencies", "Members"];
    SECTIONS.forEach((name, index) => expect(section(html, name)).toMatch(new RegExp(`<h5[^>]*>[\\s\\S]*?${titles[index]}`)));
    expect(section(html, "profile")).toContain("Show the distance and the elevation gain beside the profile");
    expect(section(html, "profile")).toContain("Turned, for the runner to read");
  });
});
