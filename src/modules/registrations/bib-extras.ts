import { getTranslations } from "next-intl/server";
import type { RouteGpx } from "@/modules/events/domain/route-gpx";
import { getStorage } from "@/modules/media/storage";
import { type BibDesign, bibDistanceBadge } from "./bib-design";
import { type BibProfile, type BibProfileDrawing, bibProfileDrawing, parseGpxProfile } from "./bib-profile";

/**
 * What a race number prints beyond the design's own switches, read once per request (§NNN): the
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
  /** «Urgențe» / "Emergency": the word before the phone, in the picture's language; empty while the tick is off. */
  emergencyLabel: string;
  /** «21K»: the event's distance for the header's badge (§NNN); null while the tick is off or the event has no distance. */
  distanceBadge: string | null;
};

/** The event's facts the profile reads: its GPX, and the figures the club may have typed (they win). */
export type BibProfileSource = {
  routeGpx: RouteGpx | null;
  distanceMeters: number | null;
  elevationGainMeters: number | null;
};

/**
 * The parsed profiles by the GPX's store key (§NNN): a new upload gets a new key, so an entry never goes
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
  design: Pick<BibDesign, "showProfile" | "showEmergency" | "showDistance">,
  locale: string,
): Promise<BibExtras> {
  const distanceBadge = design.showDistance ? bibDistanceBadge(event.distanceMeters) : null;
  if (!design.showProfile && !design.showEmergency) return { profile: null, emergencyLabel: "", distanceBadge };
  const admin = await getTranslations({ locale, namespace: "Admin" });
  let profile: BibProfileDrawing | null = null;
  if (design.showProfile && event.routeGpx) {
    try {
      const parsed = await profileOf(event.routeGpx.key);
      if (parsed) {
        profile = bibProfileDrawing(parsed, event, locale, (key, values) =>
          key === "start"
            ? admin("bibs.profileStart")
            : key === "finish"
              ? admin("bibs.profileFinish")
              : key === "distance"
                ? admin("bibs.profileDistance", { km: values?.km ?? "" })
                : admin("bibs.profileGain", { m: values?.m ?? "" }),
        );
      }
    } catch {
      profile = null;
    }
  }
  return { profile, emergencyLabel: design.showEmergency ? admin("bibs.emergencyLabel") : "", distanceBadge };
}
