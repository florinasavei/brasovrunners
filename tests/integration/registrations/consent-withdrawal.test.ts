import { asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { emailActionTokens } from "@/db/schema/email-action-tokens";
import { emailOutbox } from "@/db/schema/email-outbox";
import { events } from "@/db/schema/events";
import { participants } from "@/db/schema/participants";
import { registrations } from "@/db/schema/registrations";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import type { StaffRole } from "@/modules/staff-identity/domain/roles";
import { canonicalizeEmail } from "@/modules/participants/domain/canonical-email";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * BR-REQ-031-05 and `AGENTS.md` §15.11 — withdrawing what was given on consent (§NNN).
 *
 * The privacy notice said the health note was "retractabilă oricând", and the only way to
 * withdraw it was to write to the club. Three doors now, one write: the manage link, "Înscrierile
 * mele", and the Administrator's staff verb. What every test here holds to:
 *
 * - exactly the named group is cleared — nulled, not flagged — and nothing else moves: not the
 *   status, not the place, not the race number, no message queued;
 * - the trail names the fields and the door, never what they held;
 * - the participant's link is read, never spent, and a GET changes nothing (BR-REQ-036-02 c4);
 * - the staff verb is the Administrator's: an Organizer reads the note and cannot delete it, and
 *   the refusal is the server's (BR-REQ-060-01).
 */
const NOW = new Date("2026-09-04T10:00:00.000Z");
const RACE_DAY = new Date("2026-10-01T09:00:00.000Z");

let db: TestDatabase;
let close: () => Promise<void>;

// A getter, resolved when the module under test calls it: the manage page reads through `getDb()`.
vi.mock("@/db/client", () => ({ getDb: () => db }));

const { issueActionToken } = await import("@/modules/action-tokens/repository");
const { withdrawFromManageLink, withdrawFromMyRegistrations } = await import("@/modules/registrations/consent-withdrawal");
const { withdrawOptionalData } = await import("@/modules/registrations/admin-service");
const { readMyRegistrations } = await import("@/modules/registrations/my-registrations");
const { readRaceDayContext } = await import("@/modules/registrations/token-actions");
const { isDomainError } = await import("@/shared/errors/domain-error");

let participantId: string;
let strangerId: string;
let eventId: string;

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
});
afterAll(async () => close());

async function seedParticipant(email: string): Promise<string> {
  const identity = canonicalizeEmail(email);
  const [row] = await db
    .insert(participants)
    .values({
      deliveryEmail: identity.deliveryEmail,
      normalizedEmail: identity.normalizedEmail,
      canonicalEmail: identity.canonicalEmail,
      canonicalizationVersion: identity.canonicalizationVersion,
      defaultName: email,
    })
    .returning();
  return row.id;
}

/** A confirmed registration holding a place and a number, with a health note, socials and the results consent. */
async function seedRegistration(owner = participantId): Promise<string> {
  const [row] = await db
    .insert(registrations)
    .values({
      eventId,
      participantId: owner,
      status: "CONFIRMED",
      locale: "ro",
      registeredName: "Ana Popescu",
      displayName: "Ana P.",
      privacyNoticeVersion: 1,
      privacyAcknowledgedAt: NOW,
      resultsNameConsent: true,
      listOptOut: false,
      resultsConsentVersion: 1,
      confirmedAt: NOW,
      bibNumber: 17,
      phone: "+40711111111",
      healthNotes: "astm, inhalator în rucsac",
      healthConsentVersion: 1,
      healthConsentAt: NOW,
      stravaUrl: "https://www.strava.com/athletes/12345",
      instagramHandle: "ana.pop",
    })
    .returning();
  return row.id;
}

async function row(id: string) {
  const [registration] = await db.select().from(registrations).where(eq(registrations.id, id));
  return registration;
}

async function staff(role: StaffRole): Promise<StaffUser> {
  const [user] = await db
    .insert(staffUsers)
    .values({ email: `${role.toLowerCase()}@dev.test`, displayName: role, role })
    .returning();
  return user;
}

const manageToken = async (registrationId: string) =>
  (await issueActionToken(db, { participantId, registrationId, purpose: "MANAGE_REGISTRATION", expiresAt: RACE_DAY, now: NOW })).secret;
