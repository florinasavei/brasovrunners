import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { events, eventTranslations } from "@/db/schema/events";
import { legalDocuments } from "@/db/schema/legal-documents";
import { computeContentHash, type LegalDocumentTranslationInput } from "@/modules/legal-documents/domain/content-hash";
import { findFirstStatesNoticeVersion, insertLegalDocumentVersion } from "@/modules/legal-documents/repository";
import { participants } from "@/db/schema/participants";
import { registrations } from "@/db/schema/registrations";
import { findPublishedEventBySlug } from "@/modules/events/repository";
import {
  countAnonymousStartListEntries,
  countPublicStartList,
  countPublicStartListOthers,
  listPublicStartList,
  listPublicStartListOthers,
} from "@/modules/registrations/repository";
import { resolveDisplayName } from "@/modules/registrations/names";
import { expectViolation, SQLSTATE } from "../helpers/constraints";
import { createTestDatabase, resetTables, type TestDatabase } from "../helpers/db";

/**
 * BR-REQ-039-01 — the public start list, and the four things it must never contain.
 * BR-REQ-070-01 — no participant email reaches a public surface.
 * BR-REQ-034-01 — a public page reads derived availability, never the raw capacity.
 *
 * This file is a boundary test, not a feature test: it asks what the *public* queries can
 * return, so that a later join, a widened select list or a helpful new column cannot quietly
 * start publishing something nobody decided to publish. It may be extended. It must not be
 * weakened — every assertion here is a disclosure that was deliberately refused.
 */
const NOW = new Date("2026-09-05T10:00:00.000Z");

let db: TestDatabase;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
});
afterAll(async () => {
  await close();
});
beforeEach(async () => {
  await resetTables(db);
});

async function createEvent(overrides: Partial<typeof events.$inferInsert> = {}) {
  const [event] = await db
    .insert(events)
    .values({
      type: "GROUP_RUN",
      startsAt: new Date("2026-10-01T09:00:00.000Z"),
      registrationMode: "INTERNAL",
      ...overrides,
    })
    .returning();
  return event;
}

/**
 * A registration written straight to the table.
 *
 * The lifecycle is proved elsewhere; what is under test here is what a *read* exposes, and
 * inserting the end state directly is what lets one test hold a confirmed row, a test row, an
 * opted-out row and an unconfirmed one side by side.
 */
async function createRegistration(
  eventId: string,
  input: {
    name: string;
    email: string;
    status?: typeof registrations.$inferInsert.status;
    kind?: "REAL" | "TEST";
    displayName?: string;
    listOptOut?: boolean;
    confirmedAt?: Date;
    emailConfirmedAt?: Date;
    waitlistedAt?: Date;
    privacyNoticeVersion?: number;
    stravaUrl?: string;
    instagramHandle?: string;
    listSocials?: boolean;
    bibNumber?: number;
    provisionalBibNumber?: number;
  },
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
    status: input.status ?? "CONFIRMED",
    kind: input.kind ?? "REAL",
    locale: "ro",
    registeredName: input.name,
    displayName: input.displayName ?? resolveDisplayName({ legalName: input.name }),
    privacyNoticeVersion: input.privacyNoticeVersion ?? 1,
    privacyAcknowledgedAt: NOW,
    resultsNameConsent: false,
    resultsConsentVersion: 1,
    listOptOut: input.listOptOut ?? false,
    confirmedAt: input.confirmedAt ?? NOW,
    emailConfirmedAt: input.emailConfirmedAt ?? null,
    waitlistedAt: input.waitlistedAt ?? null,
    stravaUrl: input.stravaUrl ?? null,
    instagramHandle: input.instagramHandle ?? null,
    listSocials: input.listSocials ?? false,
    bibNumber: input.bibNumber ?? null,
    provisionalBibNumber: input.provisionalBibNumber ?? null,
  });
}

describe("BR-REQ-039-01 the start list is off until somebody turns it on", () => {
  it("defaults every event to HIDDEN", async () => {
    const event = await createEvent();
    expect(event.participantListVisibility).toBe("HIDDEN");
  });

  it("refuses NAMES for an event this platform does not register", async () => {
    // No participants exist to list for a NONE event, and for EXTERNAL the people who entered
    // are the other organizer's. The database refuses it, not only the service.
    await expectViolation(
      createEvent({ registrationMode: "NONE", participantListVisibility: "NAMES" }),
      { code: SQLSTATE.CHECK_VIOLATION, constraint: "events_participant_list_internal_only" },
    );
  });
});

