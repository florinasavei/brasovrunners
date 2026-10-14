import { getTranslations } from "next-intl/server";
import type { Database } from "@/db/types";
import { listCheckpoints } from "@/modules/event-checkpoints/checkpoints";
import type { RouteGpx } from "@/modules/events/domain/route-gpx";
import { getStorage } from "@/modules/media/storage";
import { type BibDesign, bibDistanceBadge } from "./bib-design";
import { type BibCheckpointSource, bibCheckpointMarks } from "./bib-checkpoints";
import { bibProfileChartWidth } from "./bib-geometry";
import {
  type BibProfile,
  type BibProfileDrawing,
  type BibProfileFigureLines,
  type BibProfileSay,
  bibProfileDrawing,
  bibProfileFigures,
  bibProfileFigureWords,
  parseGpxProfile,
} from "./bib-profile";

/**
 * What a race number prints beyond the design's own switches, read once per request (§750): the
 * route's profile with its words — from the event's route GPX in the site's store (§718), only when
 * the design asks for it and the event has one — and the word before the emergency phone.
 *
 * Both routes that draw a number (the sheet and the picture) call this and hand the answer to the
 * renderer, which stays pure over its inputs: a store that is slow or a file that is not readable is
 * `null` here, and the number prints as it does without a profile, never a failed sheet — the rule
 * every picture of the design follows (`bib-pictures.ts`). The GPX is read once and reduced to a few
 * dozen points (`bib-profile.ts`), never carried whole.
 */
export type BibExtras = {
  profile: BibProfileDrawing | null;
  /**
   * The figures beside the club's picture of the profile (§759, «O poză încărcată»): the event's typed
   * distance and gain, else the GPX's, in the sheet's language; null when neither is known or the club
   * turned them off — then the picture takes the strip's whole width.
   */
  profileFigures: BibProfileFigureLines | null;
  /** «Urgențe» / "Emergency": the word before the phone when the club typed none (§759), in the picture's language; empty while the tick is off. */
  emergencyLabel: string;
  /** «21K»: the event's distance for the header's badge (§750); null while the tick is off or the event has no distance. */
  distanceBadge: string | null;
};

/** The event's facts the profile reads: its GPX, and the figures the club may have typed (they win). */
export type BibProfileSource = {
  routeGpx: RouteGpx | null;
  distanceMeters: number | null;
  elevationGainMeters: number | null;
  /**
   * The route's checkpoints (§757), read by the caller only when the design asks for the profile and
   * for them (`bibNeedsCheckpoints`); absent draws the strip as it was.
   */
  checkpoints?: readonly BibCheckpointSource[];
};

/**
 * Whether a design's strip carries the checkpoints, so a caller reads them from the database only then:
 * a profile drawn from the GPX — never the club's picture of it (§759) — with the tick on.
 */
export function bibNeedsCheckpoints(design: Pick<BibDesign, "showProfile" | "showCheckpoints"> & Partial<Pick<BibDesign, "profileSource">>): boolean {
  return design.showProfile && design.showCheckpoints && design.profileSource !== "picture";
}

/**
 * The event's profile source with its checkpoints (§757), for the routes that draw a number: read from
 * the database only when the design ticks the profile and the checkpoints and the event has a route
 * to draw them on, one query — otherwise the source as it was.
 */
export async function withBibCheckpoints<T extends Record<string, unknown>, E extends BibProfileSource>(
  db: Database<T>,
  eventId: string,
  event: E,
  design: Pick<BibDesign, "showProfile" | "showCheckpoints"> & Partial<Pick<BibDesign, "profileSource">>,
): Promise<E> {
  if (!bibNeedsCheckpoints(design) || !event.routeGpx) return event;
  return { ...event, checkpoints: await listCheckpoints(db, eventId) };
}

/**
 * The parsed profiles by the GPX's store key (§750): a new upload gets a new key, so an entry never goes
 * stale, and the 64 points are small. Without it every picture on the bibs page and the desk, and
 * every redraw of the editor's preview, downloaded the whole file (up to 4 MB) and parsed it again.
 * Only an answer is kept — a file that was read, with or without a profile in it — never a failed read,
 * which may be the store's bad moment. Oldest out beyond `PROFILE_CACHE_SIZE`.
 */
const PROFILE_CACHE_SIZE = 16;
const profileCache = new Map<string, BibProfile | null>();

