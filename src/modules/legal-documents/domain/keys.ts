import type { LegalDocumentKey } from "@/db/schema/legal-documents";

/**
 * Every legal document key, in the order the backoffice lists them (§393): the three a
 * registration rests on (BR-REQ-053-01) with the road race's declaration beside the trail one
 * (§NNN), then the group runs' two optional self-declarations.
 *
 * Written out here rather than read off the enum, so a client component (the legal editor's
 * select) can import the list without the database schema; `tests/unit/legal-documents/group-run-declaration.test.ts`
 * holds it equal to the enum, value for value and in order.
 */
export const LEGAL_DOCUMENT_KEYS = [
  "PRIVACY_NOTICE",
  "TERMS",
  "EVENT_DECLARATION",
  "EVENT_DECLARATION_ROAD",
  "GROUP_RUN_DECLARATION_ASPHALT",
  "GROUP_RUN_DECLARATION_TRAIL",
] as const satisfies readonly LegalDocumentKey[];

/**
 * The three texts a registration cannot go without (BR-REQ-053-01). The declaration among them is the
 * trail one, `EVENT_DECLARATION`: it is the text every race falls back to (`raceDeclarationKeysFor`),
 * so with it in force no race is without a declaration; the road one (§NNN) is wanted but not
 * required — until it is approved, a road race signs the trail text, as every race did before it
 * existed. The one press approves both (`PLATFORM_APPROVAL_KEYS`).
 */
export const REGISTRATION_LEGAL_KEYS = ["PRIVACY_NOTICE", "TERMS", "EVENT_DECLARATION"] as const satisfies readonly LegalDocumentKey[];

/**
 * What «Aprobă textele platformei» on `/admin/legal` creates and approves in one press (§132,
 * §NNN): the three a registration rests on and the road race's declaration beside the trail one, so
 * a club that takes the platform's texts has both kinds of race covered from the same press. The
 * group runs' two self-declarations stay out — they are optional, and a club offers them one by
 * one. The page and its messages count this list; no sentence says a number of its own.
 */
export const PLATFORM_APPROVAL_KEYS = [...REGISTRATION_LEGAL_KEYS, "EVENT_DECLARATION_ROAD"] as const satisfies readonly LegalDocumentKey[];

/**
 * The race's two declarations (§NNN; the owner's review of 2026-09-27: "Două tipuri:
 * `event_declaration_trail`, `event_declaration_road`"), built from one shared body with a risk
 * section per course (`templates/declaration.ts`, `RACE_DECLARATION_PARTS`). `EVENT_DECLARATION` is the trail one — the
 * key every signature so far was recorded under, kept so that no recorded acceptance changes
 * meaning — and `EVENT_DECLARATION_ROAD` the road or park one.
 */
export const RACE_DECLARATION_KEYS = ["EVENT_DECLARATION", "EVENT_DECLARATION_ROAD"] as const satisfies readonly LegalDocumentKey[];
export type RaceDeclarationKey = (typeof RACE_DECLARATION_KEYS)[number];

export function isRaceDeclarationKey(key: string | null | undefined): key is RaceDeclarationKey {
  return (RACE_DECLARATION_KEYS as readonly string[]).includes(key ?? "");
}

/**
 * Which of the two declarations a race's participant signs (§NNN), most wanted first — the text in
 * force of the first key that has one is the text, and the caller stops there.
 *
 * - The organizer's choice decides: the version picked in «Declarația pe propria răspundere»
 *   (`events.declaration_document_id`) names its key, trail or road.
 * - With nothing picked, the course decides: asphalt reads the road text; a trail, a mixed course or
 *   an unstated one the trail text, whose risks are the wider set.
 * - The road text falls back to the trail one while the club has approved no road text: that is what
 *   every race signed before the road text existed, it is the club's own approved words, and a road
 *   race is never left with nothing to sign. The trail text never falls back to the road one — the
 *   road text leaves out the mountain's risks, and a trail runner must read them.
 */
export function raceDeclarationKeysFor(event: { surface: string | null; chosenKey?: string | null }): readonly RaceDeclarationKey[] {
  const key: RaceDeclarationKey = isRaceDeclarationKey(event.chosenKey)
    ? event.chosenKey
    : event.surface === "ASPHALT"
      ? "EVENT_DECLARATION_ROAD"
      : "EVENT_DECLARATION";
  return key === "EVENT_DECLARATION_ROAD" ? ["EVENT_DECLARATION_ROAD", "EVENT_DECLARATION"] : ["EVENT_DECLARATION"];
}

