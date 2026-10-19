import { createElement, type ReactElement } from "react";
import { renderToReadableStream } from "react-dom/server";
import { createTranslator } from "next-intl";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * §811, amended by §817 — where a member's level does NOT show, and what it decides, read from a real database and drawn by the
 * real pages: the zone draws no badge and names no level (the level is the staff's label alone), the public members' page has no
 * section of levels, the zone's «Coduri de reducere» tab lists the codes for everyone and those of the member's level with no
 * mark saying why a code is there — and the codes' editor, which gives each code the chips «Pentru cine e codul»: «Toți membrii»
 * first, then the levels, chosen and never left empty (§811, amended).
 * A level is a label: the zone opens for a member with a level exactly as for one with none.
 */
const state = vi.hoisted(() => ({ db: undefined as unknown, cookie: undefined as string | undefined, locale: "ro" as "ro" | "en" }));
const messages = { ro, en } as const;

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => (state.cookie ? { value: state.cookie } : undefined), set: () => {}, delete: () => {} }),
  headers: async () => new Headers(),
}));
vi.mock("@/auth", () => ({ auth: async () => null, signIn: async () => {}, signOut: async () => {} }));
vi.mock("@/db/client", () => ({ getDb: () => state.db }));
vi.mock("@/app/[locale]/admin/actions", () => ({ signOutAction: async () => {} }));
vi.mock("@/app/[locale]/admin/pages/members/actions", () => ({
  createDiscountCodeAction: async () => null,
  deleteDiscountCodeAction: async () => null,
  moveDiscountCodeAction: async () => {},
  saveDiscountCodeAction: async () => null,
  setDiscountCodeHiddenAction: async () => null,
}));
vi.mock("next-intl/server", () => ({
  setRequestLocale: () => {},
  getMessages: async () => messages[state.locale],
  getTranslations: async (input: string | { locale?: string; namespace: string }) => {
    const namespace = typeof input === "string" ? input : input.namespace;
    const locale = (typeof input === "string" ? undefined : input.locale) ?? state.locale;
    return createTranslator({ locale, messages: (messages[locale as "ro" | "en"] as Record<string, object>)[namespace] as Record<string, string>, namespace: undefined });
  },
}));

const { saveMemberTiers } = await import("@/modules/content/member-tiers/service");
const { postedTierRows } = await import("@/modules/content/member-tiers/tier-rows");
const { createDiscountCode } = await import("@/modules/content/member-codes/service");
const { listDiscountCodesForAdmin } = await import("@/modules/content/member-codes/repository");
const { setMemberTier } = await import("@/modules/staff-identity/service");
const { setMembersPagePublished } = await import("@/modules/content/members/page-settings");
const { default: MembersAreaPage } = await import("@/app/[locale]/members-area/page");
const { default: MembersPage } = await import("@/app/[locale]/members/page");
const { default: CodesCard } = await import("@/app/[locale]/admin/pages/members/CodesCard");
const { NextIntlClientProvider } = await import("next-intl");

async function markup(node: ReactElement): Promise<string> {
  const stream = await renderToReadableStream(node, { onError: () => {} });
  await stream.allReady;
  return (await new Response(stream).text()).replace(/<style[\s\S]*?<\/style>/g, "").replace(/<!-- -->/g, "").replaceAll("&#x27;", "'");
}

const NOW = new Date("2026-10-18T09:00:00.000Z");
const CODE = { partnerName: "Magazinul", code: "BVR15", descriptionRo: "15% la încălțăminte.", descriptionEn: "15% off shoes.", link: "", validUntil: "" };

/** A code for «Toți membrii»: who a code is for is chosen, never left empty (§811, amended). */
const EVERYONE = { ...CODE, forAll: true };

function rowsOf(spec: Record<string, Record<string, string>>) {
  const entries: [string, string][] = [];
  for (const [key, boxes] of Object.entries(spec)) for (const [box, value] of Object.entries(boxes)) entries.push([`tiers[${key}].${box}`, value]);
  return postedTierRows(entries);
}

