import { readFileSync } from "node:fs";
import { type ComponentProps, createElement, type ReactElement } from "react";
import { renderToReadableStream } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { countForm } from "@/i18n/count-form";
import { CHOICE_CARD_SX, CHOICE_INPUT_SX } from "@/shared/ui/choice-card";
import type { PublicVolunteerCategory, PublicVolunteerRole } from "@/modules/volunteers/volunteers";

/**
 * §780 (amended 2026-10-16) — the volunteers' page's roles as the server draws them: each category its own calm card (a header on the
 * card's surface with its glyph, its name as the level-3 heading and «4 roluri», a hairline, its contact line, its chips inside, no
 * filled band), «Alte activități» last with the same look, no card at all for an event with no category; each role a chip — a pill whose
 * face is the checkbox's label (the box visible, the name, the §773 count words only when the club ticked them) — with a «?» outside the
 * label, a native closed `<details>`, only for a role with a description; the ticked state, which the CSS draws from `:checked`; the wrap
 * row; native inputs only, so scripts off works and a refused post comes back with its ticks; the words in both languages.
 */
const messages = { ro, en } as const;
let locale: "ro" | "en" = "ro";

vi.mock("next-intl/server", async () => {
  const { createTranslator } = await import("next-intl");
  return {
    getTranslations: async (arg?: string | { locale: "ro" | "en"; namespace: string }) =>
      typeof arg === "object"
        ? createTranslator({ locale: arg.locale, messages: messages[arg.locale], namespace: arg.namespace as "Event" })
        : createTranslator({ locale, messages: messages[locale], namespace: arg as "Event" }),
    getLocale: async () => locale,
  };
});
vi.mock("@/db/client", () => ({ getDb: () => undefined }));
vi.mock("@/app/[locale]/events/[slug]/volunteers/actions", () => ({ submitVolunteerAction: async () => {} }));
vi.mock("@/shared/feedback/PublicFlash", async () => {
  const { createElement: element } = await import("react");
  return { default: ({ accept }: { accept: readonly string[] }) => element("div", { "data-testid": "public-flash", "data-accepts": accept.join(",") }) };
});

const { default: VolunteerBox } = await import("@/modules/volunteers/ui/VolunteerBox");

const START_ID = "c1111111-1111-4111-8111-111111111111";
const ROUTE_ID = "c2222222-2222-4222-8222-222222222222";
const para = (text: string) => ({ type: "paragraph" as const, content: [{ type: "text" as const, text }] });
const docOf = (...lines: string[]) => ({ type: "doc" as const, content: lines.map(para) });

const role = (id: string, categoryId: string | null, nameRo: string, nameEn: string, free = 2, extra: Partial<PublicVolunteerRole> = {}): PublicVolunteerRole => ({
  id,
  nameRo,
  nameEn,
  descriptionRo: null,
  descriptionEn: null,
  descriptionRoJson: null,
  descriptionEnJson: null,
  needed: free,
  taken: 0,
  free,
  categoryId,
  ...extra,
});
const GUIDE_START = role("d1111111-1111-4111-8111-111111111111", START_ID, "Direcționare", "Guidance", 1);
const GUIDE_ROUTE = role("d2222222-2222-4222-8222-222222222222", ROUTE_ID, "Direcționare", "Guidance", 2);
const WATER = role("d3333333-3333-4333-8333-333333333333", ROUTE_ID, "Punct de hidratare", "Water point", 3, {
  descriptionRo: "Stai la kilometrul 5.\nDai apă de la 9:00.\nÎți dăm pahare.\nStrângi gunoiul.",
  descriptionEn: "Stand at km 5.\nHand out water from 9:00.\nWe give you cups.\nCollect the rubbish.",
  descriptionRoJson: docOf("Stai la kilometrul 5.", "Dai apă de la 9:00.", "Îți dăm pahare.", "Strângi gunoiul."),
  descriptionEnJson: docOf("Stand at km 5.", "Hand out water from 9:00.", "We give you cups.", "Collect the rubbish."),
});
const PHOTO = role("d4444444-4444-4444-8444-444444444444", null, "Foto/Video", "Photo/Video", 1, {
  descriptionRo: "Faci poze",
  descriptionEn: "Take photos",
  descriptionRoJson: docOf("Faci poze"),
  descriptionEnJson: docOf("Take photos"),
});
const ROLES = [GUIDE_START, GUIDE_ROUTE, WATER, PHOTO];
const CATEGORIES: PublicVolunteerCategory[] = [
  { id: START_ID, nameRo: "Start / Sosire", nameEn: "Start / Finish", contact: null },
  { id: ROUTE_ID, nameRo: "Traseu", nameEn: "Route", contact: { name: "Ana Popescu", phone: "+40712345678", email: "coordonator@club.test" } },
];

