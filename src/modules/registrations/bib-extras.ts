import { getTranslations } from "next-intl/server";
import type { RouteGpx } from "@/modules/events/domain/route-gpx";
import { getStorage } from "@/modules/media/storage";
import type { BibDesign } from "./bib-design";
import { type BibProfileDrawing, bibProfileDrawing, parseGpxProfile } from "./bib-profile";

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
};

/** The event's facts the profile reads: its GPX, and the figures the club may have typed (they win). */
export type BibProfileSource = {
  routeGpx: RouteGpx | null;
  distanceMeters: number | null;
  elevationGainMeters: number | null;
};

export async function loadBibExtras(
  event: BibProfileSource,
  design: Pick<BibDesign, "showProfile" | "showEmergency">,
  locale: string,
): Promise<BibExtras> {
  if (!design.showProfile && !design.showEmergency) return { profile: null, emergencyLabel: "" };
  const admin = await getTranslations({ locale, namespace: "Admin" });
  let profile: BibProfileDrawing | null = null;
  if (design.showProfile && event.routeGpx) {
    try {
      const bytes = await getStorage().get(event.routeGpx.key);
      const parsed = bytes ? parseGpxProfile(new TextDecoder().decode(bytes)) : null;
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
  return { profile, emergencyLabel: design.showEmergency ? admin("bibs.emergencyLabel") : "" };
}