describe("BR-REQ-039-01 what the start list may contain", () => {
  it("lists only confirmed participants who did not opt out, in confirmation order", async () => {
    const event = await createEvent();
    await createRegistration(event.id, {
      name: "Ana Popescu",
      email: "ana@example.org",
      confirmedAt: new Date("2026-09-02T08:00:00.000Z"),
    });
    await createRegistration(event.id, {
      name: "Bogdan Ionescu",
      email: "bogdan@example.org",
      confirmedAt: new Date("2026-09-01T08:00:00.000Z"),
    });

    // Everything below must be absent, each for its own reason.
    await createRegistration(event.id, {
      name: "Nu Vreau",
      email: "optout@example.org",
      listOptOut: true,
    });
    await createRegistration(event.id, {
      name: "Test Runner",
      email: "queue-demo@test.invalid",
      kind: "TEST",
    });
    await createRegistration(event.id, {
      name: "Inca Nu",
      email: "pending@example.org",
      status: "PENDING_DECLARATION",
      confirmedAt: undefined,
    });
    await createRegistration(event.id, {
      name: "Pe Lista",
      email: "waiting@example.org",
      status: "WAITLISTED",
    });
    await createRegistration(event.id, {
      name: "S-a Retras",
      email: "cancelled@example.org",
      status: "CANCELLED",
    });

    const listed = await listPublicStartList(db, event.id);

    // Bogdan confirmed first, so Bogdan is first — the order is a fact about the people, not
    // about insertion.
    expect(listed.map((row) => row.displayName)).toEqual(["Bogdan Ionescu", "Ana Popescu"]);
  });

  it("returns the name and nothing else — no email, no status, no identifier", async () => {
    const event = await createEvent();
    await createRegistration(event.id, { name: "Ana Popescu", email: "ana@example.org" });

    const [row] = await listPublicStartList(db, event.id);

    // The select list is the guarantee. A future join that widened it would fail here rather
    // than on the day somebody's address appeared on a race page.
    // The display name and the club they wrote (`DECISIONS.md` §85) — and nothing else.
    expect(Object.keys(row)).toEqual(["displayName", "clubName"]);
    expect(JSON.stringify(row)).not.toContain("@");
  });

  it("publishes the display name and never the legal name (BR-REQ-039-02)", async () => {
    const event = await createEvent();
    await createRegistration(event.id, {
      name: "Ana Maria Popescu",
      email: "ana.maria@example.org",
      displayName: "Ana P.",
    });

    const listed = await listPublicStartList(db, event.id);

    expect(listed).toEqual([{ displayName: "Ana P.", clubName: null }]);
    // The whole point of the pair of columns: a name on an identity document does not become
    // public because somebody entered a race.
    expect(JSON.stringify(listed)).not.toContain("Popescu");
  });

  it("does not list a TEST registration even when it is the only confirmed one", async () => {
    // AGENTS.md §12.6: a synthetic row occupies a place like anybody else, and appears on no
    // page a person reads.
    const event = await createEvent();
    await createRegistration(event.id, {
      name: "Test Runner",
      email: "queue-demo@test.invalid",
      kind: "TEST",
    });

    expect(await listPublicStartList(db, event.id)).toEqual([]);
  });
});

/**
 * §346 — the runners who did not tick "I want to appear" are still counted, as a number with
 * nothing else attached: the query behind that number selects `count()` alone, so there is no
 * name, club, position or anything else it could return even by a future mistake.
 */
