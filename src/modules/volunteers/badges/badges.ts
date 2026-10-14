import { and, asc, eq } from "drizzle-orm";
import { eventVolunteerRoles } from "@/db/schema/event-volunteers";
import { eventTranslations, events } from "@/db/schema/events";
import type { StaffUser } from "@/db/schema/staff-users";
import type { Database } from "@/db/types";
import { recordAuditEvent } from "@/modules/audit/repository";
import { bibEmergencyPhone } from "@/modules/registrations/bib-design";
import { canDesignVolunteerBadges } from "@/modules/staff-identity/domain/roles";
import { DomainError } from "@/shared/errors/domain-error";
import { isWrittenText, missingLanguage } from "@/shared/forms/both-languages";
import { isUuid } from "@/shared/ids";
import { compareRoles } from "../domain/volunteer";
import {
  type BadgeDesign,
  type BadgeLocale,
  badgeColourReadable,
  badgeDesignSchema,
  badgeRoleColour,
  readBadgeDesign,
} from "./badge-design";
import { BADGE_CUSTOM_BOUNDS, BADGE_SIZES } from "./badge-geometry";
import { BADGE_DESIGN_FORM_PREFIX, type BadgeDesignFormValues } from "./badge-query";

/**
 * The volunteer badges' reads and writes (§NNN): an event's badge design, its roles' band colours, and
 * the print's counts. Every write asserts `canDesignVolunteerBadges` here, whatever the page drew — the
 * Organizer, the Administrator and the Superadministrator (BR-REQ-060-01) — and is audited with the
 * club's own words only: a badge carries no person, and nothing here reads one.
 */

type Actor = Pick<StaffUser, "id" | "role">;

function assertMay(actor: Actor): void {
  if (!canDesignVolunteerBadges(actor.role)) {
    throw new DomainError("FORBIDDEN", `role ${actor.role} may not design volunteer badges`);
  }
}

/** One role as the badges read it: its names, how many it needs, its band's colour. */
export type BadgeRole = {
  id: string;
  nameRo: string;
  nameEn: string;
  needed: number;
  /** The colour as stored: a hex, or null for the club's orange. */
  colour: string | null;
  position: number;
  createdAt: Date;
};

/** An event's roles in the club's order (`compareRoles`, the volunteers' card's own). */
export async function listBadgeRoles<T extends Record<string, unknown>>(db: Database<T>, eventId: string): Promise<BadgeRole[]> {
  const rows = await db
    .select({
      id: eventVolunteerRoles.id,
      nameRo: eventVolunteerRoles.nameRo,
      nameEn: eventVolunteerRoles.nameEn,
      needed: eventVolunteerRoles.needed,
      colour: eventVolunteerRoles.colour,
      position: eventVolunteerRoles.position,
      createdAt: eventVolunteerRoles.createdAt,
    })
    .from(eventVolunteerRoles)
    .where(eq(eventVolunteerRoles.eventId, eventId));
  return rows.sort(compareRoles);
}

/** A role's name in the badge's language. */
export function badgeRoleName(role: Pick<BadgeRole, "nameRo" | "nameEn">, locale: BadgeLocale): string {
  return locale === "en" ? role.nameEn : role.nameRo;
}

/** The event as the badges read it: its title in the badge's language and its design. */
export async function findEventForBadges<T extends Record<string, unknown>>(
  db: Database<T>,
  eventId: string,
  locale: BadgeLocale,
): Promise<{ title: string; design: BadgeDesign } | undefined> {
  if (!isUuid(eventId)) return undefined;
  const [row] = await db
    .select({ title: eventTranslations.title, badgeDesign: events.badgeDesign })
    .from(events)
    .innerJoin(eventTranslations, and(eq(eventTranslations.eventId, events.id), eq(eventTranslations.locale, locale)))
    .where(eq(events.id, eventId))
    .limit(1);
  return row ? { title: row.title, design: readBadgeDesign(row.badgeDesign) } : undefined;
}

/** A form box's full name: what a refusal names, so the summary links to it. */
const box = (key: string) => `${BADGE_DESIGN_FORM_PREFIX}${key}`;

