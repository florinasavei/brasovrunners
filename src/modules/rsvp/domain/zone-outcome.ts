/**
 * What the members' zone says after a press on «Vin!» or «Nu mai vin» (§822): one language-neutral code in the address (`?vin=`),
 * which the page turns into a sentence — the shop's way (`content/shop/zone-outcome.ts`), so a refresh or a shared link carries
 * nothing of the person's. Kept out of the actions' module because a "use server" file may export only async functions.
 *
 *   went    the answer is counted.
 *   left    the answer was taken back.
 *   closed  the event no longer takes answers (it started, was cancelled, was unticked, or the notice stopped describing «Vin!»).
 */
export const ZONE_RSVP_OUTCOMES = ["went", "left", "closed"] as const;
export type ZoneRsvpOutcome = (typeof ZONE_RSVP_OUTCOMES)[number];

export function parseZoneRsvpOutcome(value: string | string[] | undefined): ZoneRsvpOutcome | null {
  const one = Array.isArray(value) ? value[0] : value;
  return (ZONE_RSVP_OUTCOMES as readonly string[]).includes(one ?? "") ? (one as ZoneRsvpOutcome) : null;
}

/** The anchor of an event's row in the zone: where a press lands again, so the phone's page does not jump to the top. */
export const zoneRsvpAnchor = (eventId: string) => `vin-${eventId}`;
