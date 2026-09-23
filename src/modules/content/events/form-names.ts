/**
 * From the field path a refusal names to the `name` the form posts (`DECISIONS.md` §305).
 *
 * The service speaks in the paths of `fields.ts` — `capacity`, `translations.ro.title`,
 * `scheduleRows.2.time`, `startsAtWallTime` — and the form posts `event.capacity`,
 * `translations.ro.title`, `event.schedule[2].time` and a date box plus a time box for every
 * wall-clock instant (`WallTimeField`). The refusal summary links to boxes, so the paths are
 * translated here, once, and `admin/actions.ts#eventFormFieldNames` applies it to every field
 * a `DomainError` carries. A path nobody recognises is prefixed like any event column; the
 * summary then shows it by name rather than not at all.
 */
export function eventFormFieldName(path: string): string {
  if (path.startsWith("translations.")) return path;
  const row = /^scheduleRows\.(\d+)\.(\w+)$/.exec(path);
  if (row) return `event.schedule[${row[1]}].${row[2]}`;
  if (path === "scheduleRows") return "event.schedule[0].date";
  const partner = /^coHosts\.(\d+)\.(\w+)$/.exec(path);
  if (partner) return `event.coHosts[${partner[1]}].${partner[2]}`;
  if (path === "coHosts") return "event.coHosts[0].name";
  // A wall-clock instant is two boxes; the date is the one the summary points at.
  if (path.endsWith("WallTime")) return `event.${path.slice(0, -"WallTime".length)}Date`;
  if (/^(startsAt|endsAt|raceStartsAt|registrationOpensAt|registrationClosesAt)$/.test(path)) return `event.${path}Date`;
  return `event.${path}`;
}