/**
 * The designer's post, held to the rules before it is kept — refused, never quietly changed, where the
 * club typed something that cannot print as typed:
 *
 * - «Altă dimensiune» needs a whole width and height in millimetres within `BADGE_CUSTOM_BOUNDS`;
 * - every text the club types is Romanian **and** English, or neither (§352): the short title, «VOLUNTAR»
 *   and the telephone's label, the empty side named;
 * - «Telefon coordonator» ticked needs a number written like one (the bib's own check, §750);
 * - the header band's colour must carry its words at AA (`BADGE_COLOUR_UNREADABLE`).
 *
 * Then the design is read through the one schema (`badgeDesignSchema`), so a stored design is exactly
 * what the readers accept.
 */
export function parseBadgeDesignPost(values: BadgeDesignFormValues): BadgeDesign {
  const invalid = (message: string, fields: string[]) => new DomainError("VALIDATION_ERROR", message, fields);
  if (!(BADGE_SIZES as readonly string[]).includes(values.size)) throw invalid("size: not one of the sizes", [box("size")]);
  if (values.size === "custom") {
    const within = (value: number, bounds: { min: number; max: number }) => Number.isInteger(value) && value >= bounds.min && value <= bounds.max;
    const wrong = [
      ...(within(values.customWidthMm, BADGE_CUSTOM_BOUNDS.width) ? [] : [box("customWidthMm")]),
      ...(within(values.customHeightMm, BADGE_CUSTOM_BOUNDS.height) ? [] : [box("customHeightMm")]),
    ];
    if (wrong.length > 0) throw invalid("the custom size is not whole millimetres within the bounds", wrong);
  }
  const pairs = [
    ["titleRo", "titleEn"],
    ["labelRo", "labelEn"],
    ["phoneLabelRo", "phoneLabelEn"],
  ] as const;
  const oneLanguage = pairs.flatMap(([ro, en]) => {
    const missing = missingLanguage({ ro: values[ro], en: values[en] }, isWrittenText);
    return missing ? [box(missing === "ro" ? ro : en)] : [];
  });
  if (oneLanguage.length > 0) throw invalid("a text is written in one language only; write it in both, or in neither", oneLanguage);
  // Whatever the tick says: a number typed and not readable as one is refused, never kept as nothing while the box is off.
  if ((values.showPhone || values.phone.trim() !== "") && bibEmergencyPhone(values.phone) === "") throw invalid("phone: not written like a telephone number", [box("phone")]);
  if (values.bandColour !== null && !badgeColourReadable(values.bandColour)) {
    throw new DomainError("BADGE_COLOUR_UNREADABLE", "the band's colour does not carry its words at AA", [box("bandColour")]);
  }
  const parsed = badgeDesignSchema.safeParse({
    ...values,
    customWidthMm: values.size === "custom" ? values.customWidthMm : Number.isFinite(values.customWidthMm) ? values.customWidthMm : undefined,
    customHeightMm: values.size === "custom" ? values.customHeightMm : Number.isFinite(values.customHeightMm) ? values.customHeightMm : undefined,
  });
  if (!parsed.success) throw invalid("the design could not be read", []);
  return parsed.data;
}

/**
 * «Salvează ecusonul»: the design kept on the event, audited with the names of the settings that changed
 * and the design before and after (the club's words, the coordinator's number and a picture's address — never a
 * volunteer's data). The same design saved again changes nothing and records nothing.
 */
