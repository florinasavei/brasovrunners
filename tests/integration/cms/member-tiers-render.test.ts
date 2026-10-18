import { createElement, type ReactElement } from "react";
import { renderToReadableStream } from "react-dom/server";
import { createTranslator } from "next-intl";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * §NNN — where a member's level shows, read from a real database and drawn by the real pages: under the member's name in the
 * zone (a badge, the description behind a «?»), after «Beneficiile membrilor» on the public members' page (the visible levels, in
 * the club's order), and on the zone's «Coduri de reducere» tab (the codes for everyone and those of the member's level, each
 * limited code wearing its levels' names) — and the codes' editor, which gives each code the chips «Pentru nivelurile».
 * A level is a label and its benefits: the zone opens for a member with a level exactly as for one with none.
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

function rowsOf(spec: Record<string, Record<string, string>>) {
  const entries: [string, string][] = [];
  for (const [key, boxes] of Object.entries(spec)) for (const [box, value] of Object.entries(boxes)) entries.push([`tiers[${key}].${box}`, value]);
  return postedTierRows(entries);
}

describe("§NNN where the member's level shows", () => {
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
    it("names the member's level under their name: the glyph, the name and the description behind a «?»", async () => {
      await setMemberTier(db, admin, { targetId: member.id, tierId: founders.id, now: NOW });
      const html = await zone();
      expect(html).toContain("Bun venit, Ana Membru.");
      expect(html).toContain('data-testid="members-tier"');
      expect(html).toContain(`aria-label="${ro.Members.tierYours}"`);
      expect(html).toMatch(/data-testid="member-tier-badge"/);
      expect(html).toContain("Fondator");
      expect(html).toContain("EmojiEventsIcon");
      expect(html).toMatch(/<button[^>]*aria-label="Printre cei dintâi\."[^>]*data-testid="member-tier-help"/);
      // The greeting comes first, the badge right under it, then the tabs.
      expect(html.indexOf("Bun venit")).toBeLessThan(html.indexOf('data-testid="members-tier"'));
      expect(html.indexOf('data-testid="members-tier"')).toBeLessThan(html.indexOf('data-testid="members-tabs"'));
    });

    it("says it in English for an English reader", async () => {
      await setMemberTier(db, admin, { targetId: member.id, tierId: founders.id, now: NOW });
      const html = await zone("en");
      expect(html).toContain("Founder");
      expect(html).toContain("Among the first.");
      expect(html).not.toContain("Fondator");
      expect(html).toContain(`aria-label="${en.Members.tierYours}"`);
    });

    it("draws no badge for a member with no level — simply «Membru» — and the zone opens all the same", async () => {
      state.cookie = bare.id;
      const html = await zone();
      expect(html).toContain("Bun venit, Mihai Fără Nivel.");
      expect(html).not.toContain('data-testid="members-tier"');
      expect(html).not.toContain("member-tier-badge");
      expect(html).toContain('data-testid="members-tabs"');
    });

    it("keeps a hidden level on the member who holds it, and a level deleted since is no badge", async () => {
      const hidden = (await (await import("@/modules/content/member-tiers/repository")).listAllMemberTiers(db))[2];
      await setMemberTier(db, admin, { targetId: member.id, tierId: plain.id, now: NOW });
      await saveMemberTiers(db, { actor: admin, rows: rowsOf({ [plain.id]: { nameRo: "Membru", nameEn: "Member", glyph: "star", hidden: "on" } }), now: NOW });
      expect(await zone()).toContain("Membru");
      expect(await zone()).toContain('data-testid="members-tier"');
      // The level deleted: nobody holds it any more, so there is nothing to draw.
      await setMemberTier(db, admin, { targetId: member.id, tierId: null, now: NOW });
      const { deleteMemberTier } = await import("@/modules/content/member-tiers/service");
      await deleteMemberTier(db, { actor: admin, tierId: hidden.id, now: NOW });
      expect(await zone()).not.toContain('data-testid="members-tier"');
    });

    it("shows the codes for everyone and those of the member's level, each limited code with its levels' names", async () => {
      await createDiscountCode(db, { actor: admin, fields: { ...CODE, code: "TOTI", partnerName: "Pentru toți" }, now: NOW });
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
      // The code for everyone says nothing about levels; the others name theirs, one small chip each.
      const cards = html.split('data-testid="member-code"').slice(1);
      expect(cards[0]).not.toContain("member-code-tiers");
      expect(cards[1]).toContain('data-testid="member-code-tiers"');
      expect(cards[1].match(/data-testid="member-code-tier"/g)).toHaveLength(1);
      expect(cards[2].match(/data-testid="member-code-tier"/g)).toHaveLength(2);
      expect(cards[2]).toContain(`aria-label="${ro.Members.codeForTiers}"`);

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

    it("lists the visible levels after the benefits, in the club's order, each with its glyph, name and description", async () => {
      const html = await publicPage();
      expect(html).toContain('data-testid="members-tiers"');
      expect(html).toContain(ro.Members.tiersTitle);
      expect(html.match(/data-testid="members-tier"/g)).toHaveLength(2);
      expect(html.indexOf("Membru")).toBeLessThan(html.indexOf("Fondator"));
      expect(html).toContain("Printre cei dintâi.");
      expect(html).toContain("EmojiEventsIcon");
      expect(html).toContain("StarIcon");
      // The hidden level is not advertised.
      expect(html).not.toContain("Vechi");
      expect(html).not.toContain("Nu se mai dă.");
      // After the benefits' place and before the door.
      expect(html.indexOf('data-testid="members-tiers"')).toBeLessThan(html.indexOf('data-testid="members-door"'));
    });

    it("lists them in English for an English reader", async () => {
      const html = await publicPage("en");
      expect(html).toContain(en.Members.tiersTitle);
      expect(html).toContain("Founder");
      expect(html).toContain("Among the first.");
      expect(html).not.toContain("Fondator");
    });

    it("follows the order the club saves, and is silent about the codes, the members and their levels", async () => {
      await saveMemberTiers(db, {
        actor: admin,
        rows: rowsOf({ [plain.id]: { nameRo: "Membru", nameEn: "Member", position: "2", was: "1" }, [founders.id]: { nameRo: "Fondator", nameEn: "Founder", descriptionRo: "Printre cei dintâi.", descriptionEn: "Among the first.", glyph: "trophy", position: "1", was: "2" } }),
        now: NOW,
      });
      await createDiscountCode(db, { actor: admin, fields: { ...CODE, code: "SECRET", tierIds: [plain.id] }, now: NOW });
      await setMemberTier(db, admin, { targetId: member.id, tierId: plain.id, now: NOW });
      const html = await publicPage();
      expect(html.indexOf("Fondator")).toBeLessThan(html.indexOf("Membru</"));
      expect(html).not.toContain("SECRET");
      expect(html).not.toContain("Ana Membru");
      expect(html).not.toContain("membru@dev.test");
    });

    it("draws no section while the club named no visible level", async () => {
      const { listAllMemberTiers } = await import("@/modules/content/member-tiers/repository");
      const all = await listAllMemberTiers(db);
      await saveMemberTiers(db, {
        actor: admin,
        rows: rowsOf(Object.fromEntries(all.map((tier, index) => [tier.id, { nameRo: tier.nameRo, nameEn: tier.nameEn, glyph: tier.glyph, hidden: "on", was: String(index + 1) }]))),
        now: NOW,
      });
      const html = await publicPage();
      expect(html).not.toContain('data-testid="members-tiers"');
      expect(html).toContain('data-testid="members-door"');
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

    it("gives each code the chips «Pentru nivelurile», every level a native tick, the code's levels ticked", async () => {
      await createDiscountCode(db, { actor: admin, fields: { ...CODE, code: "FONDAT", tierIds: [founders.id] }, now: NOW });
      const html = await editor(true);
      // The add form and the code's own form each carry the chips.
      expect(html.match(/data-testid="tier-chips"/g)).toHaveLength(2);
      expect(html).toContain(ro.Admin.members.codes.forTiers);
      expect(html).toContain(ro.Admin.members.codes.forTiersHelp);
      const boxes = html.match(/<input[^>]*name="tierIds"[^>]*>/g) ?? [];
      expect(boxes).toHaveLength(6);
      for (const box of boxes) expect(box).toContain('type="checkbox"');
      const ticked = boxes.filter((box) => box.includes("checked"));
      expect(ticked).toHaveLength(1);
      expect(ticked[0]).toContain(`value="${founders.id}"`);
      // A hidden level is still named, marked, so a code limited to it can be seen and changed.
      expect(html).toContain("Vechi (ascuns)");
      // The code's line names the limit in words; a code for everyone says so.
      expect(html).toContain("Pentru: Fondator");
    });

    it("says «Pentru toți membrii» on a code with no limit, and draws no chips while the club named no level", async () => {
      await createDiscountCode(db, { actor: admin, fields: CODE, now: NOW });
      expect(await editor(true)).toContain(ro.Admin.members.codes.forEveryone);
      const { deleteMemberTier } = await import("@/modules/content/member-tiers/service");
      const { listAllMemberTiers } = await import("@/modules/content/member-tiers/repository");
      for (const tier of await listAllMemberTiers(db)) await deleteMemberTier(db, { actor: admin, tierId: tier.id, now: NOW });
      const html = await editor(true);
      expect(html).not.toContain("tier-chips");
      expect(html).not.toContain('name="tierIds"');
      // …and no line says «for everyone» either: before any level exists the chip would say nothing.
      expect(html).not.toContain("code-tiers-chip");
      expect(html).not.toContain(ro.Admin.members.codes.forEveryone);
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
      expect(html).toContain("For: Founder");
      expect(html).not.toContain("Pentru nivelurile");
    });
  });
});