describe("§346 what the anonymous count may contain — nothing but itself", () => {
  it("counts exactly the confirmed, real, opted-out rows — same event, same people, the other half of the list", async () => {
    const event = await createEvent();
    await createRegistration(event.id, { name: "Ana Popescu", email: "ana@example.org" });
    await createRegistration(event.id, { name: "Bogdan Ionescu", email: "bogdan@example.org" });
    await createRegistration(event.id, { name: "Nu Vreau", email: "optout@example.org", listOptOut: true });
    await createRegistration(event.id, { name: "Nici Eu", email: "optout2@example.org", listOptOut: true });
    // Everything below is excluded for its own reason, exactly as it is from the named list.
    await createRegistration(event.id, { name: "Test Runner", email: "queue-demo@test.invalid", kind: "TEST", listOptOut: true });
    await createRegistration(event.id, { name: "Inca Nu", email: "pending@example.org", status: "PENDING_DECLARATION", confirmedAt: undefined, listOptOut: true });
    await createRegistration(event.id, { name: "S-a Retras", email: "cancelled@example.org", status: "CANCELLED", listOptOut: true });

    expect(await countPublicStartList(db, event.id)).toBe(2);
    expect(await countAnonymousStartListEntries(db, event.id)).toBe(2);
  });

  it("returns a plain number — `countAnonymousStartListEntries`'s return type has no room for a name to leak through", async () => {
    // Unlike `listPublicStartList`, this query cannot be widened into returning a person by a
    // future accident: `repository.ts` types it `Promise<number>`, and this is what it hands a
    // caller — nothing that could be spread onto a page and read as a field.
    const event = await createEvent();
    await createRegistration(event.id, { name: "Ascuns Cineva", email: "hidden@example.org", listOptOut: true });

    const count = await countAnonymousStartListEntries(db, event.id);
    expect(typeof count).toBe("number");
  });

  it("a TEST registration is invisible on both halves of the list, even when it opted in", async () => {
    // AGENTS.md §12.6: `kind` appears in no condition the allocator or a public count uses —
    // and opting in changes nothing about that, because a synthetic row is not a person either.
    const event = await createEvent();
    await createRegistration(event.id, {
      name: "Test Runner",
      email: "queue-demo@test.invalid",
      kind: "TEST",
      listOptOut: false,
    });

    expect(await countPublicStartList(db, event.id)).toBe(0);
    expect(await countAnonymousStartListEntries(db, event.id)).toBe(0);
  });
});

/**
 * §396 (amending §32 and §143) — the rows the list gains once the privacy notice in force
 * describes the states: the ticked ones who have not confirmed yet, then the waiting list. A
 * deliberate widening, and a narrow one: a name, a club and a *group* — never the lifecycle's own
 * state, a date or an identifier — and never an unproved address, a withdrawal or a test row.
 */
