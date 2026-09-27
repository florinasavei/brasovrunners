import sharp from "sharp";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { faqQuestions } from "@/db/schema/faq";
import { mediaAssets } from "@/db/schema/gallery";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { FAQ_PAGE_SETTING_ENTITY_ID, readFaqPageSettings, setFaqPagePublished } from "@/modules/content/faq/page-settings";
import { faqPageOnSite, listFaqItemsForAdmin, readPublicFaqPage } from "@/modules/content/faq/repository";
import { saveFaqPage } from "@/modules/content/faq/service";
import { listMediaAssetsForAdmin, sweepOrphanAssets } from "@/modules/media/references";
import { uploadBodyImage } from "@/modules/media/service";
import type { StaffRole } from "@/modules/staff-identity/domain/roles";
import { isDomainError } from "@/shared/errors/domain-error";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * §525 — «Întrebări frecvente»: the page's one save (§28) — the introduction and every question
 * card together — who may write and who may put a question on the site, both languages required,
 * the categories, the order and the arrows, deletion, the page's version guard, the audit row,
 * the two gates the public read keeps, and a picture in an answer kept by the orphan sweep.
 */
describe("§525 the FAQ page's one save", () => {
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
  const card = (overrides: Record<string, string> = {}) => ({
    questionRo: "Cum mă înscriu?",
    questionEn: "How do I register?",
    answerRoBody: JSON.stringify(doc("Din pagina evenimentului.")),
    answerEnBody: JSON.stringify(doc("From the event's page.")),
    ...overrides,
  });
  const version = async () => (await readFaqPageSettings(db)).version;
  const save = async (role: StaffRole, items: Array<Record<string, string>>, extra: Record<string, unknown> = {}) =>
    saveFaqPage(db, { actor: actor(role), expectedVersion: await version(), fields: { items, ...extra } });
  /** The cards as the screen posts them now: every question with its id, in order. */
  const current = async (patch: (row: Record<string, string>, index: number) => Record<string, string> = (row) => row) =>
    (await listFaqItemsForAdmin(db)).map((row, index) =>
      patch(
        {
          id: row.id,
          questionRo: row.questionRo,
          questionEn: row.questionEn,
          categoryRo: row.categoryRo ?? "",
          categoryEn: row.categoryEn ?? "",
          answerRoBody: JSON.stringify(row.answerRo),
          answerEnBody: JSON.stringify(row.answerEn),
          ...(row.visible ? { visible: "on" } : {}),
        },
        index,
      ),
    );

  const refusal = async (promise: Promise<unknown>) => {
    try {
      await promise;
    } catch (error) {
      if (isDomainError(error)) return { code: error.code, fields: error.fields };
      throw error;
    }
    throw new Error("expected a refusal");
  };

  it("adds questions in the cards' order, hidden for a Redactor, skipping the empty spare card, with one audit row naming ids only", async () => {
    const result = await save("COPYWRITER", [card(), card({ questionRo: "Ce aduc?", questionEn: "What do I bring?", visible: "on" }), {}]);
    expect(result).toMatchObject({ version: 2 });
    const rows = await listFaqItemsForAdmin(db);
    expect(rows.map((row) => [row.questionRo, row.position, row.visible])).toEqual([
      ["Cum mă înscriu?", 1, false],
      // «Pe site» ticked by a Redactor is not read: showing a question is the Administrator's.
      ["Ce aduc?", 2, false],
    ]);
    const [audit] = await db.select().from(auditLogs).where(eq(auditLogs.action, "faq_page.saved"));
    expect(audit).toMatchObject({ entityType: "platform_setting", entityId: FAQ_PAGE_SETTING_ENTITY_ID, actorStaffUserId: actor("COPYWRITER").id });
    expect(audit.metadataJson).toMatchObject({ version: 2, created: result.created, deleted: [], shown: [], hidden: [] });
    expect(JSON.stringify(audit.metadataJson)).not.toContain("înscriu");
  });

  it("refuses a role that writes no words, and names every empty or one-sided box by its card", async () => {
    expect(await refusal(save("MODERATOR", [card()]))).toMatchObject({ code: "FORBIDDEN" });
    expect(await refusal(save("ADMIN", [card(), card({ questionEn: "", categoryRo: "Înscriere" }), card({ answerRoBody: "" })]))).toEqual({
      code: "VALIDATION_ERROR",
      fields: ["faq[1].questionEn", "faq[1].categoryEn", "faq[2].answerRoBody"],
    });
    expect(await db.select().from(faqQuestions)).toEqual([]);
  });

  it("keeps the introduction both languages or neither, and shows it only on a published page", async () => {
    expect(await refusal(save("ADMIN", [], { introRoBody: JSON.stringify(doc("Bun venit.")) }))).toEqual({
      code: "VALIDATION_ERROR",
      fields: ["introEnBody"],
    });
    await save("COPYWRITER", [card()], { introRoBody: JSON.stringify(doc("Bun venit.")), introEnBody: JSON.stringify(doc("Welcome.")) });
    expect((await readFaqPageSettings(db)).introRo).toBe("Bun venit.");
    expect(await readPublicFaqPage(db, "en")).toMatchObject({ published: false, intro: null });
    await setFaqPagePublished(db, { actor: actor("ADMIN"), published: true });
    expect(await readPublicFaqPage(db, "en")).toMatchObject({ published: true, intro: doc("Welcome."), introText: "Welcome." });
    // Publishing keeps the words and the version: a form loaded before it still saves.
    expect(await version()).toBe(2);
  });

  it("shows nothing while the page is a draft, and each question with its category in the page's own language once both gates are open", async () => {
    await save("ADMIN", [card({ categoryRo: "Înscriere", categoryEn: "Registration", visible: "on" })]);
    const [item] = await listFaqItemsForAdmin(db);
    expect(item.visible).toBe(true);

    const draft = await readPublicFaqPage(db, "ro");
    expect(draft).toEqual({ published: false, intro: null, introText: null, items: [] });
    expect(faqPageOnSite(draft)).toBe(false);

    await setFaqPagePublished(db, { actor: actor("ADMIN"), published: true });
    const ro = await readPublicFaqPage(db, "ro");
    const en = await readPublicFaqPage(db, "en");
    expect(faqPageOnSite(ro)).toBe(true);
    expect(ro.items).toEqual([
      { id: item.id, question: "Cum mă înscriu?", category: "Înscriere", answer: doc("Din pagina evenimentului."), answerText: "Din pagina evenimentului." },
    ]);
    expect(en.items[0]).toMatchObject({ question: "How do I register?", category: "Registration" });

    const [published] = await db.select().from(auditLogs).where(and(eq(auditLogs.entityId, FAQ_PAGE_SETTING_ENTITY_ID), eq(auditLogs.action, "faq_page.published")));
    expect(published).toMatchObject({ entityType: "platform_setting", metadataJson: { from: "DRAFT", to: "PUBLISHED" } });

    // A published page with every question hidden is on the site but not in the menu.
    await save("ADMIN", await current((row) => ({ ...row, visible: "" })));
    const empty = await readPublicFaqPage(db, "ro");
    expect(empty.items).toEqual([]);
    expect(faqPageOnSite(empty)).toBe(false);
    const audits = await db.select().from(auditLogs).where(eq(auditLogs.action, "faq_page.saved"));
    expect(audits.at(-1)?.metadataJson).toMatchObject({ hidden: [item.id] });
  });

  it("refuses a save loaded at an older version as a conflict", async () => {
    await save("COPYWRITER", [card()]);
    const stale = 1;
    expect(await refusal(saveFaqPage(db, { actor: actor("ADMIN"), expectedVersion: stale, fields: { items: await current() } }))).toMatchObject({
      code: "CONFLICT",
    });
  });

  it("moves a card with its arrow inside the save, keeping the words typed on the page", async () => {
    await save("ADMIN", [card({ questionRo: "A?", questionEn: "A?" }), card({ questionRo: "B?", questionEn: "B?" }), card({ questionRo: "C?", questionEn: "C?" })]);
    const typed = await current((row, index) => (index === 0 ? { ...row, questionRo: "A, scrisă acum?" } : row));
    await saveFaqPage(db, { actor: actor("COPYWRITER"), expectedVersion: await version(), fields: { items: typed }, move: { index: 2, direction: "up" } });
    expect((await listFaqItemsForAdmin(db)).map((row) => [row.questionRo, row.position])).toEqual([
      ["A, scrisă acum?", 1],
      ["C?", 2],
      ["B?", 3],
    ]);
    // An arrow at an end moves nothing.
    await saveFaqPage(db, { actor: actor("COPYWRITER"), expectedVersion: await version(), fields: { items: await current() }, move: { index: 0, direction: "up" } });
    expect((await listFaqItemsForAdmin(db)).map((row) => row.questionRo)).toEqual(["A, scrisă acum?", "C?", "B?"]);
  });

  it("lets the Redactor delete a hidden question, and only the Administrator one that is on the site", async () => {
    await save("ADMIN", [card({ questionRo: "Ascunsă?", questionEn: "Hidden?" }), card({ visible: "on" })]);
    await save("COPYWRITER", await current((row, index) => (index === 0 ? { ...row, remove: "on" } : row)));
    expect((await listFaqItemsForAdmin(db)).map((row) => row.questionRo)).toEqual(["Cum mă înscriu?"]);

    const onSite = await current((row) => ({ ...row, remove: "on" }));
    expect(await refusal(save("COPYWRITER", onSite))).toMatchObject({ code: "FORBIDDEN" });
    const [shown] = await listFaqItemsForAdmin(db);
    await save("ADMIN", onSite);
    expect(await db.select().from(faqQuestions)).toEqual([]);
    const audits = await db.select().from(auditLogs).where(eq(auditLogs.action, "faq_page.saved"));
    expect(audits.at(-1)?.metadataJson).toMatchObject({ deleted: [shown.id] });
  });

  it("keeps a picture in an answer from the orphan sweep, and names the page on the pictures list", async () => {
    const T0 = new Date("2026-09-18T10:00:00Z");
    const file = await sharp({ create: { width: 800, height: 600, channels: 3, background: "#3355ff" } }).jpeg().toBuffer();
    const uploaded = await uploadBodyImage(db, { actorId: actor("ADMIN").id, file, originalFilename: "harta.jpg", now: T0 });
    const picture = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Vezi harta." }] },
        { type: "image", attrs: { src: uploaded.src, alt: "harta", width: 800, height: 600 } },
      ],
    };
    await save("ADMIN", [card({ answerRoBody: JSON.stringify(picture) })]);
    expect(await sweepOrphanAssets(db, new Date(T0.getTime() + 30 * 24 * 60 * 60_000))).toBe(0);
    expect(await db.select({ id: mediaAssets.id }).from(mediaAssets)).toHaveLength(1);
    const [listed] = await listMediaAssetsForAdmin(db, "ro");
    expect(listed.references).toEqual([{ kind: "faq", id: "faqPage", title: null }]);
  });

  it("refuses a hand-made row with a blank question, or a category in one language, at the database", async () => {
    const row = { questionRo: "De ce?", questionEn: "Why?", answerRoJson: doc("x"), answerEnJson: doc("x"), answerRo: "x", answerEn: "x", position: 1 };
    await expect(db.insert(faqQuestions).values({ ...row, questionRo: " " })).rejects.toThrow();
    await expect(db.insert(faqQuestions).values({ ...row, categoryRo: "Înscriere" })).rejects.toThrow();
  });
});
