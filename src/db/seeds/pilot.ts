import { getDb } from "@/db/client";
import { eventTranslations, events } from "@/db/schema/events";

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
 * Safe to re-run: it clears both tables first. It refuses to touch production.
 */
async function seed() {
  const appEnv = process.env.APP_ENV ?? "local";
  if (appEnv === "production") {
    throw new Error("Refusing to seed production. AGENTS.md §7.7: production is never auto-seeded.");
  }

  await getDb().delete(eventTranslations);
  await getDb().delete(events);

  const rows = [
    {
      // The race the site exists for. Every detail here is a placeholder.
      kind: "RACE" as const,
      startsAt: new Date("2026-10-11T10:00:00+03:00"),
      distanceMeters: 10000,
      elevationGainMeters: 180,
      ro: {
        slug: "crosul-aniversar-brasov-runners",
        title: "Crosul aniversar Brașov Runners",
        excerpt:
          "Cursa aniversară a clubului, pe traseu de cros în jurul orașului. Toate nivelurile sunt binevenite.",
        locationName: "Parcul Tractorul, zona de start",
        locationAddress: "Strada Nicolae Labiș, Brașov",
        difficultyLabel: "Mediu",
        costText: "Gratuit",
      },
      en: {
        slug: "brasov-runners-anniversary-cross",
        title: "Brașov Runners Anniversary Cross",
        excerpt:
          "The club's anniversary race, on a cross-country course around the city. All levels welcome.",
        locationName: "Tractorul Park, start area",
        locationAddress: "Strada Nicolae Labiș, Brașov",
        difficultyLabel: "Moderate",
        costText: "Free",
      },
    },
    {
      kind: "COMMUNITY_RUN" as const,
      startsAt: new Date("2026-09-13T07:00:00+03:00"),
      distanceMeters: 8000,
      ro: {
        slug: "alergare-de-duminica-parcul-tractorul",
        title: "Alergare de duminică",
        excerpt: "Alergare relaxată prin parc, ritm de conversație. Vino cum ești.",
        locationName: "Parcul Tractorul, intrarea principală",
        difficultyLabel: "Ușor",
        costText: "Gratuit",
      },
      en: {
        slug: "sunday-run-tractorul-park",
        title: "Sunday run",
        excerpt: "An easy run through the park at conversation pace. Come as you are.",
        locationName: "Tractorul Park, main entrance",
        difficultyLabel: "Easy",
        costText: "Free",
      },
    },
    {
      kind: "TRAIL_RUN" as const,
      startsAt: new Date("2026-09-20T08:00:00+03:00"),
      distanceMeters: 14000,
      elevationGainMeters: 600,
      ro: {
        slug: "tura-pe-tampa",
        title: "Tură pe Tâmpa",
        excerpt: "Urcare pe Tâmpa și retur. Bocanci sau pantofi de trail recomandați.",
        locationName: "Stația de telecabină Tâmpa",
        difficultyLabel: "Mediu",
        costText: "Gratuit",
      },
      en: {
        slug: "tampa-trail",
        title: "Tâmpa trail run",
        excerpt: "Up Tâmpa and back. Hiking boots or trail shoes recommended.",
        locationName: "Tâmpa cable car station",
        difficultyLabel: "Moderate",
        costText: "Free",
      },
    },
    {
      kind: "INTERVAL_SESSION" as const,
      startsAt: new Date("2026-09-24T18:30:00+03:00"),
      ro: {
        slug: "antrenament-de-intervale-olimpia",
        title: "Antrenament de intervale",
        excerpt: "Serii pe pistă, toate nivelurile. Încălzire în grup la 18:30.",
        locationName: "Stadionul Olimpia",
        difficultyLabel: "Avansat",
        costText: "Gratuit",
      },
      en: {
        slug: "interval-session-olimpia",
        title: "Interval session",
        excerpt: "Track repeats, all levels. Group warm-up at 18:30.",
        locationName: "Olimpia Stadium",
        difficultyLabel: "Advanced",
        costText: "Free",
      },
    },
  ];

  const publishedAt = new Date();

  for (const row of rows) {
    const [event] = await getDb()
      .insert(events)
      .values({
        kind: row.kind,
        startsAt: row.startsAt,
        distanceMeters: row.distanceMeters,
        elevationGainMeters: row.elevationGainMeters,
        // Registration is not built: it needs the club's approved declaration and privacy
        // notice, and email needs the domain. NONE is the honest state until then, and the
        // pilot is uncapped by design — the database refuses a capacity anyway.
        registrationMode: "NONE",
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
          locationName: row[locale].locationName,
          locationAddress: "locationAddress" in row[locale] ? row[locale].locationAddress : undefined,
          difficultyLabel: row[locale].difficultyLabel,
          costText: row[locale].costText,
          editorialStatus: "PUBLISHED" as const,
          publishedAt,
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