/** Forgets every cached profile — for the tests, which count the store's reads. */
export function clearBibProfileCache(): void {
  profileCache.clear();
}

async function profileOf(key: string): Promise<BibProfile | null> {
  if (profileCache.has(key)) {
    const kept = profileCache.get(key) ?? null;
    // Most recently used goes last.
    profileCache.delete(key);
    profileCache.set(key, kept);
    return kept;
  }
  const bytes = await getStorage().get(key);
  if (!bytes) return null;
  const parsed = parseGpxProfile(new TextDecoder().decode(bytes));
  profileCache.set(key, parsed);
  if (profileCache.size > PROFILE_CACHE_SIZE) profileCache.delete(profileCache.keys().next().value as string);
  return parsed;
}

export async function loadBibExtras(
  event: BibProfileSource,
  design: Pick<BibDesign, "showProfile" | "showEmergency" | "showDistance"> &
    Partial<Pick<BibDesign, "showCheckpoints" | "showCheckpointTimes" | "profileSource" | "showProfileFigures">>,
  locale: string,
): Promise<BibExtras> {
  const distanceBadge = design.showDistance ? bibDistanceBadge(event.distanceMeters) : null;
  if (!design.showProfile && !design.showEmergency) return { profile: null, profileFigures: null, emergencyLabel: "", distanceBadge };
  const admin = await getTranslations({ locale, namespace: "Admin" });
  const say: BibProfileSay = (key, values) =>
    key === "start"
      ? admin("bibs.profileStart")
      : key === "finish"
        ? admin("bibs.profileFinish")
        : key === "distance"
          ? admin("bibs.profileDistance", { km: values?.km ?? "" })
          : admin("bibs.profileGain", { m: values?.m ?? "" });
  let profile: BibProfileDrawing | null = null;
  let profileFigures: BibProfileFigureLines | null = null;
  /*
    «O poză încărcată» (§759): no line to draw, only the figures beside the picture, while the club wants
    them — the event's own first (§750), the GPX's filling what it left empty when there is a GPX.
  */
  if (design.showProfile && design.profileSource === "picture") {
    if (design.showProfileFigures !== false) {
      let parsed: BibProfile | null = null;
      if (event.routeGpx) {
        try {
          parsed = await profileOf(event.routeGpx.key);
        } catch {
          parsed = null;
        }
      }
      const figures = parsed
        ? bibProfileFigures(parsed, event)
        : { distanceMeters: event.distanceMeters ?? null, gainMeters: event.elevationGainMeters ?? null };
      const words = bibProfileFigureWords(figures, locale, say);
      profileFigures = words.distance !== null || words.gain !== null ? words : null;
    }
    return { profile: null, profileFigures, emergencyLabel: design.showEmergency ? admin("bibs.emergencyLabel") : "", distanceBadge };
  }
  if (design.showProfile && event.routeGpx) {
    try {
      const parsed = await profileOf(event.routeGpx.key);
      if (parsed) {
        const drawing = bibProfileDrawing(parsed, event, locale, say);
        // The route's checkpoints (§757) on the strip, where the design asks and the event has some:
        // placed by the figure the bib prints, the club's own distance first, as the strip's right end is;
        // «km 12» in the sheet's language, «km 12 · 11:30» with «…cu orele limită».
        const kmWords = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });
        const marks =
          design.showCheckpoints !== false && event.checkpoints && event.checkpoints.length > 0
            ? bibCheckpointMarks({
                checkpoints: event.checkpoints,
                routeKm: bibProfileFigures(parsed, event).distanceMeters / 1000,
                points: parsed.points,
                // Measured in the chart's own width: the whole strip with the figures off (§759).
                chartWidth: bibProfileChartWidth(design.showProfileFigures !== false),
                showTimes: design.showCheckpointTimes === true,
                startWord: drawing.start,
                finishWord: drawing.finish,
                label: (row, withTime) =>
                  withTime && row.cutoffClock
                    ? admin("bibs.checkpointKmTime", { km: kmWords.format(row.km), time: row.cutoffClock })
                    : admin("bibs.checkpointKm", { km: kmWords.format(row.km) }),
              })
            : null;
        profile = { ...drawing, checkpoints: marks };
      }
    } catch {
      profile = null;
    }
  }
  return { profile, profileFigures: null, emergencyLabel: design.showEmergency ? admin("bibs.emergencyLabel") : "", distanceBadge };
}
