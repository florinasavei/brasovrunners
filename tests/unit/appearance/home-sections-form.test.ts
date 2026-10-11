import { describe, expect, it } from "vitest";
import {
  HOME_SECTION_BOXES,
  postedNumbers,
  postedSteps,
  postedStripTitle,
  postedWhy,
  STEPS_BOXES,
  STRIP_BOXES,
  WHY_BOXES,
} from "@/modules/appearance/domain/home-sections-form";
import { EMPTY_STRIP } from "@/modules/home/domain/photo-strip";
import { isTranslatableEnglishField } from "@/modules/translate/domain/fields";

/**
 * BR-REQ-050-03 (§NNN) — «Pagina principală»'s four lower sections as its form posts them: every box a
 * pair named `<stem>Ro` / `<stem>En`, read through the sections' own schemas, a refusal naming the box
 * the club must fix, and every English box one «Copiază și tradu tot» may fill.
 */
const form = (fields: Record<string, string>) => (name: string) => fields[name];
const PAGE = "6f1c2e1a-3b4d-4e5f-8a6b-7c8d9e0f1a2b";

describe("§NNN the lower sections' boxes", () => {
  it("are one name per pair, never two boxes with the same name", () => {
    const names = HOME_SECTION_BOXES.flatMap((box) => [`${box.stem}Ro`, `${box.stem}En`]);
    expect(new Set(names).size).toBe(names.length);
    expect(STEPS_BOXES.map((box) => box.stem)).toEqual(["stepsTitle", "stepsLead", "step1", "step2", "step3", "step4", "step5", "stepsLink"]);
    expect(WHY_BOXES).toHaveLength(1 + 8 + 2);
    expect(STRIP_BOXES.map((box) => box.stem)).toEqual(["stripTitle"]);
  });

  it("offer every English box to the translate button, and no Romanian one", () => {
    for (const box of HOME_SECTION_BOXES) {
      expect(isTranslatableEnglishField(`${box.stem}En`), box.stem).toBe(true);
      expect(isTranslatableEnglishField(`${box.stem}Ro`), box.stem).toBe(false);
    }
    // The figures are not words.
    expect(isTranslatableEnglishField("foundedOnEn")).toBe(false);
  });

  it("hold each box to the length its section's schema keeps: the box's own limit passes, one more is refused", () => {
    for (const box of HOME_SECTION_BOXES) {
      const post = box.stem.startsWith("step") ? postedSteps : box.stem.startsWith("strip") ? (read: (name: string) => unknown) => postedStripTitle(read, EMPTY_STRIP) : postedWhy;
      expect(post(form({ [`${box.stem}Ro`]: "a".repeat(box.max), [`${box.stem}En`]: "b" })).ok, box.stem).toBe(true);
      expect(post(form({ [`${box.stem}Ro`]: "a".repeat(box.max + 1), [`${box.stem}En`]: "b" })), box.stem).toEqual({ ok: false, field: `${box.stem}Ro` });
    }
  });
});

describe("§NNN what the form posts, read", () => {
  it("reads the club's words where written and the platform's (null) where both boxes are empty", () => {
    const read = postedSteps(form({ stepsTitleRo: " Nou aici? ", stepsTitleEn: "New here?", step2Ro: "Vino", step2En: "Come", stepsPageId: PAGE }));
    expect(read).toEqual({
      ok: true,
      value: { title: { ro: "Nou aici?", en: "New here?" }, lead: null, steps: [null, { ro: "Vino", en: "Come" }, null, null, null], linkLabel: null, targetPageId: PAGE },
    });
    const why = postedWhy(form({ why3TitleRo: "Gratuit", why3TitleEn: "Free" }));
    expect(why.ok && why.value.items[2]).toEqual({ title: { ro: "Gratuit", en: "Free" }, body: null });
  });

  it("names the empty side of a pair written in one language only", () => {
    expect(postedSteps(form({ step4Ro: "", step4En: "Run" }))).toEqual({ ok: false, field: "step4Ro" });
    expect(postedWhy(form({ why2BodyRo: "Munți", why2BodyEn: "  " }))).toEqual({ ok: false, field: "why2BodyEn" });
    expect(postedWhy(form({ quoteByRo: "", quoteByEn: "Member A" }))).toEqual({ ok: false, field: "quoteByRo" });
    expect(postedStripTitle(form({ stripTitleRo: "Poze" }), EMPTY_STRIP)).toEqual({ ok: false, field: "stripTitleEn" });
    expect(postedSteps(form({ stepsPageId: "nu" }))).toEqual({ ok: false, field: "stepsPageId" });
  });

  it("keeps the strip's pictures when only its heading is posted", () => {
    const before = { title: null, pictures: [{ assetId: PAGE, keyPrefix: "k", width: 10, height: 10 }] };
    expect(postedStripTitle(form({ stripTitleRo: "Poze", stripTitleEn: "Photos" }), before)).toEqual({
      ok: true,
      value: { title: { ro: "Poze", en: "Photos" }, pictures: before.pictures },
    });
  });

  it("reads the founding day and the runners as figures, empty as none, and refuses what is not one", () => {
    expect(postedNumbers(form({ foundedOn: "2015-04-01", activeRunners: "120" }))).toEqual({ ok: true, value: { foundedOn: "2015-04-01", activeRunners: 120 } });
    expect(postedNumbers(form({}))).toEqual({ ok: true, value: { foundedOn: null, activeRunners: null } });
    expect(postedNumbers(form({ foundedOn: "2015-02-30" }))).toEqual({ ok: false, field: "foundedOn" });
    expect(postedNumbers(form({ activeRunners: "0" }))).toEqual({ ok: false, field: "activeRunners" });
    expect(postedNumbers(form({ activeRunners: "3.5" }))).toEqual({ ok: false, field: "activeRunners" });
  });
});