describe("§811 where the member's level shows", () => {
  let db: TestDatabase;
  let close: () => Promise<void>;
  let admin: StaffUser;
  let member: StaffUser;
  let bare: StaffUser;
  let founders: { id: string };
  let plain: { id: string };

  beforeAll(async () => {
    ({ db, close } = await createTestDatabase());
    state.db = db;
  });
  afterAll(async () => close());
  beforeEach(async () => {
    await resetTables(db);
    state.locale = "ro";
    [admin] = await db.insert(staffUsers).values({ email: "admin@dev.test", displayName: "Ioana", role: "ADMIN" }).returning();
    [member] = await db.insert(staffUsers).values({ email: "membru@dev.test", displayName: "Ana Membru", role: "MEMBER" }).returning();
    [bare] = await db.insert(staffUsers).values({ email: "gol@dev.test", displayName: "Mihai Fără Nivel", role: "MEMBER" }).returning();
    await saveMemberTiers(db, { actor: admin, rows: rowsOf({ new: { nameRo: "Membru", nameEn: "Member", glyph: "star" } }), now: NOW });
    await saveMemberTiers(db, {
      actor: admin,
      rows: rowsOf({ new: { nameRo: "Fondator", nameEn: "Founder", descriptionRo: "Printre cei dintâi.", descriptionEn: "Among the first.", glyph: "trophy" } }),
      now: NOW,
    });
    await saveMemberTiers(db, { actor: admin, rows: rowsOf({ new: { nameRo: "Vechi", nameEn: "Old", descriptionRo: "Nu se mai dă.", descriptionEn: "No longer given.", hidden: "on" } }), now: NOW });
    const { listAllMemberTiers } = await import("@/modules/content/member-tiers/repository");
    [plain, founders] = await listAllMemberTiers(db);
    state.cookie = member.id;
  });

  const zone = async (locale: "ro" | "en" = "ro") => {
    state.locale = locale;
    return markup((await MembersAreaPage({ params: Promise.resolve({ locale }) })) as ReactElement);
  };

  describe("the members' zone", () => {
    it("draws no badge and names no level, with a level and without one — the zone opens for both", async () => {
      await setMemberTier(db, admin, { targetId: member.id, tierId: founders.id, now: NOW });
      const withLevel = await zone();
      expect(withLevel).toContain("Bun venit, Ana Membru.");
      expect(withLevel).toContain('data-testid="members-tabs"');
      for (const trace of ['data-testid="members-tier"', "member-tier-badge", "member-tier-help", "EmojiEventsIcon", "Fondator", "Printre cei dintâi.", "Nivelul tău"]) {
        expect(withLevel, trace).not.toContain(trace);
      }
      state.cookie = bare.id;
      const without = await zone();
      expect(without).toContain("Bun venit, Mihai Fără Nivel.");
      expect(without).toContain('data-testid="members-tabs"');
      expect(without).not.toContain("member-tier");
    });

    it("says nothing of the level in English either", async () => {
      await setMemberTier(db, admin, { targetId: member.id, tierId: founders.id, now: NOW });
      const html = await zone("en");
      expect(html).toContain("Welcome, Ana Membru.");
      for (const trace of ["Founder", "Among the first.", "Your level", "member-tier"]) expect(html, trace).not.toContain(trace);
    });

    it("keeps a hidden level on the member who holds it, and the zone draws the same whether the level is deleted or not", async () => {
      const hidden = (await (await import("@/modules/content/member-tiers/repository")).listAllMemberTiers(db))[2];
      await setMemberTier(db, admin, { targetId: member.id, tierId: plain.id, now: NOW });
      await saveMemberTiers(db, { actor: admin, rows: rowsOf({ [plain.id]: { nameRo: "Membru", nameEn: "Member", glyph: "star", hidden: "on" } }), now: NOW });
      expect(await zone()).not.toContain("member-tier");
      await setMemberTier(db, admin, { targetId: member.id, tierId: null, now: NOW });
      const { deleteMemberTier } = await import("@/modules/content/member-tiers/service");
      await deleteMemberTier(db, { actor: admin, tierId: hidden.id, now: NOW });
      expect(await zone()).not.toContain("member-tier");
    });

    it("shows the codes for everyone and those of the member's level, with no mark saying why a code is there", async () => {
      await createDiscountCode(db, { actor: admin, fields: { ...EVERYONE, code: "TOTI", partnerName: "Pentru toți" }, now: NOW });
      await createDiscountCode(db, { actor: admin, fields: { ...CODE, code: "SIMPLU", partnerName: "Doar nivelul simplu", tierIds: [plain.id] }, now: NOW });
      await createDiscountCode(db, { actor: admin, fields: { ...CODE, code: "FONDAT", partnerName: "Doar fondatorii", tierIds: [founders.id] }, now: NOW });
      await createDiscountCode(db, { actor: admin, fields: { ...CODE, code: "AMBELE", partnerName: "Ambele", tierIds: [plain.id, founders.id] }, now: NOW });
      await setMemberTier(db, admin, { targetId: member.id, tierId: founders.id, now: NOW });

      const html = await zone();
      expect(html.match(/data-testid="member-code"/g)).toHaveLength(3);
      expect(html).toContain("TOTI");
      expect(html).toContain("FONDAT");
      expect(html).toContain("AMBELE");
      expect(html).not.toContain("SIMPLU");
      // The code for everyone and the limited ones look alike: no chip, no group, no level's name on any card.
      for (const trace of ["member-code-tier", "member-code-tiers", "Codul e pentru nivelurile", "Fondator", "Membru</"]) expect(html, trace).not.toContain(trace);

      // A member with no level sees the code for everyone alone.
      state.cookie = bare.id;
      const bareHtml = await zone();
      expect(bareHtml.match(/data-testid="member-code"/g)).toHaveLength(1);
      expect(bareHtml).toContain("TOTI");
      expect(bareHtml).not.toContain("FONDAT");
    });

    it("says no code yet when every code is for another level", async () => {
      await createDiscountCode(db, { actor: admin, fields: { ...CODE, tierIds: [plain.id] }, now: NOW });
      await setMemberTier(db, admin, { targetId: member.id, tierId: founders.id, now: NOW });
      const html = await zone();
      expect(html).toContain('data-testid="members-codes-empty"');
      expect(html).not.toContain('data-testid="member-code"');
    });
  });

  describe("the public members' page", () => {
    const publicPage = async (locale: "ro" | "en" = "ro") => {
      state.locale = locale;
      // The page's links are next-intl's, which read the locale from a provider the layout gives them.
      const intl = { locale, messages: messages[locale] } as unknown as Parameters<typeof NextIntlClientProvider>[0];
      return markup(createElement(NextIntlClientProvider, intl, (await MembersPage({ params: Promise.resolve({ locale }) })) as ReactElement));
    };

    beforeEach(async () => {
      await setMembersPagePublished(db, { actor: admin, published: true, now: NOW });
      state.cookie = undefined;
    });

    it("has no section of levels and names none, however many the club has, in either language", async () => {
      await createDiscountCode(db, { actor: admin, fields: { ...CODE, code: "SECRET", tierIds: [plain.id] }, now: NOW });
      await setMemberTier(db, admin, { targetId: member.id, tierId: plain.id, now: NOW });
      for (const locale of ["ro", "en"] as const) {
        const html = await publicPage(locale);
        expect(html, locale).toContain('data-testid="members-door"');
        for (const trace of ['data-testid="members-tiers"', 'data-testid="members-tier"', "Nivelurile de membru", "Member levels", "Fondator", "Founder", "Printre cei dintâi.", "Among the first.", "Vechi", "SECRET", "Ana Membru", "membru@dev.test"]) {
          expect(html, `${locale} ${trace}`).not.toContain(trace);
        }
      }
    });
  });

  describe("the codes' editor", () => {
    const editor = async (mayManage: boolean, locale: "ro" | "en" = "ro") => {
      const codes = await listDiscountCodesForAdmin(db);
      const { listAllMemberTiers } = await import("@/modules/content/member-tiers/repository");
      const tiers = (await listAllMemberTiers(db)).map((tier) => ({ id: tier.id, name: locale === "en" ? tier.nameEn : tier.nameRo, hidden: tier.hidden }));
      const words = createTranslator({ locale, messages: messages[locale], namespace: "Admin" });
      const refusals = { errors: {}, fields: {}, fieldsIntro: "", fieldError: "", kept: "", keptConflict: "" };
      const intl = { locale, messages: { Admin: messages[locale].Admin, Translate: messages[locale].Translate } } as unknown as Parameters<typeof NextIntlClientProvider>[0];
      return markup(
        createElement(NextIntlClientProvider, intl, createElement(CodesCard, { codes, today: "2026-10-18", locale, words, cancel: "Renunță", messages: refusals, mayManage, mayEditWords: true, tiers } as never)),
      );
    };

    it("gives each code the chips «Pentru cine e codul»: «Toți membrii» first, every level a native tick, the code's levels ticked, a new code nothing", async () => {
      await createDiscountCode(db, { actor: admin, fields: { ...CODE, code: "FONDAT", tierIds: [founders.id] }, now: NOW });
      const html = await editor(true);
      // The add form and the code's own form each carry the chips.
      expect(html.match(/data-testid="tier-chips"/g)).toHaveLength(2);
      expect(html).toContain(ro.Admin.members.codes.forTiers);
      expect(html).toContain(ro.Admin.members.codes.forTiersHelp);
      expect(ro.Admin.members.codes.forTiers).toBe("Pentru cine e codul");
      const boxes = html.match(/<input[^>]*name="tierIds"[^>]*>/g) ?? [];
      expect(boxes).toHaveLength(6);
      for (const box of boxes) expect(box).toContain('type="checkbox"');
      const ticked = boxes.filter((box) => box.includes("checked"));
      expect(ticked).toHaveLength(1);
      expect(ticked[0]).toContain(`value="${founders.id}"`);
      // «Toți membrii» is the first chip of each form, its own post (`forAll`), ticked on neither: the new code starts with nothing, this one has a level.
      const everyone = html.match(/<input[^>]*name="forAll"[^>]*>/g) ?? [];
      expect(everyone).toHaveLength(2);
      for (const box of everyone) {
        expect(box).toContain('type="checkbox"');
        expect(box).toContain('value="1"');
        expect(box).not.toContain("checked");
      }
      expect(html.match(/data-testid="tier-chip-all"/g)).toHaveLength(2);
      for (const chips of html.split('data-testid="tier-chips"').slice(1)) {
        expect(chips.indexOf('name="forAll"')).toBeGreaterThan(-1);
        expect(chips.indexOf('name="forAll"')).toBeLessThan(chips.indexOf('name="tierIds"'));
        expect(chips).toContain(ro.Admin.members.codes.forAllMembers);
      }
      // A hidden level is still named, marked, so a code limited to it can be seen and changed.
      expect(html).toContain("Vechi (ascuns)");
      // The code's line names the limit in words; a code for everyone says so.
      expect(html).toContain("Pentru: Fondator");
    });

    it("shows «Toți membrii» ticked on a code with no limit and says «Pentru: Toți membrii» on its line, and draws no chips while the club named no level", async () => {
      await createDiscountCode(db, { actor: admin, fields: EVERYONE, now: NOW });
      const old = await editor(true);
      expect(old).toContain(ro.Admin.members.codes.forEveryone);
      expect(ro.Admin.members.codes.forEveryone).toBe("Pentru: Toți membrii");
      // The code's own form has «Toți membrii» ticked and no level; the add form beside it, nothing.
      const forms = old.split('data-testid="tier-chips"').slice(1);
      expect(forms).toHaveLength(2);
      const tickedIn = (chunk: string) => (chunk.match(/<input[^>]*name="(?:forAll|tierIds)"[^>]*>/g) ?? []).filter((box) => box.includes("checked")).map((box) => /name="(\w+)"/.exec(box)?.[1]);
      expect(tickedIn(forms[0])).toEqual([]);
      expect(tickedIn(forms[1])).toEqual(["forAll"]);
      const { deleteMemberTier } = await import("@/modules/content/member-tiers/service");
      const { listAllMemberTiers } = await import("@/modules/content/member-tiers/repository");
      for (const tier of await listAllMemberTiers(db)) await deleteMemberTier(db, { actor: admin, tierId: tier.id, now: NOW });
      const html = await editor(true);
      expect(html).not.toContain("tier-chips");
      expect(html).not.toContain('name="tierIds"');
      // Nothing to choose between: the form posts «Toți membrii» itself, and the code's line still says who it is for, always.
      expect(html).not.toMatch(/<input[^>]*type="checkbox"[^>]*name="forAll"/);
      expect(html.match(/<input[^>]*type="hidden"[^>]*name="forAll"[^>]*value="1"|<input[^>]*name="forAll"[^>]*type="hidden"[^>]*value="1"/g)).toHaveLength(2);
      expect(html).toContain("code-tiers-chip");
      expect(html).toContain(ro.Admin.members.codes.forEveryone);
    });

    it("shows the chips to the Administrator alone: the Redactor, who writes the words, sees none", async () => {
      await createDiscountCode(db, { actor: admin, fields: { ...CODE, tierIds: [founders.id] }, now: NOW });
      const html = await editor(false);
      expect(html).not.toContain("tier-chips");
      expect(html).not.toContain('name="tierIds"');
      expect(html).toContain("Pentru: Fondator");
    });

    it("is the same in English", async () => {
      await createDiscountCode(db, { actor: admin, fields: { ...CODE, tierIds: [founders.id] }, now: NOW });
      const html = await editor(true, "en");
      expect(html).toContain(en.Admin.members.codes.forTiers);
      expect(en.Admin.members.codes.forTiers).toBe("Who the code is for");
      expect(html).toContain(en.Admin.members.codes.forAllMembers);
      expect(html).toContain("For: Founder");
      expect(html).not.toContain("Pentru nivelurile");
    });
  });
});
