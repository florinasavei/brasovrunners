import { getTranslations } from "next-intl/server";
import { type PageSectionData, type PageSectionId, pageSectionStates } from "@/modules/events/domain/page-sections";
import type { PublishGapBox } from "./publish-check";
import type { SectionMapEntry, SectionMapWords } from "./SectionMap";

/**
 * The event editor as the page it makes (§406; the owner, 2026-09-25: "am nevoie de mai multe
 * căsuțe la editor ca să văd exact ce flow am în pagină"): every card that writes a section of the
 * public page is headed by the section's number and whether the page shows it — "4 · Data și ora —
 * apare pe pagină", "12 · Film — gol, nu apare pe pagină" — and the map under Publicare and
 * Recurență lists the same sections as chips. Both read `pageSectionStates`, the page's order, as
 * a list (`events/domain/page-sections.ts`) — the page is drawn by hand and
 * `tests/unit/events/page-sections.test.ts` holds the two equal — so a number on a card, a chip
 * and the page's order are one thing.
 *
 * The card's own words stay its name: "Data și ora", not the page's "Când" — the name a refusal, a
 * gap in Publicare and every e2e spec already use (`editorBox` finds a card by it, after the
 * number). The chips use the page's own short words, because they are the page in miniature.
 */

/** The box title each section's card already wears (`Admin.editor.boxes.<key>.title`). */
const CARD_TITLE_KEY: Record<Exclude<PageSectionId, "share">, string> = {
  kind: "kind",
  title: "titleSummary",
  description: "description",
  when: "when",
  place: "place",
  course: "course",
  cost: "cost",
  registration: "registration",
  coHosts: "coHosts",
  links: "links",
  programme: "programme",
  rules: "rules",
  video: "video",
  startList: "startList",
};

/** The card whose closed line names a publication gap, by the section it writes (the address is not on the page). */
const GAP_BOX: Partial<Record<PageSectionId, PublishGapBox>> = { title: "titleSummary", place: "place" };

export type PageFlow = {
  /** Each card's heading, by section. */
  headings: Record<Exclude<PageSectionId, "share">, string>;
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
  const states = pageSectionStates(data);
  const headings = {} as Record<Exclude<PageSectionId, "share">, string>;
  for (const section of states) {
    if (section.id === "share" || section.number === null) continue;
    const name = t(`editor.boxes.${CARD_TITLE_KEY[section.id]}.title`);
    headings[section.id] = t(section.isDrawn ? "editor.pageFlow.drawnHeading" : "editor.pageFlow.emptyHeading", { number: section.number, name });
  }
  return {
    headings,
    entries: states.map((section) => ({
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
