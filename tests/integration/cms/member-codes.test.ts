import { eq } from "drizzle-orm";
import { createTranslator } from "next-intl";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import ro from "../../../messages/ro.json";
import { auditLogs } from "@/db/schema/audit-logs";
import { memberDiscountCodes } from "@/db/schema/member-discount-codes";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * §NNN — «Coduri de reducere»: the members' discount codes, kept by the club on «Pagini» → «Membri»
 * and shown only inside the members' zone.
 *
 * The Administrator adds, writes, hides, moves and deletes a code; the Redactor writes the words
 * alone; a volunteer and a member write nothing — asserted in the service, whatever the screen
 * offered (BR-REQ-060-01). The members' read leaves out a hidden code and one past its last day,
 * and the zone draws what it read: the code in its box, the words in the reader's language, the day
 * through the one date helper (§349).
 */
const state = vi.hoisted(() => ({ db: undefined as unknown }));
vi.mock("@/db/client", () => ({ getDb: () => state.db }));
vi.mock("next-intl/server", () => ({
  getTranslations: async (namespace: string) =>
    createTranslator({ locale: "ro", messages: (ro as Record<string, object>)[namespace] as Record<string, string>, namespace: undefined }),
}));

const { createDiscountCode, deleteDiscountCode, moveDiscountCode, saveDiscountCode, setDiscountCodeHidden } = await import(
  "@/modules/content/member-codes/service"
);
const { listDiscountCodesForAdmin, listDiscountCodesForMembers } = await import("@/modules/content/member-codes/repository");
const { default: MemberCodes } = await import("@/modules/content/member-codes/ui/MemberCodes");

const NOW = new Date("2026-10-01T09:00:00.000Z");
const CODE = {
  partnerName: "Magazinul Alergătorului",
  code: "BVR15",
  descriptionRo: "15% la încălțăminte.",
  descriptionEn: "15% off shoes.",
  link: "https://example.ro/reduceri",
  validUntil: "",
};

