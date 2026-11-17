import { eventCheckpoints } from "@/db/schema/event-checkpoints";
import { eventVolunteerCategories, eventVolunteerRoleAssignments, eventVolunteerRoles, eventVolunteers } from "@/db/schema/event-volunteers";
import { eventTranslations, events } from "@/db/schema/events";
import type { TestDatabase } from "./db";
import { roleDescription } from "./role-description";

/*
  A race with its volunteers' plan half built, for the tests of «Trimite fiecăruia punctul lui» (§956,
  `tests/integration/volunteers/plan-mail.test.ts` and `plan-mail-screens.test.ts`): three points on the route, typed out of
  the route's order on purpose; two roles, one under a category with a contact person; and one person of every kind the
  press tells apart —

  - **Ana Pop** (Romanian, confirmed, the role «Direcționare» under «Traseu») at the junction — the route's first point, with a note;
  - **Dan Ene** (English, confirmed, both roles) at the water point;
  - **Ion Lupu** (Romanian, offered and not confirmed, no role given) at the bridge;
  - **Zoe Manea**, a row the club typed with no address and no telephone number (§865), at the junction;
  - **Radu Liber**, with an address, at no point yet;
  - **Eva Stan**, cancelled, who keeps the point she had;
  - and, on another race, **Mara Dinu** at that race's own point.

  So a first press writes to Ana, Dan and Ion; Zoe stands at a point with no address; Radu stands at none.
*/

/**
 * The plan's summary line as words — «0 voluntari la start–finish · 2 voluntari pe traseu · …» (§NNN): the page draws each
 * of its four counted phrases in a span of its own, so the line wraps between them and never inside one; a test reads the
 * words. Empty for a page that draws no summary (an event with no point).
 */
export function planSummaryOf(page: string): string {
  const line = /<p[^>]*data-testid="plan-summary"[^>]*>([\s\S]*?)<\/p>/.exec(page)?.[1] ?? "";
  return line.replace(/<!-- -->/g, "").replace(/<[^>]+>/g, "");
}

/** The contact person of the category «Traseu», as the club set them on the category. */
export const PLAN_CONTACT = { name: "Călin Coordonator", phone: "+40712345678", email: "traseu@club.test" } as const;
/** The same person as a message's footer says them: the telephone number as a person reads it. */
export const PLAN_CONTACT_WORDS = "Călin Coordonator · +40 712 345 678 · traseu@club.test";

/** The junction's own note, in each language, as the club typed it on the point. */
export const PLAN_JUNCTION_NOTE = { ro: "Mașinile vin din stânga: ține alergătorii pe dreapta.", en: "Cars come from the left: keep the runners on the right." } as const;

export type PlanRace = {
  raceId: string;
  otherId: string;
  slug: { ro: string; en: string };
  points: { junction: string; water: string; bridge: string; elsewhere: string };
  roles: { guide: string; water: string };
  people: { ana: string; dan: string; ion: string; zoe: string; radu: string; eva: string; mara: string };
};

type NewVolunteer = {
  eventId: string;
  name: string;
  locale?: "ro" | "en";
  state?: "REGISTERED" | "CONFIRMED" | "CANCELLED";
  /** The roles the organizers gave. */
  given?: string[];
  /** No address and no telephone number: a row the club typed (§865). */
  nameOnly?: boolean;
  checkpointId?: string | null;
  phone?: string;
};

/** The address a seeded person has, from their name: «Ana Pop» → `ana.pop@example.test`. */
export const planAddressOf = (name: string) => `${name.toLowerCase().replace(/[^a-z]+/g, ".")}@example.test`;

export async function planVolunteer(db: TestDatabase, over: NewVolunteer, now: Date): Promise<string> {
  const email = over.nameOnly ? null : planAddressOf(over.name);
  const [row] = await db
    .insert(eventVolunteers)
    .values({
      eventId: over.eventId,
      name: over.name,
      email,
      canonicalEmail: email,
      canonicalizationVersion: email === null ? null : 1,
      phone: over.nameOnly ? null : (over.phone ?? "+40700000001"),
      // Only a row the club typed may lack an address or a telephone number (§865): the public form asks both.
      source: over.nameOnly ? "STAFF" : "PUBLIC",
      locale: over.locale ?? "ro",
      state: over.state ?? "CONFIRMED",
      roleId: over.given?.[0] ?? null,
      checkpointId: over.checkpointId ?? null,
      createdAt: now,
      updatedAt: now,
    })
    .returning({ id: eventVolunteers.id });
  if (over.given?.length) await db.insert(eventVolunteerRoleAssignments).values(over.given.map((roleId) => ({ volunteerId: row.id, roleId })));
  return row.id;
}

