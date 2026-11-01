import club from "@club/club.json";
import type { ClubConfig } from "./schema";

/**
 * The club this deployment is (§NNN): `club/club.json`, read at build time.
 *
 * The **only** importer of the file, and imported in turn only by the five modules that turn it into the
 * platform's constants — `theme/brand.ts` (the name, the wordmark, the short forms, the logo),
 * `events/domain/place.ts` (the city, the county, the country), `i18n/dates.ts` (the zone),
 * `events/domain/sun.ts` (the coordinates) and `shared/config/env.ts` (the defaults the environment
 * may override) — so every other file keeps reading the names it always read
 * (`tests/unit/club/import-surface.test.ts`). A fork replaces the folder, not the code: `yarn test:fork`
 * builds the identity from a made-up club's folder and finds none of this one's words in it.
 *
 * JSON rather than TypeScript so a plain `.mjs` script reads it without a compiler. No Zod and no
 * environment here: this file reaches the public client islands through the theme. The checks a schema
 * would make run in `tests/unit/club/club-config.test.ts`; the types come from `satisfies` below.
 */

const { country } = club.place;
// The one runtime check, because the type promises it: the platform's laws, languages and currency are Romania's.
if (country !== "RO") throw new Error(`club/club.json: place.country must be "RO" — the platform is written for Romania; got "${country}".`);

// `guardWords` are read by the literal guard alone (`tests/unit/club/club-literals.test.ts` reads the file itself):
// the application never needs them, so they stay out of what the client islands import.
const { guardWords, ...applicationClub } = club;
void guardWords;

export const CLUB = {
  ...applicationClub,
  place: { ...club.place, country },
} satisfies Omit<ClubConfig, "guardWords">;
