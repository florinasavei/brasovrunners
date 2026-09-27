import { describe, expect, it } from "vitest";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { DOCUMENT_CODES } from "@/modules/legal-documents/domain/confirmation";
import {
  declarationKindMismatch,
  isRaceDeclarationKey,
  PLATFORM_APPROVAL_KEYS,
  preselectedRaceDeclaration,
  RACE_DECLARATION_KEYS,
  raceDeclarationKeysFor,
  REGISTRATION_LEGAL_KEYS,
} from "@/modules/legal-documents/domain/keys";
import { LEGAL_TEMPLATES } from "@/modules/legal-documents/templates/catalogue";

/**
 * §515 — which of the race's two declarations a participant signs: the organizer's choice, else the
 * course; a road race falls back to the trail text while no road text is approved, never the other
 * way round.
 */
describe("§515 which race declaration an event signs", () => {
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

/**
 * §515 — the editor starts a race with no declaration chosen on the kind its course calls for, so the
 * surface's rule reaches the saved row (a race cannot be saved without a declaration, §39), and says
 * when a saved choice is the other kind.
 */
describe("§515 the editor's start for a race's declaration", () => {
  const NOW = new Date("2026-09-27T12:00:00.000Z");
  const LATER = new Date("2026-10-15T00:00:00.000Z");
  const trail1 = { id: "trail-1", key: "EVENT_DECLARATION", version: 1, effectiveAt: new Date("2026-09-01T00:00:00.000Z") } as const;
  const trail2 = { id: "trail-2", key: "EVENT_DECLARATION", version: 2, effectiveAt: new Date("2026-09-20T00:00:00.000Z") } as const;
  const road1 = { id: "road-1", key: "EVENT_DECLARATION_ROAD", version: 1, effectiveAt: new Date("2026-09-25T00:00:00.000Z") } as const;
  const roadLater = { id: "road-2", key: "EVENT_DECLARATION_ROAD", version: 2, effectiveAt: LATER } as const;

  it("starts an asphalt race on the newest road text in force, and every other course on the newest trail text", () => {
    const choices = [trail2, trail1, road1];
    expect(preselectedRaceDeclaration(choices, "ASPHALT", NOW)?.id).toBe("road-1");
    expect(preselectedRaceDeclaration(choices, "TRAIL", NOW)?.id).toBe("trail-2");
    expect(preselectedRaceDeclaration(choices, "MIXED", NOW)?.id).toBe("trail-2");
    expect(preselectedRaceDeclaration(choices, null, NOW)?.id).toBe("trail-2");
  });

  it("starts an asphalt race on the trail text while no road text is in force — never a trail race on the road one", () => {
    expect(preselectedRaceDeclaration([trail1], "ASPHALT", NOW)?.id).toBe("trail-1");
    // A road version approved for later is not in force yet.
    expect(preselectedRaceDeclaration([trail1, roadLater], "ASPHALT", NOW)?.id).toBe("trail-1");
    expect(preselectedRaceDeclaration([trail1, roadLater], "ASPHALT", LATER)?.id).toBe("road-2");
    expect(preselectedRaceDeclaration([road1], "TRAIL", NOW)).toBeNull();
    expect(preselectedRaceDeclaration([], "ASPHALT", NOW)).toBeNull();
  });

  it("does not trust the order it is given: the highest version in force wins", () => {
    expect(preselectedRaceDeclaration([trail1, trail2], "TRAIL", NOW)?.id).toBe("trail-2");
    // A version without a date (an older caller's option) counts as in force.
    expect(preselectedRaceDeclaration([{ id: "x", key: "EVENT_DECLARATION", version: 3 }, trail2], "TRAIL", NOW)?.id).toBe("x");
  });

  it("names the kind the course calls for when the chosen one is the other, and only when that kind exists", () => {
    const both = [trail1, road1];
    expect(declarationKindMismatch("EVENT_DECLARATION", "ASPHALT", both)).toBe("EVENT_DECLARATION_ROAD");
    expect(declarationKindMismatch("EVENT_DECLARATION_ROAD", "TRAIL", both)).toBe("EVENT_DECLARATION");
    expect(declarationKindMismatch("EVENT_DECLARATION_ROAD", "ASPHALT", both)).toBeNull();
    expect(declarationKindMismatch("EVENT_DECLARATION", "TRAIL", both)).toBeNull();
    // An asphalt race on the trail text while no road text is approved is the fallback, not a mistake.
    expect(declarationKindMismatch("EVENT_DECLARATION", "ASPHALT", [trail1])).toBeNull();
    // Nothing chosen, or no course stated: nothing to say.
    expect(declarationKindMismatch(null, "ASPHALT", both)).toBeNull();
    expect(declarationKindMismatch("EVENT_DECLARATION_ROAD", null, both)).toBeNull();
    expect(declarationKindMismatch("EVENT_DECLARATION_ROAD", "", both)).toBeNull();
  });

  it("has the card's note in both catalogues", () => {
    for (const catalogue of [ro, en]) {
      expect(catalogue.Admin.editor.boxes.declaration.mismatch).toMatch(/\{surface\}.*\{chosen\}.*\{wanted\}/);
    }
  });
});

describe("§515 the one press approves every text of the catalogue", () => {
  it("covers exactly the catalogue's keys: the registration's three, the road declaration and the group runs' two", () => {
    expect([...PLATFORM_APPROVAL_KEYS]).toEqual(["PRIVACY_NOTICE", "TERMS", "EVENT_DECLARATION", "EVENT_DECLARATION_ROAD", "GROUP_RUN_DECLARATION_ASPHALT", "GROUP_RUN_DECLARATION_TRAIL"]);
    expect([...PLATFORM_APPROVAL_KEYS].sort()).toEqual(Object.keys(LEGAL_TEMPLATES).sort());
  });

  it("counts its texts in the messages rather than writing a number", () => {
    for (const catalogue of [ro, en]) {
      const words = [
        catalogue.Admin.confirm.approvePlatformTitle,
        catalogue.Admin.legal.platform.button,
        catalogue.Admin.legal.intro,
        catalogue.Admin.legal.platformApproved,
      ];
      for (const sentence of words) {
        expect(sentence).toContain("{count");
        expect(sentence).not.toMatch(/\b(trei|three)\b/i);
        // Plain sentences, never an ICU plural (docs/VIBECODING.md).
        expect(sentence).not.toMatch(/\bplural\b|\bselectordinal\b/);
      }
    }
  });
});
