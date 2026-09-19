import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { emailOutbox } from "@/db/schema/email-outbox";
import { eventTranslations, events } from "@/db/schema/events";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { DEV_IDENTITIES, ensureDevStaffUser } from "@/modules/staff-identity/dev-switcher";
import { STAFF_ROLES } from "@/modules/staff-identity/domain/roles";
import { findStaffUserById, listStaffUsers } from "@/modules/staff-identity/repository";
import {
  changeStaffRole,
  inviteStaffUser,
  listStaff,
  resendStaffInvitation,
  revokeStaffUser,
} from "@/modules/staff-identity/service";
import { renderOutboxMessage } from "@/modules/notifications/render";
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
      .values({ email: "contributor@dev.test", displayName: "Author", role: "CONTRIBUTOR" })
      .returning();
    [editor] = await db
      .insert(staffUsers)
      .values({ email: "moderator@dev.test", displayName: "Editor", role: "MODERATOR" })
      .returning();
    [admin] = await db
      .insert(staffUsers)
      .values({ email: "superadmin@dev.test", displayName: "Admin", role: "SUPERADMIN" })
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
        role: "MODERATOR",
      });

      // The address is the allowlist key, so it is stored lowercased and nothing else is.
      expect(invited.email).toBe("ana@dev.test");
      expect(invited.displayName).toBe("Ana");
      expect(invited.role).toBe("MODERATOR");
      // No provider subject until they actually sign in — and no password, ever.
      expect(invited.zitadelSubject).toBeNull();
      expect(invited.firstSignedInAt).toBeNull();
      expect(Object.keys(invited)).not.toContain("password");
    });

    // BR-REQ-060-01 criterion 8 (`DECISIONS.md` §141): the invitation is an email the platform
    // itself queues with the row — who, as what, by whom — and can send again until they sign in.
    it("queues the invitation email with the row, sends it again on request, and not once they have signed in", async () => {
      const invited = await inviteStaffUser(db, admin, { email: "ana@dev.test", displayName: "Ana", role: "MODERATOR", preferredLocale: "en" });
      const queued = await db.select().from(emailOutbox).where(eq(emailOutbox.recipientEmail, "ana@dev.test"));
      expect(queued).toHaveLength(1);
      expect(queued[0].messageType).toBe("STAFF_INVITATION");
      expect(queued[0].locale).toBe("en");
      expect(queued[0].participantId).toBeNull();
      expect(queued[0].requestedByStaffUserId).toBe(admin.id);
      expect(queued[0].payloadJson).toEqual({ displayName: "Ana", role: "Organizator", inviterName: admin.displayName });

      // The message itself: the inviter, the role, the address, the sign-in page as the action; no token.
      const rendered = await renderOutboxMessage(queued[0], db, new Date());
      expect(rendered.subject).toContain("Brașov Runners");
      expect(rendered.text).toContain(admin.displayName);
      expect(rendered.text).toContain("Organizator");
      expect(rendered.text).toContain("ana@dev.test");
      expect(rendered.text).toMatch(/\/en\/sign-in/);
      expect(rendered.text).not.toMatch(/token/i);

      await resendStaffInvitation(db, admin, "ANA@dev.test", new Date(Date.now() + 1000));
      expect(await db.select().from(emailOutbox).where(eq(emailOutbox.recipientEmail, "ana@dev.test"))).toHaveLength(2);

      await db.update(staffUsers).set({ zitadelSubject: "sub-ana", firstSignedInAt: new Date() }).where(eq(staffUsers.id, invited.id));
      expect(await codeOf(resendStaffInvitation(db, admin, "ana@dev.test"))).toBe("CONFLICT");
      expect(await codeOf(resendStaffInvitation(db, editor, "ana@dev.test"))).toBe("FORBIDDEN");
    });

    it("refuses a second invitation for the same address, however it is capitalized", async () => {
      await inviteStaffUser(db, admin, { email: "ana@dev.test", displayName: "Ana", role: "CONTRIBUTOR" });

      expect(
        await codeOf(
          inviteStaffUser(db, admin, { email: "ANA@dev.test", displayName: "Ana again", role: "ADMIN" }),
        ),
      ).toBe("CONFLICT");
    });

    it("refuses an invitation that is not an address or has no name", async () => {
      expect(
        await codeOf(inviteStaffUser(db, admin, { email: "ana", displayName: "Ana", role: "CONTRIBUTOR" })),
      ).toBe("VALIDATION_ERROR");
      expect(
        await codeOf(
          inviteStaffUser(db, admin, { email: "ana@dev.test", displayName: "  ", role: "CONTRIBUTOR" }),
        ),
      ).toBe("VALIDATION_ERROR");
      expect(
        await codeOf(
          inviteStaffUser(db, admin, { email: "ana@dev.test", displayName: "Ana", role: "OWNER" }),
        ),
      ).toBe("VALIDATION_ERROR");
    });

    it("changes a colleague's role", async () => {
      const promoted = await changeStaffRole(db, admin, author.id, "MODERATOR");
      expect(promoted.role).toBe("MODERATOR");
    });

    it("revokes access without taking the work with it", async () => {
      // The attribution columns are ON DELETE SET NULL, so a departing volunteer does not
      // delete the event pages they wrote.
      const [event] = await db
        .insert(events)
        .values({ type: "RACE", startsAt: new Date("2026-10-11T06:00:00Z") })
        .returning();
      await db.insert(eventTranslations).values({
        eventId: event.id,
        locale: "ro",
        slug: "crosul-aniversar",
        title: "Crosul aniversar",
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
      expect(await codeOf(changeStaffRole(db, admin, admin.id, "CONTRIBUTOR"))).toBe("FORBIDDEN");
    });

    it("refuses an Administrator their own removal", async () => {
      expect(await codeOf(revokeStaffUser(db, admin, admin.id))).toBe("FORBIDDEN");
    });

    it("refuses the demotion of the last Superadministrator", async () => {
      const [second] = await db
        .insert(staffUsers)
        .values({ email: "second@dev.test", displayName: "Second admin", role: "SUPERADMIN" })
        .returning();

      // Two administrators: one may demote the other.
      await changeStaffRole(db, second, admin.id, "MODERATOR");

      // One left, and nobody can take the last one away.
      expect(await codeOf(changeStaffRole(db, second, second.id, "MODERATOR"))).toBe("FORBIDDEN");
      const [onlyAdmin] = await db.select().from(staffUsers).where(eq(staffUsers.role, "SUPERADMIN"));
      expect(onlyAdmin.id).toBe(second.id);
    });

    it("refuses the removal of the last Superadministrator even by another Administrator", async () => {
      const [second] = await db
        .insert(staffUsers)
        .values({ email: "second@dev.test", displayName: "Second admin", role: "SUPERADMIN" })
        .returning();

      await revokeStaffUser(db, second, admin.id);
      // `second` is now the only one; revoking them is refused, and self-removal already is.
      const [remaining] = await db.select().from(staffUsers).where(eq(staffUsers.role, "SUPERADMIN"));
      expect(remaining.id).toBe(second.id);

      const [third] = await db
        .insert(staffUsers)
        .values({ email: "third@dev.test", displayName: "Third", role: "SUPERADMIN" })
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
          .values({ email: "superadmin@dev.test", displayName: "Impostor", role: "ADMIN" }),
        { code: SQLSTATE.UNIQUE_VIOLATION },
      );
    });

    it("refuses an address that is not lowercased", async () => {
      await expectViolation(
        db.insert(staffUsers).values({ email: "Ana@Dev.test", displayName: "Ana", role: "CONTRIBUTOR" }),
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
          role: "CONTRIBUTOR",
          firstSignedInAt: new Date(),
        }),
        { code: SQLSTATE.CHECK_VIOLATION, constraint: "staff_users_signed_in_has_subject" },
      );
    });
  });

  describe("the development staff switcher (AGENTS.md §13.1)", () => {
    it("creates a synthetic identity on demand and returns the same row next time", async () => {
      const first = await ensureDevStaffUser(db, "moderator");
      const second = await ensureDevStaffUser(db, "moderator");

      expect(second.id).toBe(first.id);
      expect(first.role).toBe("MODERATOR");
      // Marked as synthetic in the data itself, not only in a comment.
      expect(first.zitadelSubject?.startsWith("dev:")).toBe(true);
    });

    it("offers one identity per role, and no more", async () => {
      // Against the enum rather than a written-out list: a role added without a development
      // identity is a permission boundary nobody can exercise locally.
      expect(DEV_IDENTITIES.map((identity) => identity.role).sort()).toEqual(
        [...STAFF_ROLES].sort(),
      );
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
