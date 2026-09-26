import { sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { teamMembers } from "@/db/schema/team";

/**
 * «Echipa»'s sample cards (§459), for every environment but production: two hidden placeholder
 * people, «Prenume Nume», with a role in both languages, so the backoffice screen and the page can
 * be walked on QA without anybody's real name or photograph. The page itself is left as it is —
 * DRAFT unless somebody published it — and the cards stay hidden until an Administrator shows them.
 *
 * Never deletes: it adds the two cards only while the table is empty, so a re-seed keeps whatever
 * the club typed. Refuses production, as every seed does (AGENTS.md §7.7).
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
    },
    {
      name: SAMPLE_TEAM_NAME,
      roleRo: "Voluntar (exemplu)",
      roleEn: "Volunteer (sample)",
      position: 2,
      visible: false,
    },
  ]);
  return 2;
}
