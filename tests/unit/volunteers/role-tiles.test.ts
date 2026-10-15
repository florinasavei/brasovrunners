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
 * §NNN — the volunteers' page's roles as the server draws them: each category its own card (a band with its glyph, its name as the
 * level-3 heading and «4 roluri», its contact line, its tiles inside), «Alte activități» last with the same look, no card at all for an
 * event with no category; each role a tile whose whole surface is the checkbox's label (the name, the count line under the name, the
 * description outside the label); the ticked state, which the CSS draws from `:checked`; the grid's one column and its two from the tablet
 * width; native inputs only, so scripts off works and a refused post comes back with its ticks; the words in both languages.
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
/** The tiles of a chunk, each as its own markup. */
const tiles = (chunk: string) => chunk.split('data-testid="volunteer-role-option"').slice(1);
/** The checkbox tags of a page, in the order drawn. */
const boxes = (page: string) => [...page.matchAll(/<input[^>]*name="roleIds"[^>]*>/g)].map((match) => match[0]);

describe("§NNN each category is a card of its own", () => {
  it("draws one card per category in the club's order, «Alte activități» last, each with its glyph, its name as a level-3 heading and how many roles it offers", async () => {
    const page = await draw();
    const drawn = cards(page);
    expect(drawn).toHaveLength(3);
    const headings = drawn.map((card) => /<h3[^>]*data-testid="volunteer-category-heading"[^>]*>([^<]*)<\/h3>/.exec(card)?.[1]);
    expect(headings).toEqual(["Start / Sosire", "Traseu", "Alte activități"]);
    const counts = drawn.map((card) => /data-testid="volunteer-category-count"[^>]*>([^<]*)</.exec(card)?.[1]);
    expect(counts).toEqual(["1 rol", "2 roluri", "1 rol"]);
    for (const card of drawn) {
      // The band holds the glyph (decoration: aria-hidden) before the name and the count.
      const band = /data-testid="volunteer-category-band"[\s\S]*?<h3/.exec(card)?.[0] ?? "";
      expect(band).toMatch(/<svg[^>]*aria-hidden="true"/);
    }
    // Each role stands in its own card: the start's one, the route's two, the loose one.
    expect(drawn.map((card) => tiles(card).length)).toEqual([1, 2, 1]);
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
    // One contact line, in the route's card (the second), under its band and above its tiles.
    expect((page.match(/data-testid="volunteer-contact"/g) ?? []).length).toBe(1);
    const route = cards(page)[1];
    expect(route).toContain('data-testid="volunteer-contact"');
    expect(route.indexOf('data-testid="volunteer-contact"')).toBeGreaterThan(route.indexOf('data-testid="volunteer-category-band"'));
    expect(route.indexOf('data-testid="volunteer-contact"')).toBeLessThan(route.indexOf('data-testid="volunteer-role-option"'));
    expect(contact).toBeGreaterThan(first);
    expect(note).toBeGreaterThan(last);
  });

  it("does not draw a card for a category with no role still needing people, and counts only the roles drawn", async () => {
    const page = await draw({ roles: [GUIDE_ROUTE, PHOTO] });
    expect(cards(page).map((card) => /<h3[^>]*>([^<]*)<\/h3>/.exec(card)?.[1])).toEqual(["Traseu", "Alte activități"]);
    expect(cards(page).map((card) => /data-testid="volunteer-category-count"[^>]*>([^<]*)</.exec(card)?.[1])).toEqual(["1 rol", "1 rol"]);
  });

  it("draws the tiles under no heading and in no card for an event with no category", async () => {
    const flat = await draw({ categories: [], roles: ROLES.map((one) => ({ ...one, categoryId: null })) });
    expect(flat).not.toContain('data-testid="volunteer-category"');
    expect(flat).not.toContain("volunteer-category-band");
    expect(flat).not.toContain("<h3");
    expect(flat).not.toContain("Alte activități");
    expect(tiles(flat)).toHaveLength(4);
    // Every tile in one grid.
    expect((flat.match(/data-testid="volunteer-role-grid"/g) ?? []).length).toBe(1);
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

describe("§NNN each role is a tile the whole of which is the checkbox's label", () => {
  it("wraps the box, the name and the count line in one label, the count under the name, and keeps the description outside it", async () => {
    const page = await draw();
    const [guide, , water] = tiles(page);
    // The label holds the native box, then the name, then the count line — in that order, in one element.
    const label = /<label[^>]*data-testid="volunteer-role-label"[\s\S]*?<\/label>/.exec(guide)?.[0] ?? "";
    expect(label).not.toBe("");
    expect(label).toMatch(/<input[^>]*type="checkbox"[^>]*name="roleIds"/);
    expect(label.indexOf("<input")).toBeLessThan(label.indexOf("Direcționare"));
    expect(label.indexOf("Direcționare")).toBeLessThan(label.indexOf('data-testid="volunteer-role-needs"'));
    expect(label).toContain("mai e nevoie de 1 persoană");
    // The description is under the label, not in it: it may hold a link and a native fold, which a label may not.
    const folded = /<label[^>]*data-testid="volunteer-role-label"[\s\S]*?<\/label>/.exec(water)?.[0] ?? "";
    expect(folded).not.toContain("<details");
    expect(folded).not.toContain("Stai la kilometrul 5.");
    expect(water.indexOf("</label>")).toBeLessThan(water.indexOf("<details"));
    expect(water).toMatch(/<details[^>]*data-testid="volunteer-role-description"[^>]*data-folded="true"/);
    // A short description is plain text under the label, not a fold.
    const photo = tiles(page)[3];
    expect(photo).not.toContain("<details");
    expect(photo.indexOf("</label>")).toBeLessThan(photo.indexOf("Faci poze"));
  });

  it("names the box by the role's name alone and describes it by the count line and the description", async () => {
    const page = await draw();
    const [guide, , water] = tiles(page);
    const box = (tile: string) => /<input[^>]*name="roleIds"[^>]*>/.exec(tile)?.[0] ?? "";
    const nameId = `volunteer-role-${GUIDE_START.id}-name`;
    expect(box(guide)).toContain(`aria-labelledby="${nameId}"`);
    expect(guide).toContain(`id="${nameId}"`);
    expect(box(guide)).toContain(`aria-describedby="volunteer-role-${GUIDE_START.id}-needs"`);
    expect(box(water)).toMatch(new RegExp(`aria-describedby="volunteer-role-${WATER.id}-needs volunteer-role-${WATER.id}-description"`));
    expect(water).toContain(`id="volunteer-role-${WATER.id}-description"`);
  });

  it("says the count line as before — a number only while the club ticked it — and keeps the same words in English", async () => {
    expect(await draw({ showCounts: true })).toContain("mai sunt necesare 3 persoane");
    const hidden = await draw({ showCounts: false });
    expect(hidden).not.toContain("mai sunt necesare");
    expect((hidden.match(/mai sunt locuri/g) ?? []).length).toBe(4);
    expect(await draw({ showCounts: true }, "en")).toContain("3 more people needed");
  });

  it("draws the ticked state from the native box: only the roles ticked before a refusal are checked, and a role no longer offered is ignored", async () => {
    const gone = "d9999999-9999-4999-8999-999999999999";
    const page = await draw({ typed: { roleIds: `${WATER.id},${gone},${PHOTO.id}` } });
    const checked = boxes(page).filter((tag) => /\schecked(=""|\s|\/|>)/.test(tag)).map((tag) => /value="([^"]+)"/.exec(tag)?.[1]);
    expect(checked).toEqual([WATER.id, PHOTO.id]);
    expect(boxes(page)).toHaveLength(4);
    expect(boxes(await draw())).not.toContainEqual(expect.stringMatching(/\schecked/));
  });

  it("draws the ticked state in CSS from the box's :checked, with the keyboard's ring and a 22-pixel box", async () => {
    expect(CHOICE_CARD_SX["&:has(input:checked)"].borderColor).toBe("primary.main");
    expect(CHOICE_CARD_SX["&:has(input:checked)"].bgcolor).toContain("color-mix");
    expect(CHOICE_CARD_SX["&:has(input:focus-visible)"].outline).toContain("2px solid");
    // Two pixels wide always, so ticking a tile never moves its words.
    expect(CHOICE_CARD_SX.border).toBe(2);
    expect(CHOICE_INPUT_SX.width).toBe(22);
    // And the drawn tile really carries it: the page's own CSS has the rules, so a tile that stopped spreading the shared surface fails here.
    // (No theme provider in this draw, so the colours are MUI's defaults, not variables: the test reads the rules, not the hues.)
    const page = await draw({}, "ro", { styles: true });
    expect(page).toMatch(/:has\(input:checked\)\{[^}]*border-color:[^;}]+;/);
    expect(page).toMatch(/:has\(input:focus-visible\)\{[^}]*outline:2px solid/);
    // The hover border only where a pointer hovers: on a phone `:hover` sticks after a tap and would keep an unticked tile's border.
    expect(page).toMatch(/@media \(hover: hover\)\{\.css-[\w-]+:hover\{border-color:/);
    expect(page).not.toMatch(/\}\.css-[\w-]+:hover\{border-color:/.source.length ? /(?<!\{)\.css-[\w-]+:hover\{border-color:/ : /x^/);
  });

  it("stretches the label over the whole tile, and the band is the deep shade of the primary, never the pure blue", async () => {
    const page = await draw({}, "ro", { styles: true });
    expect(page).toMatch(/::after\{[^}]*position:absolute[^}]*inset:0/);
    const card = readFileSync(new URL("../../../src/modules/volunteers/ui/VolunteerCategoryCard.tsx", import.meta.url), "utf8");
    expect(card).toContain('bgcolor: "primary.dark"');
    expect(card).not.toContain('bgcolor: "primary.main"');
  });
});

describe("§NNN the grid and the page without scripts", () => {
  it("is one column on a phone and two from the tablet width, in the columns a long name cannot stretch", async () => {
    const page = await draw({}, "ro", { styles: true });
    // Emotion writes the rule as `grid-template-columns: minmax(0, 1fr)` and, under the `sm` breakpoint, `repeat(2, minmax(0, 1fr))`.
    expect(page).toMatch(/grid-template-columns:\s*minmax\(0,\s*1fr\)/);
    expect(page).toMatch(/@media[^{]*min-width:\s*600px[^{]*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
  });

  it("is plain markup with no script: the boxes are native inputs inside the form, the cards and tiles are Server Components", async () => {
    const page = await draw();
    const form = /<form[\s\S]*?<\/form>/.exec(page)?.[0] ?? "";
    expect(form).not.toBe("");
    expect(boxes(form)).toHaveLength(4);
    // Native: no MUI checkbox wrapper around the role boxes.
    for (const tag of boxes(form)) expect(tag).toContain('type="checkbox"');
    expect(form).not.toMatch(/MuiCheckbox-input[^>]*name="roleIds"/);
    for (const file of ["VolunteerRoleTile.tsx", "VolunteerCategoryCard.tsx"]) {
      const source = readFileSync(new URL(`../../../src/modules/volunteers/ui/${file}`, import.meta.url), "utf8");
      expect(source, file).not.toMatch(/^\s*["']use client["']/m);
    }
  });

  it("gives every tile the 44 pixels a thumb needs and a glyph on the band, never the barrel", () => {
    const tile = readFileSync(new URL("../../../src/modules/volunteers/ui/VolunteerRoleTile.tsx", import.meta.url), "utf8");
    expect(tile).toContain("...TAP_TARGET");
    const card = readFileSync(new URL("../../../src/modules/volunteers/ui/VolunteerCategoryCard.tsx", import.meta.url), "utf8");
    expect(card).toContain('from "@mui/icons-material/VolunteerActivism"');
    expect(card).not.toMatch(/from "@mui\/icons-material"/);
  });
});
