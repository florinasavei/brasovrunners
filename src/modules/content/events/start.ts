import { fromWallTimeInput } from "@/modules/events/domain/zoned-time";
import { provisionalStartWallTime, readStartBoxes, UNDATED_DAY } from "@/modules/events/domain/provisional-start";
import { DomainError } from "@/shared/errors/domain-error";

/** The two «Când și unde» switches after the save: as posted, else as stored (§533). */
export type StartSwitches = { dateToBeAnnounced: boolean; timeToBeAnnounced: boolean };

/**
 * Which parts of the start may be empty (§545): «Data se anunță…» makes both optional, «Ora se
 * anunță…» alone only the hour; otherwise both are required.
 */
export function startBoxesRequired(switches: StartSwitches): { date: boolean; time: boolean } {
  return { date: !switches.dateToBeAnnounced, time: !switches.dateToBeAnnounced && !switches.timeToBeAnnounced };
}

/**
 * The start to store: the typed instant, or the provisional one (`provisional-start.ts`) for a
 * part the switches let be empty (§545). Refusals name `startsAt` or `startsAtTime` (§47).
 */
export function resolveStart(
  posted: string,
  switches: StartSwitches,
  timeZone: string,
): { startsAt: Date; blank: { date: boolean; time: boolean } } {
  const boxes = readStartBoxes(posted);
  if (!boxes) throw new DomainError("VALIDATION_ERROR", "startsAt: not a date and time", ["startsAt"]);
  // The provisional day is the platform's word for "no date"; typed, it would publish as a date.
  if (boxes.date !== "" && boxes.date >= UNDATED_DAY) {
    throw new DomainError("VALIDATION_ERROR", "startsAt: not a date an event can have", ["startsAt"]);
  }
  const required = startBoxesRequired(switches);
  if (required.date && boxes.date === "") {
    throw new DomainError("VALIDATION_ERROR", "startsAt: a date and time are required", ["startsAt"]);
  }
  if (required.time && boxes.time === "") {
    throw new DomainError("VALIDATION_ERROR", "startsAtTime: an hour is required unless it is to be announced later", ["startsAtTime"]);
  }
  const startsAt = fromWallTimeInput(provisionalStartWallTime(boxes), timeZone);
  if (!startsAt || Number.isNaN(startsAt.getTime())) {
    throw new DomainError("VALIDATION_ERROR", "startsAt: not a date and time", ["startsAt"]);
  }
  return { startsAt, blank: { date: boxes.date === "", time: boxes.time === "" } };
}
