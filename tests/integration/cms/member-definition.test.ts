import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { platformSettings } from "@/db/schema/platform-settings";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import {
  DEFAULT_MEMBER_DEFINITION,
  MEMBER_DEFINITION_MAX,
  MEMBER_DEFINITION_SETTING_ENTITY_ID,
  MEMBER_DEFINITION_SETTING_KEY,
  memberDefinitionFor,
  parseMemberDefinition,
  readMemberDefinition,
  saveMemberDefinition,
} from "@/modules/content/members/member-definition";
import type { StaffRole } from "@/modules/staff-identity/domain/roles";
import { isDomainError } from "@/shared/errors/domain-error";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * §788 — «Cine e membru»: the club's own sentence behind the «?» after the tick «Sunt membru al
 * grupului» on the registration form and on the volunteers' form. One `platform_settings` row (no
 * migration), both languages or neither, the members' pages' writers', audited without the words,
 * and none until the club writes one — the forms then say the platform's own.
 */
const NOW = new Date("2026-10-16T08:00:00.000Z");
const RO = "Ai fost la cel puțin 5 alergări de grup în ultimele 3 luni.";
const EN = "You have joined at least 5 group runs in the last 3 months.";

describe("§788 who is a member, as the club says it", () => {
  let db: TestDatabase;
  let close: () => Promise<void>;
  const staff: Partial<Record<StaffRole, StaffUser>> = {};

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
  const refusal = async (promise: Promise<unknown>) => {
    try {
      await promise;
    } catch (error) {
      if (isDomainError(error)) return { code: error.code, fields: error.fields };
      throw error;
    }
    throw new Error("expected a refusal");
  };

  it("is no sentence of the club's until one is written: the platform's words are the forms' fallback", async () => {
    expect(await readMemberDefinition(db)).toEqual({ ro: null, en: null, updatedAt: null });
    expect(memberDefinitionFor("ro", DEFAULT_MEMBER_DEFINITION)).toBeNull();
    expect(memberDefinitionFor("en", DEFAULT_MEMBER_DEFINITION)).toBeNull();
  });

  it("round-trips both languages, each read in its own language, whitespace made one space", async () => {
    const saved = await saveMemberDefinition(db, {
      actor: actor("COPYWRITER"),
      fields: { memberDefinitionRo: `  ${RO}\n`, memberDefinitionEn: EN.replace(" at ", "   at\n") },
      now: NOW,
    });
    expect(saved).toEqual({ ro: RO, en: EN, updatedAt: NOW });

    const read = await readMemberDefinition(db);
    expect(read).toEqual({ ro: RO, en: EN, updatedAt: NOW });
    expect(memberDefinitionFor("ro", read)).toBe(RO);
    expect(memberDefinitionFor("en", read)).toBe(EN);
  });

  it("clears the sentence when both boxes are saved empty, and the fallback is back", async () => {
    await saveMemberDefinition(db, { actor: actor("ADMIN"), fields: { memberDefinitionRo: RO, memberDefinitionEn: EN }, now: NOW });
    await saveMemberDefinition(db, { actor: actor("ADMIN"), fields: { memberDefinitionRo: " ", memberDefinitionEn: "" }, now: NOW });
    const read = await readMemberDefinition(db);
    expect(read.ro).toBeNull();
    expect(read.en).toBeNull();
    // A save with the fields absent altogether is also empty, never a crash.
    await saveMemberDefinition(db, { actor: actor("ADMIN"), fields: {}, now: NOW });
    expect((await readMemberDefinition(db)).ro).toBeNull();
  });

  it("refuses one language only, naming the empty box, and keeps what was there", async () => {
    await saveMemberDefinition(db, { actor: actor("ADMIN"), fields: { memberDefinitionRo: RO, memberDefinitionEn: EN }, now: NOW });

    expect(await refusal(saveMemberDefinition(db, { actor: actor("ADMIN"), fields: { memberDefinitionRo: RO, memberDefinitionEn: "" } }))).toEqual({
      code: "VALIDATION_ERROR",
      fields: ["memberDefinitionEn"],
    });
    expect(await refusal(saveMemberDefinition(db, { actor: actor("ADMIN"), fields: { memberDefinitionRo: " ", memberDefinitionEn: EN } }))).toEqual({
      code: "VALIDATION_ERROR",
      fields: ["memberDefinitionRo"],
    });
    expect(await readMemberDefinition(db)).toMatchObject({ ro: RO, en: EN });
  });

  it("refuses a sentence past the ceiling, naming its box", async () => {
    const long = "a".repeat(MEMBER_DEFINITION_MAX + 1);
    expect(await refusal(saveMemberDefinition(db, { actor: actor("ADMIN"), fields: { memberDefinitionRo: long, memberDefinitionEn: EN } }))).toEqual({
      code: "VALIDATION_ERROR",
      fields: ["memberDefinitionRo"],
    });
    const exact = "b".repeat(MEMBER_DEFINITION_MAX);
    await saveMemberDefinition(db, { actor: actor("ADMIN"), fields: { memberDefinitionRo: exact, memberDefinitionEn: exact }, now: NOW });
    expect((await readMemberDefinition(db)).ro).toBe(exact);
  });

  it("lets the Redactor and the Administrator write it, and nobody else", async () => {
    for (const role of ["MEMBER", "CONTRIBUTOR", "MODERATOR"] as const) {
      expect(await refusal(saveMemberDefinition(db, { actor: actor(role), fields: { memberDefinitionRo: RO, memberDefinitionEn: EN } })), role).toMatchObject({
        code: "FORBIDDEN",
      });
    }
    expect(await db.select().from(platformSettings).where(eq(platformSettings.key, MEMBER_DEFINITION_SETTING_KEY))).toEqual([]);
    for (const role of ["COPYWRITER", "ADMIN"] as const) {
      await saveMemberDefinition(db, { actor: actor(role), fields: { memberDefinitionRo: RO, memberDefinitionEn: EN }, now: NOW });
    }
    expect((await readMemberDefinition(db)).ro).toBe(RO);
  });

  it("is audited as a platform setting, with whether it is written and never the words", async () => {
    await saveMemberDefinition(db, { actor: actor("ADMIN"), fields: { memberDefinitionRo: RO, memberDefinitionEn: EN }, now: NOW });
    await saveMemberDefinition(db, { actor: actor("ADMIN"), fields: { memberDefinitionRo: "", memberDefinitionEn: "" }, now: NOW });

    const rows = await db.select().from(auditLogs).where(eq(auditLogs.action, "member_definition.saved"));
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.actorStaffUserId).toBe(actor("ADMIN").id);
      expect(row.entityType).toBe("platform_setting");
      expect(row.entityId).toBe(MEMBER_DEFINITION_SETTING_ENTITY_ID);
      expect(JSON.stringify(row.metadataJson)).not.toContain("alergări");
      expect(JSON.stringify(row.metadataJson)).not.toContain("group runs");
    }
    expect(rows.map((row) => row.metadataJson)).toEqual(
      expect.arrayContaining([
        { from: { written: false }, to: { written: true } },
        { from: { written: true }, to: { written: false } },
      ]),
    );
  });

  it("reads a stored value this code cannot read, or one language alone, as no sentence — never one language's words in the other", async () => {
    for (const value of [{ ro: RO, en: null }, { ro: "", en: EN }, { ro: 42, en: EN }, "words", { ro: "x".repeat(MEMBER_DEFINITION_MAX + 1), en: EN }]) {
      await db.delete(platformSettings).where(eq(platformSettings.key, MEMBER_DEFINITION_SETTING_KEY));
      await db.insert(platformSettings).values({ key: MEMBER_DEFINITION_SETTING_KEY, value: value as never, updatedAt: NOW });
      const read = await readMemberDefinition(db);
      expect([read.ro, read.en], JSON.stringify(value)).toEqual([null, null]);
      expect(parseMemberDefinition(value)).toEqual(DEFAULT_MEMBER_DEFINITION);
    }
  });
});
