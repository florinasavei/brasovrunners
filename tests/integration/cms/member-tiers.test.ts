import { asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createTranslator } from "next-intl";
import ro from "../../../messages/ro.json";
import { auditLogs } from "@/db/schema/audit-logs";
import { memberDiscountCodes } from "@/db/schema/member-discount-codes";
import { memberTiers } from "@/db/schema/member-tiers";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { GLYPHS } from "@/modules/events/ui/glyphs";
import { TIER_GLYPH } from "@/modules/events/ui/tier-glyphs";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * §811 — «Niveluri de membru»: the levels the club names for its members, the level each member holds, and the partners'
 * codes limited to some levels. A level is a label and its benefits, never a permission.
 *
 * Proven on real PostgreSQL (PGlite): the one save of every row (add through the blank row, edit, reorder by the numbers
 * typed, hide), the delete refused while a member holds the level or a code is for it alone, the member's level given,
 * cleared and audited (and cleared with a role that is no member's), the bulk add giving one level to the rows it adds,
 * and the members' read of the codes filtered by the member's level. Asserted on the server whatever the screen offered
 * (BR-REQ-060-01): a Redactor, a volunteer and a member are refused at every write.
 */
const state = vi.hoisted(() => ({ db: undefined as unknown, cookie: undefined as string | undefined }));

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => (state.cookie ? { value: state.cookie } : undefined), set: () => {}, delete: () => {} }),
  headers: async () => new Headers(),
}));
vi.mock("@/auth", () => ({ auth: async () => null, signIn: async () => {}, signOut: async () => {} }));
vi.mock("@/db/client", () => ({ getDb: () => state.db }));
vi.mock("next-intl/server", () => ({
  setRequestLocale: () => {},
  getMessages: async () => ro,
  getTranslations: async (namespace: string) =>
    createTranslator({ locale: "ro", messages: (ro as Record<string, object>)[namespace] as Record<string, string>, namespace: undefined }),
}));

const { saveMemberTiers, deleteMemberTier } = await import("@/modules/content/member-tiers/service");
const { listMemberTiersForAdmin, tierUsage } = await import("@/modules/content/member-tiers/admin-repository");
const { listAllMemberTiers, tierViewOf } = await import("@/modules/content/member-tiers/repository");
const { postedTierRows, tierBox, orderTierRows } = await import("@/modules/content/member-tiers/tier-rows");
const { TIER_GLYPH_KEYS, isTierGlyphKey } = await import("@/modules/content/member-tiers/glyph-keys");
const { tierFieldsSchema } = await import("@/modules/content/member-tiers/fields");
const { createDiscountCode, saveDiscountCode } = await import("@/modules/content/member-codes/service");
const { codeIsForTier, listDiscountCodesForAdmin, listDiscountCodesForMembers } = await import("@/modules/content/member-codes/repository");
const { changeStaffRole, inviteMembers, setMemberTier } = await import("@/modules/staff-identity/service");
const { inviteMembersAction } = await import("@/app/[locale]/admin/actions");
const { saveMemberTiersAction, deleteMemberTierAction, createDiscountCodeAction, saveDiscountCodeAction } = await import("@/app/[locale]/admin/pages/members/actions");
const { setMemberTierAction } = await import("@/app/[locale]/admin/actions");
const { parseMemberRows } = await import("@/modules/staff-identity/domain/member-rows");

const NOW = new Date("2026-10-18T09:00:00.000Z");
const LATER = new Date("2026-10-18T09:30:00.000Z");

/** The posted rows of a form: `{ <key>: { <box>: value } }` as `tiers[<key>].<box>`. */
function rowsOf(spec: Record<string, Record<string, string>>) {
  const entries: [string, string][] = [];
  for (const [key, boxes] of Object.entries(spec)) for (const [box, value] of Object.entries(boxes)) entries.push([`tiers[${key}].${box}`, value]);
  return postedTierRows(entries);
}

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
}

/** Where a Next `redirect()` pointed, read from the error it throws. */
async function redirectedTo(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    const digest = (error as { digest?: string }).digest ?? "";
    if (digest.startsWith("NEXT_REDIRECT")) return digest.split(";")[2];
    throw error;
  }
  throw new Error("expected a redirect");
}

const CODE = {
  partnerName: "Magazinul Alergătorului",
  code: "BVR15",
  descriptionRo: "15% la încălțăminte.",
  descriptionEn: "15% off shoes.",
  link: "https://example.ro/reduceri",
  validUntil: "",
};

/** A code for «Toți membrii»: who a code is for is chosen, never left empty (§811, amended). */
const EVERYONE = { ...CODE, forAll: true };

