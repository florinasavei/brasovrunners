/**
 * «Din galerie» — which stored pictures the picker shows (§NNN). Pure, with no database and no
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
export type PictureSource = (typeof PICTURE_SOURCES)[number];
export type PictureUse = Exclude<PictureSource, "all">;

/** What the filter needs of a picture: its file's name and the places it is used. */
export type PickablePicture = { name: string; uses: readonly PictureUse[] };

/** A reference kind from the pictures page (`MediaReference`) as the picker's chip: the team page's introduction is «Echipa». */
export function pictureUseOf(kind: "album" | "page" | "event" | "team" | "teamIntro"): PictureUse {
  return kind === "teamIntro" ? "team" : kind;
}

/** Each use once, in the chips' order. */
export function pictureUses(kinds: readonly ("album" | "page" | "event" | "team" | "teamIntro")[]): PictureUse[] {
  const present = new Set(kinds.map(pictureUseOf));
  return PICTURE_SOURCES.filter((source): source is PictureUse => source !== "all" && present.has(source));
}

/** A query parameter read strictly: anything but one of the five words is «toate». */
export function parsePictureSource(value: string | null | undefined): PictureSource {
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
      (source === "all" || picture.uses.includes(source)) &&
      (folded === "" || foldForSearch(picture.name).includes(folded)),
  );
}

/** How many pictures one answer carries at most, after the narrowing: a wall past this is not a choice. */
export const PICKER_LIMIT = 300;
