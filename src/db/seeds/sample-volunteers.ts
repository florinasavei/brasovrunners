import { eventVolunteerCategories, eventVolunteerRoles } from "@/db/schema/event-volunteers";
import { getDb } from "@/db/client";

/**
 * The sample race's volunteer categories and roles (§NNN; the owner, 2026-10-14: «aș pune activități Start/Finish și am putea adăuga
 * ex: direcționare, foto/video, punct hidratare; Traseu: direcționare, punct hidratare, foto/video»): two categories, «Start / Sosire»
 * and «Traseu», and under each the same three roles — which is the point of the sample: one role name in two categories. No contact person:
 * «the contact person for each category will be established later», and the card shows it empty.
 *
 * Made up, like every sample here — local and QA only: it refuses production (AGENTS.md §7.7, `DECISIONS.md` §30). The sample event takes
 * no volunteers on its page until a person ticks «Primește voluntari» (§754), so nothing public changes; the card and its groups can be walked.
 */
export async function seedSampleVolunteers(eventId: string): Promise<{ categories: number; roles: number }> {
  if ((process.env.APP_ENV ?? "local") === "production") {
    throw new Error("Refusing to seed volunteer categories on production. AGENTS.md §7.7: production is never auto-seeded.");
  }
  const db = getDb();
  const categories = await db
    .insert(eventVolunteerCategories)
    .values([
      { eventId, nameRo: "Start / Sosire", nameEn: "Start / Finish", sort: 0 },
      { eventId, nameRo: "Traseu", nameEn: "Route", sort: 1 },
    ])
    .returning({ id: eventVolunteerCategories.id, sort: eventVolunteerCategories.sort });
  const roles = [
    { nameRo: "Direcționare", nameEn: "Guidance", needed: 2 },
    { nameRo: "Foto/Video", nameEn: "Photo/Video", needed: 1 },
    { nameRo: "Punct de hidratare", nameEn: "Water point", needed: 3 },
  ];
  let position = 0;
  let written = 0;
  for (const category of categories.sort((a, b) => a.sort - b.sort)) {
    for (const role of roles) {
      await db.insert(eventVolunteerRoles).values({ eventId, categoryId: category.id, ...role, position: position++ });
      written += 1;
    }
  }
  return { categories: categories.length, roles: written };
}