describe("§396 what the pending and waiting rows may contain", () => {
  const at = (hour: number) => new Date(Date.UTC(2026, 8, 3, hour));

  it("lists the ticked pending, then the ticked waiting list in queue order — and nobody else", async () => {
    const event = await createEvent();
    // The pending group, by when the address was confirmed.
    await createRegistration(event.id, { name: "Carmen Pop", email: "carmen@example.org", status: "PENDING_DECLARATION", confirmedAt: undefined, emailConfirmedAt: at(3) });
    await createRegistration(event.id, { name: "Dan Oferit", email: "dan@example.org", status: "WAITLIST_OFFERED", confirmedAt: undefined, emailConfirmedAt: at(1) });
    // The waiting list, by `waitlisted_at` — inserted out of order on purpose.
    await createRegistration(event.id, { name: "Elena Doi", email: "elena@example.org", status: "WAITLISTED", confirmedAt: undefined, waitlistedAt: at(8) });
    await createRegistration(event.id, { name: "Florin Unu", email: "florin@example.org", status: "WAITLISTED", confirmedAt: undefined, waitlistedAt: at(5) });

    // Everything below is absent, each for its own reason.
    await createRegistration(event.id, { name: "Ana Confirmata", email: "ana@example.org" }); // the confirmed list's, not this one's
    await createRegistration(event.id, { name: "Nu Vrea", email: "optout@example.org", status: "WAITLISTED", confirmedAt: undefined, waitlistedAt: at(2), listOptOut: true });
    await createRegistration(event.id, { name: "Adresa Nedovedita", email: "unverified@example.org", status: "PENDING_EMAIL_CONFIRMATION", confirmedAt: undefined });
    await createRegistration(event.id, { name: "S-a Retras", email: "cancelled@example.org", status: "CANCELLED", confirmedAt: undefined });
    await createRegistration(event.id, { name: "A Expirat", email: "expired@example.org", status: "EXPIRED", confirmedAt: undefined });
    await createRegistration(event.id, { name: "Test Runner", email: "queue-demo@test.invalid", kind: "TEST", status: "PENDING_DECLARATION", confirmedAt: undefined, emailConfirmedAt: at(0) });
    const other = await createEvent();
    await createRegistration(other.id, { name: "Alt Eveniment", email: "elsewhere@example.org", status: "WAITLISTED", confirmedAt: undefined, waitlistedAt: at(1) });

    const rows = await listPublicStartListOthers(db, event.id, 1);
    expect(rows).toEqual([
      { displayName: "Dan Oferit", clubName: null, group: "PENDING" },
      { displayName: "Carmen Pop", clubName: null, group: "PENDING" },
      { displayName: "Florin Unu", clubName: null, group: "WAITLISTED" },
      { displayName: "Elena Doi", clubName: null, group: "WAITLISTED" },
    ]);
    expect(await countPublicStartListOthers(db, event.id, 1)).toEqual({ pending: 2, waitlisted: 2 });

    // A page is a slice of the same order.
    expect((await listPublicStartListOthers(db, event.id, 1, { offset: 1, limit: 2 })).map((row) => row.displayName)).toEqual(["Carmen Pop", "Florin Unu"]);
  });

  it("returns the name, the club and the group — no state, no date, no identifier, no address", async () => {
    const event = await createEvent();
    await createRegistration(event.id, { name: "Carmen Pop", email: "carmen@example.org", status: "WAITLIST_OFFERED", confirmedAt: undefined, emailConfirmedAt: NOW });

    const [row] = await listPublicStartListOthers(db, event.id, 1);
    expect(Object.keys(row)).toEqual(["displayName", "clubName", "group"]);
    // The group, never the lifecycle's own word: an offer is the club's business.
    expect(row.group).toBe("PENDING");
    expect(JSON.stringify(row)).not.toContain("WAITLIST_OFFERED");
    expect(JSON.stringify(row)).not.toContain("@");
  });
});

/**
 * §421 (narrowing §396) — a tick given under a notice that described a list of confirmed names
 * only covers that list. The pending and waiting groups hold only registrations that recorded the
 * first notice describing the states, or a later one; an older tick appears once confirmed, as it
 * always did.
 */