describe("§811 the member tiers", () => {
  let db: TestDatabase;
  let close: () => Promise<void>;
  let admin: StaffUser;
  let copywriter: StaffUser;
  let volunteer: StaffUser;
  let member: StaffUser;

  beforeAll(async () => {
    ({ db, close } = await createTestDatabase());
    state.db = db;
  });
  afterAll(async () => close());
  beforeEach(async () => {
    await resetTables(db);
    [admin] = await db.insert(staffUsers).values({ email: "admin@dev.test", displayName: "Admin", role: "ADMIN" }).returning();
    [copywriter] = await db.insert(staffUsers).values({ email: "redactor@dev.test", displayName: "Redactor", role: "COPYWRITER" }).returning();
    [volunteer] = await db.insert(staffUsers).values({ email: "voluntar@dev.test", displayName: "Voluntar", role: "CONTRIBUTOR" }).returning();
    [member] = await db.insert(staffUsers).values({ email: "membru@dev.test", displayName: "Ana Membru", role: "MEMBER" }).returning();
    state.cookie = admin.id;
  });

  const names = async () => (await listAllMemberTiers(db)).map((tier) => tier.nameRo);

  /** Two levels, «Membru» first and «Fondator» second, written through the one save. */
  async function twoTiers() {
    await saveMemberTiers(db, { actor: admin, rows: rowsOf({ new: { nameRo: "Membru", nameEn: "Member" } }), now: NOW });
    await saveMemberTiers(db, {
      actor: admin,
      rows: rowsOf({ new: { nameRo: "Fondator", nameEn: "Founder", descriptionRo: "Cei dintâi.", descriptionEn: "The first.", glyph: "trophy" } }),
      now: NOW,
    });
    const [first, second] = await listAllMemberTiers(db);
    return { first, second };
  }

  /** The row every saved level posts when it is left alone. */
  const unchanged = (tier: typeof memberTiers.$inferSelect, place: number) => ({
    nameRo: tier.nameRo,
    nameEn: tier.nameEn,
    descriptionRo: tier.descriptionRo ?? "",
    descriptionEn: tier.descriptionEn ?? "",
    glyph: tier.glyph,
    position: String(place),
    was: String(place),
    ...(tier.hidden ? { hidden: "on" } : {}),
  });

  describe("«Salvează toate nivelurile»", () => {
    it("adds a level through the blank row, last, with the star by default, and says nothing of a blank row left alone", async () => {
      const blank = rowsOf({ new: { nameRo: "", nameEn: "", descriptionRo: "", descriptionEn: "", glyph: "star", position: "" } });
      expect(await saveMemberTiers(db, { actor: admin, rows: blank, now: NOW })).toEqual({ changed: false, created: 0, edited: 0, moved: 0 });
      expect(await listAllMemberTiers(db)).toEqual([]);

      const { first, second } = await twoTiers();
      expect([first.nameRo, first.nameEn, first.glyph, first.position, first.hidden, first.descriptionRo]).toEqual(["Membru", "Member", "star", 1, false, null]);
      expect([second.nameRo, second.glyph, second.position, second.descriptionEn]).toEqual(["Fondator", "trophy", 2, "The first."]);
      expect(second.updatedByStaffUserId).toBe(admin.id);
    });

    it("edits what changed, leaves the rest, and audits the parts that changed — never the words", async () => {
      const { first, second } = await twoTiers();
      const result = await saveMemberTiers(db, {
        actor: admin,
        rows: rowsOf({
          [first.id]: { ...unchanged(first, 1), nameEn: "Plain member", glyph: "heart" },
          [second.id]: unchanged(second, 2),
        }),
        now: NOW,
      });
      expect(result).toEqual({ changed: true, created: 0, edited: 1, moved: 0 });
      const [renamed] = await db.select().from(memberTiers).where(eq(memberTiers.id, first.id));
      expect([renamed.nameRo, renamed.nameEn, renamed.glyph]).toEqual(["Membru", "Plain member", "heart"]);
      const audit = await db.select().from(auditLogs).where(eq(auditLogs.action, "member_tier.edited"));
      expect(audit).toHaveLength(1);
      expect(audit[0].entityId).toBe(first.id);
      expect(audit[0].metadataJson).toEqual({ parts: ["name", "glyph"], hidden: false });
      expect(JSON.stringify(await db.select().from(auditLogs))).not.toMatch(/Fondator|Plain member|Cei dintâi/);
    });

    it("changes nothing, and audits nothing, when every row is as it was", async () => {
      const { first, second } = await twoTiers();
      const before = (await db.select().from(auditLogs)).length;
      const result = await saveMemberTiers(db, { actor: admin, rows: rowsOf({ [first.id]: unchanged(first, 1), [second.id]: unchanged(second, 2), new: {} }), now: NOW });
      expect(result.changed).toBe(false);
      expect((await db.select().from(auditLogs)).length).toBe(before);
    });

    it("orders by the numbers typed: a lower number goes before the level that holds it, a higher one after it, and the gaps close", async () => {
      const { first, second } = await twoTiers();
      await saveMemberTiers(db, { actor: admin, rows: rowsOf({ new: { nameRo: "Sprijinitor", nameEn: "Supporter", position: "" } }), now: NOW });
      expect(await names()).toEqual(["Membru", "Fondator", "Sprijinitor"]);
      const third = (await listAllMemberTiers(db))[2];
      const place = (tier: typeof first, n: number) => unchanged(tier, n);

      // 1 typed on the third: it goes first, the others move down; only it is audited as moved.
      const up = await saveMemberTiers(db, {
        actor: admin,
        rows: rowsOf({ [first.id]: place(first, 1), [second.id]: place(second, 2), [third.id]: { ...place(third, 3), position: "1" } }),
        now: LATER,
      });
      expect(up).toMatchObject({ changed: true, edited: 0, moved: 1 });
      expect(await names()).toEqual(["Sprijinitor", "Membru", "Fondator"]);
      expect((await listAllMemberTiers(db)).map((tier) => tier.position)).toEqual([1, 2, 3]);
      const moved = await db.select().from(auditLogs).where(eq(auditLogs.action, "member_tier.moved"));
      expect(moved.map((row) => row.entityId)).toEqual([third.id]);
      // The level moved by hand carries when it was moved; one that only gave way keeps its own stamp.
      const stamps = new Map((await listAllMemberTiers(db)).map((tier) => [tier.id, tier.updatedAt.getTime()]));
      expect(stamps.get(third.id)).toBe(LATER.getTime());
      expect(stamps.get(first.id)).not.toBe(LATER.getTime());

      // 3 typed on the first (now second): it goes after the one holding 3.
      const fresh = await listAllMemberTiers(db);
      const down = await saveMemberTiers(db, {
        actor: admin,
        rows: rowsOf({ [fresh[0].id]: unchanged(fresh[0], 1), [fresh[1].id]: { ...unchanged(fresh[1], 2), position: "3" }, [fresh[2].id]: unchanged(fresh[2], 3) }),
        now: NOW,
      });
      expect(down.moved).toBe(1);
      expect(await names()).toEqual(["Sprijinitor", "Fondator", "Membru"]);
    });

    it("puts a new level where its number says, before the level that holds it", async () => {
      const { first, second } = await twoTiers();
      await saveMemberTiers(db, {
        actor: admin,
        rows: rowsOf({ [first.id]: unchanged(first, 1), [second.id]: unchanged(second, 2), new: { nameRo: "Nou", nameEn: "New", position: "1" } }),
        now: NOW,
      });
      expect(await names()).toEqual(["Nou", "Membru", "Fondator"]);
      expect((await listAllMemberTiers(db)).map((tier) => tier.position)).toEqual([1, 2, 3]);
    });

    it("hides and shows a level by the tick, and a row with its words and no tick says not hidden", async () => {
      const { first } = await twoTiers();
      await saveMemberTiers(db, { actor: admin, rows: rowsOf({ [first.id]: { ...unchanged(first, 1), hidden: "on" } }), now: NOW });
      expect((await listAllMemberTiers(db)).map((tier) => [tier.nameRo, tier.hidden])).toEqual([["Membru", true], ["Fondator", false]]);
      const shown = await saveMemberTiers(db, { actor: admin, rows: rowsOf({ [first.id]: unchanged({ ...first, hidden: false }, 1) }), now: NOW });
      expect(shown.edited).toBe(1);
      expect((await listAllMemberTiers(db)).map((tier) => [tier.nameRo, tier.hidden])).toEqual([["Membru", false], ["Fondator", false]]);
      const audit = await db.select().from(auditLogs).where(eq(auditLogs.action, "member_tier.edited"));
      expect(audit.map((row) => row.metadataJson)).toEqual([
        { parts: ["hidden"], hidden: true },
        { parts: ["hidden"], hidden: false },
      ]);
    });

    it("refuses the whole save when one row is refused, naming its boxes, and writes none of the others", async () => {
      const { first, second } = await twoTiers();
      const refused = saveMemberTiers(db, {
        actor: admin,
        rows: rowsOf({
          [first.id]: { ...unchanged(first, 1), nameRo: "Alt nume" },
          [second.id]: { ...unchanged(second, 2), descriptionEn: "", glyph: "nope", position: "abc" },
          new: { nameRo: "Doar română", nameEn: "" },
        }),
        now: NOW,
      });
      await expect(refused).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
      const error = (await refused.then(
        () => null,
        (caught: unknown) => caught,
      )) as { fields: string[] };
      expect([...error.fields].sort()).toEqual(
        [tierBox(second.id, "descriptionEn"), tierBox(second.id, "glyph"), tierBox(second.id, "position"), tierBox("new", "nameEn")].sort(),
      );
      // The first row's good edit was not written either.
      expect(await names()).toEqual(["Membru", "Fondator"]);
    });

    it("refuses a name past forty characters, one language of the description, a position below one and a level deleted meanwhile", async () => {
      const { first } = await twoTiers();
      await expect(saveMemberTiers(db, { actor: admin, rows: rowsOf({ new: { nameRo: "a".repeat(41), nameEn: "Long" } }), now: NOW })).rejects.toMatchObject({ fields: [tierBox("new", "nameRo")] });
      await expect(saveMemberTiers(db, { actor: admin, rows: rowsOf({ new: { nameRo: "Nou", nameEn: "New", descriptionRo: "Doar română." } }), now: NOW })).rejects.toMatchObject({ fields: [tierBox("new", "descriptionEn")] });
      await expect(saveMemberTiers(db, { actor: admin, rows: rowsOf({ [first.id]: { ...unchanged(first, 1), position: "0" } }), now: NOW })).rejects.toMatchObject({ fields: [tierBox(first.id, "position")] });
      await expect(
        saveMemberTiers(db, { actor: admin, rows: rowsOf({ "00000000-0000-4000-8000-000000000099": { nameRo: "Fantomă", nameEn: "Ghost" } }), now: NOW }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(saveMemberTiers(db, { actor: admin, rows: rowsOf({ "nu-e-un-id": { nameRo: "Fantomă", nameEn: "Ghost" } }), now: NOW })).rejects.toMatchObject({ code: "NOT_FOUND" });
      expect(await names()).toEqual(["Membru", "Fondator"]);
    });

    it("keeps a club to twelve levels", async () => {
      for (let n = 1; n <= 12; n += 1) await saveMemberTiers(db, { actor: admin, rows: rowsOf({ new: { nameRo: `Nivel ${n}`, nameEn: `Level ${n}` } }), now: NOW });
      expect(await listAllMemberTiers(db)).toHaveLength(12);
      await expect(saveMemberTiers(db, { actor: admin, rows: rowsOf({ new: { nameRo: "Al treisprezecelea", nameEn: "Thirteenth" } }), now: NOW })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
      expect(await listAllMemberTiers(db)).toHaveLength(12);
    });

    it("is refused to a Redactor, a volunteer and a member, and writes nothing", async () => {
      for (const actor of [copywriter, volunteer, member]) {
        await expect(saveMemberTiers(db, { actor, rows: rowsOf({ new: { nameRo: "Nou", nameEn: "New" } }), now: NOW })).rejects.toMatchObject({ code: "FORBIDDEN" });
      }
      expect(await listAllMemberTiers(db)).toEqual([]);
    });

    it("reads the posted form into rows by the names the card draws, and the action saves, refuses and redirects", async () => {
      const rows = rowsOf({ new: { nameRo: "Membru", nameEn: "Member", hidden: "on" } });
      expect(rows).toEqual([{ key: "new", id: null, fields: { nameRo: "Membru", nameEn: "Member", hidden: "on" } }]);
      expect(orderTierRows([{ key: "a", was: 1, typed: null }, { key: "b", was: 2, typed: 1 }, { key: "n", was: null, typed: null }])).toEqual(["b", "a", "n"]);

      const refusal = await saveMemberTiersAction(null, form({ uiLocale: "ro", [tierBox("new", "nameRo")]: "Doar română", [tierBox("new", "nameEn")]: "" }));
      expect(refusal).toMatchObject({ error: "VALIDATION_ERROR", fields: [tierBox("new", "nameEn")] });
      expect(refusal?.values[tierBox("new", "nameRo")]).toEqual(["Doar română"]);

      const to = await redirectedTo(saveMemberTiersAction(null, form({ uiLocale: "ro", [tierBox("new", "nameRo")]: "Membru", [tierBox("new", "nameEn")]: "Member" })));
      expect(to).toBe("/ro/admin/pages/members?saved=memberTiersSaved#members-tiers");
      expect(await names()).toEqual(["Membru"]);

      const [tier] = await listAllMemberTiers(db);
      const again = await redirectedTo(saveMemberTiersAction(null, form({ uiLocale: "ro", ...Object.fromEntries(Object.entries(unchanged(tier, 1)).map(([box, value]) => [tierBox(tier.id, box as "nameRo"), value])) })));
      expect(again).toContain("saved=memberTiersUnchanged");

      // A Redactor is staff and is refused the capability; a member is no staff at all.
      const another = form({ uiLocale: "ro", [tierBox("new", "nameRo")]: "Alt", [tierBox("new", "nameEn")]: "Other" });
      state.cookie = copywriter.id;
      expect((await saveMemberTiersAction(null, another))?.error).toBe("FORBIDDEN");
      state.cookie = member.id;
      expect((await saveMemberTiersAction(null, another))?.error).toBe("UNAUTHENTICATED");
      expect(await names()).toEqual(["Membru"]);
    });
  });

  describe("«Șterge nivelul»", () => {
    it("deletes a level nobody holds, closes the gap, and audits it by id with no name", async () => {
      const { first, second } = await twoTiers();
      await deleteMemberTier(db, { actor: admin, tierId: first.id, now: NOW });
      const rest = await listAllMemberTiers(db);
      expect(rest.map((tier) => [tier.nameRo, tier.position])).toEqual([["Fondator", 1]]);
      const [audit] = await db.select().from(auditLogs).where(eq(auditLogs.action, "member_tier.deleted"));
      expect(audit).toMatchObject({ entityType: "member_tier", entityId: first.id, metadataJson: { codesUpdated: 0 } });
      expect(JSON.stringify(audit)).not.toContain("Membru");
      await expect(deleteMemberTier(db, { actor: admin, tierId: second.id.replace(/.$/, "0"), now: NOW })).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(deleteMemberTier(db, { actor: admin, tierId: "nu-e-un-id", now: NOW })).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("is refused while a member holds the level, counting them, and works once they hold another", async () => {
      const { first, second } = await twoTiers();
      await setMemberTier(db, admin, { targetId: member.id, tierId: first.id, now: NOW });
      await expect(deleteMemberTier(db, { actor: admin, tierId: first.id, now: NOW })).rejects.toMatchObject({ code: "MEMBER_TIER_HAS_MEMBERS" });
      expect(await tierUsage(db, first.id)).toEqual({ members: 1, codesOnlyForIt: 0 });
      expect((await listMemberTiersForAdmin(db)).map((row) => [row.tier.nameRo, row.members])).toEqual([["Membru", 1], ["Fondator", 0]]);
      expect(await listAllMemberTiers(db)).toHaveLength(2);
      await setMemberTier(db, admin, { targetId: member.id, tierId: second.id, now: NOW });
      await deleteMemberTier(db, { actor: admin, tierId: first.id, now: NOW });
      expect(await names()).toEqual(["Fondator"]);
    });

    it("the action says how many members hold the level on its way back, and deletes through the form", async () => {
      const { first } = await twoTiers();
      await setMemberTier(db, admin, { targetId: member.id, tierId: first.id, now: NOW });
      const refused = await redirectedTo(deleteMemberTierAction(null, form({ uiLocale: "ro", tierId: first.id })));
      expect(refused).toBe("/ro/admin/pages/members?error=MEMBER_TIER_HAS_MEMBERS&count=1#admin-alert");
      await setMemberTier(db, admin, { targetId: member.id, tierId: null, now: NOW });
      const done = await redirectedTo(deleteMemberTierAction(null, form({ uiLocale: "ro", tierId: first.id })));
      expect(done).toBe("/ro/admin/pages/members?saved=memberTierDeleted#members-tiers");
    });

    it("is refused while a code is for that level alone — an empty limit would open it to everyone — and takes the id off a shared code", async () => {
      const { first, second } = await twoTiers();
      const only = await createDiscountCode(db, { actor: admin, fields: { ...CODE, code: "DOAR", tierIds: [first.id] }, now: NOW });
      const shared = await createDiscountCode(db, { actor: admin, fields: { ...CODE, code: "AMBELE", tierIds: [first.id, second.id] }, now: NOW });
      await expect(deleteMemberTier(db, { actor: admin, tierId: first.id, now: NOW })).rejects.toMatchObject({ code: "MEMBER_TIER_IN_CODES" });
      expect(await tierUsage(db, first.id)).toEqual({ members: 0, codesOnlyForIt: 1 });
      expect((await listMemberTiersForAdmin(db)).map((row) => [row.tier.nameRo, row.codesOnlyForIt, row.codesForIt])).toEqual([["Membru", 1, 2], ["Fondator", 0, 1]]);

      // The code that was for that level alone is opened to everyone on purpose, then the level goes; the shared one keeps the other.
      await saveDiscountCode(db, { actor: admin, codeId: only.id, expectedVersion: only.version, fields: { ...EVERYONE, code: "DOAR" }, now: NOW });
      await deleteMemberTier(db, { actor: admin, tierId: first.id, now: NOW });
      const codes = await db.select().from(memberDiscountCodes).orderBy(asc(memberDiscountCodes.position));
      expect(codes.map((code) => [code.code, code.tierIds])).toEqual([["DOAR", null], ["AMBELE", [second.id]]]);
      // The shared code's version moved on, so an editor open on it is told it is stale rather than saving the dead id back.
      expect(codes[1].version).toBe(shared.version + 1);
      const [audit] = await db.select().from(auditLogs).where(eq(auditLogs.action, "member_tier.deleted"));
      expect(audit.metadataJson).toEqual({ codesUpdated: 1 });
    });

    it("is refused to a Redactor, a volunteer and a member", async () => {
      const { first } = await twoTiers();
      for (const actor of [copywriter, volunteer, member]) {
        await expect(deleteMemberTier(db, { actor, tierId: first.id, now: NOW })).rejects.toMatchObject({ code: "FORBIDDEN" });
      }
      expect(await listAllMemberTiers(db)).toHaveLength(2);
    });
  });

  describe("«Nivel» on a member's row of «Echipa»", () => {
    it("gives a level, changes it and clears it, each audited by ids; the same level again writes nothing", async () => {
      const { first, second } = await twoTiers();
      expect(await setMemberTier(db, admin, { targetId: member.id, tierId: first.id, now: NOW })).toEqual({ changed: true });
      expect((await db.select().from(staffUsers).where(eq(staffUsers.id, member.id)))[0].memberTierId).toBe(first.id);
      expect(await setMemberTier(db, admin, { targetId: member.id, tierId: first.id, now: NOW })).toEqual({ changed: false });
      // The same id in capitals is the same level, not a change: nothing is written or audited.
      expect(await setMemberTier(db, admin, { targetId: member.id, tierId: first.id.toUpperCase(), now: NOW })).toEqual({ changed: false });
      await setMemberTier(db, admin, { targetId: member.id, tierId: second.id.toUpperCase(), now: NOW });
      expect((await db.select().from(staffUsers).where(eq(staffUsers.id, member.id)))[0].memberTierId).toBe(second.id);
      expect(await setMemberTier(db, admin, { targetId: member.id, tierId: null, now: NOW })).toEqual({ changed: true });
      expect(await setMemberTier(db, admin, { targetId: member.id, tierId: null, now: NOW })).toEqual({ changed: false });
      const trail = await db.select().from(auditLogs).where(eq(auditLogs.entityId, member.id)).orderBy(asc(auditLogs.createdAt));
      expect(trail.map((row) => [row.action, row.metadataJson])).toEqual([
        ["staff.member_tier.set", { staffUserId: member.id, tierId: first.id, previousTierId: null, reason: "row" }],
        ["staff.member_tier.set", { staffUserId: member.id, tierId: second.id, previousTierId: first.id, reason: "row" }],
        ["staff.member_tier.cleared", { staffUserId: member.id, tierId: null, previousTierId: second.id, reason: "row" }],
      ]);
      expect(JSON.stringify(trail)).not.toMatch(/Ana|membru@dev\.test|Fondator/);
    });

    it("gives a level to a club member's account only: a colleague holds none", async () => {
      const { first } = await twoTiers();
      await expect(setMemberTier(db, admin, { targetId: volunteer.id, tierId: first.id, now: NOW })).rejects.toMatchObject({ code: "VALIDATION_ERROR", fields: ["tierId"] });
      await expect(setMemberTier(db, admin, { targetId: volunteer.id, tierId: null, now: NOW })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
      expect((await db.select().from(staffUsers).where(eq(staffUsers.id, volunteer.id)))[0].memberTierId).toBeNull();
    });

    it("refuses a level that is not there, a hidden one, and a person who is not there — a member keeps the hidden level they hold", async () => {
      const { first, second } = await twoTiers();
      await expect(setMemberTier(db, admin, { targetId: member.id, tierId: "00000000-0000-4000-8000-000000000099", now: NOW })).rejects.toMatchObject({ code: "VALIDATION_ERROR", fields: ["tierId"] });
      await expect(setMemberTier(db, admin, { targetId: member.id, tierId: "nu-e-un-id", now: NOW })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
      await expect(setMemberTier(db, admin, { targetId: "00000000-0000-4000-8000-000000000099", tierId: first.id, now: NOW })).rejects.toMatchObject({ code: "NOT_FOUND" });
      await setMemberTier(db, admin, { targetId: member.id, tierId: first.id, now: NOW });
      await saveMemberTiers(db, { actor: admin, rows: rowsOf({ [first.id]: { ...unchanged(first, 1), hidden: "on" }, [second.id]: unchanged(second, 2) }), now: NOW });
      // Hidden: no longer given to anyone else, kept by the member who holds it (a save of the row as it was is no refusal).
      const [other] = await db.insert(staffUsers).values({ email: "alt@dev.test", displayName: "Alt Membru", role: "MEMBER" }).returning();
      await expect(setMemberTier(db, admin, { targetId: other.id, tierId: first.id, now: NOW })).rejects.toMatchObject({ code: "VALIDATION_ERROR", fields: ["tierId"] });
      expect(await setMemberTier(db, admin, { targetId: member.id, tierId: first.id, now: NOW })).toEqual({ changed: false });
    });

    it("is the Administrator's alone, in the service and in the action", async () => {
      const { first } = await twoTiers();
      for (const actor of [copywriter, volunteer, member]) {
        await expect(setMemberTier(db, actor as StaffUser, { targetId: member.id, tierId: first.id, now: NOW })).rejects.toMatchObject({ code: "FORBIDDEN" });
      }
      state.cookie = volunteer.id;
      const outcome = await redirectedTo(setMemberTierAction(null, form({ uiLocale: "ro", staffUserId: member.id, tierId: first.id })));
      expect(outcome).toContain("error=FORBIDDEN");
      state.cookie = admin.id;
      expect(await redirectedTo(setMemberTierAction(null, form({ uiLocale: "ro", staffUserId: member.id, tierId: first.id })))).toBe("/ro/admin/staff?saved=memberTierSet#admin-alert");
      expect(await redirectedTo(setMemberTierAction(null, form({ uiLocale: "ro", staffUserId: member.id, tierId: first.id })))).toBe("/ro/admin/staff?saved=memberTierUnchanged#admin-alert");
      expect(await redirectedTo(setMemberTierAction(null, form({ uiLocale: "ro", staffUserId: member.id, tierId: "" })))).toBe("/ro/admin/staff?saved=memberTierCleared#admin-alert");
    });

    it("clears the level when the member becomes a colleague, audited — and a level is no part of any role", async () => {
      const { first } = await twoTiers();
      await setMemberTier(db, admin, { targetId: member.id, tierId: first.id, now: NOW });
      await changeStaffRole(db, admin, member.id, "CONTRIBUTOR");
      const [promoted] = await db.select().from(staffUsers).where(eq(staffUsers.id, member.id));
      expect([promoted.role, promoted.memberTierId]).toEqual(["CONTRIBUTOR", null]);
      const [cleared] = await db.select().from(auditLogs).where(eq(auditLogs.action, "staff.member_tier.cleared"));
      expect(cleared.metadataJson).toEqual({ staffUserId: member.id, tierId: null, previousTierId: first.id, reason: "role_change" });
      // The reverse: made a member again, they start with none.
      await changeStaffRole(db, admin, member.id, "MEMBER");
      expect((await db.select().from(staffUsers).where(eq(staffUsers.id, member.id)))[0].memberTierId).toBeNull();
    });
  });

  describe("«Adaugă mai mulți membri» with a level", () => {
    it("gives the level to every row it adds, and leaves an existing member's level alone", async () => {
      const { first, second } = await twoTiers();
      await setMemberTier(db, admin, { targetId: member.id, tierId: second.id, now: NOW });
      const result = await inviteMembers(db, admin, {
        rows: parseMemberRows("Ana Nouă, ana@dev.test\nmihai@dev.test\nmembru@dev.test"),
        preferredLocale: "ro",
        tierId: first.id,
      });
      expect(result.added.map((row) => [row.email, row.memberTierId])).toEqual([["ana@dev.test", first.id], ["mihai@dev.test", first.id]]);
      expect(result.existing.map((row) => row.email)).toEqual(["membru@dev.test"]);
      expect((await db.select().from(staffUsers).where(eq(staffUsers.id, member.id)))[0].memberTierId).toBe(second.id);
    });

    it("adds nobody when the level is not there or is hidden, naming the box", async () => {
      const { first, second } = await twoTiers();
      await saveMemberTiers(db, { actor: admin, rows: rowsOf({ [first.id]: { ...unchanged(first, 1), hidden: "on" }, [second.id]: unchanged(second, 2) }), now: NOW });
      for (const tierId of [first.id, "00000000-0000-4000-8000-000000000099", "nu-e-un-id"]) {
        await expect(inviteMembers(db, admin, { rows: parseMemberRows("nou@dev.test"), preferredLocale: "ro", tierId })).rejects.toMatchObject({ code: "VALIDATION_ERROR", fields: ["tierId"] });
      }
      expect(await db.select().from(staffUsers).where(eq(staffUsers.email, "nou@dev.test"))).toEqual([]);
    });

    it("through the action: the level rides on the form, and the one audit row of the press names it by id", async () => {
      const { first } = await twoTiers();
      const to = await redirectedTo(inviteMembersAction(null, form({ uiLocale: "ro", preferredLocale: "ro", members: "ana@dev.test\nmihai@dev.test", tierId: first.id })));
      expect(to).toContain("count=2");
      const added = await db.select().from(staffUsers).where(eq(staffUsers.role, "MEMBER"));
      expect(added.filter((row) => row.memberTierId === first.id).map((row) => row.email).sort()).toEqual(["ana@dev.test", "mihai@dev.test"]);
      const [audit] = await db.select().from(auditLogs).where(eq(auditLogs.action, "staff.members_invited"));
      expect(audit.metadataJson).toMatchObject({ added: 2, tierId: first.id });
      // The empty choice is no level at all.
      await redirectedTo(inviteMembersAction(null, form({ uiLocale: "ro", preferredLocale: "ro", members: "fara@dev.test", tierId: "" })));
      expect((await db.select().from(staffUsers).where(eq(staffUsers.email, "fara@dev.test")))[0].memberTierId).toBeNull();
    });
  });

  describe("the partners' codes for some levels", () => {
    it("limits a code to the levels ticked, none ticked being every member, and refuses a level that is not there", async () => {
      const { first, second } = await twoTiers();
      const everyone = await createDiscountCode(db, { actor: admin, fields: { ...EVERYONE, code: "TOTI" }, now: NOW });
      const some = await createDiscountCode(db, { actor: admin, fields: { ...CODE, code: "UNELE", tierIds: [second.id, second.id, first.id.toUpperCase()] }, now: NOW });
      expect(everyone.tierIds).toBeNull();
      expect([...(some.tierIds ?? [])].sort()).toEqual([first.id, second.id].sort());
      await expect(createDiscountCode(db, { actor: admin, fields: { ...CODE, tierIds: ["00000000-0000-4000-8000-000000000099"] }, now: NOW })).rejects.toMatchObject({ code: "VALIDATION_ERROR", fields: ["tierIds"] });
      await expect(createDiscountCode(db, { actor: admin, fields: { ...CODE, tierIds: ["nu-e-un-id"] }, now: NOW })).rejects.toMatchObject({ fields: ["tierIds"] });
      const cleared = await saveDiscountCode(db, { actor: admin, codeId: some.id, expectedVersion: some.version, fields: { ...EVERYONE, code: "UNELE" }, now: NOW });
      expect(cleared.tierIds).toBeNull();
      // A save that posts no choice at all (a script) keeps the one stored.
      const limited = await saveDiscountCode(db, { actor: admin, codeId: some.id, expectedVersion: cleared.version, fields: { ...CODE, code: "UNELE", tierIds: [first.id] }, now: NOW });
      const kept = await saveDiscountCode(db, { actor: admin, codeId: some.id, expectedVersion: limited.version, fields: { ...CODE, code: "UNELE" }, now: NOW });
      expect(kept.tierIds).toEqual([first.id]);
    });

    it("refuses a code that chose nobody or both, naming the chips' box, and stores «Toți membrii» as no limit (§811, amended)", async () => {
      const { first } = await twoTiers();
      // Neither a level nor «Toți membrii»: the club must choose, an empty list is no answer.
      await expect(createDiscountCode(db, { actor: admin, fields: { ...CODE, tierIds: [] }, now: NOW })).rejects.toMatchObject({ code: "VALIDATION_ERROR", fields: ["tierIds"] });
      await expect(createDiscountCode(db, { actor: admin, fields: CODE, now: NOW })).rejects.toMatchObject({ code: "VALIDATION_ERROR", fields: ["tierIds"] });
      // Both: never.
      await expect(createDiscountCode(db, { actor: admin, fields: { ...CODE, forAll: true, tierIds: [first.id] }, now: NOW })).rejects.toMatchObject({ code: "VALIDATION_ERROR", fields: ["tierIds"] });
      expect(await db.select().from(memberDiscountCodes)).toHaveLength(0);
      // «Toți membrii» is stored as today's null; levels as the list.
      const all = await createDiscountCode(db, { actor: admin, fields: { ...CODE, forAll: "1" }, now: NOW });
      const some = await createDiscountCode(db, { actor: admin, fields: { ...CODE, code: "NIVEL", tierIds: [first.id] }, now: NOW });
      expect([all.tierIds, some.tierIds]).toEqual([null, [first.id]]);
      // A save is the same: it cannot clear a limit by posting none, it must say «Toți membrii».
      await expect(saveDiscountCode(db, { actor: admin, codeId: some.id, expectedVersion: some.version, fields: { ...CODE, code: "NIVEL", tierIds: [] }, now: NOW })).rejects.toMatchObject({ fields: ["tierIds"] });
      const widened = await saveDiscountCode(db, { actor: admin, codeId: some.id, expectedVersion: some.version, fields: { ...EVERYONE, code: "NIVEL" }, now: NOW });
      expect(widened.tierIds).toBeNull();
      // An old code with no limit, saved with nothing else said, keeps meaning «Toți membrii».
      const kept = await saveDiscountCode(db, { actor: admin, codeId: all.id, expectedVersion: all.version, fields: { ...CODE, partnerName: "Alt partener" }, now: NOW });
      expect([kept.partnerName, kept.tierIds]).toEqual(["Alt partener", null]);
    });

    it("answers the form: the chips post the levels as tierIds and «Toți membrii» as forAll, and a refusal comes back as ticked", async () => {
      const { first, second } = await twoTiers();
      const post = (extra: [string, string][]) => {
        const data = form({ uiLocale: "ro", ...Object.fromEntries(Object.entries(CODE).filter(([, value]) => typeof value === "string")) });
        for (const [name, value] of extra) data.append(name, value);
        return data;
      };
      // None ticked: refused on the chips' box, every other box kept.
      const none = await createDiscountCodeAction(null, post([]));
      expect(none).toMatchObject({ error: "VALIDATION_ERROR", fields: ["tierIds"] });
      expect(none?.values?.partnerName).toEqual([CODE.partnerName]);
      // Both ticked (a page with no script): refused on the same box, and what was ticked comes back.
      const both = await createDiscountCodeAction(null, post([["forAll", "1"], ["tierIds", first.id]]));
      expect(both).toMatchObject({ error: "VALIDATION_ERROR", fields: ["tierIds"] });
      expect([both?.values?.forAll, both?.values?.tierIds]).toEqual([["1"], [first.id]]);
      expect(await db.select().from(memberDiscountCodes)).toHaveLength(0);
      // «Toți membrii» alone, and two levels alone, are saved.
      const created = await redirectedTo(createDiscountCodeAction(null, post([["forAll", "1"]])));
      expect(created).toMatch(/^\/ro\/admin\/pages\/members\?saved=memberCodeCreated#code-/);
      await redirectedTo(createDiscountCodeAction(null, post([["tierIds", first.id], ["tierIds", second.id]])));
      const [everyone, levels] = await db.select().from(memberDiscountCodes).orderBy(asc(memberDiscountCodes.createdAt), asc(memberDiscountCodes.position));
      expect(everyone.tierIds).toBeNull();
      expect([...(levels.tierIds ?? [])].sort()).toEqual([first.id, second.id].sort());
      // Saving a code with the chips cleared is refused; ticking «Toți membrii» instead widens it.
      const save = (extra: [string, string][]) => {
        const data = post(extra);
        data.set("codeId", levels.id);
        data.set("expectedVersion", String(levels.version));
        return data;
      };
      expect(await saveDiscountCodeAction(null, save([]))).toMatchObject({ error: "VALIDATION_ERROR", fields: ["tierIds"] });
      await redirectedTo(saveDiscountCodeAction(null, save([["forAll", "1"]])));
      const [after] = await db.select().from(memberDiscountCodes).where(eq(memberDiscountCodes.id, levels.id));
      expect(after.tierIds).toBeNull();
    });

    it("lets a Redactor write the words and keeps the limit as stored", async () => {
      const { first } = await twoTiers();
      const code = await createDiscountCode(db, { actor: admin, fields: { ...CODE, tierIds: [first.id] }, now: NOW });
      const saved = await saveDiscountCode(db, { actor: copywriter, codeId: code.id, expectedVersion: code.version, fields: { ...CODE, partnerName: "Alt partener", tierIds: [] }, now: NOW });
      expect([saved.partnerName, saved.tierIds]).toEqual(["Alt partener", [first.id]]);
    });

    it("shows a member the codes for everyone and those of their level, a member with no level the first alone", async () => {
      const { first, second } = await twoTiers();
      const [other] = await db.insert(staffUsers).values({ email: "alt@dev.test", displayName: "Alt Membru", role: "MEMBER" }).returning();
      await createDiscountCode(db, { actor: admin, fields: { ...EVERYONE, code: "TOTI" }, now: NOW });
      await createDiscountCode(db, { actor: admin, fields: { ...CODE, code: "MEMBRU", tierIds: [first.id] }, now: NOW });
      await createDiscountCode(db, { actor: admin, fields: { ...CODE, code: "FONDATOR", tierIds: [second.id] }, now: NOW });
      await createDiscountCode(db, { actor: admin, fields: { ...CODE, code: "AMBELE", tierIds: [first.id, second.id] }, now: NOW });
      const seen = async (tierId: string | null) => (await listDiscountCodesForMembers(db, NOW, tierId)).map((code) => code.code);
      expect(await seen(first.id)).toEqual(["TOTI", "MEMBRU", "AMBELE"]);
      expect(await seen(second.id)).toEqual(["TOTI", "FONDATOR", "AMBELE"]);
      expect(await seen(null)).toEqual(["TOTI"]);
      expect(await seen(other.memberTierId)).toEqual(["TOTI"]);
      // An account that cannot hold a level (a colleague opening the zone, §524) reads every code: decided by the kind of account.
      const colleague = (await listDiscountCodesForMembers(db, NOW, null, true)).map((code) => code.code);
      expect(colleague).toEqual(["TOTI", "MEMBRU", "FONDATOR", "AMBELE"]);
      const { canHoldMemberTier } = await import("@/modules/staff-identity/domain/roles");
      expect([canHoldMemberTier("MEMBER"), canHoldMemberTier("ADMIN"), canHoldMemberTier("MODERATOR")]).toEqual([true, false, false]);
      // The members' read carries no level (the zone names none); only the backoffice's read does.
      expect((await listDiscountCodesForMembers(db, NOW, first.id)).map((code) => code.code)).toEqual(["TOTI", "MEMBRU", "AMBELE"]);
      expect(Object.keys((await listDiscountCodesForMembers(db, NOW, first.id))[0])).not.toContain("tierIds");
      expect((await listDiscountCodesForAdmin(db)).map((code) => code.tierIds?.length ?? 0)).toEqual([0, 1, 1, 2]);
      // The same rule in words, for the tests and the screens.
      expect(codeIsForTier({ tierIds: null }, null)).toBe(true);
      expect(codeIsForTier({ tierIds: [] }, null)).toBe(true);
      expect(codeIsForTier({ tierIds: [first.id] }, null)).toBe(false);
      expect(codeIsForTier({ tierIds: [first.id] }, second.id)).toBe(false);
      expect(codeIsForTier({ tierIds: [first.id, second.id] }, second.id)).toBe(true);
    });

    it("changes nothing a member may do: a tier is read by no door, only by the lists of benefits", async () => {
      const { first } = await twoTiers();
      await setMemberTier(db, admin, { targetId: member.id, tierId: first.id, now: NOW });
      const roles = await import("@/modules/staff-identity/domain/roles");
      const [held] = await db.select().from(staffUsers).where(eq(staffUsers.id, member.id));
      const [bare] = await db.insert(staffUsers).values({ email: "gol@dev.test", displayName: "Fără nivel", role: "MEMBER" }).returning();
      expect(held.memberTierId).toBe(first.id);
      expect(bare.memberTierId).toBeNull();
      // The WHOLE row goes in, not its role: a predicate that read the level off the account would differ here. Every
      // one-argument export of the roles file is asked, so a predicate added tomorrow is held to the same rule.
      const answer = (fn: (subject: never) => unknown, subject: unknown) => {
        try {
          return { value: fn(subject as never) };
        } catch (error) {
          return { threw: String(error) };
        }
      };
      let asked = 0;
      for (const [name, fn] of Object.entries(roles)) {
        if (typeof fn !== "function" || fn.length !== 1) continue;
        asked += 1;
        const heldAnswer = answer(fn as (subject: never) => unknown, { ...held, permissions: new Set() });
        const bareAnswer = answer(fn as (subject: never) => unknown, { ...bare, permissions: new Set() });
        expect(heldAnswer, name).toEqual(bareAnswer);
      }
      expect(asked).toBeGreaterThan(20);
    });
  });

  describe("the glyph", () => {
    it("is validated against the tiers' table: twelve names, each with a picture the chip can draw", () => {
      expect(Object.keys(TIER_GLYPH).sort()).toEqual([...TIER_GLYPH_KEYS].sort());
      for (const key of TIER_GLYPH_KEYS) {
        expect(isTierGlyphKey(key)).toBe(true);
        expect(GLYPHS[`tier:${key}`], key).toBe(TIER_GLYPH[key]);
      }
      expect(isTierGlyphKey("nope")).toBe(false);
      expect(isTierGlyphKey(undefined)).toBe(false);
      expect(isTierGlyphKey("tier:star")).toBe(false);
    });

    it("defaults to the star, and a name the table does not know is refused at the save and drawn as the star when read", async () => {
      expect(tierFieldsSchema.parse({ nameRo: "Membru", nameEn: "Member" }).glyph).toBe("star");
      expect(tierFieldsSchema.parse({ nameRo: "Membru", nameEn: "Member", glyph: "  " }).glyph).toBe("star");
      expect(tierFieldsSchema.safeParse({ nameRo: "Membru", nameEn: "Member", glyph: "nope" }).success).toBe(false);
      const [row] = await db.insert(memberTiers).values({ nameRo: "Vechi", nameEn: "Old", glyph: "from-sql", position: 1 }).returning();
      expect(tierViewOf(row, "ro").glyph).toBe("star");
    });

    it("a stored symbol the closed set does not name does not stop a save that posts no glyph box, and is left as it is (§817)", async () => {
      const [odd] = await db.insert(memberTiers).values({ nameRo: "Vechi", nameEn: "Old", glyph: "from-sql", position: 1 }).returning();
      const withoutGlyph = Object.fromEntries(Object.entries(unchanged(odd, 1)).filter(([box]) => box !== "glyph"));
      const result = await saveMemberTiers(db, {
        actor: admin,
        rows: rowsOf({ [odd.id]: { ...withoutGlyph, nameRo: "Nou", nameEn: "New" } }),
        now: NOW,
      });
      expect(result.edited).toBe(1);
      const [after] = await listAllMemberTiers(db);
      expect([after.nameRo, after.glyph]).toEqual(["Nou", "from-sql"]);
    });

    it("is left as it is by the card's save, which posts no glyph box (§817): the column stays for a later contract migration", async () => {
      const { first, second } = await twoTiers();
      expect(second.glyph).toBe("trophy");
      // The card posts no glyph box: the rows the save receives carry none.
      const withoutGlyph = (tier: typeof memberTiers.$inferSelect, place: number) => Object.fromEntries(Object.entries(unchanged(tier, place)).filter(([box]) => box !== "glyph"));
      const withoutFirst = withoutGlyph(first, 1);
      const withoutSecond = withoutGlyph(second, 2);
      await saveMemberTiers(db, {
        actor: admin,
        rows: rowsOf({ [first.id]: withoutFirst, [second.id]: { ...withoutSecond, descriptionRo: "Notă nouă.", descriptionEn: "A new note." }, new: { nameRo: "Nou", nameEn: "New" } }),
        now: NOW,
      });
      const after = await listAllMemberTiers(db);
      expect(after.map((tier) => [tier.nameRo, tier.glyph])).toEqual([["Membru", "star"], ["Fondator", "trophy"], ["Nou", "star"]]);
      expect(after[1].descriptionRo).toBe("Notă nouă.");
      const audit = await db.select().from(auditLogs).where(eq(auditLogs.action, "member_tier.edited"));
      expect(audit.map((row) => row.metadataJson)).toEqual([{ parts: ["description"], hidden: false }]);
    });
  });

  it("writes only ids and counts to the audit trail — no name, no description, no address", async () => {
    const { first, second } = await twoTiers();
    await setMemberTier(db, admin, { targetId: member.id, tierId: first.id, now: NOW });
    await createDiscountCode(db, { actor: admin, fields: { ...CODE, tierIds: [second.id] }, now: NOW });
    await setMemberTier(db, admin, { targetId: member.id, tierId: null, now: NOW });
    await deleteMemberTier(db, { actor: admin, tierId: first.id, now: NOW });
    const trail = JSON.stringify(await db.select().from(auditLogs));
    for (const word of ["Membru", "Fondator", "Founder", "Cei dintâi", "Ana Membru", "membru@dev.test", "BVR15"]) expect(trail, word).not.toContain(word);
  });
});