/** An approved race-declaration version as the editor lists it: its kind, its number, when it took effect. */
export type RaceDeclarationChoice = { id: string; key: RaceDeclarationKey; version: number; effectiveAt?: Date };

/**
 * The version the editor's «Declarația pe care o semnează participantul» starts on for a race with
 * no declaration chosen yet (§NNN) — a new race, or a saved one that never had one: the newest
 * version **in force** (approved, not withdrawn, `effectiveAt` reached) of the kind its course
 * reads (`raceDeclarationKeysFor`), so an asphalt race starts on the road text once the club has
 * approved one and on the trail text until then. Null when nothing of either usable kind is in
 * force — the select then starts on «Niciuna» and the save's refusal (§39) says why.
 *
 * Only a start: the organizer may pick the other kind, and a saved choice is never replaced — an
 * existing race keeps the version it names, and the card says when that kind does not match the
 * course (`declarationKindMismatch`).
 */
export function preselectedRaceDeclaration<C extends RaceDeclarationChoice>(
  choices: readonly C[],
  surface: string | null,
  now: Date,
): C | null {
  for (const key of raceDeclarationKeysFor({ surface })) {
    const inForce = choices
      .filter((choice) => choice.key === key && (choice.effectiveAt === undefined || choice.effectiveAt.getTime() <= now.getTime()))
      .sort((a, b) => b.version - a.version)[0];
    if (inForce) return inForce;
  }
  return null;
}

/**
 * The kind a race's course calls for when the kind chosen is the other one (§NNN), or null when
 * they agree — or when the course's own kind has no approved version to switch to (an asphalt race
 * on the trail text while no road text exists is the fallback, not a mistake), or when the course
 * is not stated. The card's note under the select; never a refusal: the organizer knows the course.
 */
export function declarationKindMismatch(
  chosenKey: RaceDeclarationKey | null,
  surface: string | null,
  choices: readonly Pick<RaceDeclarationChoice, "key">[],
): RaceDeclarationKey | null {
  if (chosenKey === null || !surface) return null;
  const wanted = raceDeclarationKeysFor({ surface })[0];
  if (wanted === chosenKey) return null;
  return choices.some((choice) => choice.key === wanted) ? wanted : null;
}

/**
 * The two optional self-declarations of a group run (§393), by the surface they are written for.
 * They gate nothing: no registration asks for them, and no registration is refused without them.
 */
export const GROUP_RUN_DECLARATION_KEYS = ["GROUP_RUN_DECLARATION_ASPHALT", "GROUP_RUN_DECLARATION_TRAIL"] as const satisfies readonly LegalDocumentKey[];
export type GroupRunDeclarationKey = (typeof GROUP_RUN_DECLARATION_KEYS)[number];

/**
 * Which declaration a group run may offer, by what it is run on (§393): asphalt's or the trail's.
 * Anything else — a race, a hike, a mixed or unstated surface — has none: the risks the two texts
 * name are the surface's, and a mixed route would need a third text nobody has written.
 */
export function groupRunDeclarationKeyFor(event: { type: string; surface: string | null }): GroupRunDeclarationKey | null {
  if (event.type !== "GROUP_RUN") return null;
  if (event.surface === "ASPHALT") return "GROUP_RUN_DECLARATION_ASPHALT";
  if (event.surface === "TRAIL") return "GROUP_RUN_DECLARATION_TRAIL";
  return null;
}

/**
 * The declaration an event offers right now, or null (§393): a group run on asphalt or trail whose
 * organizer ticked "Declarație opțională pe propria răspundere". Whether the club has an approved
 * version of that kind in force is the caller's second question — without one there is nothing to
 * sign, and the page shows nothing.
 */
export function offeredGroupRunDeclarationKey(event: {
  type: string;
  surface: string | null;
  offersGroupRunDeclaration: boolean;
}): GroupRunDeclarationKey | null {
  return event.offersGroupRunDeclaration ? groupRunDeclarationKeyFor(event) : null;
}
