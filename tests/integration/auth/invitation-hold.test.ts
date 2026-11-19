import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { emailOutbox } from "@/db/schema/email-outbox";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * §1000 — the club's invitation waits until Zitadel has been asked (the owner, 2026-11-19: «cumva trebuie un delay intre
 * mailurile de logare, sau sa fie instructiunile mai clare»).
 *
 * A press that will ask Zitadel for the account queues the invitation with `next_attempt_at` a minute ahead
 * (`INVITATION_HOLD_MS`) — the column the claim already waits on, a first attempt included — and the action lets it go the
 * moment Zitadel answers (`releaseInvitationHold`), before its response: the press's own drain, after the response, finds
 * it due; no other drain or pinger took it before Zitadel was asked. Zitadel's answer says which steps the email states:
 * a refusal turns them into the person's own. A press that asks Zitadel nothing holds nothing.
 *
 * Against PGlite. The actions run through their own code with Zitadel faked: the fake looks at the outbox at the moment
 * it is asked — the proof of the order.
 */
const state = vi.hoisted(() => ({
  db: undefined as unknown,
  actor: undefined as unknown,
  /** Zitadel is the provider (`STAFF_AUTH_MODE=provider`)… */
  provider: true,
  /** …and its key is set: the press asks it for the account. */
  keySet: true,
  answer: { kind: "invited" } as { kind: "invited" | "exists" | "ready" | "unconfigured" } | { kind: "failed"; reason: string },
  /** At each call to Zitadel: whose account, how many invitations that person has, and how many were still held. */
  asked: [] as { email: string; rows: number; held: number }[],
}));