export async function saveBadgeDesign<T extends Record<string, unknown>>(
  db: Database<T>,
  actor: Actor,
  eventId: string,
  values: BadgeDesignFormValues,
  now: Date,
): Promise<{ changed: boolean }> {
  assertMay(actor);
  if (!isUuid(eventId)) throw new DomainError("NOT_FOUND", "no such event");
  const design = parseBadgeDesignPost(values);
  // One transaction: the design and its audit row are kept together or not at all. The event's row is
  // read under NO KEY UPDATE (the volunteers' own lock, `volunteers.ts`), so two presses queue and the
  // second compares against the first's design, while a volunteer's sign-up — a KEY SHARE on the row —
  // is never blocked by it.
  return db.transaction(async (tx) => {
    const [row] = await tx.select({ badgeDesign: events.badgeDesign }).from(events).where(eq(events.id, eventId)).for("no key update").limit(1);
    if (!row) throw new DomainError("NOT_FOUND", "no such event");
    const before = readBadgeDesign(row.badgeDesign);
    const changedKeys = (Object.keys(design) as Array<keyof BadgeDesign>).filter((key) => JSON.stringify(design[key]) !== JSON.stringify(before[key]));
    // Nothing new — the platform's own design saved over a column still null included — writes nothing.
    if (changedKeys.length === 0) return { changed: false };
    const written = await tx.update(events).set({ badgeDesign: design }).where(eq(events.id, eventId)).returning({ id: events.id });
    if (written.length === 0) return { changed: false };
    await recordAuditEvent(tx, {
      actorStaffUserId: actor.id,
      action: "event.badge_design_changed",
      entityType: "event",
      entityId: eventId,
      metadata: { changed: changedKeys, from: before, to: design },
      now,
    });
    return { changed: true };
  });
}

/** What the colours' form posts for one role: the choice, and the colour typed beside «Altă culoare». */
export type PostedRoleColour = { roleId: string; choice: string; typed: string };

/** The choice that means «Altă culoare»: the colour typed beside it. */
export const TYPED_COLOUR = "typed";

/** The box names of one role's colour, as the form posts them and a refusal names them. */
export function roleColourBoxes(roleId: string): { choice: string; typed: string } {
  return { choice: `role.${roleId}.colour`, typed: `role.${roleId}.typedColour` };
}

/** A typed colour as kept: `#` and six hex digits, lower case — a missing `#` added — or null for nothing that reads as one. */
export function typedColour(raw: string): string | null {
  const text = raw.trim().toLowerCase();
  const withHash = text.startsWith("#") ? text : `#${text}`;
  return /^#[0-9a-f]{6}$/.test(withHash) ? withHash : null;
}

/**
 * «Salvează culorile»: each role's band colour — the club's orange (empty), one of the palette's, or a
 * colour typed in «Culoarea scrisă» (`postedRoleColour` says which wins) — refused when a typed colour is not a colour or would not carry its words
 * at AA, naming its box. Only the event's own roles are touched; a role of another event, or a removed
 * one, is refused as unknown. Each change is audited with the role's id and name, the colour from and to.
 */
export async function saveBadgeRoleColours<T extends Record<string, unknown>>(
  db: Database<T>,
  actor: Actor,
  eventId: string,
  posted: readonly PostedRoleColour[],
  now: Date,
): Promise<{ changed: number }> {
  assertMay(actor);
  if (!isUuid(eventId)) throw new DomainError("NOT_FOUND", "no such event");
  // One transaction: every role's colour and its audit row, or none of them. The locks in the volunteers'
  // order (`volunteers.ts`): the event's row first, NO KEY UPDATE, then its roles **in the order of their
  // ids** (`changeVolunteerRole`'s rule, which a sign-up and a hand entry keep too) — so two presses that
  // lock the same roles never wait on each other in a circle, whichever order the table scans them in.
  return db.transaction(async (tx) => {
    const [event] = await tx.select({ id: events.id }).from(events).where(eq(events.id, eventId)).for("no key update").limit(1);
    if (!event) throw new DomainError("NOT_FOUND", "no such event");
    const roles = await tx
      .select({ id: eventVolunteerRoles.id, nameRo: eventVolunteerRoles.nameRo, nameEn: eventVolunteerRoles.nameEn, colour: eventVolunteerRoles.colour })
      .from(eventVolunteerRoles)
      .where(eq(eventVolunteerRoles.eventId, eventId))
      .orderBy(asc(eventVolunteerRoles.id))
      .for("update");
    const byId = new Map(roles.map((role) => [role.id, role]));
    const wanted: Array<{ role: (typeof roles)[number]; colour: string | null }> = [];
    for (const entry of posted) {
      const role = byId.get(entry.roleId);
      if (!role) throw new DomainError("NOT_FOUND", "no such role on this event");
      const colour = checkedRoleColour(entry, role.colour);
      if (colour !== role.colour) wanted.push({ role, colour });
    }
    let changed = 0;
    for (const { role, colour } of wanted) {
      const written = await tx
        .update(eventVolunteerRoles)
        .set({ colour })
        .where(and(eq(eventVolunteerRoles.id, role.id), eq(eventVolunteerRoles.eventId, eventId)))
        .returning({ id: eventVolunteerRoles.id });
      // A row the update did not reach is not audited as changed.
      if (written.length === 0) continue;
      changed += 1;
      await recordAuditEvent(tx, {
        actorStaffUserId: actor.id,
        action: "volunteer_role.badge_colour_changed",
        entityType: "event",
        entityId: eventId,
        metadata: { roleId: role.id, nameRo: role.nameRo, nameEn: role.nameEn, from: role.colour, to: colour },
        now,
      });
    }
    return { changed };
  });
}

