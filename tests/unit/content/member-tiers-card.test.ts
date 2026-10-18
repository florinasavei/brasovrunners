import { type ComponentProps, createElement, type ReactElement } from "react";
import { renderToReadableStream } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { TIER_DESCRIPTION_MAX, TIER_NAME_MAX } from "@/modules/content/member-tiers/fields";
import TranslateProvider, { type TranslateAction } from "@/modules/translate/ui/TranslateProvider";

/**
 * §811, amended by §817 — «Pagini» → «Membri» → «Niveluri de membru» as the server draws it: a named card (the house's `Panel`, its glyph and its count
 * on the line, closed until opened) whose intro says what a level is for, ONE form around every level with ONE «Salvează toate nivelurile», each
 * level a row whose boxes are named by its key (no glyph box; the description is the administrators' note), the blank row at the end that adds a
 * level, «Șterge nivelul» a button that names a small form of its own, and for a reader who may not manage the levels the list and no box.
 * In Romanian and in English.
 */
const messages = { ro, en } as const;

vi.mock("@/app/[locale]/admin/pages/members/actions", () => ({ saveMemberTiersAction: async () => null, deleteMemberTierAction: async () => null }));

const { default: TiersCard } = await import("@/app/[locale]/admin/pages/members/TiersCard");
const { createTranslator, NextIntlClientProvider } = await import("next-intl");

const translate: TranslateAction = async () => ({ ok: false, reason: "notConfigured" });
const REFUSALS = { errors: {}, fields: {}, fieldsIntro: "", fieldError: "", kept: "", keptConflict: "" };

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

const row = (id: string, over: Record<string, unknown>, counts: { members?: number; codesForIt?: number } = {}) =>
  ({
    tier: {
      id,
      nameRo: "Membru",
      nameEn: "Member",
      descriptionRo: null,
      descriptionEn: null,
      glyph: "star",
      position: 1,
      hidden: false,
      updatedByStaffUserId: null,
      createdAt: new Date(0),
      updatedAt: new Date(0),
      ...over,
    },
    members: counts.members ?? 0,
    codesOnlyForIt: 0,
    codesForIt: counts.codesForIt ?? 0,
  }) as unknown as ComponentProps<typeof TiersCard>["tiers"][number];

const TIERS = [
  row(A, { nameRo: "Membru", nameEn: "Member" }, { members: 12 }),
  row(B, { nameRo: "Fondator", nameEn: "Founder", descriptionRo: "Cei dintâi.", descriptionEn: "The first.", glyph: "trophy", hidden: true, position: 2 }, { members: 1, codesForIt: 3 }),
];

async function html(element: ReactElement): Promise<string> {
  const stream = await renderToReadableStream(element, { onError: () => {} });
  await stream.allReady;
  return (await new Response(stream).text()).replace(/<style[\s\S]*?<\/style>/g, "").replace(/<!-- -->/g, "").replaceAll("&#x27;", "'");
}

async function draw(over: Partial<ComponentProps<typeof TiersCard>> = {}, locale: "ro" | "en" = "ro", offer = { action: translate, setupHref: null }) {
  const words = createTranslator({ locale, messages: messages[locale], namespace: "Admin" });
  const props = { tiers: TIERS, locale, words, cancel: "Renunță", messages: REFUSALS, mayManage: true, ...over } as unknown as ComponentProps<typeof TiersCard>;
  const intl = { locale, messages: { Translate: messages[locale].Translate, Admin: messages[locale].Admin } } as unknown as ComponentProps<typeof NextIntlClientProvider>;
  return html(createElement(NextIntlClientProvider, intl, createElement(TranslateProvider, { offer } as ComponentProps<typeof TranslateProvider>, createElement(TiersCard, props))));
}

/** One element's opening tag by its name. */
const tagOf = (page: string, element: "input" | "textarea", name: string) => new RegExp(`<${element}\\b[^>]*\\bname="${name.replace(/[[\]]/g, "\\$&")}"[^>]*>`).exec(page)?.[0] ?? "";