const profileToken = async (owner = participantId) =>
  (await issueActionToken(db, { participantId: owner, registrationId: null, purpose: "MANAGE_PROFILE", expiresAt: RACE_DAY, now: NOW })).secret;

beforeEach(async () => {
  await resetTables(db);
  participantId = await seedParticipant("ana@example.ro");
  strangerId = await seedParticipant("ion@example.ro");
  const [event] = await db
    .insert(events)
    .values({ type: "RACE", startsAt: RACE_DAY, registrationMode: "INTERNAL", capacity: 10 })
    .returning();
  eventId = event.id;
});

describe("BR-REQ-031-05 the participant withdraws their own health note and socials (§NNN)", () => {
  it("clears the health note and its consent from the manage link, and nothing else", async () => {
    const id = await seedRegistration();
    const before = await row(id);
    const secret = await manageToken(id);

    expect(await withdrawFromManageLink(db, secret, "health", NOW)).toEqual({ ok: true, cleared: ["health"] });

    const after = await row(id);
    expect([after.healthNotes, after.healthConsentVersion, after.healthConsentAt]).toEqual([null, null, null]);
    // Exactly its fields: the socials, the results consent, the place and the number are as they were.
    expect(after.stravaUrl).toBe(before.stravaUrl);
    expect(after.instagramHandle).toBe(before.instagramHandle);
    expect(after.resultsNameConsent).toBe(true);
    expect(after.status).toBe("CONFIRMED");
    expect(after.bibNumber).toBe(17);
    expect(after.phone).toBe(before.phone);
    // No message: withdrawing is not news to the person who did it.
    expect(await db.select().from(emailOutbox)).toHaveLength(0);
    // The link was read, not spent: the same page can still cancel.
    const [token] = await db.select().from(emailActionTokens).where(eq(emailActionTokens.purpose, "MANAGE_REGISTRATION"));
    expect(token.usedAt).toBeNull();

    const trail = await db.select().from(auditLogs);
    expect(trail.map((entry) => [entry.action, entry.actorStaffUserId, entry.entityId, entry.metadataJson])).toEqual([
      ["registration.consent_withdrawn", null, id, { fields: ["health"], via: "MANAGE_LINK" }],
    ]);
    // AGENTS.md §12.12: the fields' names, never what they held.
    expect(JSON.stringify(trail)).not.toMatch(/astm|inhalator|strava\.com|ana\.pop/);
  });

  it("clears the Strava link and the Instagram username from \"Înscrierile mele\", and nothing else", async () => {
    const id = await seedRegistration();
    const secret = await profileToken();

    expect(await withdrawFromMyRegistrations(db, secret, id, "socials", NOW)).toEqual({ ok: true, cleared: ["socials"] });

    const after = await row(id);
    expect([after.stravaUrl, after.instagramHandle]).toEqual([null, null]);
    expect(after.healthNotes).toBe("astm, inhalator în rucsac");
    expect(after.status).toBe("CONFIRMED");
    expect(after.bibNumber).toBe(17);
    const [entry] = await db.select().from(auditLogs);
    expect(entry.metadataJson).toEqual({ fields: ["socials"], via: "MY_REGISTRATIONS" });
  });

  it("writes nothing the second time: an empty group is not a change", async () => {
    const id = await seedRegistration();
    const secret = await manageToken(id);
    await withdrawFromManageLink(db, secret, "health", NOW);

    expect(await withdrawFromManageLink(db, secret, "health", NOW)).toEqual({ ok: true, cleared: [] });
    expect(await db.select().from(auditLogs)).toHaveLength(1);
  });

  it("refuses somebody else's registration under a profile link, and changes nothing", async () => {
    const theirs = await seedRegistration(strangerId);
    const secret = await profileToken();

    await expect(withdrawFromMyRegistrations(db, secret, theirs, "health", NOW)).rejects.toSatisfy(
      (error: unknown) => isDomainError(error) && error.code === "NOT_FOUND",
    );
    expect((await row(theirs)).healthNotes).toBe("astm, inhalator în rucsac");
    expect(await db.select().from(auditLogs)).toHaveLength(0);
  });

  it("refuses a token that is not a manage link, and changes nothing", async () => {
    const id = await seedRegistration();
    const wrong = (await issueActionToken(db, { participantId, registrationId: id, purpose: "LIST_CONSENT", expiresAt: RACE_DAY, now: NOW })).secret;

    expect((await withdrawFromManageLink(db, wrong, "health", NOW)).ok).toBe(false);
    expect((await row(id)).healthNotes).toBe("astm, inhalator în rucsac");
  });

  it("GET: the pages learn whether there is something to withdraw, and change nothing", async () => {
    const id = await seedRegistration();
    const before = await row(id);

    const mine = await readMyRegistrations(db, await profileToken(), "ro", NOW);
    expect(mine.ok).toBe(true);
    if (mine.ok) {
      expect(mine.items.map((item) => [item.holdsHealthNote, item.holdsSocials])).toEqual([[true, true]]);
      // Booleans only: the note itself is not on the page's data.
      expect(JSON.stringify(mine.items)).not.toContain("astm");
    }
    const manage = await readRaceDayContext(await manageToken(id), NOW);
    expect(manage.ok).toBe(true);

    // BR-REQ-036-02 criterion 4: the row, the tokens and the trail are as they were.
    expect(await row(id)).toEqual(before);
    expect(await db.select().from(auditLogs)).toHaveLength(0);
    const tokens = await db.select().from(emailActionTokens).orderBy(asc(emailActionTokens.createdAt));
    expect(tokens.every((token) => token.usedAt === null)).toBe(true);
  });
});

