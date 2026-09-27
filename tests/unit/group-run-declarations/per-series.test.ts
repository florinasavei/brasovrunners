import { describe, expect, it } from "vitest";
import { planSeriesSignature, type SeriesSignature, signerIdentity } from "@/modules/group-run-declarations/domain";

/**
 * §NNN — one self-declaration per person per series of group runs. The owner, 2026-09-27: "a
 * returning runner signs once; it has no end date and is deleted only at their request".
 *
 * The pure half: who a signature is (the canonical address and the name, read loosely), and what a
 * press does to the signatures already kept for the run — keep the one signed for the version in
 * force and send it again, or write a new one; the person's other rows go either way.
 */

const V1 = "11111111-1111-4111-8111-111111111111";
const V2 = "22222222-2222-4222-8222-222222222222";

const row = (id: string, overrides: Partial<SeriesSignature> = {}): SeriesSignature => ({
  id,
  legalDocumentId: V1,
  email: "ana@example.ro",
  typedName: "Ana Popescu",
  acceptedAt: new Date("2026-10-01T08:00:00Z"),
  ...overrides,
});

describe("§NNN who a signature is", () => {
  it("reads the address canonically and the name without case, accents or extra spaces", () => {
    const ana = signerIdentity("ana@example.ro", "Ana Popescu");
    expect(ana).not.toBeNull();
    expect(signerIdentity("  Ana@Example.RO ", "ana  popescu ")).toBe(ana);
    expect(signerIdentity("ana@example.ro", "Ană Popescu")).toBe(ana);
  });

  it("tells two people on one address apart (a family, §389), and one person on two addresses", () => {
    expect(signerIdentity("ana@example.ro", "Ion Popescu")).not.toBe(signerIdentity("ana@example.ro", "Ana Popescu"));
    expect(signerIdentity("ana@example.com", "Ana Popescu")).not.toBe(signerIdentity("ana@example.ro", "Ana Popescu"));
  });

  it("is nobody for an address that is not one", () => {
    expect(signerIdentity("not an address", "Ana Popescu")).toBeNull();
  });
});

describe("§NNN what a press does to the run's signatures", () => {
  const ana = { email: "ANA@example.ro", typedName: "ana popescu" };

  it("writes the first signature of a person", () => {
    expect(planSeriesSignature([], ana, V1)).toEqual({ kind: "new", superseded: [] });
    // Another person's signature is theirs: untouched.
    expect(planSeriesSignature([row("ion", { typedName: "Ion Popescu" })], ana, V1)).toEqual({ kind: "new", superseded: [] });
  });

  it("keeps the signature of the version in force and sends it again, to the address it was signed with", () => {
    expect(planSeriesSignature([row("a1", { email: "Ana@Example.ro" })], ana, V1)).toEqual({ kind: "kept", id: "a1", email: "Ana@Example.ro", superseded: [] });
  });

  it("replaces an older version's signature with the new one", () => {
    expect(planSeriesSignature([row("old")], ana, V2)).toEqual({ kind: "new", superseded: ["old"] });
  });

  it("keeps the earliest of the version in force and lets the person's other rows go — one per person per series", () => {
    const rows = [
      row("later", { acceptedAt: new Date("2026-10-08T08:00:00Z") }),
      row("first", { acceptedAt: new Date("2026-10-01T08:00:00Z") }),
      row("older-version", { legalDocumentId: V2, acceptedAt: new Date("2026-09-01T08:00:00Z") }),
      row("ion", { typedName: "Ion Popescu" }),
    ];
    const plan = planSeriesSignature(rows, ana, V1);
    expect(plan.kind).toBe("kept");
    expect(plan).toMatchObject({ id: "first" });
    expect([...plan.superseded].sort()).toEqual(["later", "older-version"]);
  });

  it("touches nothing for a signer whose address is not one: the service refuses the address first", () => {
    expect(planSeriesSignature([row("a1")], { email: "nope", typedName: "Ana Popescu" }, V1)).toEqual({ kind: "new", superseded: [] });
  });
});
