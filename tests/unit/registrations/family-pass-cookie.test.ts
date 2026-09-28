import { describe, expect, it, vi } from "vitest";

/**
 * The jar as Next keeps it: one cookie per name in a response — a second `set` of the same name
 * replaces the first, whatever its path. That is what hid the defect (§547): the pass written under
 * one name on the Romanian and the English path kept only the English one, and the Romanian
 * wizard's next press arrived without it.
 */
const jar = new Map<string, { value: string; options: Record<string, unknown> }>();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    set: (name: string, value: string, options: Record<string, unknown>) => jar.set(name, { value, options }),
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)!.value } : undefined),
    delete: (name: string) => jar.delete(name),
  }),
}));

const { clearFamilySigningPass, readFamilySigningPass, writeFamilySigningPass } = await import("@/modules/registrations/family-signing");

const NOW = new Date("2026-09-28T18:00:00.000Z");
const PASS = {
  binding: "family" as const,
  participantId: "11111111-1111-4111-8111-111111111111",
  eventId: "22222222-2222-4222-8222-222222222222",
  originId: null,
  eligibleIds: ["33333333-3333-4333-8333-333333333333", "44444444-4444-4444-8444-444444444444"],
  signedIds: [],
  skippedIds: [],
  done: false,
  expiresAt: new Date(NOW.getTime() + 30 * 60_000),
};

describe("§547 the family's pass reaches the wizard's next press in every language (§471)", () => {
  it("writes one cookie per language, each on its own page's path, so none replaces the other", async () => {
    jar.clear();
    await writeFamilySigningPass(PASS, "tok_en", NOW);
    expect([...jar.keys()].sort()).toEqual(["br_family_sign_en", "br_family_sign_ro"]);
    expect(jar.get("br_family_sign_ro")?.options.path).toBe("/ro/inregistrari/declaratie/tok_en");
    expect(jar.get("br_family_sign_en")?.options.path).toBe("/en/registrations/declare/tok_en");
    expect(jar.get("br_family_sign_ro")?.value).toBe(jar.get("br_family_sign_en")?.value);
  });

  it("reads the pass back from the page's own cookie, whichever language it is", async () => {
    jar.clear();
    await writeFamilySigningPass(PASS, "tok_en", NOW);
    // A request to the Romanian page carries only the Romanian cookie (its path).
    jar.delete("br_family_sign_en");
    expect(await readFamilySigningPass(NOW)).toMatchObject({ binding: "family", eligibleIds: PASS.eligibleIds });
    jar.clear();
    await writeFamilySigningPass(PASS, "tok_en", NOW);
    jar.delete("br_family_sign_ro");
    expect(await readFamilySigningPass(NOW)).toMatchObject({ binding: "family", participantId: PASS.participantId });
  });

  it("takes the pass back on both paths", async () => {
    jar.clear();
    await writeFamilySigningPass(PASS, "tok_en", NOW);
    await clearFamilySigningPass("tok_en");
    expect(jar.get("br_family_sign_ro")).toMatchObject({ value: "", options: { maxAge: 0 } });
    expect(jar.get("br_family_sign_en")).toMatchObject({ value: "", options: { maxAge: 0 } });
    expect(await readFamilySigningPass(NOW)).toBeNull();
  });
});
