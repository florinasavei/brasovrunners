import { getTranslations } from "next-intl/server";
import { cardStates, type PageSectionData, type PageSectionId } from "@/modules/events/domain/page-sections";
import type { PublishGapBox } from "./publish-check";
import type { SectionMapEntry, SectionMapWords } from "./SectionMap";

/**
 * The event editor as the page it makes (§406; the owner, 2026-09-25: "am nevoie de mai multe
 * căsuțe la editor ca să văd exact ce flow am în pagină"): every card that writes a section of the
 * public page is headed by the section's number and whether the page shows it — "4 · Când și unde
 * — apare pe pagină", "9 · Program, regulament și declarație — gol, nu apare pe pagină" — and the
 * map under Publicare and Recurență lists the same cards as chips. Both read `cardStates`, the
 * page's order, as a list (`events/domain/page-sections.ts`) — the page is drawn by hand and
 * `tests/unit/events/page-sections.test.ts` holds the two equal — so a number on a card, a chip
 * and the page's order are one thing.
 *
 * A card that holds more than one of the page's sections (§481: the date and the place, the
 * programme and the rules; §512: the public list with them; §466: the type and the cost) is one chip and one number, drawn when
 * any section it holds is drawn.
 *
 * The card's own words stay its name — the name a refusal, a gap in Publicare and every e2e spec
 * already use (`editorBox` finds a card by it, after the number). The chips use the page's own
 * short words, because they are the page in miniature.
 */

/** The sections with a numbered card of their own: not the automatic share links, not a section asked inside another card. */
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
  // «Program, regulament și declarație» (§481): the programme, the rules, the declaration and,
  // since §512, the public list — four cards in one.
  programme: "programmeRules",
};

/** The card whose closed line names a publication gap, by the section it writes (the address is not on the page). */
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
  // The cards, each drawn when anything it holds is (a nested section has no card of its own).
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
    // A section asked inside another card (the cost §466, the place and the rules §481) has no chip: the map lists the cards.
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
