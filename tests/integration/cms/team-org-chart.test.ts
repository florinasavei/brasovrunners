import sharp from "sharp";
import { asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { teamMembers } from "@/db/schema/team";
import { createTeamBox, deleteTeamBox, moveTeamBox, saveTeamBox, setTeamBoxVisible } from "@/modules/content/team/boxes";
import { setTeamPagePublished } from "@/modules/content/team/page-settings";
import { listTeamBoxesForAdmin, listTeamMembersForAdmin, listVisibleTeamMembers, readPublicTeamPage } from "@/modules/content/team/repository";
import { createTeamMember, deleteTeamMember, saveTeamMember, setTeamMemberVisible } from "@/modules/content/team/service";
import { deleteMediaAsset, listMediaAssetsForAdmin, ORPHAN_ASSET_DAYS, sweepOrphanAssets } from "@/modules/media/references";
import { uploadBodyImage } from "@/modules/media/service";
import type { StaffRole } from "@/modules/staff-identity/domain/roles";
import { isDomainError } from "@/shared/errors/domain-error";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * §691 — «Echipa» as an organisational chart, on real PostgreSQL (PGlite): whom a card answers to
 * (a stored card, never itself, never a circle), the children of a deleted parent, the public read
 * of the new pairs, and the page's boxes with §459's two gates, their audit rows and their pictures.
 * Fixtures say «Președinte» and «Rol A»: no person, no partner.
 */
describe("§691 the organisational chart and the page's boxes", () => {
  let db: TestDatabase;
  let close: () => Promise<void>;
  const staff: Partial<Record<StaffRole, StaffUser>> = {};

  const T0 = new Date("2026-10-10T10:00:00Z");
  const daysLater = (days: number) => new Date(T0.getTime() + days * 24 * 60 * 60_000);

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
  const fields = (overrides: Record<string, string> = {}) => ({
    name: "Președinte",
    roleRo: "Președinte",
    roleEn: "President",
    bioRo: "",
    bioEn: "",
    photoAssetId: "",
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
  const show = async (memberId: string, version: number) =>
    setTeamMemberVisible(db, { actor: actor("ADMIN"), memberId, expectedVersion: version, visible: true });
  const auditActions = async () =>
    (await db.select({ action: auditLogs.action, entityType: auditLogs.entityType }).from(auditLogs).orderBy(asc(auditLogs.createdAt))).map(
      (row) => `${row.entityType}:${row.action}`,
    );

  describe("whom a card answers to, and its level on the canvas (§701)", () => {
    it("stores the parent, the placement, the sub-role, the responsibilities and the level, and reads them per language on the public page", async () => {
      const president = await createTeamMember(db, { actor: actor("ADMIN"), fields: fields({ level: "1" }), now: T0 });
      const advisor = await createTeamMember(db, {
        actor: actor("COPYWRITER"),
        fields: fields({
          name: "Rol A",
          roleRo: "Consilier",
          roleEn: "Advisor",
          subtitleRo: "Linia a doua",
          subtitleEn: "Second line",
          responsibilitiesRo: "Una\n\nDouă",
          responsibilitiesEn: "One\nTwo",
          reportsToId: president.id,
          placement: "beside",
          level: "1.5",
        }),
        now: T0,
      });
      expect(advisor).toMatchObject({ reportsToId: president.id, placement: "beside", subtitleRo: "Linia a doua", responsibilitiesRo: "Una\nDouă", level: 1.5 });
      // A root is always `below`, whatever was posted; the level is a number, exactly as posted.
      expect(president.placement).toBe("below");
      expect(president.level).toBe(1);

      await show(president.id, president.version);
      await show(advisor.id, advisor.version);
      const ro = await listVisibleTeamMembers(db, "ro");
      const en = await listVisibleTeamMembers(db, "en");
      expect(ro[0]).toMatchObject({ name: "Președinte", level: 1 });
      expect(ro[1]).toMatchObject({ name: "Rol A", subtitle: "Linia a doua", responsibilities: ["Una", "Două"], level: 1.5 });
      expect(en[1]).toMatchObject({ subtitle: "Second line", responsibilities: ["One", "Two"], level: 1.5 });
      // The public read says nothing of the parent since §701: the canvas is drawn from the level alone.
      expect(ro[1]).not.toHaveProperty("reportsToId");
      // The backoffice reads the same, both languages.
      const admin = await listTeamMembersForAdmin(db);
      expect(admin.find((row) => row.id === advisor.id)).toMatchObject({ subtitleEn: "Second line", responsibilitiesEn: "One\nTwo", level: 1.5 });
    });

    it("saves a level, clears it with an empty box, refuses a quarter step on the box, and the database refuses a level off the scale", async () => {
      const a = await createTeamMember(db, { actor: actor("ADMIN"), fields: fields({ name: "A" }), now: T0 });
      expect(a.level).toBeNull();
      const levelled = await saveTeamMember(db, { actor: actor("ADMIN"), memberId: a.id, expectedVersion: a.version, fields: fields({ name: "A", level: "2.5" }), now: T0 });
      expect(levelled.level).toBe(2.5);
      const cleared = await saveTeamMember(db, { actor: actor("ADMIN"), memberId: a.id, expectedVersion: levelled.version, fields: fields({ name: "A", level: "" }), now: T0 });
      expect(cleared.level).toBeNull();
      const quarter = await refusal(saveTeamMember(db, { actor: actor("ADMIN"), memberId: a.id, expectedVersion: cleared.version, fields: fields({ name: "A", level: "1.25" }) }));
      expect(quarter).toEqual({ code: "VALIDATION_ERROR", fields: ["level"] });
      // Nothing was written by the refusal: still no level, at the version the clear left.
      const [row] = await db.select({ level: teamMembers.level, version: teamMembers.version }).from(teamMembers).where(eq(teamMembers.id, a.id));
      expect(row).toEqual({ level: null, version: cleared.version });
      // The database's own range, whatever wrote it.
      const constraintOf = async (promise: Promise<unknown>) => {
        try {
          await promise;
        } catch (error) {
          const cause = (error as { cause?: { message?: string } }).cause;
          return `${(error as Error).message} ${cause?.message ?? ""}`;
        }
        throw new Error("expected the database to refuse");
      };
      expect(await constraintOf(db.update(teamMembers).set({ level: 10 }).where(eq(teamMembers.id, a.id)))).toMatch(/team_members_level_range/);
      expect(await constraintOf(db.update(teamMembers).set({ level: 0.5 }).where(eq(teamMembers.id, a.id)))).toMatch(/team_members_level_range/);
    });

    it("refuses a card answering to itself, to a card that does not exist, and to a card under it — a circle of any length — naming the box", async () => {
      const a = await createTeamMember(db, { actor: actor("ADMIN"), fields: fields({ name: "A" }), now: T0 });
      const b = await createTeamMember(db, { actor: actor("ADMIN"), fields: fields({ name: "B", reportsToId: a.id }), now: T0 });
      const c = await createTeamMember(db, { actor: actor("ADMIN"), fields: fields({ name: "C", reportsToId: b.id }), now: T0 });

      const self = await refusal(saveTeamMember(db, { actor: actor("ADMIN"), memberId: a.id, expectedVersion: a.version, fields: fields({ name: "A", reportsToId: a.id }) }));
      expect(self).toEqual({ code: "VALIDATION_ERROR", fields: ["reportsToId"] });
      const missing = await refusal(
        createTeamMember(db, { actor: actor("ADMIN"), fields: fields({ name: "D", reportsToId: "0f6c4a36-5d1a-4b8e-9c3d-2a1b0c9d8e7f" }) }),
      );
      expect(missing).toEqual({ code: "VALIDATION_ERROR", fields: ["reportsToId"] });
      // A → C would close the circle A → C → B → A.
      const circle = await refusal(saveTeamMember(db, { actor: actor("ADMIN"), memberId: a.id, expectedVersion: a.version, fields: fields({ name: "A", reportsToId: c.id }) }));
      expect(circle).toEqual({ code: "VALIDATION_ERROR", fields: ["reportsToId"] });
      // The two-card circle too.
      expect(await refusal(saveTeamMember(db, { actor: actor("ADMIN"), memberId: a.id, expectedVersion: a.version, fields: fields({ name: "A", reportsToId: b.id }) }))).toEqual({
        code: "VALIDATION_ERROR",
        fields: ["reportsToId"],
      });
      // Nothing was written: A still answers to nobody, at version 1.
      const [row] = await db.select({ reportsToId: teamMembers.reportsToId, version: teamMembers.version }).from(teamMembers).where(eq(teamMembers.id, a.id));
      expect(row).toEqual({ reportsToId: null, version: 1 });
      // Re-pointing C to A directly is a tree, not a circle.
      const moved = await saveTeamMember(db, { actor: actor("ADMIN"), memberId: c.id, expectedVersion: c.version, fields: fields({ name: "C", reportsToId: a.id }) });
      expect(moved.reportsToId).toBe(a.id);
    });

    it("the database refuses a row answering to itself and an unknown placement, whatever wrote them", async () => {
      const a = await createTeamMember(db, { actor: actor("ADMIN"), fields: fields({ name: "A" }), now: T0 });
      // Drizzle wraps the driver's error: the constraint's name is in the cause.
      const constraintOf = async (promise: Promise<unknown>) => {
        try {
          await promise;
        } catch (error) {
          const cause = (error as { cause?: { message?: string } }).cause;
          return `${(error as Error).message} ${cause?.message ?? ""}`;
        }
        throw new Error("expected the database to refuse");
      };
      expect(await constraintOf(db.update(teamMembers).set({ reportsToId: a.id }).where(eq(teamMembers.id, a.id)))).toMatch(/team_members_reports_to_not_self/);
      expect(await constraintOf(db.update(teamMembers).set({ placement: "above" }).where(eq(teamMembers.id, a.id)))).toMatch(/team_members_placement_known/);
    });

    it("leaves a deleted parent's children at the top: the reference goes null, nothing else moves", async () => {
      const p = await createTeamMember(db, { actor: actor("ADMIN"), fields: fields({ name: "P" }), now: T0 });
      const c = await createTeamMember(db, { actor: actor("ADMIN"), fields: fields({ name: "C", reportsToId: p.id, placement: "beside" }), now: T0 });
      await deleteTeamMember(db, { actor: actor("ADMIN"), memberId: p.id });
      const [row] = await db.select({ reportsToId: teamMembers.reportsToId, placement: teamMembers.placement, position: teamMembers.position }).from(teamMembers).where(eq(teamMembers.id, c.id));
      expect(row).toEqual({ reportsToId: null, placement: "beside", position: 2 });
    });
  });

  describe("the page's boxes", () => {
    const box = (overrides: Record<string, string> = {}) => ({
      titleRo: "Responsabilitate colectivă",
      titleEn: "Shared responsibility",
      bodyRo: "Proiectul A.",
      bodyEn: "Project A.",
      ...overrides,
    });

    it("lets the Redactor add and write a box, hidden, and never show it; the Administrator shows, hides and deletes a shown one", async () => {
      const created = await createTeamBox(db, { actor: actor("COPYWRITER"), fields: box(), now: T0 });
      expect(created.visible).toBe(false);
      expect(created.position).toBe(1);
      expect(await refusal(createTeamBox(db, { actor: actor("MODERATOR"), fields: box() }))).toMatchObject({ code: "FORBIDDEN" });
      expect(await refusal(setTeamBoxVisible(db, { actor: actor("COPYWRITER"), boxId: created.id, expectedVersion: created.version, visible: true }))).toMatchObject({ code: "FORBIDDEN" });

      const saved = await saveTeamBox(db, { actor: actor("COPYWRITER"), boxId: created.id, expectedVersion: created.version, fields: box({ titleRo: "Parteneriate", titleEn: "Partnerships" }), now: T0 });
      expect(saved).toMatchObject({ titleRo: "Parteneriate", version: 2, bodyRo: "Proiectul A." });
      // A stale version is a CONFLICT, never an overwrite.
      expect(await refusal(saveTeamBox(db, { actor: actor("ADMIN"), boxId: created.id, expectedVersion: 1, fields: box() }))).toMatchObject({ code: "CONFLICT" });

      const shown = await setTeamBoxVisible(db, { actor: actor("ADMIN"), boxId: created.id, expectedVersion: saved.version, visible: true });
      expect(shown.visible).toBe(true);
      // A shown box is the Administrator's to delete; the Redactor may still write it.
      expect(await refusal(deleteTeamBox(db, { actor: actor("COPYWRITER"), boxId: created.id }))).toMatchObject({ code: "FORBIDDEN" });
      await saveTeamBox(db, { actor: actor("COPYWRITER"), boxId: created.id, expectedVersion: shown.version, fields: box(), now: T0 });
      const hidden = await setTeamBoxVisible(db, { actor: actor("ADMIN"), boxId: created.id, expectedVersion: shown.version + 1, visible: false });
      expect(hidden.visible).toBe(false);
      // Hidden again, the Redactor may delete it.
      await deleteTeamBox(db, { actor: actor("COPYWRITER"), boxId: created.id });
      expect(await listTeamBoxesForAdmin(db)).toEqual([]);
      // A box that is not a uuid is a 404, not a 500.
      expect(await refusal(deleteTeamBox(db, { actor: actor("ADMIN"), boxId: "not-an-id" }))).toMatchObject({ code: "NOT_FOUND" });
    });

    it("refuses a title in one language, a text in one language, and keeps the order through moves", async () => {
      expect(await refusal(createTeamBox(db, { actor: actor("ADMIN"), fields: box({ titleEn: "" }) }))).toEqual({ code: "VALIDATION_ERROR", fields: ["titleEn"] });
      expect(await refusal(createTeamBox(db, { actor: actor("ADMIN"), fields: box({ bodyEn: "" }) }))).toEqual({ code: "VALIDATION_ERROR", fields: ["bodyEn"] });
      const first = await createTeamBox(db, { actor: actor("ADMIN"), fields: box(), now: T0 });
      const second = await createTeamBox(db, { actor: actor("ADMIN"), fields: box({ titleRo: "Parteneriate", titleEn: "Partnerships" }), now: T0 });
      await moveTeamBox(db, { actor: actor("COPYWRITER"), boxId: second.id, direction: "up" });
      expect((await listTeamBoxesForAdmin(db)).map((row) => row.id)).toEqual([second.id, first.id]);
      expect(await refusal(moveTeamBox(db, { actor: actor("MODERATOR"), boxId: first.id, direction: "up" }))).toMatchObject({ code: "FORBIDDEN" });
    });

    it("shows on the public page only the shown boxes, in order, in the page's language, and never a hidden one", async () => {
      await setTeamPagePublished(db, { actor: actor("ADMIN"), published: true });
      const hidden = await createTeamBox(db, { actor: actor("ADMIN"), fields: box({ titleRo: "Ascunsă", titleEn: "Hidden" }), now: T0 });
      const shown = await createTeamBox(db, { actor: actor("ADMIN"), fields: box(), now: T0 });
      await setTeamBoxVisible(db, { actor: actor("ADMIN"), boxId: shown.id, expectedVersion: shown.version, visible: true });
      const ro = await readPublicTeamPage(db, "ro");
      const en = await readPublicTeamPage(db, "en");
      expect(ro.boxes).toEqual([{ id: shown.id, title: "Responsabilitate colectivă", body: expect.objectContaining({ type: "doc" }) }]);
      expect(en.boxes.map((row) => row.title)).toEqual(["Shared responsibility"]);
      expect(JSON.stringify(ro)).not.toContain(hidden.id);
      // A box with no text at all is not drawn either: nothing to show under its title.
      const bare = await createTeamBox(db, { actor: actor("ADMIN"), fields: box({ bodyRo: "", bodyEn: "" }), now: T0 });
      await setTeamBoxVisible(db, { actor: actor("ADMIN"), boxId: bare.id, expectedVersion: bare.version, visible: true });
      expect((await readPublicTeamPage(db, "ro")).boxes.map((row) => row.id)).toEqual([shown.id]);
    });

    it("leaves an audit row per write that names the box by id and never its words", async () => {
      // A second box, so a move has somewhere to go; its own row is the first.
      const other = await createTeamBox(db, { actor: actor("ADMIN"), fields: box({ titleRo: "Alta", titleEn: "Other" }), now: T0 });
      const created = await createTeamBox(db, { actor: actor("COPYWRITER"), fields: box(), now: T0 });
      await saveTeamBox(db, { actor: actor("COPYWRITER"), boxId: created.id, expectedVersion: 1, fields: box(), now: T0 });
      await moveTeamBox(db, { actor: actor("COPYWRITER"), boxId: created.id, direction: "up", now: T0 });
      await setTeamBoxVisible(db, { actor: actor("ADMIN"), boxId: created.id, expectedVersion: 2, visible: true, now: T0 });
      await setTeamBoxVisible(db, { actor: actor("ADMIN"), boxId: created.id, expectedVersion: 3, visible: false, now: T0 });
      await deleteTeamBox(db, { actor: actor("ADMIN"), boxId: created.id, now: T0 });
      expect(await auditActions()).toEqual([
        "team_page_box:team.box.created",
        "team_page_box:team.box.created",
        "team_page_box:team.box.saved",
        "team_page_box:team.box.moved",
        "team_page_box:team.box.shown",
        "team_page_box:team.box.hidden",
        "team_page_box:team.box.deleted",
      ]);
      const rows = await db.select({ entityId: auditLogs.entityId, metadata: auditLogs.metadataJson }).from(auditLogs);
      expect(rows.filter((row) => row.entityId === created.id)).toHaveLength(6);
      expect(rows.filter((row) => row.entityId === other.id)).toHaveLength(1);
      for (const row of rows) expect(JSON.stringify(row.metadata)).not.toMatch(/Responsabilitate|Proiectul|Alta/);
    });

    it("keeps a picture inside a box's text from the sweep, names the box on the pictures page, and lets it go once the box is gone", async () => {
      const image = await sharp({ create: { width: 800, height: 800, channels: 3, background: "#33aa55" } }).jpeg().toBuffer();
      const logo = await uploadBodyImage(db, { actorId: actor("ADMIN").id, file: image, originalFilename: "partener-1.jpg", now: T0 });
      const pictureDoc = (src: string, alt: string) => ({ type: "doc" as const, content: [{ type: "image" as const, attrs: { src, alt, width: 800, height: 800 } }] });
      const created = await createTeamBox(db, {
        actor: actor("ADMIN"),
        fields: { titleRo: "Parteneriate", titleEn: "Partnerships", bodyRoBody: JSON.stringify(pictureDoc(logo.src, "Partener 1")), bodyEnBody: JSON.stringify(pictureDoc(logo.src, "Partner 1")) },
        now: T0,
      });

      expect(await sweepOrphanAssets(db, daysLater(ORPHAN_ASSET_DAYS * 3))).toBe(0);
      const listedRo = await listMediaAssetsForAdmin(db, "ro");
      expect(listedRo.find((row) => row.id === logo.assetId)?.references).toEqual([{ kind: "teamBox", id: created.id, title: "Parteneriate" }]);
      const listedEn = await listMediaAssetsForAdmin(db, "en");
      expect(listedEn.find((row) => row.id === logo.assetId)?.references).toEqual([{ kind: "teamBox", id: created.id, title: "Partnerships" }]);
      expect(await refusal(deleteMediaAsset(db, { actor: actor("ADMIN"), assetId: logo.assetId }))).toMatchObject({ code: "VALIDATION_ERROR" });

      await deleteTeamBox(db, { actor: actor("ADMIN"), boxId: created.id });
      await sweepOrphanAssets(db, daysLater(ORPHAN_ASSET_DAYS * 3));
      expect(await sweepOrphanAssets(db, daysLater(ORPHAN_ASSET_DAYS * 5))).toBe(1);
    });
  });
});
