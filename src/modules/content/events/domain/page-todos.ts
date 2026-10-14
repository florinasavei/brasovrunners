import { hasRichTextContent, readRichText } from "@/modules/content/rich-text/domain/schema";
import { difficultyLevelOf } from "@/modules/events/domain/difficulty";
import { type EventType, hasProgramme, takesRegistrations } from "@/modules/events/domain/event-type";
import { readEventLinks } from "@/modules/events/domain/links";
import { readRouteGpx } from "@/modules/events/domain/route-gpx";
import { readRouteMaps } from "@/modules/events/domain/route-maps";
import { readScheduleItems } from "@/modules/events/domain/schedule";
import type { EventTodoPriority } from "@/modules/event-todos/domain/event-todo";
import { missingForPublish, storedPublishReader, type StoredPublishTranslation } from "../ui/publish-check";

/**
 * What an event's page still lacks (§749; the owner, 2026-10-13: «eu vreau doar TODOs pt site-ul
 * evenimentului») — **computed from the event on every read, never stored**, so a row is gone the
 * moment its field is filled and nobody has to tick it. The card «De făcut pentru pagina
 * evenimentului» in the editor lists these beside the club's own typed lines
 * (`event-todos/domain/event-todo.ts`), under one priority scale.
 *
 * Each rule below says in one comment what it reads and why it is on the list; every one is
 * unit-tested (`tests/unit/events/page-todos.test.ts`). The words of each row are the backoffice
 * catalogue's (`Admin.eventTodos.page.<rule>`), the priority is the rule's own, and `anchor` is
 * the id of the editor's card that fills it — opened by `OpenFoldFromHash` on a press.
 *
 * **What is deliberately not here**, because the data cannot be read reliably:
 * - «the difficulty is still the migrated default» (§526): migration `0104` put each old word on
 *   the middle step of its band (2, 5, 11, 14, and 1 for «foarte ușor»), and a level the club
 *   chose by hand is stored as the same number — nothing tells the two apart. Only a level not
 *   chosen at all (`null`) is a row.
 * - «no partners on the bib design» (§735): partners come from the event's co-hosts, and a design
 *   that shows none is as likely a choice (`showPartners` off, or no partner) as an omission.
 * - a programme for a hike, a coffee or a meetup: only a race is expected to have timed rows.
 *
 * An event that is over, cancelled or archived has nothing left to do for its page, so it has no
 * computed rows (`isOver`); the club's own typed lines stay.
 */

export const PAGE_TODO_RULES = [
  "title",
  "summary",
  "description",
  "meetingPoint",
  "placeAnnounced",
  "address",
  "startTime",
  "programme",
  "cover",
  "route",
  "difficulty",
  "capacity",
  "bibDesign",
  "declaration",
] as const;
export type PageTodoRule = (typeof PAGE_TODO_RULES)[number];

/** The editor's cards by their `id`, where a row's link lands (`#box-…`). */
export type PageTodoAnchor =
  | "box-title"
  | "box-description"
  | "box-when"
  | "box-place"
  | "box-address"
  | "box-schedule"
  | "box-cover"
  | "box-course"
  | "box-kind"
  | "box-registration"
  | "box-bibs"
  | "box-declaration";

/** One thing the page lacks: which rule, in which language when it is a language's, how pressing, and where it is filled. */
export type PageTodo = {
  /** Unique within an event: the rule, and `:ro` / `:en` when the language is the gap. */
  id: string;
  rule: PageTodoRule;
  locale: string | null;
  priority: EventTodoPriority;
  anchor: PageTodoAnchor;
};

/** What the rules read of the event row — the stored columns, nothing computed. */
export type PageTodoEvent = {
  type: EventType;
  eventStatus: "SCHEDULED" | "CANCELLED" | "COMPLETED";
  editorialStatus: "DRAFT" | "IN_REVIEW" | "PUBLISHED" | "ARCHIVED";
  startsAt: Date;
  endsAt: Date | null;
  dateToBeAnnounced: boolean;
  timeToBeAnnounced: boolean;
  locationName: string | null;
  locationToBeAnnounced: boolean;
  scheduleItems: unknown;
  coverMediaAssetId: string | null;
  routeUrl: string | null;
  routeMaps: unknown;
  routeGpx: unknown;
  links: unknown;
  difficultyLevel: number | null;
  registrationMode: "NONE" | "INTERNAL" | "EXTERNAL";
  capacity: number | null;
  bibDesign: unknown;
  declarationDocumentId: string | null;
};

/** What the rules read of one language. */
export type PageTodoTranslation = StoredPublishTranslation & { bodyJson: unknown; scheduleJson: unknown };

/** What the rules need from outside the event. */
export type PageTodoContext = {
  now: Date;
  /** The locales the page exists in (`routing.locales`), in the order the club works in. */
  locales: readonly string[];
  /** `isStorageConfigured()`: without a store there is no picture to upload, so a missing cover is not a task. */
  storageConfigured: boolean;
  /** The ids of the approved declaration versions (`listApprovedRaceDeclarations`). */
  approvedDeclarationIds: ReadonlySet<string>;
};