vi.mock("@/db/client", () => ({ getDb: () => state.db }));
vi.mock("@/auth", () => ({ auth: async () => null, signIn: async () => {}, signOut: async () => {} }));
vi.mock("@/modules/staff-identity/session", () => ({
  requireStaff: async () => state.actor,
  requireStaffCapability: async () => state.actor,
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, set: () => undefined, delete: () => undefined }),
  headers: async () => new Headers(),
}));
vi.mock("@/i18n/navigation", () => ({
  getPathname: ({ href }: { href: string | { pathname: string; query?: Record<string, string> } }) => `/ro${typeof href === "string" ? href : href.pathname}`,
}));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT ${to}`);
  },
}));
vi.mock("next/cache", async () => ({ ...(await import("../../helpers/next-cache")).fakeNextCache.module, revalidatePath: () => undefined }));
// Zitadel as the provider, the one value flipped, read live (as `zone-rsvp.test.ts` flips it).
vi.mock("@/shared/config/env", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/shared/config/env")>();
  return { ...real, env: new Proxy(real.env, { get: (target, key, receiver) => (key === "STAFF_AUTH_MODE" ? (state.provider ? "provider" : "dev-switcher") : Reflect.get(target, key, receiver)) }) };
});
vi.mock("@/modules/staff-identity/zitadel-users", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/modules/staff-identity/zitadel-users")>();
  /** Zitadel, asked for one person's account: it looks at that person's invitation first, then answers. */
  async function zitadel(person: { email: string }) {
    const { emailOutbox: outbox } = await import("@/db/schema/email-outbox");
    const rows = await (state.db as TestDatabase).select().from(outbox).where(eq(outbox.recipientEmail, person.email));
    const now = Date.now();
    state.asked.push({ email: person.email, rows: rows.length, held: rows.filter((row) => row.nextAttemptAt !== null && row.nextAttemptAt.getTime() > now).length });
    return state.answer;
  }
  return { ...real, isZitadelInviteConfigured: () => state.keySet, inviteZitadelUser: zitadel, reinviteZitadelUser: zitadel };
});

const { INVITATION_HOLD_MS, inviteMembers, inviteStaffUser, releaseInvitationHold, resendStaffInvitation } = await import("@/modules/staff-identity/service");
const { claimOutboxBatch } = await import("@/modules/notifications/outbox");
const { renderOutboxMessage } = await import("@/modules/notifications/render");
const { inviteMembersAction, inviteStaffAction, resendStaffInviteAction } = await import("@/app/[locale]/admin/actions");

let db: TestDatabase;
let close: () => Promise<void>;
let admin: StaffUser;

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
  state.db = db;
});
afterAll(async () => close());
beforeEach(async () => {
  await resetTables(db);
  [admin] = await db.insert(staffUsers).values({ email: "admin@dev.test", displayName: "Admin Club", role: "ADMIN" }).returning();
  state.actor = admin;
  state.provider = true;
  state.keySet = true;
  state.answer = { kind: "invited" };
  state.asked = [];
});

const person = (email = "ana@dev.test") => ({ email, displayName: "Ana Pop", role: "CONTRIBUTOR" as const, preferredLocale: "ro" as const });
const outboxOf = (email = "ana@dev.test") => db.select().from(emailOutbox).where(eq(emailOutbox.recipientEmail, email));
/** What a drain or the pinger would take at `now` — the claim itself, with no hourly pace in the way. */
const claimAt = (now: Date) => claimOutboxBatch(db, { now, batchSize: 20, hourlyAllowance: null });

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
}

async function redirectOf(press: Promise<unknown>): Promise<string> {
  try {
    await press;
  } catch (error) {
    const message = (error as Error).message;
    if (message.startsWith("REDIRECT ")) return message.slice("REDIRECT ".length);
    throw error;
  }
  throw new Error("expected a redirect");
}

describe("§1000 the invitation's hold, at the service", () => {
  it("holds the invitation a minute when the press will ask Zitadel, with Zitadel's steps — no claim takes it before", async () => {
    await inviteStaffUser(db, admin, person(), { zitadelInvite: true });
    const [row] = await outboxOf();
    expect(row.status).toBe("PENDING");
    expect(row.attemptCount).toBe(0);
    expect(row.nextAttemptAt?.getTime()).toBe(row.createdAt.getTime() + INVITATION_HOLD_MS);
    expect(INVITATION_HOLD_MS).toBe(60_000);
    expect(row.payloadJson).toMatchObject({ signInSteps: "zitadel" });
    // A drain or the pinger at any moment of the minute takes nothing.
    expect(await claimAt(new Date(row.createdAt.getTime() + 1_000))).toEqual([]);
    expect(await claimAt(new Date(row.createdAt.getTime() + INVITATION_HOLD_MS - 1))).toEqual([]);
  });

  it("is let go once Zitadel answered: due at once, the next claim takes it; a second release finds nothing", async () => {
    const member = await inviteStaffUser(db, admin, person(), { zitadelInvite: true });
    expect(await releaseInvitationHold(db, member.id, "zitadel")).toBe(1);
    const [row] = await outboxOf();
    expect(row.nextAttemptAt).toBeNull();
    expect(row.payloadJson).toMatchObject({ signInSteps: "zitadel" });
    expect(await releaseInvitationHold(db, member.id, "zitadel")).toBe(0);
    expect((await claimAt(new Date(row.createdAt.getTime() + 1_000))).map((claimed) => claimed.id)).toEqual([row.id]);
  });

  it("leaves at the minute's end when nothing let it go — an action that died after the commit", async () => {
    await inviteStaffUser(db, admin, person(), { zitadelInvite: true });
    const [row] = await outboxOf();
    expect((await claimAt(new Date(row.createdAt.getTime() + INVITATION_HOLD_MS))).map((claimed) => claimed.id)).toEqual([row.id]);
  });

  it("turns the steps into the person's own when Zitadel did not make the account, keeping the rest of the payload", async () => {
    const member = await inviteStaffUser(db, admin, person(), { zitadelInvite: true });
    expect(await releaseInvitationHold(db, member.id, "self")).toBe(1);
    const [row] = await outboxOf();
    expect(row.nextAttemptAt).toBeNull();
    expect(row.payloadJson).toEqual({ displayName: "Ana Pop", role: "Voluntar", inviterName: "Admin Club", signInSteps: "self" });
  });

  it("holds nothing when no press asks Zitadel: the person's steps, due at once, as every invitation was", async () => {
    const member = await inviteStaffUser(db, admin, person());
    const [row] = await outboxOf();
    expect(row.nextAttemptAt).toBeNull();
    expect(row.payloadJson).toMatchObject({ signInSteps: "self" });
    expect(await releaseInvitationHold(db, member.id, "zitadel")).toBe(0);
    expect((await claimAt(new Date(row.createdAt.getTime() + 1))).map((claimed) => claimed.id)).toEqual([row.id]);
  });

  it("lets go only that person's held invitation: another person's stays held, a row already claimed is not touched", async () => {
    const ana = await inviteStaffUser(db, admin, person("ana@dev.test"), { zitadelInvite: true });
    await inviteStaffUser(db, admin, person("ion@dev.test"), { zitadelInvite: true });
    expect(await releaseInvitationHold(db, ana.id, "zitadel")).toBe(1);
    const [ion] = await outboxOf("ion@dev.test");
    expect(ion.nextAttemptAt).not.toBeNull();
    // Ana's is claimed by a drain; a late release (a retried press) changes nothing on it.
    const [claimed] = await claimAt(new Date(Date.now() + 1_000));
    expect(claimed.recipientEmail).toBe("ana@dev.test");
    expect(await releaseInvitationHold(db, ana.id, "self")).toBe(0);
    const [after] = await outboxOf("ana@dev.test");
    expect(after.status).toBe("PROCESSING");
    expect(after.payloadJson).toMatchObject({ signInSteps: "zitadel" });
  });

  it("holds the members' invitations and a resend alike", async () => {
    const { added } = await inviteMembers(db, admin, { rows: [{ email: "m1@dev.test", displayName: "M Unu" }, { email: "m2@dev.test", displayName: "M Doi" }], preferredLocale: "ro", zitadelInvite: true });
    expect(added).toHaveLength(2);
    for (const email of ["m1@dev.test", "m2@dev.test"]) {
      const [row] = await outboxOf(email);
      expect(row.messageType).toBe("MEMBER_INVITATION");
      expect(row.nextAttemptAt).not.toBeNull();
      expect(row.payloadJson).toMatchObject({ signInSteps: "zitadel" });
    }
    await inviteStaffUser(db, admin, person());
    await resendStaffInvitation(db, admin, "ana@dev.test", new Date(Date.now() + 1_000), "queue", { zitadelInvite: true });
    const resent = (await outboxOf()).find((row) => row.isManualResend);
    expect(resent?.nextAttemptAt).not.toBeNull();
    expect(resent?.payloadJson).toMatchObject({ signInSteps: "zitadel" });
  });
});

describe("§1000 the invitation as it renders from the row", () => {
  it("says Zitadel's steps, Zitadel's email named in the row's language in both halves", async () => {
    const member = await inviteStaffUser(db, admin, person(), { zitadelInvite: true });
    await releaseInvitationHold(db, member.id, "zitadel");
    const [row] = await outboxOf();
    const email = await renderOutboxMessage(row, db, new Date());
    expect(email.text).toContain("1. Deschide emailul de la Zitadel");
    expect(email.text).toContain("2. Apoi apasă „Intră în backoffice”, mai jos, și intră cu adresa ana@dev.test și parola aleasă.");
    expect(email.text.match(/Invitație la /g)).toHaveLength(2);
    expect(email.text).not.toContain("Invitation to ");
  });

  it("says the person's own steps after a refusal, and an English row names “Invitation to …”", async () => {
    const member = await inviteStaffUser(db, admin, person(), { zitadelInvite: true });
    await releaseInvitationHold(db, member.id, "self");
    const [refused] = await outboxOf();
    const own = await renderOutboxMessage(refused, db, new Date());
    expect(own.text).toContain("2. Pe pagina de autentificare alege „Register new user”");
    expect(own.text).not.toContain("1. Deschide emailul de la Zitadel");

    await inviteStaffUser(db, admin, { ...person("en@dev.test"), preferredLocale: "en" }, { zitadelInvite: true });
    const [english] = await outboxOf("en@dev.test");
    const rendered = await renderOutboxMessage(english, db, new Date());
    expect(rendered.text.match(/Invitation to /g)).toHaveLength(2);
  });
});

describe("§1000 through the presses: the club's invitation leaves only after Zitadel was asked", () => {
  it("«Adaugă»: Zitadel is asked while the invitation is held, then the invitation is due", async () => {
    const to = await redirectOf(inviteStaffAction(null, form({ uiLocale: "ro", ...person(), preferredLocale: "ro" })));
    expect(to).toContain("saved=invited");
    expect(to).toContain("invite=invited");
    expect(state.asked).toEqual([{ email: "ana@dev.test", rows: 1, held: 1 }]);
    const [row] = await outboxOf();
    expect(row.nextAttemptAt).toBeNull();
    expect(row.payloadJson).toMatchObject({ signInSteps: "zitadel" });
    expect((await claimAt(new Date(Date.now() + 1_000))).map((claimed) => claimed.id)).toEqual([row.id]);
  });

  it("«Adaugă» that Zitadel refused: the invitation leaves anyway, with the person's own steps", async () => {
    state.answer = { kind: "failed", reason: "403 permission denied" };
    const to = await redirectOf(inviteStaffAction(null, form({ uiLocale: "ro", ...person(), preferredLocale: "ro" })));
    expect(to).toContain("invite=failed");
    expect(state.asked).toEqual([{ email: "ana@dev.test", rows: 1, held: 1 }]);
    const [row] = await outboxOf();
    expect(row.nextAttemptAt).toBeNull();
    expect(row.payloadJson).toMatchObject({ signInSteps: "self" });
  });

  it("«Adaugă» for an account that already signs in: `ready`, the invitation goes at once with the button alone — no Zitadel email is coming", async () => {
    state.answer = { kind: "ready" };
    const to = await redirectOf(inviteStaffAction(null, form({ uiLocale: "ro", ...person(), preferredLocale: "ro" })));
    expect(to).toContain("invite=ready");
    const [row] = await outboxOf();
    expect(row.nextAttemptAt).toBeNull();
    expect(row.payloadJson).toMatchObject({ signInSteps: "ready" });
  });

  it("«Adaugă» with no key: nothing is held, and the steps are the person's own", async () => {
    state.keySet = false;
    state.answer = { kind: "unconfigured" };
    const to = await redirectOf(inviteStaffAction(null, form({ uiLocale: "ro", ...person(), preferredLocale: "ro" })));
    expect(to).toContain("invite=unconfigured");
    // The action still asks (`inviteZitadelUser` answers «unconfigured» without a key), and the invitation was never held.
    expect(state.asked).toEqual([{ email: "ana@dev.test", rows: 1, held: 0 }]);
    const [row] = await outboxOf();
    expect(row.nextAttemptAt).toBeNull();
    expect(row.payloadJson).toMatchObject({ signInSteps: "self" });
  });

  it("«Adaugă» with another provider (the development switcher): Zitadel is not asked and nothing is held", async () => {
    state.provider = false;
    await redirectOf(inviteStaffAction(null, form({ uiLocale: "ro", ...person(), preferredLocale: "ro" })));
    expect(state.asked).toEqual([]);
    const [row] = await outboxOf();
    expect(row.nextAttemptAt).toBeNull();
    expect(row.payloadJson).toMatchObject({ signInSteps: "self" });
  });

  it("«Adaugă fără invitație»: no row, and Zitadel is not asked", async () => {
    await redirectOf(inviteStaffAction(null, form({ uiLocale: "ro", ...person(), preferredLocale: "ro", sendEmail: "0" })));
    expect(state.asked).toEqual([]);
    expect(await outboxOf()).toEqual([]);
  });

  it("«Adaugă mai mulți membri»: each member's invitation is held when Zitadel is asked for that member, then due", async () => {
    await redirectOf(inviteMembersAction(null, form({ uiLocale: "ro", preferredLocale: "ro", members: "m1@dev.test\nm2@dev.test" })));
    expect(state.asked).toEqual([
      { email: "m1@dev.test", rows: 1, held: 1 },
      { email: "m2@dev.test", rows: 1, held: 1 },
    ]);
    for (const email of ["m1@dev.test", "m2@dev.test"]) {
      const [row] = await outboxOf(email);
      expect(row.nextAttemptAt, email).toBeNull();
    }
  });

  it("«Retrimite invitația»: the new invitation waits for Zitadel's answer too", async () => {
    await inviteStaffUser(db, admin, person());
    const to = await redirectOf(resendStaffInviteAction(null, form({ uiLocale: "ro", email: "ana@dev.test" })));
    expect(to).toContain("saved=reinvited");
    // The first invitation (no press asked Zitadel then) was due; the new one was held while Zitadel was asked.
    expect(state.asked.at(-1)).toEqual({ email: "ana@dev.test", rows: 2, held: 1 });
    const rows = await outboxOf();
    const again = rows.find((row) => row.isManualResend);
    expect(again?.nextAttemptAt).toBeNull();
    expect(again?.payloadJson).toMatchObject({ signInSteps: "zitadel" });
  });
});
