import type { RegistrationStatus } from "@/db/schema/registrations";
import { formatRaceNumber, type RaceNumberFormat } from "./race-number";

/**
 * One person's race number, downloaded on its own (§980; the owner, 2026-11-18, three days before the race: «eu trebuie
 * să pot descărca un BIB doar pentru o persoană»; BR-REQ-038-01).
 *
 * Decided here once, so the route that prints it and the three places that offer it — the registration's page, the
 * desk's «Vezi numărul de concurs (BIB)» and the registrations list's «⋮» — cannot disagree about when it exists. Pure.
 */

/** What a registration needs to have a bib to print: its state, its kind, its number and the elite mark (§897). */
export type OneBibSubject = { status: RegistrationStatus; kind: "REAL" | "TEST"; bibNumber: number | null; elite: boolean };

/**
 * Whether the registration has a bib the sheet would print (§264, §897): a real, confirmed registration (a cancelled one's
 * paper is void, §311; a test row never wears a number, §30) that wears a number — or is marked «Elită», whose bib prints
 * its label where the number goes (§975) and needs none.
 */
export function hasOneBib(subject: OneBibSubject): boolean {
  return subject.kind === "REAL" && subject.status === "CONFIRMED" && (subject.bibNumber !== null || subject.elite);
}

/**
 * The address of that one bib: the event's sheet route asked for a single registration. A link a browser opens in a new
 * tab — a GET that writes nothing, never the printed mark (§264).
 */
export function oneBibHref(eventId: string, registrationId: string, locale: string): string {
  return `/api/admin/events/${eventId}/bibs?locale=${locale}&registrationId=${registrationId}`;
}

/**
 * The file's name: `bib-<number>.pdf`, the number as the event writes it (§735); an elite bib `bib-<number>-elite.pdf`, or
 * — with no number — `bib-<the event's slug>-elite.pdf`. Never the person's name: a file name travels further than the file.
 */
export function oneBibFileName(bib: { bibNumber: number | null; elite: boolean }, event: { slug: string; numberFormat: RaceNumberFormat | null | undefined }): string {
  const stem = bib.bibNumber !== null ? formatRaceNumber(bib.bibNumber, event.numberFormat) : event.slug;
  return `bib-${stem}${bib.elite ? "-elite" : ""}.pdf`;
}
