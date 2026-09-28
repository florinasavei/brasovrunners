import { fromWallTimeInput } from "@/modules/events/domain/zoned-time";
import { provisionalStartWallTime, readStartBoxes, UNDATED_DAY } from "@/modules/events/domain/provisional-start";
import { DomainError } from "@/shared/errors/domain-error";

/**
 * The two switches of «Când și unde» as they stand after the save (§533): what the form posted, else
 * what the row holds — a caller that does not post a switch leaves it as it is (`fields.ts`).
 */
export type StartSwitches = { dateToBeAnnounced: boolean; timeToBeAnnounced: boolean };

/**
 * Which parts of the start may be left empty (`DECISIONS.md` §545, amending §533) — the one rule the
 * service applies and the editor's boxes follow (`StartToBeAnnounced`):
 *
 * - «Data se anunță mai târziu» ticked: the date and the hour are both optional;
 * - «Ora se anunță mai târziu» alone: the date is required, the hour optional;
 * - neither: both are required, as they always were.
 */
export function startBoxesRequired(switches: StartSwitches): { date: boolean; time: boolean } {
  return { date: !switches.dateToBeAnnounced, time: !switches.dateToBeAnnounced && !switches.timeToBeAnnounced };
}

/**
 * The start to store, from its posted value and the switches (§545): the typed instant, or the
 * provisional one (`provisional-start.ts`) in place of a part the switch lets the organizer leave
 * empty. Every refusal names its box (§47): an empty date is `startsAt` (the date box, «Începutul
 * evenimentului»), an empty hour beside a typed date is `startsAtTime`.
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