/**
 * The colour one role's row asks for, and the box a refusal names. The select decides — «Portocaliul
 * clubului» (empty), a palette colour, or «Altă culoare» with the colour typed — **except** when a new
 * colour was typed while the select still shows what is saved: then the typed colour wins, as the
 * «Aspect» card's own colour boxes select their option when typed in (`appearance/ui/CustomTintOption.tsx`),
 * so nobody types a colour, presses «Salvează culorile» and keeps the old one without a word. A typed
 * colour beside a select that was changed to something else is refused, naming the select: the two say
 * different things, and the server will not guess which one the person meant. The typed box still holding
 * the saved colour (it is prefilled with it) says nothing new.
 */
export function postedRoleColour(
  entry: Pick<PostedRoleColour, "choice" | "typed"> & { roleId?: string },
  stored: string | null,
  /** The boxes' names when the colour is posted from somewhere else than the badges' page: the role's own form (§NNN). */
  named: { choice: string; typed: string } = roleColourBoxes(entry.roleId ?? ""),
): { colour: string | null; box: string } {
  const boxes = named;
  const typedText = entry.typed.trim();
  const typed = typedColour(typedText);
  if (entry.choice === TYPED_COLOUR) {
    if (!typed) throw new DomainError("VALIDATION_ERROR", "the typed colour is not #rrggbb", [boxes.typed]);
    return { colour: typed, box: boxes.typed };
  }
  const chosen = entry.choice === "" ? null : typedColour(entry.choice);
  if (entry.choice !== "" && !chosen) throw new DomainError("VALIDATION_ERROR", "the colour is not one of the choices", [boxes.choice]);
  const typedSomethingNew = typedText !== "" && typed !== stored;
  if (!typedSomethingNew) return { colour: chosen, box: boxes.choice };
  if (!typed) throw new DomainError("VALIDATION_ERROR", "the typed colour is not #rrggbb", [boxes.typed]);
  // The select untouched (it still says the saved colour): the typed one is the change.
  if (chosen === stored) return { colour: typed, box: boxes.typed };
  throw new DomainError("VALIDATION_ERROR", "a colour was chosen and another typed; choose «Altă culoare» to keep the typed one", [boxes.choice]);
}

/**
 * The colour a role's boxes ask for, held to the rule every colour of a band obeys: a typed colour is `#rrggbb`
 * and carries its words at AA (`BADGE_COLOUR_UNREADABLE`, naming the box) — when it differs from the stored one. The badges' page and the role's own
 * form in the «Voluntari» card (§NNN) both save a colour through this one function.
 */
export function checkedRoleColour(
  entry: Pick<PostedRoleColour, "choice" | "typed"> & { roleId?: string },
  stored: string | null,
  named?: { choice: string; typed: string },
): string | null {
  const { colour, box } = postedRoleColour(entry, stored, named);
  // Only a colour that changes is checked: one written by hand and kept as it is — the form pre-fills it —
  // must not make every save of its role refuse.
  if (colour && colour !== stored && !badgeColourReadable(colour)) {
    throw new DomainError("BADGE_COLOUR_UNREADABLE", "the role's colour does not carry its words at AA", [box]);
  }
  return colour;
}