describe("§421 the pending and waiting rows follow the notice each runner was given", () => {
  const at = (hour: number) => new Date(Date.UTC(2026, 8, 3, hour));
  const statesBody = { sections: [{ paragraphs: ["Lista arată {{participantListStates}}."] }] };
  const plainBody = { sections: [{ paragraphs: ["Lista arată numele confirmate."] }] };

  async function approveNotice(version: number, bodies: { ro: unknown; en?: unknown }, withdrawn = false) {
    const translations: LegalDocumentTranslationInput[] = [
      { locale: "ro", title: "Notă", body: bodies.ro as LegalDocumentTranslationInput["body"] },
      ...(bodies.en ? [{ locale: "en" as const, title: "Notice", body: bodies.en as LegalDocumentTranslationInput["body"] }] : []),
    ];
    const id = await insertLegalDocumentVersion(db, {
      key: "PRIVACY_NOTICE",
      version,
      effectiveAt: new Date("2026-01-01T00:00:00.000Z"),
      isApproved: true,
      contentSha256: computeContentHash(translations),
      translations,
      now: NOW,
    });
    if (withdrawn) await db.update(legalDocuments).set({ withdrawnAt: NOW }).where(eq(legalDocuments.id, id));
  }

  it("a ticked pending or waiting row below the first marker notice is neither listed nor counted; at or above it, it is", async () => {
    const event = await createEvent();
    await createRegistration(event.id, { name: "Vechi Asteapta", email: "old-pending@example.org", status: "PENDING_DECLARATION", confirmedAt: undefined, emailConfirmedAt: at(1), privacyNoticeVersion: 1 });
    await createRegistration(event.id, { name: "Vechi Lista", email: "old-waiting@example.org", status: "WAITLISTED", confirmedAt: undefined, waitlistedAt: at(2), privacyNoticeVersion: 1 });
    await createRegistration(event.id, { name: "Nou Asteapta", email: "new-pending@example.org", status: "PENDING_DECLARATION", confirmedAt: undefined, emailConfirmedAt: at(3), privacyNoticeVersion: 2 });
    await createRegistration(event.id, { name: "Mai Nou Lista", email: "newer-waiting@example.org", status: "WAITLISTED", confirmedAt: undefined, waitlistedAt: at(4), privacyNoticeVersion: 3 });
    // A confirmed runner under the old notice is on the confirmed list, as that notice said.
    await createRegistration(event.id, { name: "Vechi Confirmat", email: "old-confirmed@example.org", privacyNoticeVersion: 1 });

    expect((await listPublicStartListOthers(db, event.id, 2)).map((row) => row.displayName)).toEqual(["Nou Asteapta", "Mai Nou Lista"]);
    expect(await countPublicStartListOthers(db, event.id, 2)).toEqual({ pending: 1, waitlisted: 1 });
    expect((await listPublicStartList(db, event.id)).map((row) => row.displayName)).toEqual(["Vechi Confirmat"]);
  });

  it("finds the first approved, not withdrawn notice whose every language names the marker", async () => {
    expect(await findFirstStatesNoticeVersion(db)).toBeNull();
    await approveNotice(1, { ro: plainBody, en: plainBody });
    // Romanian only: the list is one list, so one language is not enough.
    await approveNotice(2, { ro: statesBody, en: plainBody });
    // Withdrawn: offered nowhere, so nobody registered under it.
    await approveNotice(3, { ro: statesBody, en: statesBody }, true);
    expect(await findFirstStatesNoticeVersion(db)).toBeNull();
    await approveNotice(4, { ro: statesBody, en: statesBody });
    await approveNotice(5, { ro: statesBody, en: statesBody });
    expect(await findFirstStatesNoticeVersion(db)).toBe(4);
  });
});

/**
 * §500 (widening §106) — Strava and Instagram beside a name. A deliberate widening, and a narrow
 * one: only when the caller asks (the page does only behind the notice's gate), and even then a
 * value leaves the database only for a runner whose own tick is kept (`list_socials`). Without the
 * option the rows are exactly what they were — the keys above are unchanged.
 */
describe("§500 what the socials beside a name may contain", () => {
  const at = (hour: number) => new Date(Date.UTC(2026, 8, 3, hour));
  const strava = "https://www.strava.com/athletes/12345";

  it("returns no socials key at all unless asked, whatever the rows hold", async () => {
    const event = await createEvent();
    await createRegistration(event.id, { name: "Ana Pop", email: "ana@example.org", stravaUrl: strava, instagramHandle: "ana.pop", listSocials: true });
    await createRegistration(event.id, { name: "Carmen Pop", email: "carmen@example.org", status: "WAITLISTED", confirmedAt: undefined, waitlistedAt: at(1), stravaUrl: strava, listSocials: true });

    const [confirmed] = await listPublicStartList(db, event.id);
    expect(Object.keys(confirmed)).toEqual(["displayName", "clubName"]);
    const [waiting] = await listPublicStartListOthers(db, event.id, 1);
    expect(Object.keys(waiting)).toEqual(["displayName", "clubName", "group"]);
  });

  it("asked, prints a runner's socials only where that runner's tick is kept — never an unticked one's", async () => {
    const event = await createEvent();
    await createRegistration(event.id, { name: "Ana Pop", email: "ana@example.org", confirmedAt: at(1), stravaUrl: strava, instagramHandle: "ana.pop", listSocials: true });
    await createRegistration(event.id, { name: "Bogdan Ion", email: "bogdan@example.org", confirmedAt: at(2), stravaUrl: strava, instagramHandle: "bogdan.ion", listSocials: false });
    // Ticked, but off the list: not a row at all, so nothing of theirs is read.
    await createRegistration(event.id, { name: "Nu Vrea", email: "optout@example.org", confirmedAt: at(3), stravaUrl: strava, listSocials: true, listOptOut: true });
    await createRegistration(event.id, { name: "Carmen Pop", email: "carmen@example.org", status: "WAITLISTED", confirmedAt: undefined, waitlistedAt: at(1), instagramHandle: "carmen", listSocials: true });
    await createRegistration(event.id, { name: "Dan Oferit", email: "dan@example.org", status: "WAITLISTED", confirmedAt: undefined, waitlistedAt: at(2), instagramHandle: "dan", listSocials: false });

    expect(await listPublicStartList(db, event.id, undefined, { socials: true })).toEqual([
      { displayName: "Ana Pop", clubName: null, stravaUrl: strava, instagramHandle: "ana.pop" },
      { displayName: "Bogdan Ion", clubName: null, stravaUrl: null, instagramHandle: null },
    ]);
    expect(await listPublicStartListOthers(db, event.id, 1, undefined, { socials: true })).toEqual([
      { displayName: "Carmen Pop", clubName: null, group: "WAITLISTED", stravaUrl: null, instagramHandle: "carmen" },
      { displayName: "Dan Oferit", clubName: null, group: "WAITLISTED", stravaUrl: null, instagramHandle: null },
    ]);
    // Still no address, no identifier, no state beside the two.
    const [row] = await listPublicStartList(db, event.id, undefined, { socials: true });
    expect(Object.keys(row)).toEqual(["displayName", "clubName", "stravaUrl", "instagramHandle"]);
    expect(JSON.stringify(row)).not.toContain("@example.org");
  });
});