describe("AGENTS.md §15.11 an Administrator withdraws consent on the participant's behalf (§NNN)", () => {
  it("clears the ticked groups, records the reason and the field names, and moves nothing else", async () => {
    const admin = await staff("ADMIN");
    const id = await seedRegistration();

    const result = await withdrawOptionalData(db, admin, id, { health: true, socials: true, results: true }, "a scris pe email", NOW);
    expect(result.cleared).toEqual(["health", "socials", "results"]);

    const after = await row(id);
    expect([after.healthNotes, after.healthConsentAt, after.stravaUrl, after.instagramHandle, after.resultsNameConsent]).toEqual([
      null,
      null,
      null,
      null,
      false,
    ]);
    expect(after.status).toBe("CONFIRMED");
    expect(after.bibNumber).toBe(17);
    expect(await db.select().from(emailOutbox)).toHaveLength(0);

    const [entry] = await db.select().from(auditLogs);
    expect(entry.action).toBe("registration.consent_withdrawn");
    expect(entry.actorStaffUserId).toBe(admin.id);
    expect(entry.metadataJson).toEqual({ fields: ["health", "socials", "results"], via: "STAFF", reason: "a scris pe email" });
  });

  it("clears exactly the one group ticked", async () => {
    const superadmin = await staff("SUPERADMIN");
    const id = await seedRegistration();

    await withdrawOptionalData(db, superadmin, id, { results: true }, "motiv", NOW);

    const after = await row(id);
    expect(after.resultsNameConsent).toBe(false);
    expect(after.healthNotes).toBe("astm, inhalator în rucsac");
    expect(after.stravaUrl).not.toBeNull();
  });

  it.each(["CONTRIBUTOR", "COPYWRITER", "MODERATOR", "DEV"] as const)(
    "refuses a %s on the server, and changes nothing (BR-REQ-060-01)",
    async (role) => {
      const actor = await staff(role);
      const id = await seedRegistration();

      await expect(withdrawOptionalData(db, actor, id, { health: true }, "no", NOW)).rejects.toSatisfy(
        (error: unknown) => isDomainError(error) && error.code === "FORBIDDEN",
      );
      expect((await row(id)).healthNotes).toBe("astm, inhalator în rucsac");
      expect(await db.select().from(auditLogs)).toHaveLength(0);
    },
  );

  it("refuses a withdrawal that names nothing", async () => {
    const admin = await staff("ADMIN");
    const id = await seedRegistration();
    await expect(withdrawOptionalData(db, admin, id, {}, "motiv", NOW)).rejects.toSatisfy(
      (error: unknown) => isDomainError(error) && error.code === "VALIDATION_ERROR",
    );
  });
});
