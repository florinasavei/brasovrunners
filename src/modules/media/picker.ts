/**
 * «Din galerie» — which stored pictures the picker shows (§485). Pure: `GET /api/admin/media`
 * narrows with it before the cap, and the picker applies its place's `accept` on the answer.
 * Nothing here sorts; the list stays newest first.
 */

/** Where a picture is used, as the picker's chips say it; «toate» (`all`) is no filter. */
export const PICTURE_SOURCES = ["all", "event", "album", "page", "team"] as const;
/** A chip; «here» is the place the picker was opened from, only when it has one (§485). */
export type PictureSource = (typeof PICTURE_SOURCES)[number] | "here";
export type PictureUse = Exclude<PictureSource, "all" | "here">;

/** The place a picker was opened from, when it is one stored thing: an event, an album, a page. */
export const PICKER_SCOPE_KINDS = ["event", "album", "page"] as const;
export type PickerScopeKind = (typeof PICKER_SCOPE_KINDS)[number];
export type PickerScope = { kind: PickerScopeKind; id: string };

/** What the filter needs of a picture; `here` is computed on the server from its references. */
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
// A newsletter sent (§550) is no place a picker chooses from: it keeps its pictures, and has no chip.
export function pictureUseOf(kind: "album" | "page" | "event" | "team" | "teamIntro" | "faq" | "membersPage" | "newsletter"): PictureUse | null {
  if (kind === "newsletter") return null;
  if (kind === "teamIntro") return "team";
  if (kind === "faq" || kind === "membersPage") return "page";
  return kind;
}

/** Each use once, in the chips' order. */
export function pictureUses(kinds: readonly ("album" | "page" | "event" | "team" | "teamIntro" | "faq" | "membersPage" | "newsletter")[]): PictureUse[] {
  const present = new Set(kinds.map(pictureUseOf));
  return PICTURE_SOURCES.filter((source): source is PictureUse => source !== "all" && present.has(source));
}

/** Read strictly: anything unknown is «toate», and «here» only when `scoped`. */
export function parsePictureSource(value: string | null | undefined, scoped = false): PictureSource {
  if (value === "here") return scoped ? "here" : "all";
  return (PICTURE_SOURCES as readonly string[]).includes(value ?? "") ? (value as PictureSource) : "all";
}

/** Lower case without diacritics, so "harta" finds «Hartă». */
export function foldForSearch(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase("ro");
}

/** The pictures a place offers: accepted, matching the chip and the typed name; order kept. */
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

/** The most pictures one answer carries, after narrowing. */
export const PICKER_LIMIT = 300;
