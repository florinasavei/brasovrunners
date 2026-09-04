import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eventTranslations, events } from "@/db/schema/events";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { DEV_IDENTITIES, ensureDevStaffUser } from "@/modules/staff-identity/dev-switcher";
import { findStaffUserById, listStaffUsers } from "@/modules/staff-identity/repository";
import {
  changeStaffRole,
  inviteStaffUser,
  listStaff,
  revokeStaffUser,
} from "@/modules/staff-identity/service";
import { isDomainError } from "@/shared/errors/domain-error";
import { expectViolation, SQLSTATE } from "../../helpers/constraints";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * BR-REQ-060-01 — role boundaries are enforced server-side.
 *
 * Criterion 4 is the one that shapes these tests: authorization is asserted at the server, not
 * only in the interface. Every call below goes straight to the service that a Server Action
 * would call, with an actor of the wrong role, and expects a refusal — no page, no button, no
 * hidden field involved.
 */
describe("BR-REQ-060-01 staff administration is the Administrator's alone", () => {
  let db: TestDatabase;
  let close: () => Promise<void>;
  let author: StaffUser;
  let editor: StaffUser;
  let admin: StaffUser;

  beforeAll(async () => {
    ({ db, close } = await createTestDatabase());
  });
  afterAll(async () => close());

  beforeEach(async () => {
    await resetTables(db);
    [author] = await db
      .insert(staffUsers)
      .values({ email: "author@dev.test", displayName: "Author", role: "AUTHOR" })
      .returning();
    [editor] = await db
      .insert(staffUsers)
      .values({ email: "editor@dev.test", displayName: "Editor", role: "EDITOR" })
      .returning();
    [admin] = await db
      .insert(staffUsers)
      .values({ email: "admin@dev.test", displayName: "Admin", role: "ADMIN" })
      .returning();
  });

  async function codeOf(operation: Promise<unknown>): Promise<string> {
    try {
      await operation;
      return "no error";
    } catch (error) {
      if (isDomainError(error)) return error.code;
      throw error;
    }
  }

  describe("criteria 1 and 2 an Author and an Editor are refused role management", () => {
    it.each([
      ["an author", () => author],
      ["an editor", () => editor],
    ])("refuses %s the staff list", async (_name, actorOf) => {
      expect(await codeOf(listStaff(db, actorOf()))).toBe("FORBIDDEN");
    });

    it.each([
      ["an author", () => author],
      ["an editor", () => editor],
    ])("refuses %s an invitation", async (_name, actorOf) => {
      expect(
        await codeOf(
          inviteStaffUser(db, actorOf(), {
            email: "new@dev.test",
            displayName: "New",
            role: "ADMIN",
          }),
        ),
      ).toBe("FORBIDDEN");

      expect(await listStaffUsers(db), "nothing was created").toHaveLength(3);
    });

    it.each([
      ["an author", () => author],
      ["an editor", () => editor],
    ])("refuses %s a role change, including their own promotion", async (_name, actorOf) => {
      const actor = actorOf();
      expect(await codeOf(changeStaffRole(db, actor, actor.id, "ADMIN"))).toBe("FORBIDDEN");

      const unchanged = await findStaffUserById(db, actor.id);
      expect(unchanged?.role).toBe(actor.role);
    });

    it.each([
      ["an author", () => author],
      ["an editor", () => editor],
    ])("refuses %s the removal of anyone", async (_name, actorOf) => {
      expect(await codeOf(revokeStaffUser(db, actorOf(), admin.id))).toBe("FORBIDDEN");
      expect(await findStaffUserById(db, admin.id)).toBeDefined();
    });
  });

  describe("an Administrator invites, promotes and revokes", () => {
    it("adds a colleague as an allowlist entry with no sign-in yet", async () => {
      const invited = await inviteStaffUser(db, admin, {
        email: "Ana@Dev.test",
        displayName: "Ana",
        role: "EDITOR",
      });

      // The address is the allowlist key, so it is stored lowercased and nothing else is.
      expect(invited.email).toBe("ana@dev.test");
      expect(invited.displayName).toBe("Ana");
      expect(invited.role).toBe("EDITOR");
      // No provider subject until they actually sign in — and no password, ever.
      expect(invited.authSubject).toBeNull();
      expect(invited.firstSignedInAt).toBeNull();
      expect(Object.keys(invited)).not.toContain("password");
    });

    it("refuses a second invitation for the same address, however it is capitalized", async () => {
      await inviteStaffUser(db, admin, { email: "ana@dev.test", displayName: "Ana", role: "AUTHOR" });

      expect(
        await codeOf(
          inviteStaffUser(db, admin, { email: "ANA@dev.test", displayName: "Ana again", role: "ADMIN" }),
        ),
      ).toBe("CONFLICT");
    });

    it("refuses an invitation that is not an address or has no name", async () => {
      expect(
        await codeOf(inviteStaffUser(db, admin, { email: "ana", displayName: "Ana", role: "AUTHOR" })),
      ).toBe("VALIDATION_ERROR");
      expect(
        await codeOf(
          inviteStaffUser(db, admin, { email: "ana@dev.test", displayName: "  ", role: "AUTHOR" }),
        ),
      ).toBe("VALIDATION_ERROR");
      expect(
        await codeOf(
          inviteStaffUser(db, admin, { email: "ana@dev.test", displayName: "Ana", role: "OWNER" }),
        ),
      ).toBe("VALIDATION_ERROR");
    });

    it("changes a colleague's role", async () => {
      const promoted = await changeStaffRole(db, admin, author.id, "EDITOR");
      expect(promoted.role).toBe("EDITOR");
    });

    it("revokes access without taking the work with it", async () => {
      // The attribution columns are ON DELETE SET NULL, so a departing volunteer does not
      // delete the event pages they wrote.
      const [event] = await db
        .insert(events)
        .values({ kind: "RACE", startsAt: new Date("2026-10-11T06:00:00Z") })
        .returning();
      await db.insert(eventTranslations).values({
        eventId: event.id,
        locale: "ro",
        slug: "crosul-aniversar",
        title: "Crosul aniversar",
        locationName: "Parcul Tractorul",
        authorStaffUserId: author.id,
      });

      await revokeStaffUser(db, admin, author.id);

      expect(await findStaffUserById(db, author.id)).toBeUndefined();
      const [translation] = await db
        .select()
        .from(eventTranslations)
        .where(eq(eventTranslations.eventId, event.id));
      expect(translation.title).toBe("Crosul aniversar");
      expect(translation.authorStaffUserId).toBeNull();
    });
  });

  describe("the club cannot be locked out of its own backoffice", () => {
    it("refuses an Administrator their own role change", async () => {
      expect(await codeOf(changeStaffRole(db, admin, admin.id, "AUTHOR"))).toBe("FORBIDDEN");
    });

    it("refuses an Administrator their own removal", async () => {
      expect(await codeOf(revokeStaffUser(db, admin, admin.id))).toBe("FORBIDDEN");
    });

    it("refuses the demotion of the last Administrator", async () => {
      const [second] = await db
        .insert(staffUsers)
        .values({ email: "second@dev.test", displayName: "Second admin", role: "ADMIN" })
        .returning();

      // Two administrators: one may demote the other.
      await changeStaffRole(db, second, admin.id, "EDITOR");

      // One left, and nobody can take the last one away.
      expect(await codeOf(changeStaffRole(db, second, second.id, "EDITOR"))).toBe("FORBIDDEN");
      const [onlyAdmin] = await db.select().from(staffUsers).where(eq(staffUsers.role, "ADMIN"));
      expect(onlyAdmin.id).toBe(second.id);
    });

    it("refuses the removal of the last Administrator even by another Administrator", async () => {
      const [second] = await db
        .insert(staffUsers)
        .values({ email: "second@dev.test", displayName: "Second admin", role: "ADMIN" })
        .returning();

      await revokeStaffUser(db, second, admin.id);
      // `second` is now the only one; revoking them is refused, and self-removal already is.
      const [remaining] = await db.select().from(staffUsers).where(eq(staffUsers.role, "ADMIN"));
      expect(remaining.id).toBe(second.id);

      const [third] = await db
        .insert(staffUsers)
        .values({ email: "third@dev.test", displayName: "Third", role: "ADMIN" })
        .returning();
      await revokeStaffUser(db, third, second.id);
      expect(await codeOf(revokeStaffUser(db, third, third.id))).toBe("FORBIDDEN");
    });
  });

  describe("the database holds the same rules the service does", () => {
    it("refuses two rows for one address", async () => {
      await expectViolation(
        db
          .insert(staffUsers)
          .values({ email: "admin@dev.test", displayName: "Impostor", role: "ADMIN" }),
        { code: SQLSTATE.UNIQUE_VIOLATION },
      );
    });

    it("refuses an address that is not lowercased", async () => {
      await expectViolation(
        db.insert(staffUsers).values({ email: "Ana@Dev.test", displayName: "Ana", role: "AUTHOR" }),
        { code: SQLSTATE.CHECK_VIOLATION, constraint: "staff_users_email_is_lowercase" },
      );
    });

    it("refuses a role outside the three", async () => {
      await expectViolation(
        db.execute(
          "INSERT INTO staff_users (email, display_name, role) VALUES ('x@dev.test', 'X', 'SUPERUSER')",
        ),
        { code: SQLSTATE.INVALID_ENUM_INPUT },
      );
    });

    it("refuses a sign-in record with no subject behind it", async () => {
      await expectViolation(
        db.insert(staffUsers).values({
          email: "ana@dev.test",
          displayName: "Ana",
          role: "AUTHOR",
          firstSignedInAt: new Date(),
        }),
        { code: SQLSTATE.CHECK_VIOLATION, constraint: "staff_users_signed_in_has_subject" },
      );
    });
  });

  describe("the development staff switcher (AGENTS.md §13.1)", () => {
    it("creates a synthetic identity on demand and returns the same row next time", async () => {
      const first = await ensureDevStaffUser(db, "editor");
      const second = await ensureDevStaffUser(db, "editor");

      expect(second.id).toBe(first.id);
      expect(first.role).toBe("EDITOR");
      // Marked as synthetic in the data itself, not only in a comment.
      expect(first.authSubject?.startsWith("dev:")).toBe(true);
    });

    it("offers one identity per role, and no more", async () => {
      expect(DEV_IDENTITIES.map((identity) => identity.role).sort()).toEqual([
        "ADMIN",
        "AUTHOR",
        "EDITOR",
      ]);
      // Reserved by RFC 6761: these addresses can never be registered or delivered to, and
      // the `dev-` prefix keeps them out of the way of a real colleague's address.
      for (const identity of DEV_IDENTITIES) {
        expect(identity.email.endsWith(".test"), identity.email).toBe(true);
        expect(identity.email.startsWith("dev-"), identity.email).toBe(true);
      }
    });

    it("refuses an identity it does not know", async () => {
      // @ts-expect-error the key is typed; this is what an unchecked form field would send.
      expect(await codeOf(ensureDevStaffUser(db, "owner"))).toBe("VALIDATION_ERROR");
    });
  });
});
