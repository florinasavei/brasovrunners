import { createTranslator } from "next-intl";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { events, eventTranslations } from "@/db/schema/events";
import { participants } from "@/db/schema/participants";
import { registrations } from "@/db/schema/registrations";
import { resolveDisplayName } from "@/modules/registrations/names";
import ro from "../../../messages/ro.json";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";
import type { PublicEvent } from "@/modules/events/repository";

/**
 * §346 — the rendered start list, not just the counts behind it: what the brief calls a render
 * test. `countAnonymousStartListEntries` (`tests/privacy/public-surface.test.ts`) proves the
 * *query* cannot return a name; this proves the *page* built from it does not print one either
 * — the guarantee end to end, in the actual HTML a browser receives.
 *
 * `getDb` and `next-intl/server` are the only two things `StartList` reaches out for that a
 * plain function call cannot supply on its own — `getDb` because the component finds its own
 * database rather than taking one as an argument, `next-intl/server` because `getTranslations`
 * and `getLocale` read a live Next.js request. Both are mocked to the real thing they stand in
 * for: this test's own PGlite database, and next-intl's ordinary translator over the actual
 * `messages/*.json` content — so a wrong key fails here exactly as it would on the page.
 */
let db: TestDatabase;
let close: () => Promise<void>;

vi.mock("@/db/client", () => ({ getDb: () => db }));
vi.mock("next-intl/server", () => ({
  getTranslations: async (namespace: string) => {
    const messages = (namespace === "Event" ? ro.Event : (ro as Record<string, object>)[namespace]) as Record<
      string,
      string
    >;
    return createTranslator({ locale: "ro", messages, namespace: undefined });
  },
  getLocale: async () => "ro",
}));

const { default: StartList } = await import("@/modules/events/ui/StartList");

const NOW = new Date("2026-09-24T10:00:00.000Z");

async function createEvent(): Promise<PublicEvent> {
  const [event] = await db
    .insert(events)
    .values({
      type: "RACE",
      startsAt: new Date("2026-11-21T07:00:00.000Z"),
      registrationMode: "INTERNAL",
      editorialStatus: "PUBLISHED",
      publishedAt: NOW,
      participantListVisibility: "NAMES",
    })
    .returning();
  await db.insert(eventTranslations).values([
    { eventId: event.id, locale: "ro", slug: "cros-randare", title: "Cros" },
    { eventId: event.id, locale: "en", slug: "cross-render", title: "Cross" },
  ]);
  // Only `id`, `participantListVisibility` and the two dates the list's period counts from (§421)
  // are read by the component; the rest of `PublicEvent`'s shape is asserted nowhere here, so a
  // cast stands in for the full query.
  return { id: event.id, participantListVisibility: "NAMES", startsAt: event.startsAt, endsAt: event.endsAt } as unknown as PublicEvent;
}

async function createRegistration(
  eventId: string,
  input: { name: string; email: string; club?: string; city?: string; bibNumber?: number; listOptOut: boolean },
) {
  const [participant] = await db
    .insert(participants)
    .values({
      deliveryEmail: input.email,
      normalizedEmail: input.email.toLowerCase(),
      canonicalEmail: input.email.toLowerCase(),
      canonicalizationVersion: 1,
      defaultName: input.name,
      preferredLocale: "ro",
    })
    .returning();

  await db.insert(registrations).values({
    eventId,
    participantId: participant.id,
    status: "CONFIRMED",
    kind: "REAL",
    locale: "ro",
    registeredName: input.name,
    displayName: resolveDisplayName({ legalName: input.name }),
    clubName: input.club ?? null,
    city: input.city ?? null,
    bibNumber: input.bibNumber ?? null,
    privacyNoticeVersion: 1,
    privacyAcknowledgedAt: NOW,
    resultsNameConsent: false,
    resultsConsentVersion: 1,
    listOptOut: input.listOptOut,
    confirmedAt: NOW,
  });
}

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
});
afterAll(async () => close());
beforeEach(async () => resetTables(db));

describe("§346 the rendered start list carries a name only for those who ticked the box", () => {
  it("prints the named row, and an anonymous row with none of the opted-out person's fields", async () => {
    const event = await createEvent();
    await createRegistration(event.id, {
      name: "Ana Popescu",
      email: "ana@example.org",
      club: "CS Rapid",
      listOptOut: false,
    });
    await createRegistration(event.id, {
      name: "Secret Runner",
      email: "secret@example.org",
      club: "Clubul Ascuns",
      city: "Sibiu",
      bibNumber: 42,
      listOptOut: true,
    });

    const html = renderToStaticMarkup(await StartList({ event }));

    // The named row: exactly what §85 promises — the display name and the club.
    expect(html).toContain("Ana Popescu");
    expect(html).toContain("CS Rapid");

    // The anonymous row's own words, and the header count — both halves counted.
    expect(html).toContain("Participant (nume ascuns)");
    expect(html).toContain("2 participanți confirmați");
    expect(html).toContain("1 cu numele afișat");

    // Nothing of the opted-out person anywhere on the page: no name, no club, no city, no bib.
    expect(html).not.toContain("Secret Runner");
    expect(html).not.toContain("Secret");
    expect(html).not.toContain("Runner");
    expect(html).not.toContain("Clubul Ascuns");
    expect(html).not.toContain("Sibiu");
    expect(html).not.toContain("42");

    // §421: `data-nosnippet` on a `<section>`, which Google honours — not on the `<details>`
    // root, which it does not.
    expect(html).toMatch(/<section[^>]*data-nosnippet=""/);
    expect(html).not.toMatch(/<details[^>]*data-nosnippet=""/);
  });

  it("renders nothing at all when the club has not switched the list on", async () => {
    const event = { id: "00000000-0000-0000-0000-000000000000", participantListVisibility: "HIDDEN" } as unknown as PublicEvent;
    expect(await StartList({ event })).toBeNull();
  });
});
