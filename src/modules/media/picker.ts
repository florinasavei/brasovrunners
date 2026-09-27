/**
 * «Din galerie» — which stored pictures the picker shows (§485). Pure, with no database and no
 * browser in it: `GET /api/admin/media` narrows the list with it before the cap, so an old
 * picture is found by its name however many came after it, and the picker applies its place's
 * own rule (`accept`) with it on what came back. A test reads it without either.
 *
 * The order is the list's own — newest first, as the route reads it — and nothing here sorts.
 */

/**
 * Where a picture is used, as the picker's chips say it: an event's texts, an album, a standing
 * page, «Echipa» (a card's photo, a bio or the page's introduction). «toate» is no filter.
 */
export const PICTURE_SOURCES = ["all", "event", "album", "page", "team"] as const;
/**
 * A chip: «toate», a kind of place, or «here» — THIS event, album or page, the one whose editor
 * the picker was opened from (§485: «Acest eveniment» / «This event»). «here» exists only where
 * the picker knows its place (`PickerScope`).
 */
export type PictureSource = (typeof PICTURE_SOURCES)[number] | "here";
export type PictureUse = Exclude<PictureSource, "all" | "here">;

/** The place a picker was opened from, when it is one stored thing: an event, an album, a page. */
export const PICKER_SCOPE_KINDS = ["event", "album", "page"] as const;
export type PickerScopeKind = (typeof PICKER_SCOPE_KINDS)[number];
export type PickerScope = { kind: PickerScopeKind; id: string };

/**
 * What the filter needs of a picture: its file's name, the places it is used, and — when the
 * list was asked for from a place — whether that very place uses it (`here`, computed on the
 * server from the picture's references, never from the whole list in the browser).
 */
export type PickablePicture = { name: string; uses: readonly PictureUse[]; here?: boolean };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The scope as a query parameter: `event:<uuid>`. */
export function pickerScopeParam(scope: PickerScope): string {
  return `${scope.kind}:${scope.id}`;
}

/** `?for=` read strictly: one of the three kinds and a UUID, else no scope at all. */
export function parsePickerScope(value: string | null | undefined): PickerScope | null {
  const match = /^(event|album|page):(.+)$/.exec(value ?? "");
  if (!match || !UUID.test(match[2])) return null;
  return { kind: match[1] as PickerScopeKind, id: match[2] };
}

/** Whether one of a picture's references (`MediaReference`: kind and id) is the scope's own place. */
export function usedHere(references: readonly { kind: string; id: string }[], scope: PickerScope): boolean {
  return references.some((reference) => reference.kind === scope.kind && reference.id === scope.id);
}

/** A reference kind from the pictures page (`MediaReference`) as the picker's chip: the team page's introduction is «Echipa». */
// «Întrebări frecvente» (§525) and the members' pages (§524) are pages the club writes: «Pagini».
export function pictureUseOf(kind: "album" | "page" | "event" | "team" | "teamIntro" | "faq" | "membersPage"): PictureUse {
  if (kind === "teamIntro") return "team";
  if (kind === "faq" || kind === "membersPage") return "page";
  return kind;
}

/** Each use once, in the chips' order. */
export function pictureUses(kinds: readonly ("album" | "page" | "event" | "team" | "teamIntro" | "faq" | "membersPage")[]): PictureUse[] {
  const present = new Set(kinds.map(pictureUseOf));
  return PICTURE_SOURCES.filter((source): source is PictureUse => source !== "all" && present.has(source));
}

/**
 * A query parameter read strictly: anything but one of the five words is «toate» — and «here»
 * only when the request names its place (`scoped`), since «here» means nothing without one.
 */
export function parsePictureSource(value: string | null | undefined, scoped = false): PictureSource {
  if (value === "here") return scoped ? "here" : "all";
  return (PICTURE_SOURCES as readonly string[]).includes(value ?? "") ? (value as PictureSource) : "all";
}

/**
 * A name as the search compares it: lower case, the diacritics gone — «Hartă» is found by
 * "harta", "HARTA" and "hartă" alike, as a person types on a phone without the Romanian keyboard.
 */
export function foldForSearch(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase("ro");
}

/**
 * The pictures a place offers: those its rule accepts, used where the chip says, whose file
 * name holds what was typed (after `foldForSearch` on both sides; blank is everything). The
 * list's order is kept.
 */
export function visiblePictures<P extends PickablePicture>(
  pictures: readonly P[],
  {
    accept = () => true,
    needle = "",
    source = "all",
  }: { accept?: (picture: P) => boolean; needle?: string; source?: PictureSource } = {},
): P[] {
  const folded = foldForSearch(needle.trim());
  return pictures.filter(
    (picture) =>
      accept(picture) &&
      (source === "all" || (source === "here" ? picture.here === true : picture.uses.includes(source))) &&
      (folded === "" || foldForSearch(picture.name).includes(folded)),
  );
}

/** How many pictures one answer carries at most, after the narrowing: a wall past this is not a choice. */
export const PICKER_LIMIT = 300;