export async function seedPlanRace(db: TestDatabase, now: Date): Promise<PlanRace> {
  const [race, other] = await db
    .insert(events)
    .values([
      // Saturday, 21 November 2026, 10:00 in Brașov.
      { type: "RACE", startsAt: new Date("2026-11-21T08:00:00.000Z"), acceptsVolunteers: true, editorialStatus: "PUBLISHED", publishedAt: new Date("2026-10-01T00:00:00.000Z") },
      { type: "RACE", startsAt: new Date("2026-12-05T08:00:00.000Z"), acceptsVolunteers: true, editorialStatus: "PUBLISHED", publishedAt: new Date("2026-10-01T00:00:00.000Z") },
    ])
    .returning({ id: events.id });
  const slug = { ro: `crosul-${race.id.slice(0, 8)}`, en: `cross-${race.id.slice(0, 8)}` };
  await db.insert(eventTranslations).values([
    { eventId: race.id, locale: "ro", slug: slug.ro, title: "Crosul", locationName: "Parcul central" },
    { eventId: race.id, locale: "en", slug: slug.en, title: "The cross", locationName: "Central park" },
    { eventId: other.id, locale: "ro", slug: `altul-${other.id.slice(0, 8)}`, title: "Alt cros", locationName: "Poiana" },
    { eventId: other.id, locale: "en", slug: `other-${other.id.slice(0, 8)}`, title: "Another cross", locationName: "The meadow" },
  ]);

  const [route] = await db
    .insert(eventVolunteerCategories)
    .values({ eventId: race.id, nameRo: "Traseu", nameEn: "Route", sort: 0, contactName: PLAN_CONTACT.name, contactPhone: PLAN_CONTACT.phone, contactEmail: PLAN_CONTACT.email })
    .returning({ id: eventVolunteerCategories.id });
  const [guide, water] = await db
    .insert(eventVolunteerRoles)
    .values([
      { eventId: race.id, categoryId: route.id, nameRo: "Direcționare", nameEn: "Guidance", needed: 4, position: 0, ...roleDescription("Arăți drumul pe traseu", "Show the way on the route") },
      // Under no category: no contact person of its own.
      { eventId: race.id, categoryId: null, nameRo: "Punct de hidratare", nameEn: "Water point", needed: 2, position: 1, ...roleDescription("Dai apă alergătorilor", "Hand out water to the runners") },
    ])
    .returning({ id: eventVolunteerRoles.id });

  // Typed water first, then the bridge, then the junction: by distance the junction is the route's first point.
  const [waterPoint, bridge, junction] = await db
    .insert(eventCheckpoints)
    .values([
      { eventId: race.id, km: "5.50", nameRo: "Apă la cabană", nameEn: "Water at the hut", kinds: ["WATER"], position: 0 },
      { eventId: race.id, km: "7.25", nameRo: "Podul de lemn", nameEn: "The wooden bridge", kinds: ["DIRECTION"], position: 1 },
      { eventId: race.id, km: "1.20", nameRo: "Intersecția Stejeriș", nameEn: "Stejeriș junction", kinds: ["DIRECTION"], position: 2, noteRo: PLAN_JUNCTION_NOTE.ro, noteEn: PLAN_JUNCTION_NOTE.en },
    ])
    .returning({ id: eventCheckpoints.id });
  const [elsewhere] = await db
    .insert(eventCheckpoints)
    .values({ eventId: other.id, km: "3.00", nameRo: "Punctul altui eveniment", nameEn: "Another event's point", kinds: ["DIRECTION"], position: 0 })
    .returning({ id: eventCheckpoints.id });

  const people = {
    ana: await planVolunteer(db, { eventId: race.id, name: "Ana Pop", given: [guide.id], checkpointId: junction.id, phone: "+40700000011" }, now),
    dan: await planVolunteer(db, { eventId: race.id, name: "Dan Ene", locale: "en", given: [guide.id, water.id], checkpointId: waterPoint.id, phone: "+40700000022" }, now),
    ion: await planVolunteer(db, { eventId: race.id, name: "Ion Lupu", state: "REGISTERED", checkpointId: bridge.id, phone: "+40700000033" }, now),
    zoe: await planVolunteer(db, { eventId: race.id, name: "Zoe Manea", given: [guide.id], nameOnly: true, checkpointId: junction.id }, now),
    radu: await planVolunteer(db, { eventId: race.id, name: "Radu Liber", given: [water.id], phone: "+40700000044" }, now),
    eva: await planVolunteer(db, { eventId: race.id, name: "Eva Stan", state: "CANCELLED", given: [guide.id], checkpointId: waterPoint.id, phone: "+40700000055" }, now),
    mara: await planVolunteer(db, { eventId: other.id, name: "Mara Dinu", checkpointId: elsewhere.id, phone: "+40700000066" }, now),
  };

  return {
    raceId: race.id,
    otherId: other.id,
    slug,
    points: { junction: junction.id, water: waterPoint.id, bridge: bridge.id, elsewhere: elsewhere.id },
    roles: { guide: guide.id, water: water.id },
    people,
  };
}
