import { getDb } from "@/db/client";
import { eventTranslations, events } from "@/db/schema/events";

/**
 * Pilot seed: a few real club events, Romanian published, English left as Draft.
 *
 * English being Draft is deliberate and is what BR-REQ-040-02 prescribes — `/en` returns 404
 * rather than serving Romanian text under an English URL. Replace the placeholder content
 * below with the club's real events before deploying; the shape matters more than the words.
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
      en: { slug: "sunday-run-tractorul-park", title: "Sunday run", locationName: "Tractorul Park" },
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
      en: { slug: "tampa-trail", title: "Tâmpa trail run", locationName: "Tâmpa cable car station" },
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
      en: { slug: "interval-session-olimpia", title: "Interval session", locationName: "Olimpia Stadium" },
    },
  ];

  for (const row of rows) {
    const [event] = await getDb()
      .insert(events)
      .values({
        kind: row.kind,
        startsAt: row.startsAt,
        distanceMeters: row.distanceMeters,
        elevationGainMeters: row.elevationGainMeters,
        // The pilot is uncapped by design; the database refuses a capacity anyway.
        registrationMode: "NONE",
      })
      .returning();

    await getDb().insert(eventTranslations).values([
      {
        eventId: event.id,
        locale: "ro",
        slug: row.ro.slug,
        title: row.ro.title,
        excerpt: row.ro.excerpt,
        locationName: row.ro.locationName,
        difficultyLabel: row.ro.difficultyLabel,
        costText: row.ro.costText,
        editorialStatus: "PUBLISHED",
        publishedAt: new Date(),
      },
      {
        eventId: event.id,
        locale: "en",
        slug: row.en.slug,
        title: row.en.title,
        locationName: row.en.locationName,
        editorialStatus: "DRAFT",
      },
    ]);
  }

  console.log(`seeded ${rows.length} events (ro published, en draft) into APP_ENV=${appEnv}`);
}

seed()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
