import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { postedCover } from "@/modules/content/events/fields";
import { COVER_SHAPE } from "@/modules/content/events/ui/boxes/CoverBox";
import { eventFormFieldName } from "@/modules/content/events/form-names";

/**
 * §709 — the facelift's phase 2, the editor's side: «Copertă» is «Echipa»'s picture field under its
 * own stem (`event.cover`, as the shop's size guide took it, §705), resting on the card's 16∶9; the
 * action reads its two inputs only when the form carried them; a refusal names the box; and the
 * events list marks a line whose next date has no cover. Source assertions, like `editor-order.test.ts`:
 * these are Server Components rendering what they are handed.
 */
const read = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8");
const BOX = read("src/modules/content/events/ui/boxes/CoverBox.tsx");
const ACTIONS = read("src/app/[locale]/admin/actions.ts");
const LIST = read("src/app/[locale]/admin/(list)/page.tsx");
const LABELS = read("src/modules/content/events/ui/field-labels.ts");
const MESSAGES = (["ro", "en"] as const).map((locale) => [locale, JSON.parse(read(`messages/${locale}.json`))] as const);

describe("§709 «Copertă» in the editor", () => {
  it("is the house's picture field — upload, «Din galerie», the crop box — under the event's stem, starting at 16:9", () => {
    expect(BOX).toContain("<TeamPhotoField");
    expect(BOX).toContain('fieldPrefix="event.cover"');
    expect(BOX).toContain("shape={COVER_SHAPE}");
    expect(COVER_SHAPE).toBe("16:9");
    // A settings card: a reader who may not change the event row — the Redactor, who works in «Titlu și
    // rezumat», which holds it since §NNN — opens it on the one sentence that the settings are not theirs,
    // and the server asks again.
    expect(BOX).toMatch(/if \(!mayEditSettings\)\s+return \(\s+<Panel collapsible \{\.\.\.card\}>\s+<SettingsReadOnly \/>/);
    // Nothing offered where no picture can be stored.
    expect(BOX).toContain("isStorageConfigured()");
  });

  it("is read by the action only when the form carried the box, and a refusal names the picture's box", () => {
    expect(ACTIONS).toContain('coverAssetId: form.has("event.coverAssetId") ? value("coverAssetId") : undefined,');
    expect(ACTIONS).toContain('coverCrop: form.has("event.coverAssetId") ? value("coverCrop") : undefined,');
    expect(eventFormFieldName("coverAssetId")).toBe("event.coverAssetId");
    // «Titlu și rezumat › Copertă › Fotografia de copertă» since §NNN.
    expect(LABELS).toContain('"event.coverAssetId": inCardOf("titleSummary", "cover", t("editor.cover.legend")),');
  });

  it("writes nothing for a form without the box, clears both for an empty one, keeps a crop only with its picture", () => {
    expect(postedCover({})).toBeUndefined();
    expect(postedCover({ coverAssetId: "", coverCrop: JSON.stringify({ x: 0.1, y: 0.1, w: 0.5, h: 0.5 }) })).toEqual({ coverMediaAssetId: null, coverCrop: null });
    const id = "0B6F3F9E-2A41-8C3D-9E5F-1A2B3C4D5E6F";
    expect(postedCover({ coverAssetId: id, coverCrop: "" })).toEqual({ coverMediaAssetId: id.toLowerCase(), coverCrop: null });
    expect(postedCover({ coverAssetId: id, coverCrop: JSON.stringify({ x: 0.1, y: 0.1, w: 0.5, h: 0.5 }) })?.coverCrop).toEqual({ x: 0.1, y: 0.1, w: 0.5, h: 0.5 });
  });

  it("has its words in both catalogues", () => {
    for (const [locale, messages] of MESSAGES) {
      expect(messages.Admin.editor.boxes.cover.title, locale).toBeTruthy();
      for (const key of ["intro", "legend", "help", "cropTitle", "cropHelp", "set", "missing", "noStorage"]) {
        expect(messages.Admin.editor.cover[key], `${locale}: editor.cover.${key}`).toBeTruthy();
      }
      expect(messages.Admin.events.noCover, locale).toBeTruthy();
    }
  });
});

describe("§709 the events list says which lines lack a cover", () => {
  it("marks a line whose next date, still to come, has none", () => {
    const chip = LIST.slice(LIST.indexOf("next.event.coverMediaAssetId === null"), LIST.indexOf('data-testid="no-cover-chip"'));
    expect(chip).toContain("(next.event.endsAt ?? next.event.startsAt).getTime() >= now.getTime()");
    expect(chip).toContain('label={t("events.noCover")}');
  });
});
