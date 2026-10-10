import type { EventType } from "@/modules/events/domain/event-type";
import { foldForSearch } from "@/modules/registrations/country-search";

/**
 * «Evenimentul» on «Cum a fost» and «O reclamație», filtered as one types (§680, amending §676; the
 * owner, 2026-10-09: «Also I need to be able the filter the events here»).
 *
 * The picker lists every published event of the last 90 days and the next 30 (`pickerOrder`), and
 * with a weekly group run that is a long native list on a phone. The server still draws the native
 * `<select name="event">` — what a browser without JavaScript posts — and, once the list is long
 * enough to need it, a client island (`ui/EventPickerFilter.tsx`) replaces it with a box that
 * filters as one types and three chips that narrow it to one kind.
 *
 * Plain data in, plain data out, with no import that ships code but the fold, so the island, the
 * server page and a unit test read the same rules — and the island carries neither Zod nor the
 * server's configuration (§489).
 */

/** What an event is, for the chips: a race, a group run, or anything else (a hike, a coffee…). */
export type PickerKind = "race" | "group" | "other";

/**
 * The chip that is pressed: every kind, the special events, or the group runs.
 *
 * «Evenimente speciale» (§NNN; the owner, 2026-10-10: «instead of "curse" say "evenimente speciale"»)
 * is every event that is not a group run — a race, and also a hike, a coffee, a special event — where
 * «Curse» held races alone and left the rest under «Toate» only. The two chips now split the list.
 */
export type PickerChip = "all" | "special" | "group";

export const PICKER_CHIPS: readonly PickerChip[] = ["all", "special", "group"];

/** Whether an event's kind is under a chip. */
export function underChip(kind: PickerKind, chip: PickerChip): boolean {
  if (chip === "all") return true;
  if (chip === "group") return kind === "group";
  return kind !== "group";
}

/**
 * One row of the picker as the server hands it to the island — plain data, never an element (§370).
 * `value` is the slug the form posts (`""` for «Altceva / în general»); `label` the event's title;
 * `day` its day in the event's zone, `YYYY-MM-DD`; `when` the same day in the page's own date words
 * (`formatDay`, as the native option says it), so the island formats nothing and searches the words
 * the reader sees.
 */
export type PickerOption = {
  value: string;
  label: string;
  kind: PickerKind;
  day: string | null;
  when: string | null;
};

/** «Altceva / în general»: the option that names no event — first in the list, and in the filtered list whenever what was typed finds no event. */
export const GENERAL_VALUE = "";

/**
 * Up to this many rows in the native list (with «Altceva» among them), no island is mounted: eight
 * rows open on a phone without a scroll worth filtering, and the page then ships no JavaScript for
 * the picker at all.
 */
export const PICKER_NATIVE_MAX = 8;

/** Whether the picker is long enough for the filtering island — more rows than `PICKER_NATIVE_MAX`. */
export function pickerFilters(options: readonly PickerOption[]): boolean {
  return options.length > PICKER_NATIVE_MAX;
}

/** The kind of an event, from the type it already carries: no column of its own. */
export function pickerKind(type: EventType): PickerKind {
  if (type === "RACE") return "race";
  if (type === "GROUP_RUN") return "group";
  return "other";
}

/** The chips are drawn only when both chips would hold an event; otherwise one would empty the list. */
export function pickerChipsShown(options: readonly PickerOption[]): boolean {
  const events = options.filter((option) => option.value !== GENERAL_VALUE);
  return events.some((option) => underChip(option.kind, "special")) && events.some((option) => underChip(option.kind, "group"));
}

/** What a row is searched by: its title and its day, in the reader's words and as `YYYY-MM-DD`, folded. */
function haystack(option: PickerOption): string {
  return foldForSearch([option.label, option.when ?? "", option.day ?? ""].join(" "));
}

/**
 * The rows the list shows for what was typed and the chip pressed, in the given order
 * (`pickerOrder`'s: the held ones first, the most recent first, then the ones ahead).
 *
 * - **«Altceva / în general» is first while the box is empty, or while nothing typed matches an
 *   event**: it is the answer for a message about no event, and it is never out of reach. **While
 *   what was typed matches an event, it steps out of the list**, so Enter picks the highlighted row:
 *   the first event found, or — when an event is already chosen and the words still match it — that
 *   one, which MUI's combobox keeps highlighted whenever the value chosen is among the rows. With
 *   «Altceva» always there (the value by default) that same highlight stayed on it, and «crosul» +
 *   Enter picked «Altceva» (the review of 2026-10-09). Cleared, the box shows it again.
 * - **Every word typed must be found**, anywhere in the title or the day, without its accents or
 *   its case: «crosul» finds «Crosul», «brasov» finds «Brașov», «happy oct» finds the October
 *   Mondays of «Happy Monday».
 * - **A chip narrows the list**: «Alergări de grup» to the group runs, «Evenimente speciale» to
 *   everything else (`underChip`); «Toate» keeps every kind.
 */
export function filterPickerOptions(options: readonly PickerOption[], typed: string, chip: PickerChip): PickerOption[] {
  const words = foldForSearch(typed).split(/\s+/).filter(Boolean);
  const general = options.find((option) => option.value === GENERAL_VALUE);
  const events = options.filter(
    (option) =>
      option.value !== GENERAL_VALUE &&
      underChip(option.kind, chip) &&
      (words.length === 0 || words.every((word) => haystack(option).includes(word))),
  );
  if (words.length > 0 && events.length > 0) return events;
  return general ? [general, ...events] : events;
}

/** Whether a filtered list holds no event — «Altceva» alone, or nothing — so the island says «Niciun eveniment găsit». */
export function pickerNoEventFound(filtered: readonly PickerOption[]): boolean {
  return !filtered.some((option) => option.value !== GENERAL_VALUE);
}
