/**
 * The marker the create form's second button posts: this press asks for publication too
 * (`DECISIONS.md` §315). Here, in a plain module, and not beside the button: a constant
 * exported from a `"use client"` file is a client reference on the server, so the action would
 * compare the posted string with a proxy object and never publish.
 */
export const THEN_FIELD = "then";
export const THEN_PUBLISH = "publish";

/**
 * From the field path a refusal names to the `name` the form posts (`DECISIONS.md` §315).
 *
 * The service speaks in the paths of `fields.ts` — `capacity`, `translations.ro.title`,
 * `scheduleRows.2.time`, `startsAtWallTime` — and the form posts `event.capacity`,
 * `translations.ro.title`, `event.schedule[2].time` and a date box plus a time box for every
 * wall-clock instant (`WallTimeField`). The refusal summary links to boxes, so the paths are
 * translated here, once, and `admin/actions.ts#eventFormFieldNames` applies it to every field
 * a `DomainError` carries.
 *
 * Two families pass through as they are, because the form already posts them under those
 * names: a language's boxes (`translations.<locale>.<field>` — the save prefixes the language
 * onto a translation's own paths, `service.ts#namedUnder`) and the create form's repeat rule
 * (`repeat.cadence`, which the action names itself, and `repeat.until`, which
 * `createEventAndPublish` prefixes onto `repeatEvent`'s own `until`). Two exceptions: the plain
 * summary — the schema's `excerpt` is derived from the rich one the editor posts as
 * `excerptBody`, so a refusal of either points at that box — and the weekday ticks, which
 * `RepeatFields` posts as a bare `weekday` on both forms. A path nobody recognises is prefixed
 * like any event column; the summary then shows it by name rather than not at all.
 */
export function eventFormFieldName(path: string): string {
  const summary = /^(translations\.\w+)\.excerpt$/.exec(path);
  if (summary) return `${summary[1]}.excerptBody`;
  if (path === "repeat.weekday") return "weekday";
  if (path.startsWith("translations.") || path.startsWith("repeat.")) return path;
  const row = /^scheduleRows\.(\d+)\.(\w+)$/.exec(path);
  if (row) return `event.schedule[${row[1]}].${row[2]}`;
  if (path === "scheduleRows") return "event.schedule[0].date";
  const partner = /^coHosts\.(\d+)\.(\w+)$/.exec(path);
  if (partner) return `event.coHosts[${partner[1]}].${partner[2]}`;
  if (path === "coHosts") return "event.coHosts[0].name";
  // The links (§NNN): a row's box by the index the editor gave it, and the whole list — "more
  // than twelve" — as the list itself, which `LinkRowsEditor` carries the id of.
  const link = /^links\.(\d+)\.(\w+)$/.exec(path);
  if (link) return `event.links[${link[1]}].${link[2]}`;
  if (path === "links") return "event.links";
  // A wall-clock instant is two boxes; the date is the one the summary points at.
  if (path.endsWith("WallTime")) return `event.${path.slice(0, -"WallTime".length)}Date`;
  if (/^(startsAt|endsAt|raceStartsAt|registrationOpensAt|registrationClosesAt)$/.test(path)) return `event.${path}Date`;
  return `event.${path}`;
}