/** Over, cancelled or archived: the page has nothing left to be finished for. */
function isOver(event: PageTodoEvent, now: Date): boolean {
  if (event.editorialStatus === "ARCHIVED") return true;
  if (event.eventStatus !== "SCHEDULED") return true;
  return (event.endsAt ?? event.startsAt).getTime() < now.getTime();
}

const hasDoc = (json: unknown) => json !== null && json !== undefined && hasRichTextContent(readRichText(json));

export function eventPageTodos(event: PageTodoEvent, translations: readonly PageTodoTranslation[], context: PageTodoContext): PageTodo[] {
  if (isOver(event, context.now)) return [];
  const found: PageTodo[] = [];
  const add = (rule: PageTodoRule, priority: EventTodoPriority, anchor: PageTodoAnchor, locale: string | null = null) =>
    found.push({ id: locale ? `${rule}:${locale}` : rule, rule, locale, priority, anchor });
  const isRace = event.type === "RACE";

  /*
    The title, the summary, the meeting point and the page address in each language: the same
    check publication runs (`missingForPublish`, §315, §350) over the stored event, so this list
    and the Publicare box cannot name different gaps. A missing language is high — the page is a
    404 there (§28), and publication is refused until it is filled.
  */
  for (const gap of missingForPublish(storedPublishReader(event, translations), context.locales)) {
    if (gap.field === "title") add("title", "HIGH", "box-title", gap.locale);
    else if (gap.field === "excerpt") add("summary", "HIGH", "box-title", gap.locale);
    else if (gap.field === "locationName") add("meetingPoint", "HIGH", "box-place", gap.locale);
    else add("address", "HIGH", "box-address", gap.locale);
  }

  /*
    The long description, per language: without it the page shows the summary in its place
    (`EventDescription`), so it is never refused — but a page with one language's description and
    not the other's is half written. A language with no row at all counts as lacking.
  */
  for (const locale of context.locales) {
    const row = translations.find((candidate) => candidate.locale === locale);
    if (!row || !hasDoc(row.bodyJson)) add("description", "NORMAL", "box-description", locale);
  }

  // The place is «se anunță» (§328): the page says so where the place would be — a state to end, not a gap.
  if (event.locationToBeAnnounced) add("placeAnnounced", "HIGH", "box-place");

  // The start is «se anunță» (§533): the day, the time or both. Every surface says «în curând», and registration stays shut.
  if (event.dateToBeAnnounced || event.timeToBeAnnounced) add("startTime", "HIGH", "box-when");

  /*
    A race's programme: the timed rows (§117) — kit pickup, briefing, start — or a programme text
    in some language (`PAGE_SECTIONS`' «programme» drawn rule). A hike or a meetup is not expected to have one.
  */
  if (isRace && hasProgramme(event.type) && readScheduleItems(event.scheduleItems).length === 0 && !translations.some((row) => hasDoc(row.scheduleJson))) {
    add("programme", "NORMAL", "box-schedule");
  }

  /*
    The cover (§709): the photo the listing card and the new page draw. Asked only where storage
    is configured — without it «Copertă» offers no upload, so the row could never be cleared.
  */
  if (context.storageConfigured && event.coverMediaAssetId === null) add("cover", "NORMAL", "box-cover");

  /*
    A run or a race with no route at all (§718): neither a Strava or Garmin Connect map nor a GPX
    file — and no route link and no GPX or map link in «Linkuri» either, which also answer the
    runner's question (§387). The GPX counts whether or not storage is configured: the club's file is
    the club's file, and a missing store is a different row.
  */
  if (
    (event.type === "RACE" || event.type === "GROUP_RUN") &&
    readRouteMaps(event.routeMaps).length === 0 &&
    readRouteGpx(event.routeGpx) === null &&
    (event.routeUrl ?? "").trim() === "" &&
    !readEventLinks(event.links).some((link) => link.kind === "GPX" || link.kind === "MAP")
  ) {
    add("route", "NORMAL", "box-course");
  }

  // The difficulty (§526): only «not chosen» (null) is read — see the note above on the migrated default.
  if ((event.type === "RACE" || event.type === "GROUP_RUN" || event.type === "HIKE") && difficultyLevelOf(event) === null) {
    add("difficulty", "LOW", "box-kind");
  }

  if (isRace && event.registrationMode === "INTERNAL") {
    // A race the club registers itself, with no limit set: legal (null is «fără limită»), but a race with no places counted is rarely meant.
    if (event.capacity === null) add("capacity", "NORMAL", "box-registration");
    // The bibs' design (§249, §735) never saved: the bibs print as the platform's own plain one.
    if (event.bibDesign === null || event.bibDesign === undefined) add("bibDesign", "LOW", "box-bibs");
  }

  /*
    The declaration a participant signs: an event the club registers itself (§111) needs an
    approved version named (the save refuses without — `assertCoherentRegistrationBlock`), so a
    row here means the version it named is no longer approved, or a draft from before the rule. Urgent: nobody can register.
  */
  if (
    takesRegistrations(event.type) &&
    event.registrationMode === "INTERNAL" &&
    (event.declarationDocumentId === null || !context.approvedDeclarationIds.has(event.declarationDocumentId))
  ) {
    add("declaration", "URGENT", "box-declaration");
  }

  return found;
}
