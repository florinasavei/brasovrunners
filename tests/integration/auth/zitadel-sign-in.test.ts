import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { findStaffUserByEmail, findStaffUserByZitadelSubject, insertStaffUser } from "@/modules/staff-identity/repository";
import { resolveStaffUserId, resolveZitadelSignIn } from "@/modules/staff-identity/auth-callbacks";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * BR-REQ-060-01 — the Zitadel allowlist gate (AGENTS.md §13.1, DECISIONS.md §26).
 *
 * `staff_users` is the allowlist, and these are the two properties that make it one: an
 * uninvited address is refused however valid its Zitadel token is, and the first sign-in from
 * an invited address binds the subject rather than creating a new row.
 */
const NOW = new Date("2026-09-04T10:00:00.000Z");

describe("BR-REQ-060-01 Zitadel sign-in", () => {
  let db: TestDatabase;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ db, close } = await createTestDatabase());
  });
  afterAll(async () => close());

  beforeEach(async () => {
    await resetTables(db);
  });

  it("refuses an address nobody invited, even with a verified email", async () => {
    const allowed = await resolveZitadelSignIn(
      db,
      { subject: "zitadel:stranger", email: "stranger@example.test", emailVerified: true },
      NOW,
    );

    expect(allowed).toBe(false);
  });

  it("refuses a provider that has not verified the email", async () => {
    await insertStaffUser(db, { email: "ana@example.test", displayName: "Ana", role: "MODERATOR" });

    const allowed = await resolveZitadelSignIn(
      db,
      { subject: "zitadel:ana", email: "ana@example.test", emailVerified: false },
      NOW,
    );

    expect(allowed).toBe(false);
    // Never bound: an unverified email must not silently claim the invitation.
    expect((await findStaffUserByEmail(db, "ana@example.test"))?.zitadelSubject).toBeNull();
  });

  it("binds the subject on an invited address's first sign-in", async () => {
    const invited = await insertStaffUser(db, {
      email: "ana@example.test",
      displayName: "Ana",
      role: "MODERATOR",
    });
    expect(invited.zitadelSubject).toBeNull();

    const allowed = await resolveZitadelSignIn(
      db,
      { subject: "zitadel:ana-subject", email: "ana@example.test", emailVerified: true },
      NOW,
    );

    expect(allowed).toBe(true);
    const bound = await findStaffUserByZitadelSubject(db, "zitadel:ana-subject");
    expect(bound?.id).toBe(invited.id);
    expect(bound?.firstSignedInAt).toEqual(NOW);
  });

  it("allows a later sign-in by subject alone, without re-checking the invitation", async () => {
    await insertStaffUser(db, { email: "ana@example.test", displayName: "Ana", role: "MODERATOR" });
    await resolveZitadelSignIn(
      db,
      { subject: "zitadel:ana-subject", email: "ana@example.test", emailVerified: true },
      NOW,
    );

    const secondSignIn = await resolveZitadelSignIn(
      db,
      { subject: "zitadel:ana-subject", email: "ana@example.test", emailVerified: true },
      new Date(NOW.getTime() + 1000),
    );

    expect(secondSignIn).toBe(true);
  });

  it("refuses an address already bound to a different subject", async () => {
    const invited = await insertStaffUser(db, {
      email: "ana@example.test",
      displayName: "Ana",
      role: "MODERATOR",
    });
    await resolveZitadelSignIn(
      db,
      { subject: "zitadel:ana-subject", email: "ana@example.test", emailVerified: true },
      NOW,
    );

    // A second Zitadel account presenting the same email is not the same person the first
    // subject was bound to — refused rather than silently rebinding the row.
    const impostor = await resolveZitadelSignIn(
      db,
      { subject: "zitadel:someone-else", email: "ana@example.test", emailVerified: true },
      NOW,
    );

    expect(impostor).toBe(false);
    expect((await findStaffUserByEmail(db, "ana@example.test"))?.id).toBe(invited.id);
    expect((await findStaffUserByEmail(db, "ana@example.test"))?.zitadelSubject).toBe(
      "zitadel:ana-subject",
    );
  });

  it("resolves the staff user id the jwt callback attaches to the token", async () => {
    const invited = await insertStaffUser(db, {
      email: "ana@example.test",
      displayName: "Ana",
      role: "MODERATOR",
    });
    await resolveZitadelSignIn(
      db,
      { subject: "zitadel:ana-subject", email: "ana@example.test", emailVerified: true },
      NOW,
    );

    const staffUserId = await resolveStaffUserId(db, {
      subject: "zitadel:ana-subject",
      email: "ana@example.test",
    });

    expect(staffUserId).toBe(invited.id);
  });

  it("resolves nothing for an uninvited subject and email", async () => {
    const staffUserId = await resolveStaffUserId(db, {
      subject: "zitadel:stranger",
      email: "stranger@example.test",
    });

    expect(staffUserId).toBeUndefined();
  });
});
