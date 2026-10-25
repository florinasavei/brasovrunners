import type { SexChoice } from "@/modules/registrations/domain/sex";
import { bandStartOf, splitCategoryKey } from "./age-bands";

/**
 * «Premii» (§NNN): who stands on the podium, read from a race's ranked results — the first places by sex and the first places in every
 * category, so the organizers hand out the awards from one list instead of reading the whole sheet. Pure: the page asks it with the rows
 * it already has, and a test asks the same function.
 */

/** How many places a group awards unless the race says otherwise: the podium. The race may say one to ten (`events.award_places`). */
export const AWARD_PLACES = 3;
export const AWARD_PLACES_MIN = 1;
export const AWARD_PLACES_MAX = 10;

/** What the race decided about its awards (§NNN): how many places, and whether the categories are awarded beside the overall podium by sex. */
export type AwardRules = { places: number; categories: boolean };
export const DEFAULT_AWARD_RULES: AwardRules = { places: AWARD_PLACES, categories: true };

/** A places count the column may hold. */
export function isValidAwardPlaces(places: number): boolean {
  return Number.isInteger(places) && places >= AWARD_PLACES_MIN && places <= AWARD_PLACES_MAX;
}

/** What the podium reads of one result: the runner (as the backoffice names them), the number, the time and the three positions. */
export type Awardable = {
  bibNumber: number;
  name: string | null;
  sex: SexChoice | null;
  gunTimeMs: number | null;
  positionSex: number | null;
  positionCategory: number | null;
  categoryKey: string | null;
};

export type AwardRow = { position: number; bibNumber: number; name: string | null; gunTimeMs: number | null };

/** One group of awards: the whole of one sex («General feminin»), or one category (`FEMALE:from30`). */
export type AwardGroup = { kind: "sex"; sex: SexChoice; rows: AwardRow[] } | { kind: "category"; key: string; sex: SexChoice; rows: AwardRow[] };

const SEX_ORDER: readonly SexChoice[] = ["FEMALE", "MALE"];

function podium(rows: readonly Awardable[], positionOf: (row: Awardable) => number | null, places: number): AwardRow[] {
  return rows
    .flatMap((row) => {
      const position = positionOf(row);
      return position !== null && position <= places ? [{ position, bibNumber: row.bibNumber, name: row.name, gunTimeMs: row.gunTimeMs }] : [];
    })
    .sort((a, b) => a.position - b.position || a.bibNumber - b.bibNumber);
}

/**
 * The groups in the order the awards are given: women then men, each sex's overall podium first and then — when the race awards them —
 * its categories, youngest band first. A group with nobody placed is left out (a race with no women has no «General feminin»); a tie puts both on the same step, so a
 * group may hold more than `places` rows. The positions are the ranking's own (`rankResults`), never counted again here.
 */
export function awardsOf(rows: readonly Awardable[], rules: AwardRules = DEFAULT_AWARD_RULES): AwardGroup[] {
  const { places } = rules;
  const groups: AwardGroup[] = [];
  for (const sex of SEX_ORDER) {
    const ofSex = rows.filter((row) => row.sex === sex);
    const overall = podium(ofSex, (row) => row.positionSex, places);
    if (overall.length > 0) groups.push({ kind: "sex", sex, rows: overall });
    // A race that awards the overall podium alone («top 5 men and top 5 women») lists no category.
    if (!rules.categories) continue;
    const keys = [...new Set(ofSex.map((row) => row.categoryKey).filter((key): key is string => key !== null && splitCategoryKey(key)?.sex === sex))].sort(
      (a, b) => bandStartOf(splitCategoryKey(a)?.band ?? "") - bandStartOf(splitCategoryKey(b)?.band ?? "") || a.localeCompare(b),
    );
    for (const key of keys) {
      const ofCategory = podium(
        ofSex.filter((row) => row.categoryKey === key),
        (row) => row.positionCategory,
        places,
      );
      if (ofCategory.length > 0) groups.push({ kind: "category", key, sex, rows: ofCategory });
    }
  }
  return groups;
}
