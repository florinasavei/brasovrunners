import { eq, inArray } from "drizzle-orm";
import { getTranslations } from "next-intl/server";
import { events } from "@/db/schema/events";
import type { Database } from "@/db/types";
import { countForm } from "@/i18n/count-form";
import { RACE_NUMBER_FORMAT } from "@/modules/events/repository";
import { freeSpareBibNumbers } from "./bibs";
import { formatRaceNumber, type RaceNumberFormat } from "./domain/race-number";
import { spareRunsText } from "./domain/spare-bibs";

/**
 * «Numere de rezervă libere» (§979; the owner, 2026-11-18: «trebuie sa pot selecta din acele BIB-uri goale (de rezerva) care
 * momentan sunt intre 155 si 163, trebuie sa si afisez undeva asta»): where one event's desk spares (§444) stand, as the
 * desk and the walk-in's form say it — none reserved, every one given, or the free ones, each as the event's bibs print it.
 */
export type SpareLine =
  | { kind: "none" }
  | { kind: "out" }
  | { kind: "free"; count: number; numbers: string; options: ReadonlyArray<{ number: number; label: string }> };

/**
 * Each event's line, by id: the free spares lowest first (`freeSpareBibNumbers`, the reader the spares sheet and the desk's
 * suggestion use) and the event's own way of writing a number (`RACE_NUMBER_FORMAT`). One read of the events, one call a
 * spare band — the desk shows one event, the walk-in's form the few that take entries.
 */
export async function readSpareLines<T extends Record<string, unknown>>(db: Database<T>, eventIds: readonly string[]): Promise<Record<string, SpareLine>> {
  const unique = [...new Set(eventIds)];
  if (unique.length === 0) return {};
  const formats = await db
    .select({ id: events.id, format: RACE_NUMBER_FORMAT })
    .from(events)
    .where(unique.length === 1 ? eq(events.id, unique[0]) : inArray(events.id, unique));
  const formatOf = new Map<string, RaceNumberFormat>(formats.map((row) => [row.id, row.format]));
  const entries = await Promise.all(
    unique.map(async (eventId): Promise<[string, SpareLine]> => {
      const { band, free } = await freeSpareBibNumbers(db, eventId);
      if (!band) return [eventId, { kind: "none" }];
      if (free.length === 0) return [eventId, { kind: "out" }];
      const write = (number: number) => formatRaceNumber(number, formatOf.get(eventId));
      return [eventId, { kind: "free", count: free.length, numbers: spareRunsText(free, write), options: free.map((number) => ({ number, label: write(number) })) }];
    }),
  );
  return Object.fromEntries(entries);
}

/** The line in words, in the page's language: «Numere de rezervă libere (9): 155–163», or why there are none. */
export async function spareLineWords(line: SpareLine, locale: string): Promise<string> {
  const t = await getTranslations("Admin");
  if (line.kind === "none") return t("desk.spares.none");
  if (line.kind === "out") return t("desk.sparesOut");
  return t(`desk.spares.free.${countForm(line.count, locale)}`, { count: String(line.count), numbers: line.numbers });
}
