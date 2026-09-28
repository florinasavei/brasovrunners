import type { LegalDocumentKey } from "@/db/schema/legal-documents";

/**
 * Every legal key in backoffice order (§393, §515). Written out rather than read off the enum so
 * client components need not import the schema; `tests/unit/legal-documents/group-run-declaration.test.ts`
 * holds it equal to the enum.
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
 * The texts a registration requires (BR-REQ-053-01). Only the trail declaration: every race falls
 * back to it (`raceDeclarationKeysFor`), so the road one (§515) is optional.
 */
export const REGISTRATION_LEGAL_KEYS = ["PRIVACY_NOTICE", "TERMS", "EVENT_DECLARATION"] as const satisfies readonly LegalDocumentKey[];

/**
 * What «Aprobă textele platformei» approves in one press: the whole catalogue (§132, §515). A group
 * run's text is then only available; the organizer's tick offers it (§393). Screens count this list.
 */
export const PLATFORM_APPROVAL_KEYS = LEGAL_DOCUMENT_KEYS;

/**
 * The race's two declarations, one shared body with a risk section per course (§515,
 * `RACE_DECLARATION_PARTS`). `EVENT_DECLARATION` is trail — the key older acceptances were recorded
 * under — and `EVENT_DECLARATION_ROAD` road or park.
 */
export const RACE_DECLARATION_KEYS = ["EVENT_DECLARATION", "EVENT_DECLARATION_ROAD"] as const satisfies readonly LegalDocumentKey[];
export type RaceDeclarationKey = (typeof RACE_DECLARATION_KEYS)[number];

export function isRaceDeclarationKey(key: string | null | undefined): key is RaceDeclarationKey {
  return (RACE_DECLARATION_KEYS as readonly string[]).includes(key ?? "");
}

/**
 * The declaration keys a race's participant may sign, most wanted first (§515): the organizer's
 * chosen key, else the road text on asphalt and the trail text otherwise. Road falls back to trail
 * while no road text is approved; trail never falls back to road, which omits the mountain's risks.
 */
export function raceDeclarationKeysFor(event: { surface: string | null; chosenKey?: string | null }): readonly RaceDeclarationKey[] {
  const key: RaceDeclarationKey = isRaceDeclarationKey(event.chosenKey)
    ? event.chosenKey
    : event.surface === "ASPHALT"
      ? "EVENT_DECLARATION_ROAD"
      : "EVENT_DECLARATION";
  return key === "EVENT_DECLARATION_ROAD" ? ["EVENT_DECLARATION_ROAD", "EVENT_DECLARATION"] : ["EVENT_DECLARATION"];
}

/** An approved race-declaration version as the editor lists it. */
export type RaceDeclarationChoice = { id: string; key: RaceDeclarationKey; version: number; effectiveAt?: Date };

/**
 * The editor's starting declaration for a race with none chosen (§515): the newest version in force
 * of the first kind `raceDeclarationKeysFor` names, or null («Niciuna»; the save refuses, §39).
 * Never replaces a saved choice.
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
 * The kind the course calls for when the chosen one differs (§515); null when they agree, when the
 * course's kind has no approved version (the fallback is not a mistake) or the course is unstated.
 * A note, never a refusal.
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

/** A group run's two optional self-declarations by surface (§393); they gate nothing. */
export const GROUP_RUN_DECLARATION_KEYS = ["GROUP_RUN_DECLARATION_ASPHALT", "GROUP_RUN_DECLARATION_TRAIL"] as const satisfies readonly LegalDocumentKey[];
export type GroupRunDeclarationKey = (typeof GROUP_RUN_DECLARATION_KEYS)[number];

/** Only a group run on asphalt or trail has one (§393): the texts name the surface's risks. */
export function groupRunDeclarationKeyFor(event: { type: string; surface: string | null }): GroupRunDeclarationKey | null {
  if (event.type !== "GROUP_RUN") return null;
  if (event.surface === "ASPHALT") return "GROUP_RUN_DECLARATION_ASPHALT";
  if (event.surface === "TRAIL") return "GROUP_RUN_DECLARATION_TRAIL";
  return null;
}

/** The declaration offered when the organizer ticked the box (§393); the caller checks one is in force. */
export function offeredGroupRunDeclarationKey(event: {
  type: string;
  surface: string | null;
  offersGroupRunDeclaration: boolean;
}): GroupRunDeclarationKey | null {
  return event.offersGroupRunDeclaration ? groupRunDeclarationKeyFor(event) : null;
}
