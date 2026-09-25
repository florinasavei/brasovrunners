import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { platformSettings } from "@/db/schema/platform-settings";
import { staffUsers } from "@/db/schema/staff-users";
import {
  ADDRESS_CAP_SETTING_KEY,
  currentAddressCap,
  readAddressCap,
  updateAddressCap,
} from "@/modules/registrations/address-cap";
import { forgetCachedAddressCap } from "@/modules/registrations/address-cap-memo";
import { DEFAULT_ADDRESS_CAP } from "@/modules/registrations/domain/address-cap";
import { isDomainError } from "@/shared/errors/domain-error";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * §389 — "Maxim de înscrieri pe o adresă (pe eveniment)", the club's setting in the shape of the
 * deadlines (§377): four unless set; the Administrator's alone, asserted on the server; every
 * change audited from and to; a save that changes nothing writes nothing; a value this code cannot
 * read is the default; and the submission paths read it through the one memoized function.
 */
const NOW = new Date("2026-09-25T10:00:00.000Z");

let db: TestDatabase;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
});
afterAll(async () => close());
beforeEach(async () => resetTables(db));

type Role = "CONTRIBUTOR" | "COPYWRITER" | "MODERATOR" | "DEV" | "ADMIN" | "SUPERADMIN";
async function staff(role: Role) {
  const [row] = await db.insert(staffUsers).values({ email: `${role.toLowerCase()}@example.ro`, displayName: role, role }).returning();
  return row;
}

async function refusal(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    if (isDomainError(error)) return { code: error.code, fields: [...error.fields] };
    throw error;
  }
  throw new Error("expected a refusal");
}

describe("§389 the registrations-per-address limit as a setting", () => {
  it("is four when nobody has set it", async () => {
    expect(await readAddressCap(db)).toEqual({ cap: DEFAULT_ADDRESS_CAP, updatedAt: null });
    expect(await currentAddressCap(db)).toEqual({ registrationsPerAddress: 4 });
  });

  it("is saved by an Administrator, audited from and to, and seen at once on this instance", async () => {
    expect(await currentAddressCap(db)).toEqual({ registrationsPerAddress: 4 });
    const admin = await staff("ADMIN");
    expect(await updateAddressCap(db, admin, { registrationsPerAddress: "6" }, NOW)).toEqual({ cap: { registrationsPerAddress: 6 }, updatedAt: NOW });
    expect(await currentAddressCap(db)).toEqual({ registrationsPerAddress: 6 });

    const [audit] = await db.select().from(auditLogs).where(eq(auditLogs.action, "registrationsPerAddress.changed"));
    expect(audit).toMatchObject({ actorStaffUserId: admin.id, entityType: "platform_setting" });
    expect(audit.metadataJson).toEqual({ from: 4, to: 6 });
  });

  it("refuses everybody but the Administrator, on the server, and writes nothing", async () => {
    for (const role of ["CONTRIBUTOR", "COPYWRITER", "MODERATOR", "DEV"] as const) {
      expect((await refusal(updateAddressCap(db, await staff(role), { registrationsPerAddress: "2" }, NOW))).code).toBe("FORBIDDEN");
    }
    expect(await db.select().from(platformSettings)).toHaveLength(0);
    expect(await db.select().from(auditLogs)).toHaveLength(0);
  });

  it("refuses a number outside one to ten, or an empty box, naming the box", async () => {
    const admin = await staff("ADMIN");
    for (const value of ["0", "11", "", "2.5", "doi"]) {
      expect(await refusal(updateAddressCap(db, admin, { registrationsPerAddress: value }, NOW))).toEqual({
        code: "VALIDATION_ERROR",
        fields: ["registrationsPerAddress"],
      });
    }
    expect(await db.select().from(platformSettings)).toHaveLength(0);
  });

  it("writes nothing for a save that changes nothing: no row, no audit", async () => {
    const admin = await staff("SUPERADMIN");
    await updateAddressCap(db, admin, { registrationsPerAddress: "4" }, NOW);
    expect(await db.select().from(platformSettings)).toHaveLength(0);
    expect(await db.select().from(auditLogs)).toHaveLength(0);
  });

  it("reads a stored value it cannot use as the default, never a throw", async () => {
    await db.insert(platformSettings).values({ key: ADDRESS_CAP_SETTING_KEY, value: { registrationsPerAddress: 40 }, updatedAt: NOW });
    expect((await readAddressCap(db)).cap).toEqual(DEFAULT_ADDRESS_CAP);
  });

  it("is kept for a minute per instance: a row written behind its back is read after the memo is dropped", async () => {
    expect(await currentAddressCap(db)).toEqual({ registrationsPerAddress: 4 });
    await db.insert(platformSettings).values({ key: ADDRESS_CAP_SETTING_KEY, value: { registrationsPerAddress: 3 }, updatedAt: NOW });
    expect(await currentAddressCap(db)).toEqual({ registrationsPerAddress: 4 });
    forgetCachedAddressCap();
    expect(await currentAddressCap(db)).toEqual({ registrationsPerAddress: 3 });
  });
});
