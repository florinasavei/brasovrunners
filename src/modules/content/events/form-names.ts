/**
 * The marker the create form's second button posts to ask for publication too (§315). Kept out
 * of the `"use client"` button file: exported from there it is a client reference on the server,
 * and the action would compare the posted string with a proxy and never publish.
 */
export const THEN_FIELD = "then";
export const THEN_PUBLISH = "publish";

/**
 * Posted once JavaScript runs in the Locul box: the English place name is kept as typed rather
 * than made to follow the Romanian again (`service.ts`, `placeNamesAsTyped`; §362).
 */
export const PLACE_NAMES_AS_TYPED_FIELD = "event.placeNamesAsTyped";

/**
 * From the field path a refusal names (`fields.ts` paths) to the `name` the form posts, so the
 * refusal summary can link to the box (§315). A language's boxes and the create form's repeat
 * rule already post under their paths; the summary maps to `excerptBody`, the weekday ticks to a
 * bare `weekday`. An unknown path is prefixed like any event column.
 */
export function eventFormFieldName(path: string): string {
  const summary = /^(translations\.\w+)\.excerpt$/.exec(path);
  if (summary) return `${summary[1]}.excerptBody`;
  if (path === "repeat.weekday") return "weekday";
  if (path.startsWith("translations.") || path.startsWith("repeat.")) return path;
  // The notice to the participants and the cancellation's reason (§331) post under their own names.
  if (path.startsWith("notice.") || path.startsWith("cancel.")) return path;
  const row = /^scheduleRows\.(\d+)\.(\w+)$/.exec(path);
  if (row) return `event.schedule[${row[1]}].${row[2]}`;
  if (path === "scheduleRows") return "event.schedule[0].date";
  // A partner's box, or one of its links' by both indices (§344); the more specific shape first.
  const partnerLink = /^coHosts\.(\d+)\.links\.(\d+)\.(\w+)$/.exec(path);
  if (partnerLink) return `event.coHosts[${partnerLink[1]}].links[${partnerLink[2]}].${partnerLink[3]}`;
  const partnerLinkList = /^coHosts\.(\d+)\.links$/.exec(path);
  if (partnerLinkList) return `event.coHosts[${partnerLinkList[1]}].links`;
  const partner = /^coHosts\.(\d+)\.(\w+)$/.exec(path);
  if (partner) return `event.coHosts[${partner[1]}].${partner[2]}`;
  if (path === "coHosts") return "event.coHosts";
  // The links (§332): a row's box by index; the whole list ("more than twelve") as the list's id.
  const link = /^links\.(\d+)\.(\w+)$/.exec(path);
  if (link) return `event.links[${link[1]}].${link[2]}`;
  if (path === "links") return "event.links";
  // «Durata» is two boxes, hours and minutes (§433); the hours are the one the summary points at.
  if (path === "durationMinutes") return "event.durationHours";
  // A wall-clock instant is two boxes; the date is the one the summary points at.
  if (path.endsWith("WallTime")) return `event.${path.slice(0, -"WallTime".length)}Date`;
  if (/^(startsAt|endsAt|raceStartsAt|registrationOpensAt|registrationClosesAt)$/.test(path)) return `event.${path}Date`;
  return `event.${path}`;
}
