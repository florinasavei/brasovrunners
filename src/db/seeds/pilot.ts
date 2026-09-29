import { sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { eventTranslations, events } from "@/db/schema/events";
import { registrations } from "@/db/schema/registrations";
import { storedDifficulty } from "@/modules/events/domain/difficulty";
import { atBrasov, nextWeekday, todayInBrasov } from "./sample-dates";
import { seedSampleLegalDocuments } from "./sample-legal-documents";
import { seedSampleTeam } from "./sample-team";

/**
 * Pilot seed: sample events, published in both languages. A published locale must be complete
 * (BR-REQ-040-02), so the English row fills every field the Romanian one does.
 *
 * PLACEHOLDER CONTENT: the anniversary cross has an invented date, distance and meeting point.
 *
 * Re-runnable: it clears both tables first. It refuses production and any environment with
 * registrations.
 */
async function seed() {
  const appEnv = process.env.APP_ENV ?? "local";
  if (appEnv === "production") {
    throw new Error("Refusing to seed production. AGENTS.md §7.7: production is never auto-seeded.");
  }

  /**
   * Legal documents first: a registering event references the declaration version. Sample text
   * everywhere but production (§29); `seedSampleLegalDocuments` refuses production itself too.
   */
  await seedSampleLegalDocuments();

  /*
    «Echipa»'s two hidden placeholder cards (§459), only into an empty table.
  */
  await seedSampleTeam();

  /**
   * Registrations reference events, so the delete would fail halfway on the foreign key anyway;
   * refuse up front with a message that says what to do instead.
   */
  const [registered] = await getDb()
    .select({ count: sql<number>`count(*)::int` })
    .from(registrations);
  if ((registered?.count ?? 0) > 0) {
    throw new Error(
      `Refusing to clear ${registered?.count} registration(s) in APP_ENV=${appEnv}. Remove the test registrations from the backoffice, or reset the database (yarn db:reset:local), before re-seeding.`,
    );
  }

  await getDb().delete(eventTranslations);
  await getDb().delete(events);

  const rows = [
    {
      // Every detail is a placeholder, and the excerpt says so in both languages: this is the
      // featured event, the first thing a visitor reads.
      type: "RACE" as const,
      surface: "MIXED" as const,
      // Gather at nine, gun at ten; `starts_at` is what ordering and the listing read.
      startsAt: atBrasov(nextWeekday(0, 21), 9),
      raceStartsAt: atBrasov(nextWeekday(0, 21), 10),
      // The database refuses a second featured event.
      featured: true,
      distanceMeters: 10000,
      elevationGainMeters: 180,
      /** One value for both languages (§36). */
      locationName: "Parcul Tractorul, zona de start",
      locationAddress: "Strada Nicolae Labiș, Brașov",
      difficultyLevel: 5,
      costType: "FREE" as const,
      // The sample race asks the health note (§NNN), so the form's medical fold can be walked here.
      askHealthNote: true,
      ro: {
        slug: "crosul-aniversar-brasov-runners",
        title: "Crosul aniversar Brașov Runners",
        excerpt:
          "EXEMPLU — data, distanța și punctul de întâlnire sunt provizorii. Cursa aniversară a clubului, pe traseu de cros în jurul orașului. Toate nivelurile sunt binevenite.",
      },
      en: {
        slug: "brasov-runners-anniversary-cross",
        title: "Brașov Runners Anniversary Cross",
        excerpt:
          "SAMPLE — the date, the distance and the meeting point are placeholders. The club's anniversary race, on a cross-country course around the city. All levels welcome.",
      },
    },
    {
      type: "GROUP_RUN" as const,
      surface: "ASPHALT" as const,
      startsAt: atBrasov(-((todayInBrasov().getUTCDay() + 7) % 7 || 7), 7),
      distanceMeters: 8000,
      locationName: "Parcul Tractorul, intrarea principală",
      // The two ends of the scale of fifteen (§526): «Ușor 1» here, «Foarte greu 3» on the intervals.
      difficultyLevel: 1,
      costType: "FREE" as const,
      ro: {
        slug: "alergare-de-duminica-parcul-tractorul",
        title: "Alergare de duminică",
        excerpt: "Alergare relaxată prin parc, ritm de conversație. Vino cum ești.",
      },
      en: {
        slug: "sunday-run-tractorul-park",
        title: "Sunday run",
        excerpt: "An easy run through the park at conversation pace. Come as you are.",
      },
    },
    {
      type: "GROUP_RUN" as const,
      surface: "TRAIL" as const,
      startsAt: atBrasov(nextWeekday(6, 2), 8),
      distanceMeters: 14000,
      elevationGainMeters: 600,
      locationName: "Stația de telecabină Tâmpa",
      // «Coordonate» typed (§416), so the weather reads the trailhead. No map link: that would
      // be a hostname under `src/` (AGENTS.md §8).
      latitude: 45.6384,
      longitude: 25.5921,
      // «Mediu 1»: the run up Tâmpa (§526).
      difficultyLevel: 4,
      costType: "FREE" as const,
      ro: {
        slug: "tura-pe-tampa",
        title: "Tură pe Tâmpa",
        excerpt: "Urcare pe Tâmpa și retur. Bocanci sau pantofi de trail recomandați.",
      },
      en: {
        slug: "tampa-trail",
        title: "Tâmpa trail run",
        excerpt: "Up Tâmpa and back. Hiking boots or trail shoes recommended.",
      },
    },
    {
      // An interval session is a group run; "interval" is the title's job (§61).
      type: "GROUP_RUN" as const,
      surface: "ASPHALT" as const,
      startsAt: atBrasov(nextWeekday(3, 1), 18, 30),
      locationName: "Stadionul Olimpia",
      difficultyLevel: 15,
      costType: "FREE" as const,
      ro: {
        slug: "antrenament-de-intervale-olimpia",
        title: "Antrenament de intervale",
        excerpt: "Serii pe pistă, toate nivelurile. Încălzire în grup la 18:30.",
      },
      en: {
        slug: "interval-session-olimpia",
        title: "Interval session",
        excerpt: "Track repeats, all levels. Group warm-up at 18:30.",
      },
    },
  ];

  const publishedAt = new Date();

  for (const row of rows) {
    const [event] = await getDb()
      .insert(events)
      .values({
        type: row.type,
        surface: row.surface,
        startsAt: row.startsAt,
        raceStartsAt: "raceStartsAt" in row ? row.raceStartsAt : undefined,
        featured: "featured" in row ? row.featured : false,
        // No map or route link: AGENTS.md §8 forbids a hostname literal under `src/`.
        distanceMeters: row.distanceMeters,
        elevationGainMeters: row.elevationGainMeters,
        locationName: row.locationName,
        locationAddress: "locationAddress" in row ? row.locationAddress : undefined,
        latitude: "latitude" in row ? row.latitude : undefined,
        longitude: "longitude" in row ? row.longitude : undefined,
        // The level on the scale of fifteen (§526), plus the old column's word.
        ...storedDifficulty(row.difficultyLevel),
        costType: row.costType,
        // «Informații medicale» (§NNN): off unless the row says otherwise, as on every new event.
        askHealthNote: "askHealthNote" in row ? row.askHealthNote : false,
        // NONE for every seeded event: registration is configured in the backoffice (§28).
        registrationMode: "NONE",
        // Publication is one state for both languages (§28).
        editorialStatus: "PUBLISHED" as const,
        publishedAt,
      })
      .returning();

    await getDb()
      .insert(eventTranslations)
      .values(
        (["ro", "en"] as const).map((locale) => ({
          eventId: event.id,
          locale,
          slug: row[locale].slug,
          title: row[locale].title,
          excerpt: row[locale].excerpt,
        })),
      );
  }

  console.log(`seeded ${rows.length} events, Romanian and English published, into APP_ENV=${appEnv}`);
}

seed()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
