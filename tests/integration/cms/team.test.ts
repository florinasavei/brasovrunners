import sharp from "sharp";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { mediaAssets } from "@/db/schema/gallery";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { teamMembers } from "@/db/schema/team";
import { listTeamMembersForAdmin, listVisibleTeamMembers } from "@/modules/content/team/repository";
import {
  createTeamMember,
  deleteTeamMember,
  moveTeamMember,
  saveTeamMember,
  setTeamMemberVisible,
} from "@/modules/content/team/service";
import { deleteMediaAsset, listMediaAssetsForAdmin, ORPHAN_ASSET_DAYS, sweepOrphanAssets } from "@/modules/media/references";
import { uploadBodyImage } from "@/modules/media/service";
import type { StaffRole } from "@/modules/staff-identity/domain/roles";
import { isDomainError } from "@/shared/errors/domain-error";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * §NNN — «Echipa»: the team page's cards. Who may write one and who may put it on the site, both
 * languages or neither, the page's own language only, the order, the version guard, and the photo
 * counted as a reference by the orphan sweep.
 */
describe("§NNN the team page's cards", () => {
  let db: TestDatabase;
  let close: () => Promise<void>;
  const staff: Partial<Record<StaffRole, StaffUser>> = {};

  const T0 = new Date("2026-09-26T10:00:00Z");
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
    name: "Amalia",
    roleRo: "Antrenoare",
    roleEn: "Coach",
    bioRo: "Aleargă pe Tâmpa de zece ani.",
    bioEn: "Has run up Tâmpa for ten years.",
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

  it("adds a card at the end, hidden, and the public page does not show it", async () => {
    const first = await createTeamMember(db, { actor: actor("COPYWRITER"), fields: fields() });
    const second = await createTeamMember(db, { actor: actor("ADMIN"), fields: fields({ name: "Dani" }) });
    expect(first.visible).toBe(false);
    expect([first.position, second.position]).toEqual([1, 2]);
    expect(await listVisibleTeamMembers(db, "ro")).toEqual([]);
    expect((await listTeamMembersForAdmin(db)).map((row) => row.name)).toEqual(["Amalia", "Dani"]);
  });

  it("refuses the Organizer and the volunteer any write, and the Redactor putting a card on the site", async () => {
    expect(await refusal(createTeamMember(db, { actor: actor("MODERATOR"), fields: fields() }))).toMatchObject({ code: "FORBIDDEN" });
    const card = await createTeamMember(db, { actor: actor("COPYWRITER"), fields: fields() });
    expect(
      await refusal(setTeamMemberVisible(db, { actor: actor("COPYWRITER"), memberId: card.id, expectedVersion: card.version, visible: true })),
    ).toMatchObject({ code: "FORBIDDEN" });
    expect(
      await refusal(saveTeamMember(db, { actor: actor("MODERATOR"), memberId: card.id, expectedVersion: card.version, fields: fields() })),
    ).toMatchObject({ code: "FORBIDDEN" });
  });

  it("shows a card in the page's own language only, once an Administrator puts it on the site", async () => {
    const card = await createTeamMember(db, { actor: actor("COPYWRITER"), fields: fields() });
    await setTeamMemberVisible(db, { actor: actor("ADMIN"), memberId: card.id, expectedVersion: card.version, visible: true });

    const [ro] = await listVisibleTeamMembers(db, "ro");
    const [en] = await listVisibleTeamMembers(db, "en");
    expect(ro).toMatchObject({ name: "Amalia", role: "Antrenoare", bio: "Aleargă pe Tâmpa de zece ani.", photo: null });
    expect(en).toMatchObject({ name: "Amalia", role: "Coach", bio: "Has run up Tâmpa for ten years." });
  });

  it("refuses a pair written in one language, naming the empty box, and accepts both empty", async () => {
    expect(await refusal(createTeamMember(db, { actor: actor("ADMIN"), fields: fields({ roleEn: "" }) }))).toEqual({
      code: "VALIDATION_ERROR",
      fields: ["roleEn"],
    });
    expect(await refusal(createTeamMember(db, { actor: actor("ADMIN"), fields: fields({ bioRo: "  " }) }))).toEqual({
      code: "VALIDATION_ERROR",
      fields: ["bioRo"],
    });
    const bare = await createTeamMember(db, { actor: actor("ADMIN"), fields: fields({ roleRo: "", roleEn: "", bioRo: "", bioEn: "" }) });
    expect(bare).toMatchObject({ roleRo: null, roleEn: null, bioRo: null, bioEn: null });
  });

  it("reads a half pair stored by hand as none on both pages, never the other language", async () => {
    await db.insert(teamMembers).values({ name: "Ioana", roleRo: "Voluntară", roleEn: null, position: 1, visible: true });
    const [ro] = await listVisibleTeamMembers(db, "ro");
    const [en] = await listVisibleTeamMembers(db, "en");
    expect(ro.role).toBeNull();
    expect(en.role).toBeNull();
  });

  it("refuses a stale version rather than overwriting a colleague's save", async () => {
    const card = await createTeamMember(db, { actor: actor("ADMIN"), fields: fields() });
    await saveTeamMember(db, { actor: actor("COPYWRITER"), memberId: card.id, expectedVersion: card.version, fields: fields({ name: "Amalia P." }) });
    expect(
      await refusal(saveTeamMember(db, { actor: actor("ADMIN"), memberId: card.id, expectedVersion: card.version, fields: fields() })),
    ).toMatchObject({ code: "CONFLICT" });
  });

  it("moves a card and renumbers the list", async () => {
    const a = await createTeamMember(db, { actor: actor("ADMIN"), fields: fields({ name: "A" }) });
    await createTeamMember(db, { actor: actor("ADMIN"), fields: fields({ name: "B" }) });
    const c = await createTeamMember(db, { actor: actor("ADMIN"), fields: fields({ name: "C" }) });
    await moveTeamMember(db, { actor: actor("COPYWRITER"), memberId: c.id, direction: "up" });
    await moveTeamMember(db, { actor: actor("COPYWRITER"), memberId: a.id, direction: "up" });
    const rows = await listTeamMembersForAdmin(db);
    expect(rows.map((row) => [row.name, row.position])).toEqual([
      ["A", 1],
      ["C", 2],
      ["B", 3],
    ]);
  });

  it("lets the Redactor delete a hidden card and only the Administrator one on the site", async () => {
    const hidden = await createTeamMember(db, { actor: actor("COPYWRITER"), fields: fields({ name: "Hidden" }) });
    await deleteTeamMember(db, { actor: actor("COPYWRITER"), memberId: hidden.id });

    const shown = await createTeamMember(db, { actor: actor("COPYWRITER"), fields: fields({ name: "Shown" }) });
    await setTeamMemberVisible(db, { actor: actor("ADMIN"), memberId: shown.id, expectedVersion: shown.version, visible: true });
    expect(await refusal(deleteTeamMember(db, { actor: actor("COPYWRITER"), memberId: shown.id }))).toMatchObject({ code: "FORBIDDEN" });
    await deleteTeamMember(db, { actor: actor("ADMIN"), memberId: shown.id });
    expect(await listTeamMembersForAdmin(db)).toEqual([]);
  });

  it("keeps the photo as a reference: listed, never swept, never deletable, and refused when it is not stored", async () => {
    const picture = await sharp({ create: { width: 800, height: 800, channels: 3, background: "#3355ff" } }).jpeg().toBuffer();
    const uploaded = await uploadBodyImage(db, { actorId: actor("ADMIN").id, file: picture, originalFilename: "amalia.jpg", now: T0 });

    expect(
      await refusal(createTeamMember(db, { actor: actor("ADMIN"), fields: fields({ photoAssetId: "00000000-0000-4000-8000-000000000000" }) })),
    ).toEqual({ code: "VALIDATION_ERROR", fields: ["photoAssetId"] });

    const card = await createTeamMember(db, { actor: actor("ADMIN"), fields: fields({ photoAssetId: uploaded.assetId }), now: T0 });
    await setTeamMemberVisible(db, { actor: actor("ADMIN"), memberId: card.id, expectedVersion: card.version, visible: true });

    const [shown] = await listVisibleTeamMembers(db, "ro");
    expect(shown.photo).toMatchObject({ width: 800, height: 800 });
    expect(shown.photo?.webUrl).toContain("web.webp");

    const [row] = await listMediaAssetsForAdmin(db, "ro");
    expect(row.references).toEqual([{ kind: "team", id: card.id, title: "Amalia" }]);
    expect(await refusal(deleteMediaAsset(db, { actor: actor("ADMIN"), assetId: uploaded.assetId }))).toMatchObject({
      code: "VALIDATION_ERROR",
    });
    expect(await sweepOrphanAssets(db, daysLater(ORPHAN_ASSET_DAYS * 3))).toBe(0);

    // Deleting the card leaves the picture to the sweep, a week after nothing uses it.
    await deleteTeamMember(db, { actor: actor("ADMIN"), memberId: card.id });
    const later = daysLater(ORPHAN_ASSET_DAYS * 3);
    await sweepOrphanAssets(db, later);
    expect(await sweepOrphanAssets(db, daysLater(ORPHAN_ASSET_DAYS * 5))).toBe(1);
    expect(await db.select().from(mediaAssets).where(eq(mediaAssets.id, uploaded.assetId))).toEqual([]);
  });
});