/**
 * §NNN (amending §396) — the race number beside a confirmed name. A deliberate widening, and the
 * narrowest there is: one key, `bibNumber`, only when the caller asks (the page does only while the
 * privacy notice in force names `{{participantListNumbers}}`), only on the confirmed list, and only
 * the settled column. Without the option the keys are exactly the ones pinned above.
 */
describe("§NNN what the race number on the public list may contain", () => {
  const at = (hour: number) => new Date(Date.UTC(2026, 8, 3, hour));

  it("returns no number key at all unless asked, whatever the rows hold", async () => {
    const event = await createEvent();
    await createRegistration(event.id, { name: "Ana Pop", email: "ana@example.org", bibNumber: 7 });
    await createRegistration(event.id, { name: "Carmen Pop", email: "carmen@example.org", status: "WAITLISTED", confirmedAt: undefined, waitlistedAt: at(1) });

    const [confirmed] = await listPublicStartList(db, event.id);
    expect(Object.keys(confirmed)).toEqual(["displayName", "clubName"]);
    expect(JSON.stringify(confirmed)).not.toContain("7");
    // With the socials alone, the socials' keys alone: one gate never opens the other.
    const [withSocials] = await listPublicStartList(db, event.id, undefined, { socials: true });
    expect(Object.keys(withSocials)).toEqual(["displayName", "clubName", "stravaUrl", "instagramHandle"]);
    // The others' query has no number to give at all (§548: none before the confirmation).
    const [waiting] = await listPublicStartListOthers(db, event.id, 1);
    expect(Object.keys(waiting)).toEqual(["displayName", "clubName", "group"]);
  });

  it("asked, adds `bibNumber` and nothing else — the settled number, null for a runner with none", async () => {
    const event = await createEvent();
    await createRegistration(event.id, { name: "Ana Pop", email: "ana@example.org", confirmedAt: at(1), bibNumber: 7 });
    await createRegistration(event.id, { name: "Bogdan Ion", email: "bogdan@example.org", confirmedAt: at(2) });
    // Off the list: not a row, so its number is never read (§186).
    await createRegistration(event.id, { name: "Nu Vrea", email: "optout@example.org", confirmedAt: at(3), bibNumber: 9, listOptOut: true });

    expect(await listPublicStartList(db, event.id, undefined, { numbers: true })).toEqual([
      { displayName: "Ana Pop", clubName: null, bibNumber: 7 },
      { displayName: "Bogdan Ion", clubName: null, bibNumber: null },
    ]);
    const [row] = await listPublicStartList(db, event.id, undefined, { numbers: true });
    expect(Object.keys(row)).toEqual(["displayName", "clubName", "bibNumber"]);
    const [both] = await listPublicStartList(db, event.id, undefined, { socials: true, numbers: true });
    expect(Object.keys(both)).toEqual(["displayName", "clubName", "stravaUrl", "instagramHandle", "bibNumber"]);
    expect(JSON.stringify(await listPublicStartList(db, event.id, undefined, { numbers: true }))).not.toContain("9");
  });

  it("gives the number of a confirmed runner whatever privacy notice their registration recorded (the owner, 2026-10-01)", async () => {
    const event = await createEvent();
    await createRegistration(event.id, { name: "Ana Pop", email: "ana@example.org", confirmedAt: at(1), bibNumber: 7, privacyNoticeVersion: 1 });
    await createRegistration(event.id, { name: "Bogdan Ion", email: "bogdan@example.org", confirmedAt: at(2), bibNumber: 8, privacyNoticeVersion: 2 });

    expect(await listPublicStartList(db, event.id, undefined, { numbers: true })).toEqual([
      { displayName: "Ana Pop", clubName: null, bibNumber: 7 },
      { displayName: "Bogdan Ion", clubName: null, bibNumber: 8 },
    ]);
    // Without the gate no number is selected at all.
    expect(Object.keys((await listPublicStartList(db, event.id))[0])).toEqual(["displayName", "clubName"]);
  });

  /*
    Never the provisional number (§214, kept by §548): it was printed nowhere and emailed to nobody so
    that it could move — a number published beside a name is a number that cannot. Nothing writes the
    column since §548, which is no reason to let a public read name it.
  */
  it("never reads `provisional_bib_number`, not even for a row that still holds one", async () => {
    const event = await createEvent();
    await createRegistration(event.id, { name: "Ana Pop", email: "ana@example.org", provisionalBibNumber: 4321 });

    const listed = await listPublicStartList(db, event.id, undefined, { socials: true, numbers: true });
    expect(listed).toEqual([{ displayName: "Ana Pop", clubName: null, stravaUrl: null, instagramHandle: null, bibNumber: null }]);
    expect(JSON.stringify(listed)).not.toContain("4321");
  });

  it("names `provisionalBibNumber` in no public start-list query's source", () => {
    const source = readFileSync("src/modules/registrations/repository.ts", "utf8");
    // Each public query, and the two helpers their gated columns come from: from its declaration to the next one.
    const publicReads = [
      "function publicSocialColumns",
      "function publicNumberColumns",
      "export async function listPublicStartList<",
      "export async function countPublicStartList<",
      "export async function countAnonymousStartListEntries<",
      "export async function listPublicStartListOthers<",
      "export async function countPublicStartListOthers<",
    ];
    for (const start of publicReads) {
      const at = source.indexOf(start);
      expect(at, start).toBeGreaterThan(-1);
      const next = source.slice(at + start.length).search(/\n(export )?(async )?function /);
      const body = next === -1 ? source.slice(at) : source.slice(at, at + start.length + next);
      // The code, not the comments: the next declaration's doc comment may well explain why the column is refused.
      const code = body.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
      expect(code, start).not.toMatch(/provisionalBibNumber|provisional_bib_number/);
      // And the select list it guards is in the slice: a slice that missed the query would prove nothing.
      if (start.startsWith("export")) expect(code, start).toMatch(/\.select\(/);
    }
  });
});

describe("BR-REQ-070-01 the public event query", () => {
  it("carries no email, no capacity and no declaration identifier", async () => {
    const event = await createEvent({ editorialStatus: "PUBLISHED", publishedAt: NOW, capacity: 20 });
    await db.insert(eventTranslations).values({
      eventId: event.id,
      locale: "ro",
      slug: "alergare",
      title: "Alergare",
    });
    await createRegistration(event.id, { name: "Ana Popescu", email: "ana@example.org" });

    const row = await findPublishedEventBySlug(db, "ro", "alergare");

    expect(row).toBeDefined();
    const keys = Object.keys(row as object);
    // Capacity is deliberately absent: a public page reads the derived availability
    // (BR-REQ-034-01), never the raw number, and there is no column here to leak it from.
    expect(keys).not.toContain("capacity");
    expect(keys).not.toContain("declarationDocumentId");
    expect(keys.filter((key) => /email/i.test(key))).toEqual([]);
    expect(JSON.stringify(row)).not.toContain("@");
  });
});
