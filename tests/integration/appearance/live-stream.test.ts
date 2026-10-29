import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { platformSettings } from "@/db/schema/platform-settings";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { LIVE_STREAM_SETTING_ENTITY_ID, LIVE_STREAM_SETTING_KEY, readLiveStream, updateLiveStream } from "@/modules/appearance/live-stream";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/** The public cache's expiry, watched: a save must expire the settings the header reads (§333). */
const cache = vi.hoisted(() => ({ revalidatePublicContent: vi.fn() }));
vi.mock("@/modules/public-cache/cache", () => cache);

/**
 * §NNN — «În direct pe YouTube» under «Setări» → «Aspect»: one `platform_settings` row, the
 * Administrator's (§450), audited, the notice on or off with the broadcast's YouTube address — on
 * only with an address, the address kept while off, and nothing else.
 */
const NOW = new Date("2026-11-21T08:30:00.000Z");
const CHANNEL_LIVE = "https://www.youtube.com/@brasovrunners/live";

describe("the live-broadcast notice setting", () => {
  let db: TestDatabase;
  let close: () => Promise<void>;
  let admin: StaffUser;
  let organizer: StaffUser;

  beforeAll(async () => {
    ({ db, close } = await createTestDatabase());
  });
  afterAll(async () => close());
  beforeEach(async () => {
    await resetTables(db);
    cache.revalidatePublicContent.mockClear();
    [admin] = await db.insert(staffUsers).values({ email: "admin@dev.test", displayName: "Admin", role: "ADMIN" }).returning();
    [organizer] = await db.insert(staffUsers).values({ email: "org@dev.test", displayName: "Org", role: "MODERATOR" }).returning();
  });

  const auditRows = () => db.select().from(auditLogs).where(eq(auditLogs.action, "live_stream.changed"));

  it("is off with no address until the club switches it on, then on with its address, with an audit row and the cache expired", async () => {
    expect(await readLiveStream(db)).toEqual({ setting: { on: false, url: null }, updatedAt: null });

    await updateLiveStream(db, admin, { on: "on", url: ` ${CHANNEL_LIVE} ` }, NOW);
    expect(await readLiveStream(db)).toEqual({ setting: { on: true, url: CHANNEL_LIVE }, updatedAt: NOW });
    expect(cache.revalidatePublicContent).toHaveBeenCalledTimes(1);
    expect(cache.revalidatePublicContent).toHaveBeenCalledWith("settings");

    const [audit] = await auditRows();
    expect(audit.actorStaffUserId).toBe(admin.id);
    expect(audit.entityType).toBe("platform_setting");
    expect(audit.entityId).toBe(LIVE_STREAM_SETTING_ENTITY_ID);
    expect(audit.metadataJson).toEqual({ from: "off", to: `on ${CHANNEL_LIVE}` });
  });

  it("keeps the address while the notice is off, so the next broadcast is one tick", async () => {
    await updateLiveStream(db, admin, { on: "on", url: CHANNEL_LIVE }, NOW);
    await updateLiveStream(db, admin, { on: null, url: CHANNEL_LIVE }, NOW);
    expect((await readLiveStream(db)).setting).toEqual({ on: false, url: CHANNEL_LIVE });
    const rows = await auditRows();
    expect(rows[1].metadataJson).toEqual({ from: `on ${CHANNEL_LIVE}`, to: `off (${CHANNEL_LIVE})` });

    await updateLiveStream(db, admin, { on: "on", url: CHANNEL_LIVE }, NOW);
    expect((await readLiveStream(db)).setting).toEqual({ on: true, url: CHANNEL_LIVE });
    expect(cache.revalidatePublicContent).toHaveBeenCalledTimes(3);
  });

  it("refuses on without an address, and any address that is not https on YouTube, naming the box, with nothing written or expired", async () => {
    await expect(updateLiveStream(db, admin, { on: "on", url: "" }, NOW)).rejects.toMatchObject({ code: "VALIDATION_ERROR", fields: ["url"] });
    await expect(updateLiveStream(db, admin, { on: "on", url: "https://example.com/live" }, NOW)).rejects.toMatchObject({ code: "VALIDATION_ERROR", fields: ["url"] });
    await expect(updateLiveStream(db, admin, { on: null, url: "http://youtube.com/@club/live" }, NOW)).rejects.toMatchObject({ code: "VALIDATION_ERROR", fields: ["url"] });
    expect(await readLiveStream(db)).toEqual({ setting: { on: false, url: null }, updatedAt: null });
    expect(await auditRows()).toHaveLength(0);
    expect(cache.revalidatePublicContent).not.toHaveBeenCalled();
  });

  it("is refused to anybody but an Administrator", async () => {
    await expect(updateLiveStream(db, organizer, { on: "on", url: CHANNEL_LIVE }, NOW)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await auditRows()).toHaveLength(0);
    expect(cache.revalidatePublicContent).not.toHaveBeenCalled();
  });

  it("reads a row an older release wrote in a shape this code cannot read as off", async () => {
    await db.insert(platformSettings).values({ key: LIVE_STREAM_SETTING_KEY, value: { on: true }, updatedAt: NOW });
    expect((await readLiveStream(db)).setting).toEqual({ on: false, url: null });
  });
});
