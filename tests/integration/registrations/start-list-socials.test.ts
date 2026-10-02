import { createTranslator } from "next-intl";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { events, eventTranslations } from "@/db/schema/events";
import { participants } from "@/db/schema/participants";
import { registrations, type RegistrationStatus } from "@/db/schema/registrations";
import type { PublicEvent } from "@/modules/events/repository";
import { computeContentHash, type LegalDocumentBody } from "@/modules/legal-documents/domain/content-hash";
import { insertLegalDocumentVersion } from "@/modules/legal-documents/repository";
import { privacyNoticeEn, privacyNoticeRo } from "@/modules/legal-documents/templates/privacy-notice";
import { resolveDisplayName } from "@/modules/registrations/names";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * BR-REQ-039-01, `DECISIONS.md` §500 (widening §106) — the rendered public list with Strava and
 * Instagram beside a name, both faces of the gate.
 *
 * With the platform's privacy notice in force — it names `{{participantListSocials}}` — a named
 * row whose runner ticked «Arată și Strava și Instagram» carries the networks' marks, each a link
 * to the profile; nobody else's does, and a hidden row never. With an older notice the list reads
 * no social at all. Mocked as `start-list-states.test.ts` mocks it.
 */
let db: TestDatabase;
let close: () => Promise<void>;
let locale: "ro" | "en" = "ro";

vi.mock("@/db/client", () => ({ getDb: () => db }));
vi.mock("next-intl/server", () => ({
  getTranslations: async (namespace: string) => {
    const catalogue = (locale === "ro" ? ro : en) as unknown as Record<string, Record<string, string>>;
    return createTranslator({ locale, messages: catalogue[namespace], namespace: undefined });
  },
  getLocale: async () => locale,
}));

const { default: StartList } = await import("@/modules/events/ui/StartList");

const NOW = new Date("2026-09-24T10:00:00.000Z");
const at = (hour: number) => new Date(Date.UTC(2026, 8, 20, hour));
const STRAVA = "https://www.strava.com/athletes/12345";

async function approveNotice(bodies: { ro: LegalDocumentBody; en: LegalDocumentBody }) {
  const translations = [
    { locale: "ro" as const, title: "Nota de confidențialitate", body: bodies.ro },
    { locale: "en" as const, title: "Privacy notice", body: bodies.en },
  ];
  await insertLegalDocumentVersion(db, {
    key: "PRIVACY_NOTICE",
    version: 1,
    effectiveAt: new Date(NOW.getTime() - 60_000),
    isApproved: true,
    contentSha256: computeContentHash(translations),
    translations,
    now: NOW,
  });
}

/** A notice approved before §500: it describes the list and says nothing of socials. */
const OLDER_NOTICE = {
  ro: { sections: [{ heading: "4. Lista publică", paragraphs: ["Lista publică arată doar numele participanților confirmați care au bifat."] }] },
  en: { sections: [{ heading: "4. Public list", paragraphs: ["The public list shows only the names of confirmed participants who ticked."] }] },
};

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
      // The waiting row below is on the list only with the event's own switch (§628).
      waitlistPublic: true,
    })
    .returning();
  await db.insert(eventTranslations).values([
    { eventId: event.id, locale: "ro", slug: "cros-social", title: "Cros" },
    { eventId: event.id, locale: "en", slug: "cross-social", title: "Cross" },
  ]);
  return { id: event.id, participantListVisibility: "NAMES", waitlistPublic: true, startsAt: event.startsAt, endsAt: event.endsAt } as unknown as PublicEvent;
}

async function register(
  eventId: string,
  input: {
    name: string;
    status?: RegistrationStatus;
    listOptOut?: boolean;
    confirmedAt?: Date;
    waitlistedAt?: Date;
    stravaUrl?: string;
    instagramHandle?: string;
    listSocials?: boolean;
  },
) {
  const email = `${input.name.toLowerCase().replace(/[^a-z]+/g, ".")}@example.org`;
  const [participant] = await db
    .insert(participants)
    .values({ deliveryEmail: email, normalizedEmail: email, canonicalEmail: email, canonicalizationVersion: 1, defaultName: input.name, preferredLocale: "ro" })
    .returning();
  await db.insert(registrations).values({
    eventId,
    participantId: participant.id,
    status: input.status ?? "CONFIRMED",
    kind: "REAL",
    locale: "ro",
    registeredName: input.name,
    displayName: resolveDisplayName({ legalName: input.name }),
    privacyNoticeVersion: 1,
    privacyAcknowledgedAt: NOW,
    resultsNameConsent: false,
    resultsConsentVersion: 1,
    listOptOut: input.listOptOut ?? false,
    confirmedAt: input.status && input.status !== "CONFIRMED" ? null : (input.confirmedAt ?? at(1)),
    waitlistedAt: input.waitlistedAt ?? null,
    stravaUrl: input.stravaUrl ?? null,
    instagramHandle: input.instagramHandle ?? null,
    listSocials: input.listSocials ?? false,
  });
}

