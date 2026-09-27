import sharp from "sharp";
import { and, asc, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { mediaAssets } from "@/db/schema/gallery";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { teamMembers } from "@/db/schema/team";
import {
  readTeamPageSettings,
  saveTeamPageIntro,
  setTeamPagePublished,
  TEAM_PAGE_SETTING_ENTITY_ID,
} from "@/modules/content/team/page-settings";
import { MAX_TEAM_LINKS } from "@/modules/content/team/links";
import { listTeamMembersForAdmin, listVisibleTeamMembers, readPublicTeamPage, teamPageOnSite } from "@/modules/content/team/repository";
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
 * §459 — «Echipa»: the team page's cards and the page itself. Who may write one and who may put it on the site, both
 * languages or neither, the page's own language only, the order, the version guard, and the photo
 * counted as a reference by the orphan sweep.
 */
describe("§459 the team page's cards", () => {
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
    name: "Ana Popescu",
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
    const second = await createTeamMember(db, { actor: actor("ADMIN"), fields: fields({ name: "Mihai Ionescu" }) });
    expect(first.visible).toBe(false);
    expect([first.position, second.position]).toEqual([1, 2]);
    expect(await listVisibleTeamMembers(db, "ro")).toEqual([]);
    expect((await listTeamMembersForAdmin(db)).map((row) => row.name)).toEqual(["Ana Popescu", "Mihai Ionescu"]);
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
    // Plain words from a caller without the editor read as a paragraph of the document (§474).
    const paragraph = (words: string) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: words }] }] });
    expect(ro).toMatchObject({ name: "Ana Popescu", role: "Antrenoare", bio: paragraph("Aleargă pe Tâmpa de zece ani."), photo: null });
    expect(en).toMatchObject({ name: "Ana Popescu", role: "Coach", bio: paragraph("Has run up Tâmpa for ten years.") });
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
    await db.insert(teamMembers).values({ name: "Elena Marin", roleRo: "Voluntară", roleEn: null, position: 1, visible: true });
    const [ro] = await listVisibleTeamMembers(db, "ro");
    const [en] = await listVisibleTeamMembers(db, "en");
    expect(ro.role).toBeNull();
    expect(en.role).toBeNull();
  });

  it("refuses a stale version rather than overwriting a colleague's save", async () => {
    const card = await createTeamMember(db, { actor: actor("ADMIN"), fields: fields() });
    await saveTeamMember(db, { actor: actor("COPYWRITER"), memberId: card.id, expectedVersion: card.version, fields: fields({ name: "Ana P." }) });
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
    const uploaded = await uploadBodyImage(db, { actorId: actor("ADMIN").id, file: picture, originalFilename: "ana.jpg", now: T0 });

    expect(
      await refusal(createTeamMember(db, { actor: actor("ADMIN"), fields: fields({ photoAssetId: "00000000-0000-4000-8000-000000000000" }) })),
    ).toEqual({ code: "VALIDATION_ERROR", fields: ["photoAssetId"] });

    const card = await createTeamMember(db, { actor: actor("ADMIN"), fields: fields({ photoAssetId: uploaded.assetId }), now: T0 });
    await setTeamMemberVisible(db, { actor: actor("ADMIN"), memberId: card.id, expectedVersion: card.version, visible: true });

    const [shown] = await listVisibleTeamMembers(db, "ro");
    expect(shown.photo).toMatchObject({ width: 800, height: 800 });
    expect(shown.photo?.webUrl).toContain("web.webp");

    const [row] = await listMediaAssetsForAdmin(db, "ro");
    expect(row.references).toEqual([{ kind: "team", id: card.id, title: "Ana Popescu" }]);
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
  const trail = async (entityId: string) =>
    db
      .select({ action: auditLogs.action, actor: auditLogs.actorStaffUserId, entityType: auditLogs.entityType, metadata: auditLogs.metadataJson })
      .from(auditLogs)
      .where(eq(auditLogs.entityId, entityId))
      .orderBy(asc(auditLogs.createdAt), asc(auditLogs.action));

  it("leaves an audit row for every write to a card, naming who acted and never the person", async () => {
    const card = await createTeamMember(db, { actor: actor("COPYWRITER"), fields: fields(), now: T0 });
    const saved = await saveTeamMember(db, {
      actor: actor("COPYWRITER"),
      memberId: card.id,
      expectedVersion: card.version,
      fields: fields({ link: "https://www.strava.com/athletes/1" }),
      now: daysLater(1),
    });
    const shown = await setTeamMemberVisible(db, { actor: actor("ADMIN"), memberId: card.id, expectedVersion: saved.version, visible: true, now: daysLater(2) });
    await setTeamMemberVisible(db, { actor: actor("ADMIN"), memberId: card.id, expectedVersion: shown.version, visible: false, now: daysLater(3) });
    await deleteTeamMember(db, { actor: actor("ADMIN"), memberId: card.id, now: daysLater(4) });

    const rows = await trail(card.id);
    expect(rows.map((row) => [row.action, row.actor])).toEqual([
      ["team_member.created", actor("COPYWRITER").id],
      ["team_member.saved", actor("COPYWRITER").id],
      ["team_member.shown", actor("ADMIN").id],
      ["team_member.hidden", actor("ADMIN").id],
      ["team_member.deleted", actor("ADMIN").id],
    ]);
    expect(rows.every((row) => row.entityType === "team_member")).toBe(true);
    // The shape of the change, never the name or the words (§12.12).
    expect(JSON.stringify(rows.map((row) => row.metadata))).not.toContain("Ana Popescu");
  });

  it("writes no audit row for a refused show, so the trail never claims what did not happen", async () => {
    const card = await createTeamMember(db, { actor: actor("COPYWRITER"), fields: fields() });
    await refusal(setTeamMemberVisible(db, { actor: actor("COPYWRITER"), memberId: card.id, expectedVersion: card.version, visible: true }));
    const shown = await db.select().from(auditLogs).where(and(eq(auditLogs.entityId, card.id), eq(auditLogs.action, "team_member.shown")));
    expect(shown).toEqual([]);
  });

  it("keeps a one-link card: an https address only, shown on the public card", async () => {
    expect(await refusal(createTeamMember(db, { actor: actor("ADMIN"), fields: fields({ link: "http://strava.com/x" }) }))).toEqual({
      code: "VALIDATION_ERROR",
      fields: ["link"],
    });
    expect(await refusal(createTeamMember(db, { actor: actor("ADMIN"), fields: fields({ link: "javascript:alert(1)" }) }))).toEqual({
      code: "VALIDATION_ERROR",
      fields: ["link"],
    });
    const card = await createTeamMember(db, { actor: actor("ADMIN"), fields: fields({ link: " https://instagram.com/ana.popescu " }) });
    expect(card.link).toBe("https://instagram.com/ana.popescu");
    await setTeamMemberVisible(db, { actor: actor("ADMIN"), memberId: card.id, expectedVersion: card.version, visible: true });
    expect((await listVisibleTeamMembers(db, "en"))[0]?.links).toEqual([{ kind: "INSTAGRAM", url: "https://instagram.com/ana.popescu", label: null }]);
  });

  it("shows nobody while the page is a draft, and the page once an Administrator publishes it", async () => {
    const card = await createTeamMember(db, { actor: actor("COPYWRITER"), fields: fields() });
    await setTeamMemberVisible(db, { actor: actor("ADMIN"), memberId: card.id, expectedVersion: card.version, visible: true });

    const draft = await readPublicTeamPage(db, "ro");
    expect(draft).toEqual({ published: false, intro: null, introText: null, members: [] });
    expect(teamPageOnSite(draft)).toBe(false);

    expect(await refusal(setTeamPagePublished(db, { actor: actor("COPYWRITER"), published: true }))).toMatchObject({ code: "FORBIDDEN" });
    expect(await refusal(setTeamPagePublished(db, { actor: actor("MODERATOR"), published: true }))).toMatchObject({ code: "FORBIDDEN" });

    await setTeamPagePublished(db, { actor: actor("ADMIN"), published: true, now: T0 });
    const live = await readPublicTeamPage(db, "en");
    expect(live.published).toBe(true);
    expect(live.members.map((member) => member.role)).toEqual(["Coach"]);
    expect(teamPageOnSite(live)).toBe(true);

    await setTeamPagePublished(db, { actor: actor("ADMIN"), published: false, now: daysLater(1) });
    expect((await readTeamPageSettings(db)).status).toBe("DRAFT");

    const rows = await trail(TEAM_PAGE_SETTING_ENTITY_ID);
    expect(rows.map((row) => [row.action, row.actor, row.entityType])).toEqual([
      ["team_page.published", actor("ADMIN").id, "platform_setting"],
      ["team_page.unpublished", actor("ADMIN").id, "platform_setting"],
    ]);
  });

  it("keeps a published page with no card shown off the menu and the sitemap", async () => {
    await createTeamMember(db, { actor: actor("COPYWRITER"), fields: fields() });
    await setTeamPagePublished(db, { actor: actor("ADMIN"), published: true });
    const page = await readPublicTeamPage(db, "ro");
    expect(page).toMatchObject({ published: true, members: [] });
    expect(teamPageOnSite(page)).toBe(false);
  });

  it("takes the club's introduction in both languages or neither, and reads it in the page's language", async () => {
    expect(await refusal(saveTeamPageIntro(db, { actor: actor("COPYWRITER"), fields: { introRo: "Cine suntem.", introEn: "" } }))).toEqual({
      code: "VALIDATION_ERROR",
      fields: ["introEn"],
    });
    expect(await refusal(saveTeamPageIntro(db, { actor: actor("MODERATOR"), fields: { introRo: "a", introEn: "b" } }))).toMatchObject({
      code: "FORBIDDEN",
    });
    await saveTeamPageIntro(db, { actor: actor("COPYWRITER"), fields: { introRo: "Cine suntem.", introEn: "Who we are." } });
    // Writing the introduction publishes nothing.
    expect((await readPublicTeamPage(db, "ro")).published).toBe(false);
    await setTeamPagePublished(db, { actor: actor("ADMIN"), published: true });
    expect((await readPublicTeamPage(db, "ro")).introText).toBe("Cine suntem.");
    expect((await readPublicTeamPage(db, "en")).introText).toBe("Who we are.");
    // Publishing keeps the words; emptying both returns the page to the platform's sentence.
    await saveTeamPageIntro(db, { actor: actor("ADMIN"), fields: { introRo: "", introEn: "" } });
    expect(await readTeamPageSettings(db)).toEqual({ status: "PUBLISHED", introRo: null, introEn: null, introRoJson: null, introEnJson: null });
    expect((await readPublicTeamPage(db, "en")).intro).toBeNull();
  });

  describe("§474 rich text and several links", () => {
    const doc = (...paragraphs: string[]) => ({
      type: "doc" as const,
      content: paragraphs.map((words) => ({ type: "paragraph" as const, content: [{ type: "text" as const, text: words }] })),
    });
    const pictureDoc = (src: string, alt: string) => ({ type: "doc" as const, content: [{ type: "image" as const, attrs: { src, alt, width: 800, height: 800 } }] });
    const row = (kind: string, url: string, labelRo = "", labelEn = "") => ({ kind, url, labelRo, labelEn });

    it("keeps the words about a person as documents, and a card's links in order, labels per language", async () => {
      const card = await createTeamMember(db, {
        actor: actor("COPYWRITER"),
        fields: {
          ...fields(),
          bioRoBody: JSON.stringify(doc("Aleargă pe Tâmpa.", "De zece ani.")),
          bioEnBody: JSON.stringify(doc("Runs up Tâmpa.", "For ten years.")),
          links: [
            row("STRAVA", "https://www.strava.com/athletes/1"),
            row("WEBSITE", "https://ana-alearga.example", "Blogul meu", "My blog"),
            row("OTHER", ""),
          ],
        },
      });
      // §459's columns keep the words and the first link, for the code serving during a rollout.
      expect(card).toMatchObject({ bioRo: "Aleargă pe Tâmpa.\nDe zece ani.", link: "https://www.strava.com/athletes/1" });
      await setTeamMemberVisible(db, { actor: actor("ADMIN"), memberId: card.id, expectedVersion: card.version, visible: true });

      const [ro] = await listVisibleTeamMembers(db, "ro");
      const [en] = await listVisibleTeamMembers(db, "en");
      expect(ro.bio).toEqual(doc("Aleargă pe Tâmpa.", "De zece ani."));
      expect(en.bio).toEqual(doc("Runs up Tâmpa.", "For ten years."));
      expect(ro.links).toEqual([
        { kind: "STRAVA", url: "https://www.strava.com/athletes/1", label: null },
        { kind: "WEBSITE", url: "https://ana-alearga.example", label: "Blogul meu" },
      ]);
      expect(en.links[1]).toMatchObject({ label: "My blog" });

      // Removing every link saves "no links", not the one §459 column left behind.
      const [admin] = await listTeamMembersForAdmin(db);
      const saved = await saveTeamMember(db, {
        actor: actor("COPYWRITER"),
        memberId: card.id,
        expectedVersion: admin.version,
        fields: { ...fields(), links: [] },
      });
      expect(saved).toMatchObject({ links: null, link: null });
      expect((await listVisibleTeamMembers(db, "ro"))[0]?.links).toEqual([]);
    });

    it("reads a card written before the editor: its plain words as paragraphs, its one link by its guessed kind", async () => {
      await db.insert(teamMembers).values({
        name: "Elena Marin",
        bioRo: "Unu.\n\nDoi.",
        bioEn: "One.\n\nTwo.",
        link: "https://instagram.com/elena",
        position: 1,
        visible: true,
      });
      const [ro] = await listVisibleTeamMembers(db, "ro");
      expect(ro.bio).toEqual(doc("Unu.", "Doi."));
      expect(ro.links).toEqual([{ kind: "INSTAGRAM", url: "https://instagram.com/elena", label: null }]);
      const [admin] = await listTeamMembersForAdmin(db);
      expect(admin.bioEn).toEqual(doc("One.", "Two."));
      expect(admin.links).toEqual([{ kind: "INSTAGRAM", url: "https://instagram.com/elena", labelRo: null, labelEn: null }]);
    });

    it("refuses a stored link that is not https, or a thirteenth, at the database too — and takes twelve (§491, migration 0094)", async () => {
      await expect(
        db.insert(teamMembers).values({ name: "X", position: 1, links: [{ kind: "OTHER", url: "http://example.org" }] }),
      ).rejects.toThrow();
      const links = (count: number) => Array.from({ length: count }, (_, index) => ({ kind: "OTHER", url: `https://example.org/${index}` }));
      expect(MAX_TEAM_LINKS).toBe(12);
      await expect(db.insert(teamMembers).values({ name: "X", position: 1, links: links(MAX_TEAM_LINKS + 1) })).rejects.toThrow();
      const [twelve] = await db.insert(teamMembers).values({ name: "Doisprezece", position: 1, links: links(MAX_TEAM_LINKS) }).returning();
      expect(twelve.links).toHaveLength(MAX_TEAM_LINKS);
      // One check by that name: 0093 dropped the six-link one and 0094 added this one.
      const result = await db.execute(
        sql`SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conname = 'team_members_links_is_a_short_array_of_https_links'`,
      );
      const rows = (result as unknown as { rows: { definition: string }[] }).rows;
      expect(rows).toHaveLength(1);
      expect(rows[0].definition).toContain(`<= ${MAX_TEAM_LINKS}`);
      await expect(db.insert(teamMembers).values({ name: "X", position: 1, links: { url: "https://example.org" } })).rejects.toThrow();
    });

    it("takes the introduction as rich text, both languages or neither, and reads it with its words", async () => {
      expect(
        await refusal(saveTeamPageIntro(db, { actor: actor("COPYWRITER"), fields: { introRoBody: JSON.stringify(doc("Cine suntem.")), introEnBody: "" } })),
      ).toEqual({ code: "VALIDATION_ERROR", fields: ["introEnBody"] });
      await saveTeamPageIntro(db, {
        actor: actor("COPYWRITER"),
        fields: { introRoBody: JSON.stringify(doc("Cine suntem.", "Ce facem.")), introEnBody: JSON.stringify(doc("Who we are.", "What we do.")) },
      });
      await setTeamPagePublished(db, { actor: actor("ADMIN"), published: true });
      const ro = await readPublicTeamPage(db, "ro");
      expect(ro.intro).toEqual(doc("Cine suntem.", "Ce facem."));
      expect(ro.introText).toBe("Cine suntem. Ce facem.");
      expect((await readTeamPageSettings(db)).introEn).toBe("Who we are.\nWhat we do.");
    });

    it("keeps a picture in a bio or in the introduction from the sweep, and names where it is used", async () => {
      const image = await sharp({ create: { width: 800, height: 800, channels: 3, background: "#33aa55" } }).jpeg().toBuffer();
      const inBio = await uploadBodyImage(db, { actorId: actor("ADMIN").id, file: image, originalFilename: "bio.jpg", now: T0 });
      const inIntro = await uploadBodyImage(db, { actorId: actor("ADMIN").id, file: image, originalFilename: "intro.jpg", now: T0 });

      const card = await createTeamMember(db, {
        actor: actor("ADMIN"),
        fields: { ...fields(), bioRoBody: JSON.stringify(pictureDoc(inBio.src, "Ana")), bioEnBody: JSON.stringify(pictureDoc(inBio.src, "Ana")) },
        now: T0,
      });
      await saveTeamPageIntro(db, {
        actor: actor("ADMIN"),
        fields: { introRoBody: JSON.stringify(pictureDoc(inIntro.src, "Echipa")), introEnBody: JSON.stringify(pictureDoc(inIntro.src, "The team")) },
        now: T0,
      });

      expect(await sweepOrphanAssets(db, daysLater(ORPHAN_ASSET_DAYS * 3))).toBe(0);
      const listed = await listMediaAssetsForAdmin(db, "ro");
      expect(listed.find((row) => row.id === inBio.assetId)?.references).toEqual([{ kind: "team", id: card.id, title: "Ana Popescu" }]);
      expect(listed.find((row) => row.id === inIntro.assetId)?.references).toEqual([{ kind: "teamIntro", id: "teamPage", title: null }]);
      expect(await refusal(deleteMediaAsset(db, { actor: actor("ADMIN"), assetId: inIntro.assetId }))).toMatchObject({ code: "VALIDATION_ERROR" });

      // Emptying both leaves the two pictures to the sweep, a week after nothing uses them.
      await deleteTeamMember(db, { actor: actor("ADMIN"), memberId: card.id });
      await saveTeamPageIntro(db, { actor: actor("ADMIN"), fields: { introRoBody: "", introEnBody: "" } });
      await sweepOrphanAssets(db, daysLater(ORPHAN_ASSET_DAYS * 3));
      expect(await sweepOrphanAssets(db, daysLater(ORPHAN_ASSET_DAYS * 5))).toBe(2);
    });
  });
});
