import { describe, expect, it } from "vitest";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { startingClubTodo } from "@/modules/club-todo/domain/starting-list";
import type { LegalDocumentBody } from "@/modules/legal-documents/domain/content-hash";
import { LEGAL_DOCUMENT_KEYS } from "@/modules/legal-documents/domain/keys";
import { LEGAL_TEMPLATES } from "@/modules/legal-documents/templates/catalogue";
import { declarationTrailRo } from "@/modules/legal-documents/templates/declaration";
import { groupRunTrailRo } from "@/modules/legal-documents/templates/group-run-declaration";

/**
 * BR-REQ-053-01, BR-REQ-053-02 (§564, amending §515, §523 and §556) — the owner, 2026-09-29: «let's
 * not call it "cursă montană" but "eveniment montan"; and don't use romgleză — don't use "trail" in a
 * Romanian document, use "teren accidentat"». The Romanian templates, their titles and every sentence
 * of the Romanian catalogue say «eveniment montan» and «teren accidentat»; the one «Trail» left is the
 * surface's own pill (`Event.surface.TRAIL`), UI and not a document. The code keeps its names
 * (`EVENT_DECLARATION`, `TRAIL`), and English keeps "trail" as its word for the ground.
 */
const TRAIL = /(^|[^\p{L}])trail($|[^\p{L}])/iu;
const MOUNTAIN_RACE = /curs[ăa] (de )?(montan|trail)/iu;
const text = (body: LegalDocumentBody) => body.sections.flatMap((section) => section.paragraphs).join("\n");

/** Every string of a message catalogue with its path, arrays included. */
function strings(value: unknown, path = ""): Array<[string, string]> {
  if (typeof value === "string") return [[path, value]];
  if (Array.isArray(value)) return value.flatMap((item, i) => strings(item, `${path}[${i}]`));
  if (value && typeof value === "object") return Object.entries(value).flatMap(([key, item]) => strings(item, path ? `${path}.${key}` : key));
  return [];
}

describe("the Romanian documents say «eveniment montan» and «teren accidentat» (§564)", () => {
  it("no Romanian template title or body says «trail» or «cursă montană»", () => {
    for (const key of LEGAL_DOCUMENT_KEYS) {
      const { title, body } = LEGAL_TEMPLATES[key].ro;
      expect(title, key).not.toMatch(TRAIL);
      expect(title, key).not.toMatch(MOUNTAIN_RACE);
      expect(text(body), key).not.toMatch(TRAIL);
      expect(text(body), key).not.toMatch(MOUNTAIN_RACE);
    }
  });

  it("titles the race's declarations by «eveniment» and the group run's by «teren accidentat», in the templates and the catalogue alike", () => {
    expect(LEGAL_TEMPLATES.EVENT_DECLARATION.ro.title).toBe("Declarație pe propria răspundere — eveniment montan");
    expect(LEGAL_TEMPLATES.EVENT_DECLARATION_ROAD.ro.title).toBe("Declarație pe propria răspundere — eveniment pe asfalt / în parc");
    expect(LEGAL_TEMPLATES.GROUP_RUN_DECLARATION_TRAIL.ro.title).toBe("Declarație pe propria răspundere (alergare de grup, teren accidentat)");
    expect(LEGAL_TEMPLATES.EVENT_DECLARATION.en.title).toBe("Self-declaration — mountain event");
    expect(LEGAL_TEMPLATES.EVENT_DECLARATION_ROAD.en.title).toBe("Self-declaration — road / park event");
    // English keeps "trail" for the ground.
    expect(LEGAL_TEMPLATES.GROUP_RUN_DECLARATION_TRAIL.en.title).toBe("Self-declaration (group run, trail)");
    // `/admin/legal` names each text by its template's title.
    for (const key of LEGAL_DOCUMENT_KEYS.filter((k) => k !== "PRIVACY_NOTICE" && k !== "TERMS")) {
      expect(ro.Admin.legal.keys[key], key).toBe(LEGAL_TEMPLATES[key].ro.title);
      expect(en.Admin.legal.keys[key], key).toBe(LEGAL_TEMPLATES[key].en.title);
    }
  });

  it("keeps the shoes' grip sentence of §556, in Romanian words, and «montan» as an adjective", () => {
    for (const body of [declarationTrailRo, groupRunTrailRo]) {
      expect(text(body)).toContain("încălțăminte adecvată terenului, cu aderență corespunzătoare (de preferat încălțăminte pentru teren accidentat)");
      expect(text(body)).not.toContain("pantofi de trail");
    }
    expect(text(declarationTrailRo)).toContain("trasee montane sau de pădure");
    expect(text(groupRunTrailRo)).toContain("un serviciu de ghidaj montan");
  });

  it("leaves «Trail» in the Romanian catalogue only as the surface's own pill", () => {
    const withTrail = strings(ro).filter(([, value]) => TRAIL.test(value) || MOUNTAIN_RACE.test(value));
    expect(withTrail.map(([path]) => path)).toEqual(["Event.surface.TRAIL"]);
  });

  it("names the race declarations' kinds as the titles do, in both languages", () => {
    expect(ro.Admin.editor.declarationKinds).toEqual({ EVENT_DECLARATION: "Eveniment montan", EVENT_DECLARATION_ROAD: "Eveniment pe șosea sau în parc" });
    expect(en.Admin.editor.declarationKinds).toEqual({ EVENT_DECLARATION: "Mountain event", EVENT_DECLARATION_ROAD: "Road or park event" });
    for (const [path, value] of strings(en)) {
      if (/declaration|self-declaration/i.test(value)) expect(value, path).not.toMatch(/trail race|mountain race/i);
    }
  });

  it("says «teren accidentat» in the club's starting list of things to do", () => {
    const words = startingClubTodo().map((item) => item.text).join("\n");
    expect(words).toContain("declarația pentru teren accidentat");
    expect(words).not.toMatch(TRAIL);
  });
});