describe("§811 the «Niveluri de membru» card on «Membri»", () => {
  it("is a named card with its glyph, its count and its helper sentence, closed until opened", async () => {
    const page = await draw();
    expect(page).toContain('data-testid="members-tiers"');
    expect(page).toContain('id="members-tiers"');
    expect(page).toContain("Niveluri de membru");
    expect(page).toContain("2 niveluri");
    expect(page).toContain(ro.Admin.members.tiers.intro);
    expect(ro.Admin.members.tiers.intro).toBe("Un nivel decide ce coduri de reducere vede membrul; membrii nu-și văd nivelul.");
    expect(page).toMatch(/<svg[^>]*aria-hidden="true"[^>]*data-testid="WorkspacePremiumIcon"/);
    expect(page).toMatch(/<details[^>]*id="members-tiers"/);
    expect(/<details[^>]*id="members-tiers"[^>]*\sopen/.test(page)).toBe(false);
  });

  it("opens by itself after its own save, and not after another card's", async () => {
    expect(/<details[^>]*id="members-tiers"[^>]*\sopen/.test(await draw({ saved: "memberTiersSaved" }))).toBe(true);
    expect(/<details[^>]*id="members-tiers"[^>]*\sopen/.test(await draw({ saved: "memberTierDeleted" }))).toBe(true);
    expect(/<details[^>]*id="members-tiers"[^>]*\sopen/.test(await draw({ saved: "memberCodeSaved" }))).toBe(false);
  });

  it("draws ONE form around every level, with ONE «Salvează toate nivelurile» and the blank row last", async () => {
    const page = await draw();
    expect(page.match(/data-testid="member-tiers-form"/g)).toHaveLength(1);
    // One button (its label ends the element); the intro names it in quotes, which is not a second one.
    expect(page.match(/Salvează toate nivelurile</g)).toHaveLength(1);
    expect(page).toContain('name="uiLocale" value="ro"');
    expect(page.match(/data-testid="member-tier"/g)).toHaveLength(2);
    expect(page.match(/data-testid="member-tier-new"/g)).toHaveLength(1);
    expect(page.indexOf('data-testid="member-tier-new"')).toBeGreaterThan(page.lastIndexOf('data-testid="member-tier"'));
    expect(page).toContain("Adaugă un nivel");
  });

  it("names every box by its level's key, with the place the level was drawn at, and the numbers from 1", async () => {
    const page = await draw();
    for (const key of [A, B, "new"]) {
      for (const box of ["nameRo", "nameEn", "descriptionRo", "descriptionEn", "position"]) expect(tagOf(page, box.startsWith("description") ? "textarea" : "input", `tiers[${key}].${box}`), `${key} ${box}`).not.toBe("");
    }
    expect(tagOf(page, "input", `tiers[${A}].was`)).toContain('value="1"');
    expect(tagOf(page, "input", `tiers[${B}].was`)).toContain('value="2"');
    expect(tagOf(page, "input", "tiers[new].was")).toBe("");
    expect(tagOf(page, "input", `tiers[${A}].position`)).toContain('value="1"');
    expect(tagOf(page, "input", `tiers[${B}].position`)).toContain('value="2"');
    expect(tagOf(page, "input", "tiers[new].position")).toContain('placeholder="ultima"');
    expect(tagOf(page, "input", `tiers[${A}].nameRo`)).toContain('value="Membru"');
    expect(tagOf(page, "input", `tiers[${B}].nameEn`)).toContain('value="Founder"');
    expect(tagOf(page, "input", `tiers[${B}].nameRo`)).toContain(`maxLength="${TIER_NAME_MAX}"`);
    expect(tagOf(page, "textarea", `tiers[${B}].descriptionEn`)).toContain(`maxLength="${TIER_DESCRIPTION_MAX}"`);
    // A saved level keeps both names; the blank row is a level only once a name is typed in it.
    expect(tagOf(page, "input", `tiers[${A}].nameRo`)).toContain("required");
    expect(tagOf(page, "input", "tiers[new].nameRo")).not.toContain("required");
  });

  it("draws the name and the description in the page's own tabs «Română» | «English», one strip a level", async () => {
    const page = await draw();
    for (const key of [A, B, "new"]) {
      expect(page, key).toContain(`id="tier-${key}-tab-ro"`);
      expect(page, key).toContain(`id="tier-${key}-tab-en"`);
    }
    expect(tagOf(page, "input", `tiers[${A}].nameRo`)).toContain('lang="ro"');
    expect(tagOf(page, "input", `tiers[${A}].nameEn`)).toContain('lang="en"');
    expect(page).toContain(ro.Admin.members.tiers.descriptionHelp.replace("{max}", String(TIER_DESCRIPTION_MAX)));
  });

  it("labels the description as the administrators' note, in both languages, and draws no glyph box", async () => {
    const page = await draw();
    expect(page).toContain("Notă (o văd doar administratorii)");
    expect(page).not.toContain("Descriere (");
    // The glyph column stays untouched: the card neither draws nor posts a glyph, so a save leaves it as it is.
    for (const key of [A, B, "new"]) expect(page, key).not.toContain(`tiers[${key}].glyph`);
    for (const trace of ["Simbol", "Stea", "Trofeu", "Medalie"]) expect(page, trace).not.toContain(trace);
    const english = await draw({}, "en");
    expect(english).toContain("Note (only administrators see it)");
    expect(english).toContain(en.Admin.members.tiers.intro);
    expect(en.Admin.members.tiers.intro).toBe("A level decides which discount codes a member sees; members do not see their level.");
    expect(english).not.toContain("Symbol");
    expect(english).not.toContain("Description (");
  });

  it("draws a tick «Ascuns» that is ticked only where the level is hidden", async () => {
    const page = await draw();
    expect(tagOf(page, "input", `tiers[${A}].hidden`)).not.toContain("checked");
    expect(tagOf(page, "input", `tiers[${B}].hidden`)).toContain("checked");
    expect(tagOf(page, "input", `tiers[${B}].hidden`)).toContain('type="checkbox"');
    expect(page).toContain("Ascuns");
  });

  it("says on each level's line how many members hold it, whether it is hidden and how many codes name it", async () => {
    const page = await draw();
    expect(page).toContain("12 membri");
    expect(page).toContain("1 membru");
    expect(page).toContain("3 coduri");
    expect(page.match(/data-testid="member-tier-hidden"/g)).toHaveLength(1);
    expect(page.match(/data-testid="member-tier-codes"/g)).toHaveLength(1);
  });

  it("puts «Șterge nivelul» in each saved level's row, naming a small form of its own outside the big one — none on the blank row", async () => {
    const page = await draw();
    expect(page.match(/data-testid="member-tier-delete"/g)).toHaveLength(2);
    for (const id of [A, B]) {
      const button = new RegExp(`<button[^>]*form="delete-tier-${id}"[^>]*>`).exec(page)?.[0] ?? "";
      expect(button, id).toContain('type="submit"');
      expect(page).toContain(`id="delete-tier-${id}"`);
    }
    // The delete forms are siblings of the big form, never inside it (HTML forms do not nest).
    const big = page.slice(page.indexOf('data-testid="member-tiers-form"'));
    const closing = big.indexOf("</form>");
    expect(big.slice(0, closing)).not.toContain('id="delete-tier-');
    expect(page).toContain("Șterge nivelul");
  });

  it("offers «Tradu din română» under the English boxes and «Tradu cardul» once, where translation is on", async () => {
    const page = await draw();
    expect(page.match(/data-translate-for="tiers\[[^"]+\]\.nameEn"/g)).toHaveLength(3);
    expect(page.match(/data-translate-for="tiers\[[^"]+\]\.descriptionEn"/g)).toHaveLength(3);
    expect(page.match(/data-translate-scope=/g)).toHaveLength(1);
    expect(page).toContain('data-translate-scope="Niveluri de membru"');
    expect(page.match(/data-translate-row="/g)).toHaveLength(3);
  });

  it("is the same card in English, every word from the catalogue", async () => {
    const page = await draw({}, "en");
    expect(page).toContain("Member levels");
    expect(page).toContain("2 levels");
    expect(page).toContain("Save all levels");
    expect(page).toContain("Add a level");
    expect(page).toContain("Delete the level");
    expect(page).toContain("12 members");
    expect(page).toContain('name="uiLocale" value="en"');
    expect(page).not.toContain("Salvează");
    // The Administrator's own language names the level in its heading and its delete button, not the Romanian one.
    expect(page).toContain('aria-label="Delete the level: Founder"');
    expect(page).not.toContain("Delete the level: Fondator");
    expect(tagOf(page, "input", "tiers[new].position")).toContain('placeholder="last"');
  });

  it("shows the empty state and only the blank row while the club has named no level", async () => {
    const page = await draw({ tiers: [] });
    expect(page).toContain('data-testid="member-tiers-empty"');
    expect(page).toContain(ro.Admin.members.tiers.empty);
    expect(page.match(/data-testid="member-tier-new"/g)).toHaveLength(1);
    expect(page.match(/data-testid="member-tier"/g)).toBeNull();
    expect(page).toContain("0 niveluri");
  });

  it("shows a reader who may not manage the levels the list and the counts, and no form, no box, no button", async () => {
    const page = await draw({ mayManage: false });
    expect(page).toContain('data-testid="member-tier-readonly"');
    expect(page).toContain("Membru");
    expect(page).toContain("12 membri");
    expect(page).toContain(ro.Admin.members.tiers.adminOnly);
    expect(page).not.toContain("<form");
    expect(page).not.toContain("Salvează toate nivelurile");
    expect(page).not.toContain("tiers[");
  });

  it("has a word for every box and button of the card, in both languages, and none for a glyph", () => {
    for (const language of [ro, en]) {
      const tiers = language.Admin.members.tiers;
      expect("glyphs" in tiers).toBe(false);
      expect("glyph" in tiers).toBe(false);
      for (const key of ["heading", "intro", "introMore", "empty", "rowsIntro", "newRow", "nameRo", "nameEn", "descriptionRo", "descriptionEn", "descriptionHelp", "position", "hidden", "save", "delete", "deleteTitle", "deleteBody"]) {
        expect(typeof (tiers as Record<string, unknown>)[key], key).toBe("string");
      }
      for (const form of ["one", "few", "other"] as const) {
        expect(tiers.count[form]).toContain("{count}");
        expect(tiers.members[form]).toContain("{count}");
        expect(tiers.codes[form]).toContain("{count}");
      }
    }
  });
});
