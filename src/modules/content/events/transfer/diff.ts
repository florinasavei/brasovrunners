import type { EventConfig } from "./file-format";
import { type MediaKind, mapMediaUrls, TEXT_BOXES } from "./media";

/**
 * What an import over an event would change, field by field (§751): the file's configuration against
 * the target's, both read by the one function (`export.ts#configFromRows`), so a field that is the
 * same is the same and one that differs is shown with both sides — in both languages, the pictures
 * named.
 *
 * Pictures are compared by the hash of their bytes, not by their address — an address differs between
 * environments for the very same picture — so a cover that is the same photograph is not a change and
 * is not copied again. Nothing here reads the database or the store: the caller hands the digests in.
 */

/** One side of a change, as the page draws it in the reader's own words. */
export type ChangeValue =
  | { type: "empty" }
  | { type: "boolean"; value: boolean }
  | { type: "text"; value: string }
  | { type: "picture"; known: boolean }
  | { type: "document"; text: string; pictures: number };

export type ConfigChange = {
  /** The leaf's dotted path in the configuration, e.g. `translations.ro.title` or `registration.capacity`. */
  key: string;
  /** The message key of its label — the path with the language taken out (`translations.title`). */
  label: string;
  /** The language a per-language field is in, or null. */
  locale: "ro" | "en" | null;
  from: ChangeValue;
  to: ChangeValue;
};

const DOCUMENT_PATH = new RegExp(`^translations\\.(?:ro|en)\\.(?:${TEXT_BOXES.join("|")})$`);
/** Leaves that are objects the page shows whole: a rich text document, and a picture's crop. */
const isWhole = (path: string) => DOCUMENT_PATH.test(path) || /(?:^|\.)crop$/i.test(path) || /Crop$/.test(path);

/** The configuration's leaves by dotted path; arrays and the whole-objects above are one leaf each. */
export function leavesOf(value: unknown, path = "", out: Map<string, unknown> = new Map()): Map<string, unknown> {
  if (value !== null && typeof value === "object" && !Array.isArray(value) && !isWhole(path)) {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) leavesOf(child, path === "" ? key : `${path}.${key}`, out);
  } else {
    out.set(path, value);
  }
  return out;
}

/** How a picture reads while two configurations are compared: its hash, or its address when the hash is not known. */
export const PICTURE_PREFIX = { digest: "sha256:", address: "url:" } as const;

/** A copy of the configuration whose every picture's address is replaced by its digest, for comparing two of them. */
export function comparable(config: EventConfig, digestOf: (url: string, kind: MediaKind) => string | null): EventConfig {
  return mapMediaUrls(config, (url, kind) => {
    const digest = digestOf(url, kind);
    return digest ? `${PICTURE_PREFIX.digest}${digest}` : `${PICTURE_PREFIX.address}${url}`;
  });
}

const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function picturesIn(node: unknown): number {
  if (Array.isArray(node)) return node.reduce<number>((sum, child) => sum + picturesIn(child), 0);
  if (typeof node !== "object" || node === null) return 0;
  const record = node as Record<string, unknown>;
  return (record.type === "image" ? 1 : 0) + Object.values(record).reduce<number>((sum, child) => sum + picturesIn(child), 0);
}

/** Every run of text in a document, in order, wherever it is nested. */
function wordsIn(node: unknown, found: string[] = []): string[] {
  if (Array.isArray(node)) {
    for (const child of node) wordsIn(child, found);
  } else if (typeof node === "object" && node !== null) {
    const record = node as Record<string, unknown>;
    if (record.type === "text" && typeof record.text === "string") found.push(record.text);
    for (const [key, child] of Object.entries(record)) if (key !== "attrs" && typeof child === "object") wordsIn(child, found);
  }
  return found;
}

