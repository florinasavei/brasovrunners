import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import type { StaffRole } from "@/modules/staff-identity/domain/roles";
import {
  readToolsPageSettings,
  saveShownTools,
  setToolsPagePublished,
  TOOLS_PAGE_SETTING_ENTITY_ID,
  toolsPageOnSite,
} from "@/modules/tools/page-settings";
import { isDomainError } from "@/shared/errors/domain-error";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

describe("§926 «Unelte»: the page's switch and its tools, the Administrator's", () => {
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
  const audits = (action: string) =>
    db.select().from(auditLogs).where(and(eq(auditLogs.entityId, TOOLS_PAGE_SETTING_ENTITY_ID), eq(auditLogs.action, action)));
  const refusal = (promise: Promise<unknown>) => promise.then(() => null, (error: unknown) => error);

  it("on the site with no row; taken off and put back by an Administrator, each audited from → to", async () => {
    expect(toolsPageOnSite(await readToolsPageSettings(db))).toBe(true);
    await setToolsPagePublished(db, { actor: actor("ADMIN"), published: false });
    expect(await readToolsPageSettings(db)).toEqual({ status: "DRAFT", hiddenTools: [] });
    expect(toolsPageOnSite(await readToolsPageSettings(db))).toBe(false);
    const [off] = await audits("tools_page.unpublished");
    expect(off).toMatchObject({ actorStaffUserId: actor("ADMIN").id, metadataJson: { from: "PUBLISHED", to: "DRAFT" } });

    await setToolsPagePublished(db, { actor: actor("ADMIN"), published: true });
    expect(toolsPageOnSite(await readToolsPageSettings(db))).toBe(true);
    expect(await audits("tools_page.published")).toHaveLength(1);
    // Pressing for the state it is already in writes nothing.
    await setToolsPagePublished(db, { actor: actor("ADMIN"), published: true });
    expect(await audits("tools_page.published")).toHaveLength(1);
  });

  it("a tool taken off the page by its tick: with none left the page is off the site; a save that changes nothing writes nothing", async () => {
    await saveShownTools(db, { actor: actor("ADMIN"), shown: [] });
    const settings = await readToolsPageSettings(db);
    expect(settings).toEqual({ status: "PUBLISHED", hiddenTools: ["pace"] });
    expect(toolsPageOnSite(settings)).toBe(false);
    const [changed] = await audits("tools_page.tools_changed");
    expect(changed).toMatchObject({ metadataJson: { from: [], to: ["pace"] } });

    await saveShownTools(db, { actor: actor("ADMIN"), shown: [] });
    expect(await audits("tools_page.tools_changed")).toHaveLength(1);
    // A key the platform does not have is ignored.
    await saveShownTools(db, { actor: actor("ADMIN"), shown: ["pace", "nope"] });
    expect(await readToolsPageSettings(db)).toEqual({ status: "PUBLISHED", hiddenTools: [] });
  });

  it("refused to every role below the Administrator, nothing written (BR-REQ-060-01)", async () => {
    for (const role of ["COPYWRITER", "MODERATOR"] as const) {
      const off = await refusal(setToolsPagePublished(db, { actor: actor(role), published: false }));
      expect(isDomainError(off) && off.code).toBe("FORBIDDEN");
      const ticks = await refusal(saveShownTools(db, { actor: actor(role), shown: [] }));
      expect(isDomainError(ticks) && ticks.code).toBe("FORBIDDEN");
    }
    expect(toolsPageOnSite(await readToolsPageSettings(db))).toBe(true);
  });
});
