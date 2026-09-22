import { readFileSync } from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import {
  botCheckIsOn,
  DEFAULT_BOT_CHECK,
  forgetCachedBotCheck,
  readBotCheck,
  updateBotCheck,
} from "@/modules/registrations/bot-check";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * BR-REQ-031-03, `DECISIONS.md` §254 — the anti-bot challenge is a switch the club can reach.
 *
 * It has been behind two environment keys since §97, so turning it off needed a deployment —
 * on the very day it is refusing real people (§216), which is the day it must be quickest to
 * turn off. What must stay true: the default is **on**, only an Administrator may move it, the
 * trail records who did and in which direction, and the two forms that carry the challenge
 * both consult it.
 */
const NOW = new Date("2026-10-11T09:00:00.000Z");

describe("§254 the anti-bot switch", () => {
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
    forgetCachedBotCheck();
    [admin] = await db.insert(staffUsers).values({ email: "admin@dev.test", displayName: "Admin", role: "ADMIN" }).returning();
    [organizer] = await db
      .insert(staffUsers)
      .values({ email: "moderator@dev.test", displayName: "Organizer", role: "MODERATOR" })
      .returning();
  });

  it("is on when nobody has touched it", async () => {
    // A defence is not removed by a missing row.
    expect(await readBotCheck(db)).toEqual(DEFAULT_BOT_CHECK);
    expect(await botCheckIsOn(db, NOW)).toBe(true);
  });

  it("switches off and on, and the next submission sees it at once", async () => {
    expect(await botCheckIsOn(db, NOW)).toBe(true);
    await updateBotCheck(db, admin, false, NOW);
    // The memo the request path uses is dropped on a save: waiting thirty seconds to stop
    // refusing people would be thirty seconds of the thing being switched off to fix.
    expect(await botCheckIsOn(db, NOW)).toBe(false);
    await updateBotCheck(db, admin, true, NOW);
    expect(await botCheckIsOn(db, NOW)).toBe(true);
  });

  it("is an Administrator's decision", async () => {
    // The same gate as every other setting that changes what a participant meets (§100, §244).
    await expect(updateBotCheck(db, organizer, false, NOW)).rejects.toThrow();
    expect((await readBotCheck(db)).enabled).toBe(true);
  });

  it("records who switched it and which way", async () => {
    await updateBotCheck(db, admin, false, NOW);
    const [row] = await db.select().from(auditLogs).where(eq(auditLogs.action, "bot_check.changed"));
    expect(row.actorStaffUserId).toBe(admin.id);
    expect(row.metadataJson).toEqual({ from: true, to: false });
  });

  it("is consulted by both public forms and by both of their actions", () => {
    /*
      A source assertion, and worth one: a switch that half the entry points ignore is worse
      than no switch — the club would believe the challenge was off while the registration form
      still refused people. Four places carry it (§97): the two forms and their two actions.
    */
    const read = (...where: string[]) => readFileSync(path.join(process.cwd(), ...where), "utf8");
    expect(read("src", "app", "[locale]", "events", "[slug]", "register", "page.tsx")).toContain("activeBotCheckSiteKey");
    expect(read("src", "app", "[locale]", "contact", "page.tsx")).toContain("activeBotCheckSiteKey");
    for (const action of [
      ["src", "app", "[locale]", "events", "[slug]", "register", "actions.ts"],
      ["src", "app", "[locale]", "events", "[slug]", "actions.ts"],
      ["src", "app", "[locale]", "contact", "actions.ts"],
    ]) {
      expect(read(...action), action.join("/")).toContain("botCheckIsOn");
    }
  });
});
