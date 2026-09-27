import sharp from "sharp";
import { asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { emailOutbox } from "@/db/schema/email-outbox";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import {
  MEMBERS_PAGE_SETTING_ENTITY_ID,
  readMembersPageSettings,
  readMembersZone,
  readPublicMembersPage,
  saveMembersText,
  setMembersPagePublished,
} from "@/modules/content/members/page-settings";
import { deleteMediaAsset, listMediaAssetsForAdmin, ORPHAN_ASSET_DAYS, sweepOrphanAssets } from "@/modules/media/references";
import { uploadBodyImage } from "@/modules/media/service";
import type { StaffRole } from "@/modules/staff-identity/domain/roles";
import { countMembers } from "@/modules/staff-identity/repository";
import { inviteStaffUser } from "@/modules/staff-identity/service";
import { isDomainError } from "@/shared/errors/domain-error";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * BR-REQ-060-01, §NNN — the members' pages: who writes them and who puts the public one on the site,
 * both languages or neither, the members' zone never in the public read, the pictures in them kept
 * from the sweep, and a member invited from the team page with a member's invitation.
 */
describe("§NNN the members' pages", () => {
  let db: TestDatabase;
  let close: () => Promise<void>;
  const staff: Partial<Record<StaffRole, StaffUser>> = {};

  const T0 = new Date("2026-09-27T10:00:00Z");
  const daysLater = (days: number) => new Date(T0.getTime() + days * 24 * 60 * 60_000);

  beforeAll(async () => {
    ({ db, close } = await createTestDatabase());
  });
  afterAll(async () => close());
  beforeEach(async () => {
    await resetTables(db);
    for (const role of ["MEMBER", "CONTRIBUTOR", "COPYWRITER", "MODERATOR", "ADMIN"] as const) {
      [staff[role]] = await db
        .insert(staffUsers)
        .values({ email: `${role.toLowerCase()}@dev.test`, displayName: role, role })
        .returning();
    }
  });

  const actor = (role: StaffRole) => staff[role] as StaffUser;
  const doc = (...paragraphs: string[]) => ({
    type: "doc" as const,
    content: paragraphs.map((words) => ({ type: "paragraph" as const, content: [{ type: "text" as const, text: words }] })),
  });
  const body = (...paragraphs: string[]) => JSON.stringify(doc(...paragraphs));
  const pictureDoc = (src: string, alt: string) =>
    JSON.stringify({ type: "doc", content: [{ type: "image", attrs: { src, alt, width: 800, height: 800 } }] });

  const refusal = async (promise: Promise<unknown>) => {
    try {
      await promise;
    } catch (error) {
      if (isDomainError(error)) return { code: error.code, fields: error.fields };
      throw error;
    }
    throw new Error("expected a refusal");
  };

  it("lets the Redactor and the Administrator write both texts, both languages or neither, and nobody else", async () => {
    for (const role of ["MEMBER", "CONTRIBUTOR", "MODERATOR"] as const) {
      expect(
        await refusal(saveMembersText(db, { actor: actor(role), text: "zone", fields: { zoneRoBody: body("a"), zoneEnBody: body("b") } })),
        role,
      ).toMatchObject({ code: "FORBIDDEN" });
    }
    // One language alone is refused on the empty box (§352), every other box kept by the form.
    expect(
      await refusal(saveMembersText(db, { actor: actor("COPYWRITER"), text: "benefits", fields: { benefitsRoBody: body("Reduceri."), benefitsEnBody: "" } })),
    ).toEqual({ code: "VALIDATION_ERROR", fields: ["benefitsEnBody"] });

    await saveMembersText(db, {
      actor: actor("COPYWRITER"),
      text: "benefits",
      fields: { benefitsRoBody: body("Reduceri la cursele clubului."), benefitsEnBody: body("Discounts on the club's races.") },
    });
    await saveMembersText(db, {
      actor: actor("ADMIN"),
      text: "zone",
      fields: { zoneRoBody: body("Codul de reducere: ALERG."), zoneEnBody: body("The discount code: ALERG.") },
    });
    const settings = await readMembersPageSettings(db);
    expect(settings.benefitsRo).toBe("Reduceri la cursele clubului.");
    expect(settings.zoneEn).toBe("The discount code: ALERG.");
    // Saving one text leaves the other as it was.
    expect(settings.benefitsEnJson).toEqual(doc("Discounts on the club's races."));
  });

  it("publishes the public page only for an Administrator, and never hands the zone's words to the public read", async () => {
    await saveMembersText(db, { actor: actor("ADMIN"), text: "benefits", fields: { benefitsRoBody: body("Beneficii."), benefitsEnBody: body("Benefits.") } });
    await saveMembersText(db, { actor: actor("ADMIN"), text: "zone", fields: { zoneRoBody: body("Doar pentru membri."), zoneEnBody: body("Members only.") } });

    // A draft page shows nothing; the zone reads its words all the same — it is behind the sign-in.
    expect(await readPublicMembersPage(db, "ro")).toEqual({ published: false, benefits: null, benefitsText: null });
    expect(await readMembersZone(db, "en")).toEqual(doc("Members only."));

    for (const role of ["COPYWRITER", "MODERATOR", "MEMBER"] as const) {
      expect(await refusal(setMembersPagePublished(db, { actor: actor(role), published: true })), role).toMatchObject({ code: "FORBIDDEN" });
    }
    await setMembersPagePublished(db, { actor: actor("ADMIN"), published: true, now: T0 });

    const ro = await readPublicMembersPage(db, "ro");
    expect(ro).toEqual({ published: true, benefits: doc("Beneficii."), benefitsText: "Beneficii." });
    expect(JSON.stringify(await readPublicMembersPage(db, "en"))).not.toContain("Members only.");
    expect(JSON.stringify(ro)).not.toContain("Doar pentru membri.");

    // Emptying both sides of the zone: the members read the platform's sentence, never the other language.
    await saveMembersText(db, { actor: actor("ADMIN"), text: "zone", fields: { zoneRoBody: "", zoneEnBody: "" } });
    expect(await readMembersZone(db, "ro")).toBeNull();
  });

  it("leaves an audit row per write that names the setting and never the words", async () => {
    await saveMembersText(db, { actor: actor("COPYWRITER"), text: "zone", fields: { zoneRoBody: body("Secret."), zoneEnBody: body("Secret.") }, now: T0 });
    await setMembersPagePublished(db, { actor: actor("ADMIN"), published: true, now: T0 });
    await setMembersPagePublished(db, { actor: actor("ADMIN"), published: false, now: T0 });
    const rows = await db
      .select({ action: auditLogs.action, actor: auditLogs.actorStaffUserId, entityType: auditLogs.entityType, metadata: auditLogs.metadataJson })
      .from(auditLogs)
      .where(eq(auditLogs.entityId, MEMBERS_PAGE_SETTING_ENTITY_ID))
      .orderBy(asc(auditLogs.createdAt));
    expect(rows.map((row) => [row.action, row.actor, row.entityType])).toEqual([
      ["members_page.text_saved", actor("COPYWRITER").id, "platform_setting"],
      ["members_page.published", actor("ADMIN").id, "platform_setting"],
      ["members_page.unpublished", actor("ADMIN").id, "platform_setting"],
    ]);
    expect(JSON.stringify(rows)).not.toContain("Secret");
  });

  it("keeps a picture in either text from the sweep, and names where it is used", async () => {
    const image = await sharp({ create: { width: 800, height: 800, channels: 3, background: "#3355aa" } }).jpeg().toBuffer();
    const inZone = await uploadBodyImage(db, { actorId: actor("ADMIN").id, file: image, originalFilename: "zona.jpg", now: T0 });
    await saveMembersText(db, {
      actor: actor("ADMIN"),
      text: "zone",
      fields: { zoneRoBody: pictureDoc(inZone.src, "Harta"), zoneEnBody: pictureDoc(inZone.src, "The map") },
      now: T0,
    });

    expect(await sweepOrphanAssets(db, daysLater(ORPHAN_ASSET_DAYS * 3))).toBe(0);
    const listed = await listMediaAssetsForAdmin(db, "ro");
    expect(listed.find((row) => row.id === inZone.assetId)?.references).toEqual([{ kind: "membersPage", id: "membersPage", title: null }]);
    expect(await refusal(deleteMediaAsset(db, { actor: actor("ADMIN"), assetId: inZone.assetId }))).toMatchObject({ code: "VALIDATION_ERROR" });

    await saveMembersText(db, { actor: actor("ADMIN"), text: "zone", fields: { zoneRoBody: "", zoneEnBody: "" } });
    await sweepOrphanAssets(db, daysLater(ORPHAN_ASSET_DAYS * 3));
    expect(await sweepOrphanAssets(db, daysLater(ORPHAN_ASSET_DAYS * 5))).toBe(1);
  });

  it("invites a member from the team page with the member's invitation, and counts the members", async () => {
    expect(await countMembers(db)).toBe(1);
    // A member's invitation says the members' zone; a colleague's still says the team.
    await inviteStaffUser(db, actor("ADMIN"), { email: "Ana@Club.test", displayName: "Ana", role: "MEMBER", preferredLocale: "ro" });
    await inviteStaffUser(db, actor("ADMIN"), { email: "vlad@club.test", displayName: "Vlad", role: "CONTRIBUTOR", preferredLocale: "en" });
    const queued = await db
      .select({ to: emailOutbox.recipientEmail, type: emailOutbox.messageType })
      .from(emailOutbox)
      .orderBy(asc(emailOutbox.recipientEmail));
    expect(queued).toEqual([
      { to: "ana@club.test", type: "MEMBER_INVITATION" },
      { to: "vlad@club.test", type: "STAFF_INVITATION" },
    ]);
    expect(await countMembers(db)).toBe(2);
    // Below the Administrator nobody makes a member either (§450).
    expect(
      await refusal(inviteStaffUser(db, actor("MODERATOR"), { email: "x@club.test", displayName: "X", role: "MEMBER", preferredLocale: "ro" })),
    ).toMatchObject({ code: "FORBIDDEN" });
  });
});
