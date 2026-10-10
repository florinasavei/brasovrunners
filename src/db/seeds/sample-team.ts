import { sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { teamMembers } from "@/db/schema/team";

/**
 * «Echipa»'s sample cards (§459): two hidden «Prenume Nume» cards, so QA can be walked with nobody's
 * real name. Only into an empty table; refuses production (AGENTS.md §7.7).
 */
export const SAMPLE_TEAM_NAME = "Prenume Nume";

export async function seedSampleTeam(): Promise<number> {
  if ((process.env.APP_ENV ?? "local") === "production") {
    throw new Error("Refusing to seed the team page on production. AGENTS.md §7.7: production is never auto-seeded.");
  }
  const db = getDb();
  const [existing] = await db.select({ count: sql<number>`count(*)::int` }).from(teamMembers);
  if ((existing?.count ?? 0) > 0) return 0;

  await db.insert(teamMembers).values([
    {
      name: SAMPLE_TEAM_NAME,
      roleRo: "Organizator (exemplu)",
      roleEn: "Organizer (sample)",
      bioRo: "Un card de exemplu. Înlocuiește-l cu o persoană reală, cu acordul ei.",
      bioEn: "A sample card. Replace it with a real person, with their consent.",
      position: 1,
      visible: false,
      // On the canvas (§701): the top row's wide card, and a tall one under it, once shown.
      level: 1,
    },
    {
      name: SAMPLE_TEAM_NAME,
      roleRo: "Voluntar (exemplu)",
      roleEn: "Volunteer (sample)",
      position: 2,
      visible: false,
      level: 2,
    },
  ]);
  return 2;
}
