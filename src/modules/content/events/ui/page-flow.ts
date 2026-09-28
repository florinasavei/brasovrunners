import { getTranslations } from "next-intl/server";
import { cardStates, type PageSectionData, type PageSectionId } from "@/modules/events/domain/page-sections";
import type { PublishGapBox } from "./publish-check";
import type { SectionMapEntry, SectionMapWords } from "./SectionMap";

/**
 * The event editor as the page it makes (§406): each card that writes a page section is headed by
 * the section's number and whether the page shows it, and the map lists the same cards as chips.
 * Both read `cardStates` (`events/domain/page-sections.ts`), held equal to the hand-drawn page by
 * `tests/unit/events/page-sections.test.ts`. A card holding several sections (§466, §481, §512)
 * is one chip, drawn when any of them is. Cards keep their own names (refusals and e2e specs find
 * them by it); chips use the page's short words.
 */

/** Sections with a numbered card of their own: not the automatic share links, not one asked inside another card. */
type HeadedSectionId = Exclude<PageSectionId, "share" | "cost" | "place" | "rules" | "startList">;

/** The box title each section's card wears (`Admin.editor.boxes.<key>.title`). */
const CARD_TITLE_KEY: Record<HeadedSectionId, string> = {
  kind: "kind",
  title: "titleSummary",
  description: "description",
  // «Când și unde» (§481): the date, the place and the time zone.
  when: "whenWhere",
  course: "course",
  registration: "registration",
  coHosts: "coHosts",
  links: "links",
  // «Program, regulament și declarație» (§481, §512): four cards in one.
  programme: "programmeRules",
};

/** The card whose closed line names a publication gap, by section (the address is not on the page). */
const GAP_BOX: Partial<Record<PageSectionId, PublishGapBox>> = { title: "titleSummary", when: "place" };

export type PageFlow = {
  /** Each card's heading, by section. */
  headings: Record<HeadedSectionId, string>;
  /** The map's chips, in page order. */
  entries: SectionMapEntry[];
  words: SectionMapWords;
  /** The map's own name, for its heading and its landmark. */
  label: string;
  /** The line the main column draws where the page puts an automatic section (the share links). */
  automaticLine: string;
};

export async function pageFlow(data: PageSectionData): Promise<PageFlow> {
  const t = await getTranslations("Admin");
  // Each card drawn when anything it holds is.
  const cards = cardStates(data);
  const headings = {} as Record<HeadedSectionId, string>;
  for (const section of cards) {
    if (section.number === null) continue;
    const id = section.id as HeadedSectionId;
    const name = t(`editor.boxes.${CARD_TITLE_KEY[id]}.title`);
    headings[id] = t(section.isDrawn ? "editor.pageFlow.drawnHeading" : "editor.pageFlow.emptyHeading", { number: section.number, name });
  }
  return {
    headings,
    // A section asked inside another card (§466, §481) has no chip of its own.
    entries: cards.map((section) => ({
      id: section.id,
      number: section.number,
      name: t(`editor.pageFlow.short.${section.id}`),
      glyph: section.glyph,
      drawn: section.isDrawn,
      card: section.card,
      gapBox: GAP_BOX[section.id] ?? null,
    })),
    words: {
      drawn: t("editor.pageFlow.drawn"),
      empty: t("editor.pageFlow.empty"),
      automatic: t("editor.pageFlow.automatic"),
      missing: t("editor.pageFlow.missing"),
    },
    label: t("editor.pageFlow.title"),
    automaticLine: t("editor.pageFlow.shareLine"),
  };
}
