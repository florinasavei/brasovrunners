import { eq } from "drizzle-orm";
import { eventVolunteerCategories, eventVolunteerRoles } from "@/db/schema/event-volunteers";
import type { StaffUser } from "@/db/schema/staff-users";
import type { Database } from "@/db/types";
import { hasRichTextContent, readRichText } from "@/modules/content/rich-text/domain/schema";
import { compareCategories, compareRoles } from "@/modules/volunteers/domain/volunteer";
import { changeVolunteerCategory, changeVolunteerRole, ROLE_FORM_COLOUR_BOXES } from "@/modules/volunteers/volunteers";
import { TYPED_COLOUR } from "@/modules/volunteers/badges/badges";
import { isDomainError } from "@/shared/errors/domain-error";
import type { VolunteersFile } from "./file-format";

/**
 * An event's volunteer categories and roles in the file (§774, amending §751 and §754; the owner, 2026-10-14: «categorii cu
 * sub-categorii … Toate astea configurabile» — what an event's volunteers do is configured once, so a copy of the event, or its
 * file on another environment, starts with it).
 *
 * **The words, never the people.** The file carries the categories — their two names, the order, the contact person the club set
 * for each (a name, a telephone number, an address: the club's own business contact, published by its choice on the volunteers' page)
 * — and the roles — their two names, how many each needs, the description's document in both languages, the badge band's colour, and
 * the category each sits under **by its place in the list**, never an id that means something in one database only. Never a
 * volunteer, a choice, an acceptance or the tick «Primește voluntari» (§754): those stay with their event.
 *
 * **Applied only where an event is made new** («Ca eveniment nou»): an import over an existing event leaves its roles exactly as they
 * are — a role may have people on it, and the diff of §751 is about the event's own configuration. Each category and role is written
 * through the services the card's own forms use (`changeVolunteerCategory`, `changeVolunteerRole`), so every rule of the card holds
 * (both names, the bounds, a name once per category, a colour that reads, the audit trail), and the file is **read forgivingly**: a
 * category the file points at that is not in it is the roles' «Alte activități»; a contact whose address or number the card would refuse
 * is left out; an entry the card would refuse is skipped — the rest of the event is not held up by it.
 */

/** The categories and roles of one event as the file holds them, in the club's order. */
export async function readVolunteersFile<T extends Record<string, unknown>>(db: Database<T>, eventId: string): Promise<VolunteersFile> {
  const categories = (await db.select().from(eventVolunteerCategories).where(eq(eventVolunteerCategories.eventId, eventId))).sort(compareCategories);
  const roles = (await db.select().from(eventVolunteerRoles).where(eq(eventVolunteerRoles.eventId, eventId))).sort(compareRoles);
  const position = new Map(categories.map((category, index) => [category.id, index]));
  const document = (stored: unknown): Record<string, unknown> | null => {
    if (stored === null || stored === undefined) return null;
    const read = readRichText(stored);
    return hasRichTextContent(read) ? (read as unknown as Record<string, unknown>) : null;
  };
  return {
    categories: categories.map((category) => ({
      name: { ro: category.nameRo, en: category.nameEn },
      contact:
        category.contactName === null && category.contactPhone === null && category.contactEmail === null
          ? null
          : { name: category.contactName, phone: category.contactPhone, email: category.contactEmail },
    })),
    roles: roles.map((role) => {
      const ro = document(role.descriptionRoJson);
      const en = document(role.descriptionEnJson);
      return {
        name: { ro: role.nameRo, en: role.nameEn },
        needed: role.needed,
        // Both languages or neither, as the card keeps it.
        description: ro && en ? { ro, en } : { ro: null, en: null },
        colour: role.colour,
        category: role.categoryId === null ? null : (position.get(role.categoryId) ?? null),
      };
    }),
  };
}

type Actor = Pick<StaffUser, "id" | "role">;

/**
 * Writes the file's categories and roles to a new event, through the card's own services, in the file's order. Returns how many of each
 * were written, and how many entries were left out. An entry the card refuses (a name over its bound, a name twice under one category, a
 * colour no word reads on) is skipped and counted in `skipped`, so the page says so; anything that is not the card's refusal is an error.
 */
export async function importVolunteersFile<T extends Record<string, unknown>>(
  db: Database<T>,
  actor: Actor,
  eventId: string,
  file: VolunteersFile,
  now: Date,
): Promise<{ categories: number; roles: number; skipped: number }> {
  // The category each file position became (undefined for one the card refused): a role pointing at it, or at no position, sits under none.
  const created: Array<string | undefined> = [];
  let categories = 0;
  let skipped = 0;
  for (const category of file.categories) {
    try {
      const added = await changeVolunteerCategory(db, actor, { kind: "add", eventId, fields: { nameRo: category.name.ro, nameEn: category.name.en } }, now);
      created.push(added.category.id);
      categories += 1;
      if (category.contact) {
        try {
          await changeVolunteerCategory(
            db,
            actor,
            { kind: "contact", eventId, id: added.category.id, fields: { contactName: category.contact.name ?? "", contactPhone: category.contact.phone ?? "", contactEmail: category.contact.email ?? "" } },
            now,
          );
        } catch (error) {
          // A contact the card would refuse (an address that is none) is left out; the category stays.
          if (!isDomainError(error)) throw error;
          skipped += 1;
        }
      }
    } catch (error) {
      if (!isDomainError(error)) throw error;
      created.push(undefined);
      skipped += 1;
    }
  }
  let roles = 0;
  for (const role of file.roles) {
    const under = role.category !== null && role.category >= 0 ? created[role.category] : undefined;
    const add = (colour: string | null) =>
      changeVolunteerRole(
        db,
        actor,
        {
          kind: "add",
          eventId,
          fields: {
            nameRo: role.name.ro,
            nameEn: role.name.en,
            // A role without a number (§784) is added through the tick, as the card's own form posts it.
            ...(role.needed === null ? { needed: "", unlimited: "on" } : { needed: String(role.needed) }),
            categoryId: under ?? "",
            ...(role.description.ro && role.description.en
              ? { descriptionRoBody: JSON.stringify(role.description.ro), descriptionEnBody: JSON.stringify(role.description.en) }
              : {}),
            // A band colour as the card's own form posts a typed one; none is the club's orange.
            [ROLE_FORM_COLOUR_BOXES.choice]: colour ? TYPED_COLOUR : "",
            [ROLE_FORM_COLOUR_BOXES.typed]: colour ?? "",
          },
        },
        now,
      );
    try {
      try {
        await add(role.colour);
      } catch (error) {
        // A colour the card would refuse (no word reads on it) costs the colour, not the role.
        if (!isDomainError(error) || role.colour === null) throw error;
        await add(null);
      }
      roles += 1;
    } catch (error) {
      if (!isDomainError(error)) throw error;
      skipped += 1;
    }
  }
  return { categories, roles, skipped };
}
