import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { faqItems } from "@/db/schema/faq";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { FAQ_PAGE_SETTING_ENTITY_ID, readFaqPageSettings, setFaqPagePublished } from "@/modules/content/faq/page-settings";
import { faqPageOnSite, listFaqItemsForAdmin, listVisibleFaqItems, readPublicFaqPage } from "@/modules/content/faq/repository";
import { createFaqItem, deleteFaqItem, moveFaqItem, saveFaqItem, setFaqItemVisible } from "@/modules/content/faq/service";
import type { StaffRole } from "@/modules/staff-identity/domain/roles";
import { isDomainError } from "@/shared/errors/domain-error";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * §NNN — «Întrebări frecvente»: the FAQ page's questions and the page itself. Who may write a
 * question and who may put it on the site, both languages required, the page's own language only,
 * the order, the version guard, the audit rows, and the two gates the public read keeps.
 */
describe("§NNN the FAQ page's questions", () => {
  let db: TestDatabase;
  let close: () => Promise<void>;
  const staff: Partial<Record<StaffRole, StaffUser>> = {};

  beforeAll(async () => {
    ({ db, close } = await createTestDatabase());
  });
  afterAll(async () => close());
  beforeEach(async () => {
    await resetTables(db);
    for (const role of ["COPYWRITER", "MODERATOR", "ADMIN"] as const) {
      [staff[role]] = await db
        .insert(staffUsers)
        .values({ email: `${role.toLowerCase()}@dev.test`, displayName: role, role })
        .returning();
    }
  });

  const actor = (role: StaffRole) => staff[role] as StaffUser;
  const doc = (text: string) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });
  const fields = (overrides: Record<string, string> = {}) => ({
    questionRo: "Cum mă înscriu?",
    questionEn: "How do I register?",
    answerRoBody: JSON.stringify(doc("Din pagina evenimentului.")),
    answerEnBody: JSON.stringify(doc("From the event's page.")),
    ...overrides,
  });

  const refusal = async (promise: Promise<unknown>) => {
    try {
      await promise;
    } catch (error) {
      if (isDomainError(error)) return { code: error.code, fields: error.fields };
      throw error;
    }
    throw new Error("expected a refusal");
  };

  it("adds a question at the end, hidden, with an audit row that names no words", async () => {
    const first = await createFaqItem(db, { actor: actor("COPYWRITER"), fields: fields() });
    const second = await createFaqItem(db, { actor: actor("ADMIN"), fields: fields({ questionRo: "Ce aduc?", questionEn: "What do I bring?" }) });
    expect(first.visible).toBe(false);
    expect([first.position, second.position]).toEqual([1, 2]);
    expect(await listVisibleFaqItems(db, "ro")).toEqual([]);
    expect((await listFaqItemsForAdmin(db)).map((row) => row.questionRo)).toEqual(["Cum mă înscriu?", "Ce aduc?"]);

    const rows = await db.select().from(auditLogs).where(eq(auditLogs.entityId, first.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ action: "faq_item.created", entityType: "faq_item", actorStaffUserId: actor("COPYWRITER").id });
    expect(JSON.stringify(rows[0].metadataJson)).not.toContain("înscriu");
  });

  it("refuses the Organizer any write, and the Redactor putting a question on the site or publishing the page", async () => {
    expect(await refusal(createFaqItem(db, { actor: actor("MODERATOR"), fields: fields() }))).toMatchObject({ code: "FORBIDDEN" });
    const item = await createFaqItem(db, { actor: actor("COPYWRITER"), fields: fields() });
    expect(
      await refusal(setFaqItemVisible(db, { actor: actor("COPYWRITER"), itemId: item.id, expectedVersion: item.version, visible: true })),
    ).toMatchObject({ code: "FORBIDDEN" });
    expect(
      await refusal(saveFaqItem(db, { actor: actor("MODERATOR"), itemId: item.id, expectedVersion: item.version, fields: fields() })),
    ).toMatchObject({ code: "FORBIDDEN" });
    expect(await refusal(moveFaqItem(db, { actor: actor("MODERATOR"), itemId: item.id, direction: "down" }))).toMatchObject({ code: "FORBIDDEN" });
    expect(await refusal(setFaqPagePublished(db, { actor: actor("COPYWRITER"), published: true }))).toMatchObject({ code: "FORBIDDEN" });
    expect((await readFaqPageSettings(db)).status).toBe("DRAFT");
  });

  it("refuses a question or an answer in one language only, naming the empty box", async () => {
    expect(await refusal(createFaqItem(db, { actor: actor("ADMIN"), fields: fields({ questionEn: "" }) }))).toEqual({
      code: "VALIDATION_ERROR",
      fields: ["questionEn"],
    });
    expect(await refusal(createFaqItem(db, { actor: actor("ADMIN"), fields: fields({ answerRoBody: "" }) }))).toEqual({
      code: "VALIDATION_ERROR",
      fields: ["answerRoBody"],
    });
    expect(await db.select().from(faqItems)).toEqual([]);
  });

  it("shows nothing while the page is a draft, and each question in the page's own language once both gates are open", async () => {
    const item = await createFaqItem(db, { actor: actor("COPYWRITER"), fields: fields() });
    await setFaqItemVisible(db, { actor: actor("ADMIN"), itemId: item.id, expectedVersion: item.version, visible: true });

    // The question is shown, the page is not: a visitor sees nothing, and the menu offers nothing.
    const draft = await readPublicFaqPage(db, "ro");
    expect(draft).toEqual({ published: false, items: [] });
    expect(faqPageOnSite(draft)).toBe(false);

    await setFaqPagePublished(db, { actor: actor("ADMIN"), published: true });
    const ro = await readPublicFaqPage(db, "ro");
    const en = await readPublicFaqPage(db, "en");
    expect(faqPageOnSite(ro)).toBe(true);
    expect(ro.items).toEqual([{ id: item.id, question: "Cum mă înscriu?", answer: doc("Din pagina evenimentului."), answerText: "Din pagina evenimentului." }]);
    expect(en.items).toEqual([{ id: item.id, question: "How do I register?", answer: doc("From the event's page."), answerText: "From the event's page." }]);

    const [published] = await db.select().from(auditLogs).where(and(eq(auditLogs.entityId, FAQ_PAGE_SETTING_ENTITY_ID), eq(auditLogs.action, "faq_page.published")));
    expect(published).toMatchObject({ entityType: "platform_setting", metadataJson: { from: "DRAFT", to: "PUBLISHED" } });

    // A published page with every question hidden is on the site but not in the menu.
    const [shown] = await listFaqItemsForAdmin(db);
    await setFaqItemVisible(db, { actor: actor("ADMIN"), itemId: item.id, expectedVersion: shown.version, visible: false });
    const empty = await readPublicFaqPage(db, "ro");
    expect(empty).toEqual({ published: true, items: [] });
    expect(faqPageOnSite(empty)).toBe(false);
  });

  it("saves against the loaded version and refuses a stale one as a conflict", async () => {
    const item = await createFaqItem(db, { actor: actor("COPYWRITER"), fields: fields() });
    const saved = await saveFaqItem(db, {
      actor: actor("COPYWRITER"),
      itemId: item.id,
      expectedVersion: item.version,
      fields: fields({ questionRo: "Cum mă înscriu la o cursă?" }),
    });
    expect(saved).toMatchObject({ version: 2, questionRo: "Cum mă înscriu la o cursă?" });
    expect(
      await refusal(saveFaqItem(db, { actor: actor("ADMIN"), itemId: item.id, expectedVersion: item.version, fields: fields() })),
    ).toMatchObject({ code: "CONFLICT" });
  });

  it("moves a question up and down, renumbering the list, and does nothing at an end", async () => {
    const a = await createFaqItem(db, { actor: actor("ADMIN"), fields: fields({ questionRo: "A?", questionEn: "A?" }) });
    const b = await createFaqItem(db, { actor: actor("ADMIN"), fields: fields({ questionRo: "B?", questionEn: "B?" }) });
    const c = await createFaqItem(db, { actor: actor("ADMIN"), fields: fields({ questionRo: "C?", questionEn: "C?" }) });
    await moveFaqItem(db, { actor: actor("COPYWRITER"), itemId: c.id, direction: "up" });
    expect((await listFaqItemsForAdmin(db)).map((row) => row.questionRo)).toEqual(["A?", "C?", "B?"]);
    await moveFaqItem(db, { actor: actor("COPYWRITER"), itemId: a.id, direction: "up" });
    expect((await listFaqItemsForAdmin(db)).map((row) => [row.questionRo, row.position])).toEqual([
      ["A?", 1],
      ["C?", 2],
      ["B?", 3],
    ]);
    expect(b.id).toBeTruthy();
  });

  it("lets the Redactor delete a hidden question, and only the Administrator one that is on the site", async () => {
    const hidden = await createFaqItem(db, { actor: actor("COPYWRITER"), fields: fields() });
    await deleteFaqItem(db, { actor: actor("COPYWRITER"), itemId: hidden.id });
    expect(await db.select().from(faqItems)).toEqual([]);

    const item = await createFaqItem(db, { actor: actor("COPYWRITER"), fields: fields() });
    await setFaqItemVisible(db, { actor: actor("ADMIN"), itemId: item.id, expectedVersion: item.version, visible: true });
    expect(await refusal(deleteFaqItem(db, { actor: actor("COPYWRITER"), itemId: item.id }))).toMatchObject({ code: "FORBIDDEN" });
    await deleteFaqItem(db, { actor: actor("ADMIN"), itemId: item.id });
    expect(await db.select().from(faqItems)).toEqual([]);
    const [row] = await db.select().from(auditLogs).where(and(eq(auditLogs.entityId, item.id), eq(auditLogs.action, "faq_item.deleted")));
    expect(row.metadataJson).toEqual({ wasVisible: true });
  });

  it("refuses a hand-made row with a blank question at the database", async () => {
    await expect(
      db.insert(faqItems).values({
        questionRo: " ",
        questionEn: "Why?",
        answerRoJson: doc("x"),
        answerEnJson: doc("x"),
        answerRo: "x",
        answerEn: "x",
        position: 1,
      }),
    ).rejects.toThrow();
  });
});
