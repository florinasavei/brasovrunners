import { describe, expect, it } from "vitest";
import { missingForPublish, publishGapLabel } from "@/modules/content/events/ui/publish-check";

/**
 * §315, §NNN — what publication would refuse, read off the form as it stands: one check for
 * "Creează și publică" (which names the first gap) and the Publicare box's list (which names them
 * all), in the order of the editor's boxes, each gap named by its box and tab.
 */
const doc = (text: string) => JSON.stringify({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });
const emptyDoc = JSON.stringify({ type: "doc", content: [{ type: "paragraph" }] });

const complete: Record<string, string> = {
  "event.locationName": "Parcul Tractorul",
  "translations.ro.title": "Alergare de luni",
  "translations.ro.excerptBody": doc("Tura de luni."),
  "translations.ro.slug": "alergare-de-luni",
  "translations.en.title": "Monday run",
  "translations.en.excerptBody": doc("The Monday run."),
  "translations.en.slug": "monday-run",
};
const reader = (values: Record<string, string>) => (name: string) => values[name] ?? "";
const LOCALES = ["ro", "en"];

describe("§NNN missingForPublish", () => {
  it("finds nothing on a complete form", () => {
    expect(missingForPublish(reader(complete), LOCALES)).toEqual([]);
  });

  it("names every gap in the order of the boxes: title and summary, the place, the address", () => {
    const gaps = missingForPublish(reader({}), LOCALES);
    expect(gaps.map((gap) => `${gap.box}:${gap.locale ?? ""}:${gap.field}`)).toEqual([
      "titleSummary:ro:title",
      "titleSummary:ro:excerpt",
      "titleSummary:en:title",
      "titleSummary:en:excerpt",
      "place::locationName",
      "address:ro:slug",
      "address:en:slug",
    ]);
    // Each gap carries the name of the box it links to.
    expect(gaps[1].name).toBe("translations.ro.excerptBody");
    expect(gaps[4].name).toBe("event.locationName");
  });

  it("reads an empty rich-text document as no summary, and whitespace as no title", () => {
    const gaps = missingForPublish(reader({ ...complete, "translations.en.excerptBody": emptyDoc, "translations.ro.title": "   " }), LOCALES);
    expect(gaps.map((gap) => gap.name)).toEqual(["translations.ro.title", "translations.en.excerptBody"]);
  });

  it("asks for no meeting point while the place is to be announced (§328)", () => {
    const later = { ...complete, "event.locationName": "", "event.locationToBeAnnounced": "on" };
    expect(missingForPublish(reader(later), LOCALES)).toEqual([]);
    expect(missingForPublish(reader({ ...later, "event.locationToBeAnnounced": "" }), LOCALES).map((gap) => gap.box)).toEqual(["place"]);
  });

  it("names a gap by its box, its tab and its field", () => {
    const labels = {
      boxes: { titleSummary: "Titlu și rezumat", place: "Locul", address: "Adresa paginii și motoarele de căutare" },
      fields: { title: "Titlu", excerpt: "Rezumat", locationName: "Punct de întâlnire", slug: "Adresa paginii" },
      languages: { ro: "Română", en: "English" },
    };
    const [summary] = missingForPublish(reader({ ...complete, "translations.en.excerptBody": "" }), LOCALES);
    expect(publishGapLabel(summary, labels)).toBe("Titlu și rezumat › English › Rezumat");
    const [place] = missingForPublish(reader({ ...complete, "event.locationName": "" }), LOCALES);
    expect(publishGapLabel(place, labels)).toBe("Locul › Punct de întâlnire");
  });
});
