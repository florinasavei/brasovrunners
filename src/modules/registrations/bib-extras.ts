import { getTranslations } from "next-intl/server";
import type { Database } from "@/db/types";
import { listCheckpoints } from "@/modules/event-checkpoints/checkpoints";
import type { RouteGpx } from "@/modules/events/domain/route-gpx";
import { readRouteElevation } from "@/modules/routes/elevation/read";
import type { ElevationProfileData } from "@/modules/routes/elevation/parse";
import { type BibDesign, bibDistanceBadge } from "./bib-design";
import { type BibCheckpointSource, bibStripCheckpoints } from "./bib-checkpoints";
import {
  type BibProfileDrawing,
  type BibProfileFigureLines,
  type BibProfileSay,
  bibProfileDrawing,
  bibProfileFigures,
  bibProfileFigureWords,
} from "./bib-profile";

/**
 * What a race number prints beyond the design's own switches, read once per request (§750): the
 * route's profile with its words — from the event's route GPX in the site's store (§718), only when
 * the design asks for it and the event has one — and the word before the emergency phone.
 *
 * Both routes that draw a number (the sheet and the picture) call this and hand the answer to the
 * renderer, which stays pure over its inputs: a store that is slow or a file that is not readable is
 * `null` here, and the number prints as it does without a profile, never a failed sheet — the rule
 * every picture of the design follows (`bib-pictures.ts`). The GPX is read once by the elevation core's reader
 * (`routes/elevation/read.ts`, §NNN — the one the event page and the editor's preview read through, with its own
 * small cache by the file's store key) and reduced to a few hundred points, never carried whole.
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

/** The route's profile by the core's reader, or null: a file with no profile in it, no store, or a store that failed — the number prints without it. */
async function profileOf(key: string): Promise<ElevationProfileData | null> {
  try {
    return await readRouteElevation(key);
  } catch {
    return null;
  }
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
        : key === "kmUnit"
          ? admin("bibs.profileKmUnit")
          : key === "altitudeUnit"
            ? admin("bibs.profileAltitudeUnit")
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
      const parsed = event.routeGpx ? await profileOf(event.routeGpx.key) : null;
      const figures = parsed
        ? bibProfileFigures(parsed, event)
        : { distanceMeters: event.distanceMeters ?? null, gainMeters: event.elevationGainMeters ?? null };
      const words = bibProfileFigureWords(figures, locale, say);
      profileFigures = words.distance !== null || words.gain !== null ? words : null;
    }
    return { profile: null, profileFigures, emergencyLabel: design.showEmergency ? admin("bibs.emergencyLabel") : "", distanceBadge };
  }
  if (design.showProfile && event.routeGpx) {
    const parsed = await profileOf(event.routeGpx.key);
    if (parsed) {
      const drawing = bibProfileDrawing(parsed, event, locale, say);
      // The route's checkpoints (§757) on the strip, where the design asks and the event has some: the ones the club left ticked
      // «Arată pe profilul traseului» (§NNN), placed by the figure the bib prints — the club's own distance first, as the strip's
      // right end is — each with its words in the sheet's language: «km 12», «km 5 · apă», and with the cut-off «km 12 · 11:30».
      const kmWords = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });
      const checkpoints =
        design.showCheckpoints !== false && event.checkpoints && event.checkpoints.length > 0
          ? bibStripCheckpoints(event.checkpoints, drawing.distanceMeters, {
              km: (km) => admin("bibs.checkpointKm", { km: kmWords.format(km) }),
              kmWater: (km) => admin("bibs.checkpointKmWater", { km: kmWords.format(km) }),
              kmFood: (km) => admin("bibs.checkpointKmFood", { km: kmWords.format(km) }),
              kmBoth: (km) => admin("bibs.checkpointKmBoth", { km: kmWords.format(km) }),
              kmTime: (km, clock) => admin("bibs.checkpointKmTime", { km: kmWords.format(km), time: clock }),
            })
          : [];
      profile = { ...drawing, checkpoints };
    }
  }
  return { profile, profileFigures: null, emergencyLabel: design.showEmergency ? admin("bibs.emergencyLabel") : "", distanceBadge };
}