const MAX_TEXT = 240;
const clip = (text: string) => (text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT - 1)}…` : text);

/** One leaf as a value the page can draw. */
export function changeValueOf(path: string, value: unknown): ChangeValue {
  if (value === null || value === undefined || value === "") return { type: "empty" };
  if (typeof value === "boolean") return { type: "boolean", value };
  if (DOCUMENT_PATH.test(path)) {
    // Read as it is, never through the editor's schema: while two configurations are compared a
    // picture's address is its digest, which that schema would refuse, and a diff must still say the words.
    const text = wordsIn(value).join(" ").replace(/\s+/g, " ").trim();
    const pictures = picturesIn(value);
    return text === "" && pictures === 0 ? { type: "empty" } : { type: "document", text: clip(text), pictures };
  }
  if (typeof value === "string" && (value.startsWith(PICTURE_PREFIX.digest) || value.startsWith(PICTURE_PREFIX.address))) {
    return { type: "picture", known: value.startsWith(PICTURE_PREFIX.digest) };
  }
  if (typeof value === "string") return { type: "text", value: clip(value) };
  if (typeof value === "number") return { type: "text", value: String(value) };
  return { type: "text", value: clip(JSON.stringify(value)) };
}

/**
 * Every label a change can carry — the leaves of a whole configuration with the language taken out —
 * so the page can say each in both languages (`Admin.eventJson.fields.<label>`). A test holds the list to
 * the configuration's own shape (a leaf with no label, a label with no leaf) and to the catalogues.
 */
export const FIELD_LABELS = [
  "type",
  "surface",
  "timezone",
  "start.date",
  "start.time",
  "durationMinutes",
  "raceStartsAt",
  "dateToBeAnnounced",
  "timeToBeAnnounced",
  "programme",
  "place.name",
  "place.address",
  "place.toBeAnnounced",
  "place.mapUrl",
  "place.coordinates.latitude",
  "place.coordinates.longitude",
  "weather.mode",
  "route.url",
  "route.maps",
  "route.gpx.name",
  "route.gpx.url",
  "route.checkpoints",
  "links",
  "partners",
  "stravaEventUrl",
  "facebookEventUrl",
  "measures.distanceMeters",
  "measures.distanceEstimated",
  "measures.elevationGainMeters",
  "measures.elevationGainEstimated",
  "difficultyLevel",
  "nightOverride",
  "cost.type",
  "cost.amount",
  "cost.url",
  "offersGroupRunDeclaration",
  "isSpecial",
  "membersOnly",
  "cover.url",
  "cover.crop",
  "registration.mode",
  "registration.capacity",
  "registration.waitlist.choice",
  "registration.waitlist.limit",
  "registration.waitlistAutoOffer",
  "registration.opensAt",
  "registration.opensSoon",
  "registration.closesAt",
  "registration.confirmationOpensDaysBefore",
  "registration.confirmationDeadlineDaysBefore",
  "registration.minAge",
  "registration.reminderHoursBefore",
  "registration.declaration.key",
  "registration.external.provider",
  "registration.external.url",
  "registration.kitShirt",
  "registration.askHealthNote",
  "publicList.names",
  "publicList.waitlist",
  "publicList.waitlistCount",
  "publicList.count",
  "publicList.club",
  "hiddenList.enabled",
  "hiddenList.bibStart",
  "hiddenList.counted",
  "hiddenList.public",
  "bib.startNumber",
  "bib.colour",
  "bib.design.showName",
  "bib.design.showEventTitle",
  "bib.design.showDate",
  "bib.design.showLogo",
  "bib.design.numberScale",
  "bib.design.numberFormat",
  "bib.design.namePosition",
  "bib.design.headerImageSrc",
  "bib.design.sponsorImageSrc",
  "bib.design.headerImageCrop",
  "bib.design.sponsorImageCrop",
  "bib.design.cutMarks",
  "bib.design.showEmail",
  "bib.design.showPartners",
  "bib.design.showEventInFooter",
  "bib.design.showWebsite",
  "bib.design.footerText",
  "bib.design.showProfile",
  "bib.design.profileSource",
  "bib.design.profileImageSrc",
  "bib.design.showProfileFigures",
  "bib.design.profileOrientation",
  "bib.design.showCheckpoints",
  "bib.design.showCheckpointTimes",
  "bib.design.showDistance",
  "bib.design.showEmergency",
  "bib.design.emergencyPhone",
  "bib.design.emergencyLabel",
  "bib.design.emergencyPhoneLabel",
  "bib.design.emergencyPhone2",
  "bib.design.emergencyPhone2Label",
  "bib.design.emergencyUpsideDown",
  "bib.design.numberStubs",
  "bib.design.sponsorPlace",
  "bib.design.member.enabled",
  "bib.design.member.style",
  "bib.design.member.bandColour",
  "bib.design.member.headerImageSrc",
  "bib.design.member.headerImageCrop",
  "bib.design.member.cardImageSrc",
  "bib.design.member.cardImageCrop",
  "bib.design.member.label",
  "bib.design.member.mark",
  "bib.design.member.markShape",
  // The volunteer badges' look (§764); never a volunteer and never a role.
  "badges.design.size",
  "badges.design.customWidthMm",
  "badges.design.customHeightMm",
  "badges.design.bandColour",
  "badges.design.headerImageSrc",
  "badges.design.headerImageCrop",
  "badges.design.showLogo",
  "badges.design.showTitle",
  "badges.design.titleRo",
  "badges.design.titleEn",
  "badges.design.labelRo",
  "badges.design.labelEn",
  "badges.design.writingLine",
  "badges.design.showPhone",
  "badges.design.phone",
  "badges.design.phoneLabelRo",
  "badges.design.phoneLabelEn",
  "badges.design.cutMarks",
  "translations.slug",
  "translations.title",
  "translations.excerpt",
  "translations.excerptBody",
  "translations.checklist",
  "translations.body",
  "translations.rules",
  "translations.schedule",
  "translations.routeDescription",
  "translations.seoTitle",
  "translations.seoDescription",
  "translations.discountNote",
  "translations.weatherNote",
] as const;

/** The message key and the language of a leaf's label: `translations.ro.title` is `translations.title` in `ro`. */
export function labelOf(path: string): { label: string; locale: "ro" | "en" | null } {
  const match = /^translations\.(ro|en)\.(.+)$/.exec(path);
  if (match) return { label: `translations.${match[2]}`, locale: match[1] as "ro" | "en" };
  const named = /^place\.name\.(ro|en)$/.exec(path);
  if (named) return { label: "place.name", locale: named[1] as "ro" | "en" };
  return { label: path, locale: null };
}

/**
 * Every leaf that differs between the file's configuration and the target's, in the configuration's own
 * order. Both arguments are compared as `comparable` copies: pictures by digest.
 */
export function diffConfigs(incoming: EventConfig, current: EventConfig): ConfigChange[] {
  const before = leavesOf(current);
  const after = leavesOf(incoming);
  const changes: ConfigChange[] = [];
  // Every path either side has: an object on one side and null on the other have different leaves, and
  // a leaf missing from a side is the same answer as an empty one.
  for (const key of new Set([...after.keys(), ...before.keys()])) {
    const to = after.get(key) ?? null;
    const from = before.get(key) ?? null;
    if (sameJson(from, to)) continue;
    changes.push({ key, ...labelOf(key), from: changeValueOf(key, from), to: changeValueOf(key, to) });
  }
  return changes;
}
