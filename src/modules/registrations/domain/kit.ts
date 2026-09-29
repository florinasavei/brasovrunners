import type { RegistrationTshirtSize } from "@/db/schema/registrations";

/**
 * The race kit (§554): what the event hands its runners, ticked in the editor's «Kit de participare»
 * card (`events.kit_shirt`). For now one thing, the T-shirt — and the form asks its size only when
 * the event gives one.
 */

/** The sizes the form offers, in order, when the event gives a T-shirt; «Fără tricou» (`NONE`) before them. */
export const SHIRT_SIZES = ["XS", "S", "M", "L", "XL", "XXL"] as const satisfies readonly RegistrationTshirtSize[];

/**
 * What a registration stores for its T-shirt, under the event's lock (`service.ts`): the posted size
 * when the event gives a shirt, `NONE` otherwise — a size posted for an event without one (a form
 * rendered before the tick came off, a script) is ignored, never refused. `NONE` is what the schema
 * already stored for a form that asked nothing.
 */
export function shirtSizeKept(kitShirt: boolean, posted: RegistrationTshirtSize | null | undefined): RegistrationTshirtSize {
  return kitShirt && posted ? posted : "NONE";
}

/**
 * The size a screen or a file shows: only for an event that gives a shirt, and never `NONE` —
 * nothing for everything else, so a size left on a row from before the tick came off says nothing.
 */
export function shirtSizeShown(kitShirt: boolean, size: RegistrationTshirtSize | null | undefined): Exclude<RegistrationTshirtSize, "NONE"> | null {
  if (!kitShirt || !size || size === "NONE") return null;
  return size;
}
