import { describe, expect, it } from "vitest";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { DOCUMENT_CODES } from "@/modules/legal-documents/domain/confirmation";
import { isRaceDeclarationKey, RACE_DECLARATION_KEYS, raceDeclarationKeysFor, REGISTRATION_LEGAL_KEYS } from "@/modules/legal-documents/domain/keys";

/**
 * §NNN — which of the race's two declarations a participant signs: the organizer's choice, else the
 * course; a road race falls back to the trail text while no road text is approved, never the other
 * way round.
 */
describe("§NNN which race declaration an event signs", () => {
  it("are two keys, the trail one the key every signature so far was recorded under", () => {
    expect([...RACE_DECLARATION_KEYS]).toEqual(["EVENT_DECLARATION", "EVENT_DECLARATION_ROAD"]);
    // The registration's three texts are unchanged: the trail text is the one every race falls back to.
    expect([...REGISTRATION_LEGAL_KEYS]).toEqual(["PRIVACY_NOTICE", "TERMS", "EVENT_DECLARATION"]);
    expect(isRaceDeclarationKey("EVENT_DECLARATION_ROAD")).toBe(true);
    expect(isRaceDeclarationKey("GROUP_RUN_DECLARATION_TRAIL")).toBe(false);
    expect(isRaceDeclarationKey(null)).toBe(false);
  });

  it("follows the version the organizer chose, whatever the surface", () => {
    expect(raceDeclarationKeysFor({ surface: "TRAIL", chosenKey: "EVENT_DECLARATION_ROAD" })).toEqual(["EVENT_DECLARATION_ROAD", "EVENT_DECLARATION"]);
    expect(raceDeclarationKeysFor({ surface: "ASPHALT", chosenKey: "EVENT_DECLARATION" })).toEqual(["EVENT_DECLARATION"]);
  });

  it("reads the course when nothing is chosen: asphalt the road text, anything else the trail text", () => {
    expect(raceDeclarationKeysFor({ surface: "ASPHALT" })).toEqual(["EVENT_DECLARATION_ROAD", "EVENT_DECLARATION"]);
    expect(raceDeclarationKeysFor({ surface: "TRAIL" })).toEqual(["EVENT_DECLARATION"]);
    expect(raceDeclarationKeysFor({ surface: "MIXED" })).toEqual(["EVENT_DECLARATION"]);
    expect(raceDeclarationKeysFor({ surface: null, chosenKey: null })).toEqual(["EVENT_DECLARATION"]);
    // A chosen key that is not a race's (a group run's) is no choice.
    expect(raceDeclarationKeysFor({ surface: "ASPHALT", chosenKey: "GROUP_RUN_DECLARATION_ASPHALT" })).toEqual(["EVENT_DECLARATION_ROAD", "EVENT_DECLARATION"]);
  });

  it("never lets a trail race fall back to the road text", () => {
    for (const surface of ["TRAIL", "MIXED", null]) {
      expect(raceDeclarationKeysFor({ surface })).not.toContain("EVENT_DECLARATION_ROAD");
    }
  });

  it("names both kinds, and gives the road text its own confirmation code, in both catalogues", () => {
    expect(DOCUMENT_CODES.EVENT_DECLARATION_ROAD).toBe("ROAD");
    expect(new Set(Object.values(DOCUMENT_CODES)).size).toBe(Object.keys(DOCUMENT_CODES).length);
    for (const catalogue of [ro, en]) {
      for (const key of RACE_DECLARATION_KEYS) {
        expect(catalogue.Admin.editor.declarationKinds[key], key).toBeTruthy();
        expect(catalogue.Admin.legal.whatIs[key], key).toBeTruthy();
      }
      expect(catalogue.Admin.tasks.items.raceDeclarations.how.length).toBeGreaterThan(0);
    }
  });
});
