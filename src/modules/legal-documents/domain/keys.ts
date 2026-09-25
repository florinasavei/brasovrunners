import type { LegalDocumentKey } from "@/db/schema/legal-documents";

/**
 * Every legal document key, in the order the backoffice lists them (§NNN): the three a
 * registration rests on (BR-REQ-053-01), then the group runs' two optional self-declarations.
 *
 * Written out here rather than read off the enum, so a client component (the legal editor's
 * select) can import the list without the database schema; `tests/unit/legal-documents/keys.test.ts`
 * holds it equal to the enum, value for value and in order.
 */
export const LEGAL_DOCUMENT_KEYS = [
  "PRIVACY_NOTICE",
  "TERMS",
  "EVENT_DECLARATION",
  "GROUP_RUN_DECLARATION_ASPHALT",
  "GROUP_RUN_DECLARATION_TRAIL",
] as const satisfies readonly LegalDocumentKey[];

/** The three texts a registration cannot go without (BR-REQ-053-01) — what "the platform's texts, in one press" approves (§132). */
export const REGISTRATION_LEGAL_KEYS = ["PRIVACY_NOTICE", "TERMS", "EVENT_DECLARATION"] as const satisfies readonly LegalDocumentKey[];

/**
 * The two optional self-declarations of a group run (§NNN), by the surface they are written for.
 * They gate nothing: no registration asks for them, and no registration is refused without them.
 */
export const GROUP_RUN_DECLARATION_KEYS = ["GROUP_RUN_DECLARATION_ASPHALT", "GROUP_RUN_DECLARATION_TRAIL"] as const satisfies readonly LegalDocumentKey[];
export type GroupRunDeclarationKey = (typeof GROUP_RUN_DECLARATION_KEYS)[number];

export function isGroupRunDeclarationKey(key: string): key is GroupRunDeclarationKey {
  return (GROUP_RUN_DECLARATION_KEYS as readonly string[]).includes(key);
}

/**
 * Which declaration a group run may offer, by what it is run on (§NNN): asphalt's or the trail's.
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
 * The declaration an event offers right now, or null (§NNN): a group run on asphalt or trail whose
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
