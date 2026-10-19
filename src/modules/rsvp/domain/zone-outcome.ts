/**
 * What the members' zone says after a press on «Vin!» or «Nu mai vin» (§822): one language-neutral code in the address (`?vin=`),
 * which the page turns into a sentence — the shop's way (`content/shop/zone-outcome.ts`), so a refresh or a shared link carries
 * nothing of the person's. Kept out of the actions' module because a "use server" file may export only async functions.
 *
 *   went    the answer is counted.
 *   left    the answer was taken back.
 *   closed  the event no longer takes answers (it started, was cancelled, was unticked, or the notice stopped describing «Vin!»).
 *
 * And the name tick «Numele meu apare la „Cine vine"» (§827): `shown` and `hidden` say what the person did; `name` that ticking needed a name
 * and there was none; `none` that no answer of this account was found (a stale page). Their sentences are the event page's (`Event.rsvp.nameOutcome`).
 */
export const ZONE_RSVP_OUTCOMES = ["went", "left", "closed", "shown", "hidden", "name", "none"] as const;
export type ZoneRsvpOutcome = (typeof ZONE_RSVP_OUTCOMES)[number];

export function parseZoneRsvpOutcome(value: string | string[] | undefined): ZoneRsvpOutcome | null {
  const one = Array.isArray(value) ? value[0] : value;
  return (ZONE_RSVP_OUTCOMES as readonly string[]).includes(one ?? "") ? (one as ZoneRsvpOutcome) : null;
}

/**
 * Outcomes that are a refusal, said as a warning at the top of the list rather than at the row: the row either is gone (`closed`) or has
 * nothing new to show (`name`, `none`), so the sentence is what the person came back for.
 */
export function isRefusedZoneOutcome(outcome: ZoneRsvpOutcome): boolean {
  return outcome === "closed" || outcome === "name" || outcome === "none";
}

/** The outcomes whose sentence is the event page's own (`Event.rsvp.nameOutcome.*`): the name tick's. */
export function isNameZoneOutcome(outcome: ZoneRsvpOutcome): outcome is "shown" | "hidden" | "name" | "none" {
  return outcome === "shown" || outcome === "hidden" || outcome === "name" || outcome === "none";
}

/** The anchor of an event's row in the zone: where a press lands again, so the phone's page does not jump to the top. */
export const zoneRsvpAnchor = (eventId: string) => `vin-${eventId}`;

/** The id of a run's title link: the name of the row's forms, so a screen reader's list of forms says which run each «Vin!» belongs to. */
export const zoneRsvpTitleId = (eventId: string) => `vin-title-${eventId}`;

/** Where a refused press lands: the run is no longer offered, so its row (the anchor above) is gone and the sentence is what is left to find. */
export const ZONE_RSVP_OUTCOME_ANCHOR = "vin-outcome";