describe("§NNN the members' discount codes", () => {
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
    [member] = await db.insert(staffUsers).values({ email: "membru@dev.test", displayName: "Membru", role: "MEMBER" }).returning();
  });

  it("an Administrator adds, writes, hides, shows, moves and deletes, each with an audit row naming no code", async () => {
    const first = await createDiscountCode(db, { actor: admin, fields: CODE, now: NOW });
    const second = await createDiscountCode(db, { actor: admin, fields: { ...CODE, partnerName: "Sala", code: "SALA10" }, now: NOW });
    expect([first.position, second.position]).toEqual([1, 2]);
    const saved = await saveDiscountCode(db, { actor: admin, codeId: first.id, expectedVersion: first.version, fields: { ...CODE, code: "BVR20" }, now: NOW });
    expect(saved.code).toBe("BVR20");
    const hidden = await setDiscountCodeHidden(db, { actor: admin, codeId: first.id, expectedVersion: saved.version, hidden: true, now: NOW });
    expect(hidden.hidden).toBe(true);
    await setDiscountCodeHidden(db, { actor: admin, codeId: first.id, expectedVersion: hidden.version, hidden: false, now: NOW });
    await moveDiscountCode(db, { actor: admin, codeId: second.id, direction: "up", now: NOW });
    expect((await listDiscountCodesForAdmin(db)).map((code) => code.code)).toEqual(["SALA10", "BVR20"]);
    await deleteDiscountCode(db, { actor: admin, codeId: second.id, now: NOW });
    expect(await listDiscountCodesForAdmin(db)).toHaveLength(1);
    const audit = await db.select().from(auditLogs).where(eq(auditLogs.entityType, "member_discount_code"));
    expect(audit.map((row) => row.action).sort()).toEqual(
      ["member_code.created", "member_code.created", "member_code.deleted", "member_code.hidden", "member_code.moved", "member_code.saved", "member_code.shown"].sort(),
    );
    expect(JSON.stringify(audit)).not.toContain("BVR");
  });

  it("refuses a volunteer and a member at every write", async () => {
    const code = await createDiscountCode(db, { actor: admin, fields: CODE, now: NOW });
    for (const actor of [volunteer, member]) {
      await expect(createDiscountCode(db, { actor, fields: CODE, now: NOW })).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(saveDiscountCode(db, { actor, codeId: code.id, expectedVersion: code.version, fields: CODE, now: NOW })).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(setDiscountCodeHidden(db, { actor, codeId: code.id, expectedVersion: code.version, hidden: true, now: NOW })).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(deleteDiscountCode(db, { actor, codeId: code.id, now: NOW })).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    expect(await listDiscountCodesForAdmin(db)).toHaveLength(1);
  });

  it("lets the Redactor write the words alone, keeping the code, the link and the day", async () => {
    const code = await createDiscountCode(db, { actor: admin, fields: { ...CODE, validUntil: "2026-12-31" }, now: NOW });
    await expect(createDiscountCode(db, { actor: copywriter, fields: CODE, now: NOW })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const saved = await saveDiscountCode(db, {
      actor: copywriter,
      codeId: code.id,
      expectedVersion: code.version,
      fields: { ...CODE, partnerName: "Magazinul nou", code: "FURAT", link: "https://example.ro/altul", validUntil: "2030-01-01", descriptionRo: "Altă reducere.", descriptionEn: "Another discount." },
      now: NOW,
    });
    expect(saved).toMatchObject({ partnerName: "Magazinul nou", descriptionEn: "Another discount.", code: "BVR15", link: "https://example.ro/reduceri", validUntil: "2026-12-31" });
  });

  it("refuses one language of the description, a link that is not https and a day that does not exist", async () => {
    await expect(createDiscountCode(db, { actor: admin, fields: { ...CODE, descriptionEn: "" }, now: NOW })).rejects.toMatchObject({ fields: ["descriptionEn"] });
    await expect(createDiscountCode(db, { actor: admin, fields: { ...CODE, link: "http://example.ro" }, now: NOW })).rejects.toMatchObject({ fields: ["link"] });
    await expect(createDiscountCode(db, { actor: admin, fields: { ...CODE, validUntil: "2027-02-30" }, now: NOW })).rejects.toMatchObject({ fields: ["validUntil"] });
    await expect(saveDiscountCode(db, { actor: admin, codeId: "nu-e-un-id", expectedVersion: 1, fields: CODE, now: NOW })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await db.select().from(memberDiscountCodes)).toEqual([]);
  });

  it("shows members neither a hidden code nor one past its last day, and today's last day still", async () => {
    await createDiscountCode(db, { actor: admin, fields: { ...CODE, code: "AZI", validUntil: "2026-10-01" }, now: NOW });
    await createDiscountCode(db, { actor: admin, fields: { ...CODE, code: "IERI", validUntil: "2026-09-30" }, now: NOW });
    const hidden = await createDiscountCode(db, { actor: admin, fields: { ...CODE, code: "ASCUNS" }, now: NOW });
    await setDiscountCodeHidden(db, { actor: admin, codeId: hidden.id, expectedVersion: hidden.version, hidden: true, now: NOW });
    await createDiscountCode(db, { actor: admin, fields: { ...CODE, code: "MEREU" }, now: NOW });
    const shown = await listDiscountCodesForMembers(db, NOW);
    expect(shown.map((code) => code.code)).toEqual(["AZI", "MEREU"]);
    // Past the club's midnight, the day it named is over (Europe/Bucharest, UTC+3 in October).
    expect((await listDiscountCodesForMembers(db, new Date("2026-10-01T21:30:00.000Z"))).map((code) => code.code)).toEqual(["MEREU"]);

    const html = renderToStaticMarkup(await MemberCodes({ codes: shown, locale: "ro" }));
    expect(html).toContain("AZI");
    expect(html).toContain("15% la încălțăminte.");
    expect(html).not.toContain("15% off shoes.");
    expect(html).toContain("Copiază codul");
    // The day with its weekday, through the one date helper (§349).
    expect(html).toContain("Valabil până joi, 1 oct. 2026, inclusiv.");
    expect(html).not.toContain("ASCUNS");
    expect(html).not.toContain("IERI");
  });
});