async function draw(over: Partial<ComponentProps<typeof VolunteerBox>> = {}, language: "ro" | "en" = "ro", { styles = false } = {}) {
  locale = language;
  const drawn = (await VolunteerBox({
    locale: language,
    slug: "cursa",
    eventTitle: "Crosul de toamnă",
    when: "sâmbătă, 21 nov. 2026, 09:00",
    sent: null,
    roles: ROLES,
    categories: CATEGORIES,
    shirts: false,
    showCounts: true,
    eventDay: "2026-11-21",
    profile: false,
    minors: false,
    outcome: null,
    refused: [],
    typed: {},
    renderedAt: new Date("2026-10-14T10:00:00Z"),
    attempt: "attempt",
    ...over,
  })) as ReactElement;
  const { NextIntlClientProvider } = await import("next-intl");
  const intl = { locale: language, messages: { Event: messages[language].Event, Registration: messages[language].Registration } } as unknown as ComponentProps<typeof NextIntlClientProvider>;
  const stream = await renderToReadableStream(createElement(NextIntlClientProvider, intl, drawn), { onError: () => {} });
  await stream.allReady;
  const page = (await new Response(stream).text()).replace(/<!-- -->/g, "");
  return styles ? page : page.replace(/<style[\s\S]*?<\/style>/g, "");
}

/** The cards in the order drawn, each as its own markup: from its testid to the next card's (the last to the note's). */
const cards = (page: string) => page.split('data-testid="volunteer-category"').slice(1).map((card) => card.split('data-testid="volunteer-roles-note"')[0]);
/** The chips of a chunk, each as its own markup. */
const chips = (chunk: string) => chunk.split('data-testid="volunteer-role-option"').slice(1);
/** The checkbox tags of a page, in the order drawn. */
const boxes = (page: string) => [...page.matchAll(/<input[^>]*name="roleIds"[^>]*>/g)].map((match) => match[0]);

