import { describe, expect, it } from "vitest";
import { showsGroupRunDeclarationsFold } from "@/modules/group-run-declarations/domain";
import { offeredGroupRunDeclarationKey } from "@/modules/legal-documents/domain/keys";

/**
 * §393 — "Declarații semnate (alergare de grup)" on the event's backoffice page: drawn for a group
 * run that offers the declaration, or that still keeps some signed before the organizer unticked
 * it; never for an asphalt or trail group run merely because of its surface.
 */
const run = (overrides: Partial<{ type: string; surface: string | null; offersGroupRunDeclaration: boolean }> = {}) => ({
  type: "GROUP_RUN",
  surface: "TRAIL",
  offersGroupRunDeclaration: true,
  ...overrides,
});

const shows = (event: ReturnType<typeof run>, signed: number) => showsGroupRunDeclarationsFold(offeredGroupRunDeclarationKey(event), signed);

describe("§393 the signed-declarations fold", () => {
  it("is drawn for a trail or asphalt group run that offers the declaration, even with nobody signed yet", () => {
    expect(shows(run(), 0)).toBe(true);
    expect(shows(run({ surface: "ASPHALT" }), 0)).toBe(true);
  });

  it("is not drawn for a trail or asphalt group run that does not offer it", () => {
    expect(shows(run({ offersGroupRunDeclaration: false }), 0)).toBe(false);
    expect(shows(run({ surface: "ASPHALT", offersGroupRunDeclaration: false }), 0)).toBe(false);
  });

  it("stays while signatures are kept, after the organizer unticked it", () => {
    expect(shows(run({ offersGroupRunDeclaration: false }), 2)).toBe(true);
  });

  it("is never drawn for a race or a mixed surface with nothing signed", () => {
    expect(shows(run({ type: "RACE" }), 0)).toBe(false);
    expect(shows(run({ surface: "MIXED" }), 0)).toBe(false);
  });
});