// --- The print -------------------------------------------------------------------------------

/** The most badges of one pile, and of one sheet: a race's volunteers, with room for spares. */
export const BADGE_COUNT_MAX = 300;
export const BADGE_TOTAL_MAX = 1000;

/** What the print form asks, per role: «Câte ecusoane» and «În plus». */
export type BadgePrintCounts = {
  roles: ReadonlyMap<string, { count: number; spares: number }>;
  /** «Ecusoane fără rol»: badges with «VOLUNTAR» alone. */
  none: number;
};

/**
 * «Câte ecusoane» before anyone types: the people the role needs, never more than one pile may hold — a role
 * that needs more than `BADGE_COUNT_MAX` (the volunteers allow up to 1 000) starts at the most a pile
 * prints, so the form the page draws is always one the sheet accepts.
 */
export function badgePrintDefault(role: Pick<BadgeRole, "needed">): number {
  return Math.min(Math.max(0, role.needed), BADGE_COUNT_MAX);
}

/** The print form's hidden box naming the page's language, and the page's query that carries a refusal back to it. */
export const BADGE_FROM_BOX = "from";
export const BADGE_REFUSED_PARAM = "refused";

/** The print form's box names, for the page and the route. */
export const printBoxes = {
  count: (roleId: string) => `n.${roleId}`,
  spares: (roleId: string) => `x.${roleId}`,
  none: "none",
} as const;

/** Why a print form was refused: a box that is not a whole number in range, or a total past the file's ceiling. */
export type BadgePrintRefusal = { refused: "number" | "total" };

/**
 * The print form's numbers, read from its query: a role's «Câte ecusoane» defaults to the people it
 * needs (`badgePrintDefault`), «În plus» and «Ecusoane fără rol» to none — when the box is **absent**; a box
 * posted empty means none, so clearing «Câte ecusoane» prints no badge of that role. A refusal — the whole
 * request — for a number that is not a whole number from 0 to `BADGE_COUNT_MAX` (`"number"`), or a total past
 * `BADGE_TOTAL_MAX` (`"total"`); the route says which on the page.
 */
export function readPrintCounts(params: URLSearchParams, roles: readonly Pick<BadgeRole, "id" | "needed">[]): BadgePrintCounts | BadgePrintRefusal {
  const number = (name: string, fallback: number): number | null => {
    const raw = params.get(name);
    if (raw === null) return fallback;
    if (raw.trim() === "") return 0;
    const value = Number(raw.trim());
    return Number.isInteger(value) && value >= 0 && value <= BADGE_COUNT_MAX ? value : null;
  };
  const counts = new Map<string, { count: number; spares: number }>();
  for (const role of roles) {
    const count = number(printBoxes.count(role.id), badgePrintDefault(role));
    const spares = number(printBoxes.spares(role.id), 0);
    if (count === null || spares === null) return { refused: "number" };
    counts.set(role.id, { count, spares });
  }
  const none = number(printBoxes.none, 0);
  if (none === null) return { refused: "number" };
  const total = [...counts.values()].reduce((sum, entry) => sum + entry.count + entry.spares, none);
  return total > BADGE_TOTAL_MAX ? { refused: "total" } : { roles: counts, none };
}

/** The sheet's piles in the club's order: each role's badges with its spares, then the badges «fără rol». */
export function badgePrintEntries(
  roles: readonly BadgeRole[],
  counts: BadgePrintCounts,
  locale: BadgeLocale,
): Array<{ role: { name: string; colour: string | null } | null; count: number }> {
  return [
    ...roles
      .map((role) => {
        const wanted = counts.roles.get(role.id) ?? { count: badgePrintDefault(role), spares: 0 };
        return { role: { name: badgeRoleName(role, locale), colour: badgeRoleColour(role.colour) }, count: wanted.count + wanted.spares };
      })
      .filter((entry) => entry.count > 0),
    ...(counts.none > 0 ? [{ role: null, count: counts.none }] : []),
  ];
}