describe("§780 each category is a calm card of its own", () => {
  it("draws one card per category in the club's order, «Alte activități» last, each with its glyph, its name as a level-3 heading and how many roles it offers", async () => {
    const page = await draw();
    const drawn = cards(page);
    expect(drawn).toHaveLength(3);
    const headings = drawn.map((card) => /<h3[^>]*data-testid="volunteer-category-heading"[^>]*>([^<]*)<\/h3>/.exec(card)?.[1]);
    expect(headings).toEqual(["Start / Sosire", "Traseu", "Alte activități"]);
    const counts = drawn.map((card) => /data-testid="volunteer-category-count"[^>]*>([^<]*)</.exec(card)?.[1]);
    expect(counts).toEqual(["1 rol", "2 roluri", "1 rol"]);
    for (const card of drawn) {
      // The header holds the glyph (decoration: aria-hidden) before the name and the count.
      const header = /data-testid="volunteer-category-header"[\s\S]*?<h3/.exec(card)?.[0] ?? "";
      expect(header).toMatch(/<svg[^>]*aria-hidden="true"/);
      // A hairline under the header, before the roles.
      expect(card).toMatch(/<hr[^>]*>/);
      expect(card.indexOf("<hr")).toBeLessThan(card.indexOf('data-testid="volunteer-role-option"'));
    }
    // Each role stands in its own card: the start's one, the route's two, the loose one.
    expect(drawn.map((card) => chips(card).length)).toEqual([1, 2, 1]);
    expect(drawn.map((card) => boxes(card).map((tag) => /value="([^"]+)"/.exec(tag)?.[1]))).toEqual([[GUIDE_START.id], [GUIDE_ROUTE.id, WATER.id], [PHOTO.id]]);
    // The group is named by its heading, for a screen reader.
    expect(page).toMatch(new RegExp(`role="group"[^>]*aria-labelledby="volunteer-category-${START_ID}"`));
    expect(page).toContain(`id="volunteer-category-${START_ID}"`);
    expect(page).toContain('id="volunteer-category-other"');
    const english = await draw({}, "en");
    expect(cards(english).map((card) => /data-testid="volunteer-category-count"[^>]*>([^<]*)</.exec(card)?.[1])).toEqual(["1 role", "2 roles", "1 role"]);
    expect(cards(english).map((card) => /<h3[^>]*>([^<]*)<\/h3>/.exec(card)?.[1])).toEqual(["Start / Finish", "Route", "Other activities"]);
  });

  it("puts the instruction line above the first card, the contact line inside the card that has one, and the owner's note under the last", async () => {
    const page = await draw();
    const help = page.indexOf(ro.Event.volunteers.choicesHelp);
    const first = page.indexOf('data-testid="volunteer-category"');
    const contact = page.indexOf('data-testid="volunteer-contact"');
    const note = page.indexOf('data-testid="volunteer-roles-note"');
    const last = page.lastIndexOf('data-testid="volunteer-category"');
    expect(help).toBeGreaterThan(-1);
    expect(help).toBeLessThan(first);
    // One contact line, in the route's card (the second), under its header and above its chips.
    expect((page.match(/data-testid="volunteer-contact"/g) ?? []).length).toBe(1);
    const route = cards(page)[1];
    expect(route).toContain('data-testid="volunteer-contact"');
    expect(route.indexOf('data-testid="volunteer-contact"')).toBeGreaterThan(route.indexOf('data-testid="volunteer-category-header"'));
    expect(route.indexOf('data-testid="volunteer-contact"')).toBeLessThan(route.indexOf('data-testid="volunteer-role-option"'));
    expect(contact).toBeGreaterThan(first);
    expect(note).toBeGreaterThan(last);
  });

  it("does not draw a card for a category with no role still needing people, and counts only the roles drawn", async () => {
    const page = await draw({ roles: [GUIDE_ROUTE, PHOTO] });
    expect(cards(page).map((card) => /<h3[^>]*>([^<]*)<\/h3>/.exec(card)?.[1])).toEqual(["Traseu", "Alte activități"]);
    expect(cards(page).map((card) => /data-testid="volunteer-category-count"[^>]*>([^<]*)</.exec(card)?.[1])).toEqual(["1 rol", "1 rol"]);
  });

  it("draws the chips under no heading and in no card for an event with no category", async () => {
    const flat = await draw({ categories: [], roles: ROLES.map((one) => ({ ...one, categoryId: null })) });
    expect(flat).not.toContain('data-testid="volunteer-category"');
    expect(flat).not.toContain("volunteer-category-header");
    expect(flat).not.toContain("<h3");
    expect(flat).not.toContain("Alte activități");
    expect(chips(flat)).toHaveLength(4);
    // Every chip in one wrap row.
    expect((flat.match(/data-testid="volunteer-role-chips"/g) ?? []).length).toBe(1);
  });

  it("has no filled band: no band test id, no deep shade, the card on the page's paper surface, the glyph on the primary's soft wash, theme tokens only", () => {
    const card = readFileSync(new URL("../../../src/modules/volunteers/ui/VolunteerCategoryCard.tsx", import.meta.url), "utf8");
    expect(card).not.toContain("volunteer-category-band");
    expect(card).not.toContain("primary.dark");
    expect(card).not.toContain("contrastText");
    expect(card).toContain('bgcolor: "background.paper"');
    expect(card).toContain('paletteWash("primary", 12)');
    expect(card).toContain('color: "primary.main"');
    // The heading is the level-3 one, 1.125rem, bold, in the primary text colour; the count is muted.
    expect(card).toContain('fontSize: "1.125rem"');
    expect(card).toContain('color: "text.primary"');
    expect(card).toContain('color="text.secondary"');
    // And no colour literal: every colour is a theme token.
    expect(card).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(/);
  });

  it("counts the roles with Romanian's three forms and English's two — the same keys in both catalogues", () => {
    const keys = (catalogue: typeof ro) => Object.keys(catalogue.Event.volunteers.roleCount).sort();
    expect(keys(en)).toEqual(keys(ro));
    expect(keys(ro)).toEqual(["few", "one", "other"]);
    // 1 rol, 2 roluri, 20 de roluri — the form the count takes picks the key.
    expect(ro.Event.volunteers.roleCount[countForm(1, "ro")]).toBe("1 rol");
    expect(ro.Event.volunteers.roleCount[countForm(4, "ro")]).toBe("{count} roluri");
    expect(ro.Event.volunteers.roleCount[countForm(20, "ro")]).toBe("{count} de roluri");
    expect(en.Event.volunteers.roleCount[countForm(1, "en")]).toBe("1 role");
    expect(en.Event.volunteers.roleCount[countForm(2, "en")]).toBe("{count} roles");
  });
});

describe("§780 each role is a chip whose face is the checkbox's label", () => {
  it("wraps the visible box and the name in one label, with the description's fold outside it", async () => {
    const page = await draw();
    const [guide, , water] = chips(page);
    // The label holds the native box, then the name — in that order, in one element.
    const label = /<label[^>]*data-testid="volunteer-role-label"[\s\S]*?<\/label>/.exec(guide)?.[0] ?? "";
    expect(label).not.toBe("");
    expect(label).toMatch(/<input[^>]*type="checkbox"[^>]*name="roleIds"/);
    expect(label.indexOf("<input")).toBeLessThan(label.indexOf("Direcționare"));
    // The count words follow the name after a middle dot, muted, while the club ticked them.
    expect(label.indexOf("Direcționare")).toBeLessThan(label.indexOf('data-testid="volunteer-role-needs"'));
    expect(label).toMatch(/aria-hidden="true"[^>]*>·</);
    expect(label).toContain("mai e nevoie de 1 persoană");
    // The «?» and the description are beside the label, not in it: a label may hold neither a link nor a fold.
    const withHelp = /<label[^>]*data-testid="volunteer-role-label"[\s\S]*?<\/label>/.exec(water)?.[0] ?? "";
    expect(withHelp).not.toContain("<details");
    expect(withHelp).not.toContain("<summary");
    expect(withHelp).not.toContain("Stai la kilometrul 5.");
    expect(water.indexOf("</label>")).toBeLessThan(water.indexOf("<details"));
    // A short description is behind a «?» as well: the description is never drawn open on its own.
    const photo = chips(page)[3];
    expect(photo.indexOf("</label>")).toBeLessThan(photo.indexOf("<details"));
    expect(photo).toContain("Faci poze");
  });

  it("names the box by the role's name alone and describes it by the count words and the description", async () => {
    const page = await draw();
    const [guide, , water] = chips(page);
    const box = (chip: string) => /<input[^>]*name="roleIds"[^>]*>/.exec(chip)?.[0] ?? "";
    const nameId = `volunteer-role-${GUIDE_START.id}-name`;
    expect(box(guide)).toContain(`aria-labelledby="${nameId}"`);
    expect(guide).toContain(`id="${nameId}"`);
    expect(box(guide)).toContain(`aria-describedby="volunteer-role-${GUIDE_START.id}-needs"`);
    expect(box(water)).toMatch(new RegExp(`aria-describedby="volunteer-role-${WATER.id}-needs volunteer-role-${WATER.id}-description"`));
    expect(water).toContain(`id="volunteer-role-${WATER.id}-description"`);
    // Without the count words the box is described by the description alone, and a role with neither names nothing.
    const quiet = await draw({ showCounts: false });
    const [quietGuide, , quietWater] = chips(quiet);
    expect(box(quietGuide)).not.toContain("aria-describedby");
    expect(box(quietWater)).toContain(`aria-describedby="volunteer-role-${WATER.id}-description"`);
  });

  it("draws a «?» only for a role with a description: outside the label, the summary of a native details, closed by default, named by the role", async () => {
    const page = await draw();
    const [guide, , water, photo] = chips(page);
    expect(guide).not.toContain("<details");
    expect(guide).not.toContain("volunteer-role-help");
    for (const [chip, name] of [
      [water, "Punct de hidratare"],
      [photo, "Foto/Video"],
    ] as const) {
      const fold = /<details[^>]*data-testid="volunteer-role-description"[^>]*>/.exec(chip)?.[0] ?? "";
      expect(fold, name).not.toBe("");
      // Closed by default: no `open` attribute.
      expect(fold, name).not.toMatch(/\sopen(=|\s|>)/);
      const summary = /<summary[^>]*data-testid="volunteer-role-help"[^>]*>[\s\S]*?<\/summary>/.exec(chip)?.[0] ?? "";
      expect(summary, name).toContain(`aria-label="Ce presupune rolul ${name}"`);
      expect(summary, name).toMatch(/<svg[^>]*aria-hidden="true"/);
      // The words are in the fold under the summary, never the other language's.
      expect(chip.indexOf("<summary")).toBeLessThan(chip.indexOf("volunteer-role-description-body"));
    }
    expect(water).not.toContain("Stand at km 5.");
    const english = await draw({}, "en");
    expect(english).toContain('aria-label="What the role Water point involves"');
    expect(english).toContain("Stand at km 5.");
  });

  it("says the count words only while the club ticked them: no «mai sunt locuri» ever, nothing by default, the same words in English", async () => {
    expect(await draw({ showCounts: true })).toContain("mai sunt necesare 3 persoane");
    const hidden = await draw({ showCounts: false });
    expect(hidden).not.toContain("mai sunt necesare");
    expect(hidden).not.toContain("mai e nevoie");
    expect(hidden).not.toContain("mai sunt locuri");
    expect(hidden).not.toContain("volunteer-role-needs");
    expect(await draw({ showCounts: true }, "en")).toContain("3 more people needed");
    expect(await draw({ showCounts: false }, "en")).not.toContain("more people needed");
  });

  it("capitalises the name's first letter by CSS on an inline-block span, and stores the text as typed", async () => {
    const id = "d5555555-5555-4555-8555-555555555555";
    const page = await draw({ roles: [role(id, null, "direcționare", "guidance", 1)], categories: [] }, "ro", { styles: true });
    const span = new RegExp(`<span[^>]*class="([^"]+)"[^>]*id="volunteer-role-${id}-name"[^>]*>direcționare</span>|<span[^>]*id="volunteer-role-${id}-name"[^>]*class="([^"]+)"[^>]*>direcționare</span>`).exec(page);
    expect(span, "the name span, stored as typed").not.toBeNull();
    // The rule must sit on the name span's own class, not on any other element of the page.
    const classes = (span![1] ?? span![2]).split(/\s+/);
    const own = (selector: RegExp) => classes.some((name) => new RegExp(`\\.${name}${selector.source}`).test(page));
    expect(own(/\{[^}]*display:inline-block/)).toBe(true);
    expect(own(/::first-letter\{[^}]*text-transform:uppercase/)).toBe(true);
  });

  it("draws the ticked state from the native box: only the roles ticked before a refusal are checked, and a role no longer offered is ignored", async () => {
    const gone = "d9999999-9999-4999-8999-999999999999";
    const page = await draw({ typed: { roleIds: `${WATER.id},${gone},${PHOTO.id}` } });
    const checked = boxes(page).filter((tag) => /\schecked(=""|\s|\/|>)/.test(tag)).map((tag) => /value="([^"]+)"/.exec(tag)?.[1]);
    expect(checked).toEqual([WATER.id, PHOTO.id]);
    expect(boxes(page)).toHaveLength(4);
    expect(boxes(await draw())).not.toContainEqual(expect.stringMatching(/\schecked/));
  });

  it("draws the ticked state in CSS from the box's :checked, with the keyboard's ring, a 22-pixel box and the pill's shape", async () => {
    expect(CHOICE_CARD_SX["&:has(input:checked)"].borderColor).toBe("primary.main");
    expect(CHOICE_CARD_SX["&:has(input:focus-visible)"].outline).toContain("2px solid");
    expect(CHOICE_INPUT_SX.width).toBe(22);
    // The drawn chip really carries it: the page's own CSS has the rules, so a chip that stopped spreading the shared surface fails here.
    // (No theme provider in this draw, so the colours are MUI's defaults, not variables: the test reads the rules, not the hues.)
    const page = await draw({}, "ro", { styles: true });
    expect(page).toMatch(/:has\(input:checked\)\{[^}]*border-color:[^;}]+;/);
    expect(page).toMatch(/:has\(input:checked\)\{[^}]*color-mix\(in srgb, var\(--mui-palette-primary-main\) 12%, transparent\)/);
    expect(page).toMatch(/:has\(input:focus-visible\)\{[^}]*outline:2px solid/);
    // A pill: the full radius.
    expect(page).toMatch(/border-radius:999px/);
    // An open «?» stretches the chip to the whole row.
    expect(page).toMatch(/:has\(details\[open\]\)\{[^}]*flex-basis:100%/);
    // The hover border only where a pointer hovers: on a phone `:hover` sticks after a tap and would keep an unticked chip's border.
    expect(page).toMatch(/@media \(hover: hover\)\{\.css-[\w-]+:hover\{border-color:/);
  });
});

describe("§780 the wrap row and the page without scripts", () => {
  it("is a wrap row of chips, never a grid of tiles", async () => {
    const page = await draw({}, "ro", { styles: true });
    expect(page).toMatch(/display:flex;[^}]*flex-wrap:wrap;[^}]*gap:/);
    expect(page).not.toContain("volunteer-role-grid");
    expect(page).not.toMatch(/grid-template-columns:\s*repeat\(2/);
    // A chip may not be wider than the row, and a long name wraps inside it.
    expect(page).toMatch(/max-width:100%/);
  });

  it("centres the closed «?» on the pill and lights the border only under the label, never under the «?»", async () => {
    const page = await draw({}, "ro", { styles: true });
    expect(page).toMatch(/:not\(\[open\]\)>summary\{[^}]*top:50%;[^}]*transform:translateY\(-50%\)/);
    expect(page).toMatch(/>summary\{[^}]*position:absolute;[^}]*top:0;[^}]*right:0/);
    expect(page).toMatch(/:has\(label:hover\)\{border-color:/);
  });

  it("no longer says in the backoffice or its toast that a role «still has room»: the page shows no number at all", () => {
    for (const catalogue of [ro, en]) {
      const words = [catalogue.Admin.volunteers.counts.help, catalogue.Feedback.toast.volunteersCountsOff].join(" ");
      expect(words).not.toMatch(/mai are locuri|still has room|still takes people/);
    }
    expect(ro.Admin.volunteers.counts.help).toContain("nu spune nicio cifră");
    expect(en.Admin.volunteers.counts.help).toContain("shows no number");
  });

  it("is plain markup with no script: the boxes are native inputs inside the form, the cards and chips are Server Components", async () => {
    const page = await draw();
    const form = /<form[\s\S]*?<\/form>/.exec(page)?.[0] ?? "";
    expect(form).not.toBe("");
    expect(boxes(form)).toHaveLength(4);
    // Native: no MUI checkbox wrapper around the role boxes.
    for (const tag of boxes(form)) expect(tag).toContain('type="checkbox"');
    expect(form).not.toMatch(/MuiCheckbox-input[^>]*name="roleIds"/);
    for (const file of ["VolunteerRoleChip.tsx", "VolunteerCategoryCard.tsx", "RoleDescription.tsx"]) {
      const source = readFileSync(new URL(`../../../src/modules/volunteers/ui/${file}`, import.meta.url), "utf8");
      expect(source, file).not.toMatch(/^\s*["']use client["']/m);
    }
  });

  it("gives every chip and every «?» the 44 pixels a thumb needs, and a glyph on the header and the «?», never the barrel", () => {
    const chip = readFileSync(new URL("../../../src/modules/volunteers/ui/VolunteerRoleChip.tsx", import.meta.url), "utf8");
    expect(chip).toContain("...TAP_TARGET");
    expect(chip).toContain("const HELP_SIZE = 44");
    expect(chip).toContain('from "@mui/icons-material/HelpOutlineOutlined"');
    expect(chip).not.toMatch(/from "@mui\/icons-material"/);
    const card = readFileSync(new URL("../../../src/modules/volunteers/ui/VolunteerCategoryCard.tsx", import.meta.url), "utf8");
    expect(card).toContain('from "@mui/icons-material/VolunteerActivism"');
    expect(card).not.toMatch(/from "@mui\/icons-material"/);
  });

  it("keeps the old tile and its grid out of the source", () => {
    expect(() => readFileSync(new URL("../../../src/modules/volunteers/ui/VolunteerRoleTile.tsx", import.meta.url), "utf8")).toThrow();
    const box = readFileSync(new URL("../../../src/modules/volunteers/ui/VolunteerBox.tsx", import.meta.url), "utf8");
    expect(box).not.toContain("RoleTileGrid");
    expect(box).not.toContain("VolunteerRoleTile");
  });
});
