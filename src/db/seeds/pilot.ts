import { sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { eventTranslations, events } from "@/db/schema/events";
import { registrations } from "@/db/schema/registrations";
import { atBrasov, nextWeekday, todayInBrasov } from "./sample-dates";
import { seedSampleLegalDocuments } from "./sample-legal-documents";

/**
 * Pilot seed: the club's events, published in both languages.
 *
 * Every event carries a complete Romanian and English translation, both PUBLISHED. That is a
 * change from the original pilot plan, where English stayed Draft so `/en` returned 404. The
 * rule behind that 404 — BR-REQ-040-02, an unpublished locale is a 404 and never a fallback to
 * the other language — is unchanged and still enforced; these rows simply are published now.
 * `tests/integration/events/publication.test.ts` covers the rule with its own data.
 *
 * An English translation that is published must be complete. A page that shows an English
 * title over Romanian details is exactly the half-translated state BR-REQ-040-02 exists to
 * prevent, so every field the Romanian row fills, the English row fills too.
 *
 * PLACEHOLDER CONTENT. The anniversary cross below is a stand-in with an invented date,
 * distance and meeting point, so that the page it drives can be built and reviewed. Replace it
 * with the club's real race before this reaches anyone — an invented date for a real event is
 * worse than no page at all.
 *
 * Safe to re-run: it clears both tables first. It refuses to touch production, and it refuses
 * to clear an environment somebody has registered on — see below.
 */
async function seed() {
  const appEnv = process.env.APP_ENV ?? "local";
  if (appEnv === "production") {
    throw new Error("Refusing to seed production. AGENTS.md §7.7: production is never auto-seeded.");
  }

  /**
   * The sample legal documents first, because an event that takes registrations references the
   * declaration version a participant signs, and that row has to exist before the event does.
   *
   * DECISIONS.md §29 replaces §27: sample text everywhere but production, so QA can run the
   * participant journey at all. `seedSampleLegalDocuments` refuses production itself; this call
   * site never reaches it there either, because the whole seed refused above.
   */
  await seedSampleLegalDocuments();

  /**
   * Clearing the events is destructive, and once an environment has registrations it is
   * destructive to somebody.
   *
   * `registrations` references `events`, so the delete below would fail on the foreign key
   * anyway — but it would fail with a constraint name, halfway through, after the legal
   * documents were already touched. Ask first, and say what to do instead.
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
      // The race the site exists for. Every detail here is a placeholder, and the excerpt says
      // so in both languages: this row is now the featured event, so it is the first thing a
      // visitor reads, and an invented date presented as real is worse than no page at all.
      type: "RACE" as const,
      surface: "MIXED" as const,
      // Two times, as a race has: gather at nine, gun at ten. `starts_at` is when the event
      // begins and stays what the ordering and the listing read.
      startsAt: atBrasov(nextWeekday(0, 21), 9),
      raceStartsAt: atBrasov(nextWeekday(0, 21), 10),
      // The one event the landing page leads with. The database refuses a second.
      featured: true,
      distanceMeters: 10000,
      elevationGainMeters: 180,
      /**
       * One value for both languages (`DECISIONS.md` §36).
       *
       * The place, the difficulty and the cost are the same fact whichever language the page is
       * read in, so they are the club's own words once rather than a translation twice. The
       * English page shows them exactly as typed, which is the trade the owner chose over
       * entering every event's meeting point twice.
       */
      locationName: "Parcul Tractorul, zona de start",
      locationAddress: "Strada Nicolae Labiș, Brașov",
      difficulty: "MODERATE" as const,
      costType: "FREE" as const,
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
      // The two ends of the five-level scale (§NNN), so a seeded listing shows the gauge at both.
      difficulty: "VERY_EASY" as const,
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
      // «Coordonate» typed (§NNN): the cable car's lower station, so a seeded trail run reads the
      // weather at its own trailhead and says «Pentru locul evenimentului». No map link carries a
      // pin here: a map link is a hostname, which no file under `src/` may hold (AGENTS.md §8).
      latitude: 45.6384,
      longitude: 25.5921,
      difficulty: "MODERATE" as const,
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
      // An interval session is a group run on the track; "interval" is the title's job now
      // (`DECISIONS.md` §61).
      type: "GROUP_RUN" as const,
      surface: "ASPHALT" as const,
      startsAt: atBrasov(nextWeekday(3, 1), 18, 30),
      locationName: "Stadionul Olimpia",
      difficulty: "VERY_HARD" as const,
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
        // No map link or route link is seeded, and that is the rule working rather than an
        // omission: AGENTS.md §8 forbids a hostname literal anywhere under `src/`, seeds
        // included. An organizer pastes both in the backoffice.
        distanceMeters: row.distanceMeters,
        elevationGainMeters: row.elevationGainMeters,
        // The same event in either language (`DECISIONS.md` §36).
        locationName: row.locationName,
        locationAddress: "locationAddress" in row ? row.locationAddress : undefined,
        latitude: "latitude" in row ? row.latitude : undefined,
        longitude: "longitude" in row ? row.longitude : undefined,
        difficulty: row.difficulty,
        costType: row.costType,
        /**
         * NONE, deliberately, for every seeded event.
         *
         * The registration block — the mode, the capacity, the window and the declaration
         * version — is configured by an organizer through the backoffice, not here.
         * `DECISIONS.md` §28: this file stopped being how an event is configured the moment the
         * CRUD covered every column, and an event that arrived from a seed already taking
         * entries would be one more thing nobody could change without a developer.
         */
        registrationMode: "NONE",
        // Publication is one state for the whole event now (`DECISIONS.md` §28): both languages
        // go live together, and the date lives here rather than on each translation.
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