/** Everyone the gate must tell apart: a ticked runner, an unticked one, a hidden one, a waiting one. */
async function mixedEvent(): Promise<PublicEvent> {
  const event = await createEvent();
  await register(event.id, { name: "Ana Popescu", confirmedAt: at(1), stravaUrl: STRAVA, instagramHandle: "ana.pop", listSocials: true });
  await register(event.id, { name: "Bogdan Ionescu", confirmedAt: at(2), stravaUrl: STRAVA, instagramHandle: "bogdan.ion", listSocials: false });
  await register(event.id, { name: "Ascuns Confirmat", confirmedAt: at(3), listOptOut: true, instagramHandle: "hidden.runner", listSocials: true });
  await register(event.id, { name: "Florin Asteapta", status: "WAITLISTED", waitlistedAt: at(6), instagramHandle: "florin.runs", listSocials: true });
  return event;
}

/** The profile links the table printed, in order. */
function socialLinks(html: string): Array<{ network: string; href: string; label: string }> {
  return [...html.matchAll(/<a [^>]*href="([^"]+)"[^>]*aria-label="([^"]+)"[^>]*data-network="([a-z]+)"/g)].map((match) => ({
    href: match[1].replace(/&amp;/g, "&"),
    label: match[2],
    network: match[3],
  }));
}

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
});
afterAll(async () => close());
beforeEach(async () => {
  locale = "ro";
  await resetTables(db);
});

describe("§500 with a notice that describes the socials", () => {
  it("links the ticked runners' Strava and Instagram beside their names, and nobody else's", async () => {
    await approveNotice({ ro: privacyNoticeRo, en: privacyNoticeEn });
    const event = await mixedEvent();

    const html = renderToStaticMarkup(await StartList({ event }));

    expect(socialLinks(html)).toEqual([
      { network: "strava", href: STRAVA, label: "Ana Popescu pe Strava" },
      { network: "instagram", href: "https://www.instagram.com/ana.pop/", label: "Ana Popescu pe Instagram" },
      // The waiting list is behind §396's gate too, which the platform's notice also opens.
      { network: "instagram", href: "https://www.instagram.com/florin.runs/", label: "Florin Asteapta pe Instagram" },
    ]);
    // Unticked: the name, never the socials — nor anything of a hidden runner's.
    expect(html).not.toContain("bogdan.ion");
    expect(html).not.toContain("hidden.runner");
    // A profile is somebody else's page: a new tab, no referrer, not endorsed.
    expect(html).toContain('rel="noopener noreferrer nofollow ugc"');
    expect(html).toContain(ro.Event.startList.socialsNote);
  });

  it("names the links in English", async () => {
    await approveNotice({ ro: privacyNoticeRo, en: privacyNoticeEn });
    const event = await mixedEvent();
    locale = "en";

    const labels = socialLinks(renderToStaticMarkup(await StartList({ event }))).map((link) => link.label);

    expect(labels).toEqual(["Ana Popescu on Strava", "Ana Popescu on Instagram", "Florin Asteapta on Instagram"]);
  });

  it("never prints a stored value that is not the network's own address", async () => {
    await approveNotice({ ro: privacyNoticeRo, en: privacyNoticeEn });
    const event = await createEvent();
    await register(event.id, { name: "Ana Popescu", stravaUrl: "https://example.com/phish", instagramHandle: "bad handle!", listSocials: true });

    const html = renderToStaticMarkup(await StartList({ event }));

    expect(socialLinks(html)).toEqual([]);
    expect(html).not.toContain("example.com");
    expect(html).not.toContain('data-testid="start-list-socials"');
  });
});

describe("§500 with a notice that does not describe them", () => {
  it("reads no social at all: the list is as it was", async () => {
    await approveNotice(OLDER_NOTICE);
    const event = await mixedEvent();

    const html = renderToStaticMarkup(await StartList({ event }));

    expect(html).toContain("Ana Popescu");
    expect(socialLinks(html)).toEqual([]);
    expect(html).not.toContain("strava.com");
    expect(html).not.toContain("instagram.com");
    expect(html).not.toContain(ro.Event.startList.socialsNote);
  });
});
