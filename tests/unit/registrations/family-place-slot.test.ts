import { describe, expect, it, vi } from "vitest";
import { deploymentSecretIssue } from "@/shared/config/deployment-secret";
import { familyPlaceSlot, familySlotSecret, LOCAL_FAMILY_SLOT_SECRET } from "@/modules/registrations/family-place-slot";

/**
 * BR-REQ-034-02 — the slot of a family sitting's held place (§NNN, the review of 2026-09-28, round five):
 * keyed under a secret that survives a restart, one per person the address sends at the event, and
 * naming nobody.
 */
const EVENT = "11111111-1111-4111-8111-111111111111";
const PARTICIPANT = "22222222-2222-4222-8222-222222222222";

describe("BR-REQ-034-02 the family place slot's secret is stable across a restart (§NNN, round five)", () => {
  it("a module loaded again — a development server restarted mid-sitting — keys the same slot", async () => {
    const before = familyPlaceSlot(EVENT, PARTICIPANT, "Ana Pop");
    vi.resetModules();
    const again = await import("@/modules/registrations/family-place-slot");
    expect(again.familyPlaceSlot(EVENT, PARTICIPANT, "Ana Pop")).toBe(before);
    vi.resetModules();
  });

  it("the deployment's secret first, the job secret where there is no sign-in, the fixed local key on a laptop", () => {
    expect(familySlotSecret({ APP_ENV: "production", AUTH_SECRET: "a", JOB_SECRET: "j" })).toBe("a:family-place-hold");
    expect(familySlotSecret({ APP_ENV: "qa", JOB_SECRET: "j" })).toBe("j:family-place-hold");
    expect(familySlotSecret({ APP_ENV: "local" })).toBe(`${LOCAL_FAMILY_SLOT_SECRET}:family-place-hold`);
    expect(familySlotSecret({ APP_ENV: "test" })).toBe(familySlotSecret({ APP_ENV: "test" }));
  });

  it("qa and production without either secret are refused, never keyed with the public local key", () => {
    for (const APP_ENV of ["qa", "production"]) {
      expect(deploymentSecretIssue({ APP_ENV })).toMatch(/requires AUTH_SECRET or JOB_SECRET/);
      expect(() => familySlotSecret({ APP_ENV })).toThrow(/requires AUTH_SECRET or JOB_SECRET/);
    }
    for (const APP_ENV of ["local", "test"]) expect(deploymentSecretIssue({ APP_ENV })).toBeNull();
    expect(deploymentSecretIssue({ APP_ENV: "production", AUTH_SECRET: "a" })).toBeNull();
    expect(deploymentSecretIssue({ APP_ENV: "qa", JOB_SECRET: "j" })).toBeNull();
  });
});

describe("BR-REQ-034-02 one slot per person the address sends at the event, whatever sitting (§NNN, round five; §39)", () => {
  it("the same runner by the name key, another runner, address or event another slot", () => {
    const ana = familyPlaceSlot(EVENT, PARTICIPANT, "Ana Pop");
    expect(familyPlaceSlot(EVENT, PARTICIPANT, "  ana   POP ")).toBe(ana);
    expect(familyPlaceSlot(EVENT, PARTICIPANT, "Mihai Pop")).not.toBe(ana);
    expect(familyPlaceSlot(EVENT, "33333333-3333-4333-8333-333333333333", "Ana Pop")).not.toBe(ana);
    expect(familyPlaceSlot("44444444-4444-4444-8444-444444444444", PARTICIPANT, "Ana Pop")).not.toBe(ana);
  });

  it("names nobody: a hex digest, with neither the name nor the ids in it", () => {
    const slot = familyPlaceSlot(EVENT, PARTICIPANT, "Ana Pop");
    expect(slot).toMatch(/^[0-9a-f]{64}$/);
    expect(slot).not.toContain(EVENT.slice(0, 8));
    expect(slot).not.toContain(PARTICIPANT.slice(0, 8));
  });
});
