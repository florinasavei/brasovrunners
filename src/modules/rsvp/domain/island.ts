import type { PersonHint } from "@/modules/person-session/domain/hint";

/**
 * The island's pure rules (§NNN, «Vin!» part 1), outside the client file so a test reads them without a browser.
 *
 * Who the one-tap state says it answers as: the masked address, with the name the person gave before it —
 * «Ana · an…@gmail.com». Never the full address (the hint holds none).
 */
export function rememberedHeading(hint: PersonHint): string {
  return hint.name ? `${hint.name} · ${hint.masked}` : hint.masked;
}
