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

/** What the island knows of the server's answer to its state read: `null` while the read is pending. */
type IslandServerState = { remembered: boolean; offered?: boolean } | null;

/**
 * Which of the island's two faces stands: `typed` (the form the server drew) or `onetap` («Răspunzi ca …»).
 *
 * A state that could not be READ (`readFailed`) falls back to the typed form, which works without anything the island knows. A PRESS that
 * failed does not: the person stays on the one-tap face, where the error alert says they may not be counted — swapping the island for
 * the typed form without a word would leave them unable to tell (the alert is `pressFailed`'s and never part of this decision).
 */
export function islandFace(input: { hasHint: boolean; readFailed: boolean; state: IslandServerState }): "typed" | "onetap" {
  if (!input.hasHint || input.readFailed) return "typed";
  if (input.state !== null && (!input.state.remembered || input.state.offered === false)) return "typed";
  return "onetap";
}
