import { eq } from "drizzle-orm";
import { createTranslator } from "next-intl";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { emailOutbox } from "@/db/schema/email-outbox";
import { platformSettings } from "@/db/schema/platform-settings";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import type { OutgoingEmail } from "@/infrastructure/email/adapter";
import { toastSentence } from "@/shared/feedback/mail-line";
import { decodeFlash, FLASH_COOKIE } from "@/shared/feedback/notice";
import ro from "../../../messages/ro.json";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * §1021 (amending §1000, whose ask was «cumva trebuie un delay intre mailurile de logare»; 2026-11-20: the two still arrived together) —
 * when Zitadel answered a press with its own email on the way, the club's invitation leaves a fixed gap after that answer
 * (`INVITATION_GAP_MS`, ninety seconds), and the press sends it itself: its drain after the response waits once, until the
 * rows it let go are due, then sends exactly those, whatever «Când pleacă emailurile» says. No other drain, «Trimite acum»
 * or the outbox job takes them before (the claim honours `next_attempt_at`); a function stopped before the moment leaves
 * them PENDING and due, for the job's next pass. Nothing waits when no email of Zitadel's is coming.
 *
 * Against PGlite, through the three presses' own code with Zitadel faked, `after()` captured so the test runs what Next
 * runs once the response is out, the provider a stub that records each send, and the drain's clock injected — the wait is
 * recorded and skipped, never slept for real.
 */
const state = vi.hoisted(() => {
  const held = {
    db: undefined as unknown,
    actor: undefined as unknown,
    provider: true,
    keySet: true,
    answer: { kind: "invited" } as { kind: "invited" | "exists" | "ready" | "unconfigured" } | { kind: "failed"; reason: string },
    afters: [] as (() => Promise<void>)[],
    /** Each send the provider was handed, and the drain clock's moment when it was. */
    sent: [] as { to: string; at: number }[],
    /** The drain's clock: where it started, its moment, each wait it was asked for, and whether a wait ends (a stopped function's never does). */
    clockStart: 0,
    clockAt: 0,
    slept: [] as number[],
    stopped: false,
    cookies: [] as { name: string; value: string }[],
  };
  const clock = {
    now: () => new Date(held.clockAt),
    sleep: async (ms: number) => {
      held.slept.push(ms);
      if (held.stopped) await new Promise<void>(() => {});
      held.clockAt += ms;
    },
  };
  return { held, clock };
});

vi.mock("@/db/client", () => ({ getDb: () => state.held.db }));
vi.mock("@/auth", () => ({ auth: async () => null, signIn: async () => {}, signOut: async () => {} }));
vi.mock("@/modules/staff-identity/session", () => ({
  requireStaff: async () => state.held.actor,
  requireStaffCapability: async () => state.held.actor,
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: () => undefined,
    set: (name: string, value: string) => {
      state.held.cookies.push({ name, value });
    },
    delete: () => undefined,
  }),
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
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: (callback: () => Promise<void>) => {
    state.held.afters.push(callback);
  },
}));
// Zitadel as the provider, read live; and the drains on, as the end-to-end suite's server has them (they are silent under
// APP_ENV=test otherwise).
vi.mock("@/shared/config/env", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/shared/config/env")>();
  return {
    ...real,
    env: new Proxy(real.env, {
      get: (target, key, receiver) =>
        key === "STAFF_AUTH_MODE" ? (state.held.provider ? "provider" : "dev-switcher") : key === "E2E_DRAIN_OUTBOX" ? true : Reflect.get(target, key, receiver),
    }),
  };
});
vi.mock("@/modules/staff-identity/zitadel-users", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/modules/staff-identity/zitadel-users")>();
  const zitadel = async () => state.held.answer;
  return { ...real, isZitadelInviteConfigured: () => state.held.keySet, inviteZitadelUser: zitadel, reinviteZitadelUser: zitadel };
});
// The provider: a stub that records every message it is handed, with the drain clock's moment.
vi.mock("@/modules/notifications/outbox-sender", () => ({
  createOutboxSender: async () => ({
    sender: {
      async send(message: OutgoingEmail) {
        state.held.sent.push({ to: message.to, at: state.held.clockAt });
        return { outcome: "sent", providerMessageId: `id-${state.held.sent.length}` } as const;
      },
    },
    route: () => "mailgun" as const,
    replyTo: undefined,
  }),
}));
// The words are `invitation-steps.test.ts`'s business; here, the row's type and address.
vi.mock("@/modules/notifications/render", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/modules/notifications/render")>()),
  createOutboxRenderer: () => async (row: { recipientEmail: string; messageType: string; locale: "ro" | "en"; idempotencyKey: string }) => ({
    to: row.recipientEmail,
    subject: row.messageType,
    html: `<p>${row.messageType}</p>`,
    text: row.messageType,
    locale: row.locale,
    idempotencyKey: row.idempotencyKey,
  }),
}));
// The press's drain at its rows' turn, with the test's clock: the wait is recorded, never slept.
vi.mock("@/modules/notifications/send-rows-now", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/modules/notifications/send-rows-now")>();
  return { ...real, sendOutboxRowsAtTurn: (db: Parameters<typeof real.sendOutboxRowsAtTurn>[0], ids: readonly string[], dueAt: Date) => real.sendOutboxRowsAtTurn(db, ids, dueAt, state.clock) };
});

const { fakeNextCache } = await import("../../helpers/next-cache");
const { INVITATION_GAP_MS, inviteStaffUser } = await import("@/modules/staff-identity/service");
const { inviteMembersAction, inviteStaffAction, resendStaffInviteAction } = await import("@/app/[locale]/admin/actions");
const { processOutboxBatch } = await import("@/modules/notifications/outbox");
const { sendOutboxRowsAtTurn, sendOutboxRowsNow, TURN_WAIT_MAX_MS } = await import("@/modules/notifications/send-rows-now");
const { createOutboxSender } = await import("@/modules/notifications/outbox-sender");
const { createOutboxRenderer } = await import("@/modules/notifications/render");
const { DELIVERY_TIMING_SETTING_KEY } = await import("@/modules/notifications/delivery-timing");

let db: TestDatabase;
let close: () => Promise<void>;
let admin: StaffUser;

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
  state.held.db = db;
});
afterAll(async () => close());
beforeEach(async () => {
  await resetTables(db);
  fakeNextCache.reset();
  [admin] = await db.insert(staffUsers).values({ email: "admin@dev.test", displayName: "Admin Club", role: "ADMIN" }).returning();
  Object.assign(state.held, { actor: admin, provider: true, keySet: true, answer: { kind: "invited" }, afters: [], sent: [], slept: [], stopped: false, cookies: [] });
  await timing("scheduled");
});

/** «Când pleacă emailurile» (§513): the scheduled pass — the default on QA and production — or right after the request. */
async function timing(value: "scheduled" | "immediate") {
  await db
    .insert(platformSettings)
    .values({ key: DELIVERY_TIMING_SETTING_KEY, value: { timing: value }, updatedAt: new Date() })
    .onConflictDoUpdate({ target: platformSettings.key, set: { value: { timing: value } } });
}

const person = (email = "ana@dev.test") => ({ email, displayName: "Ana Pop", role: "CONTRIBUTOR" as const, preferredLocale: "ro" as const });
const outboxOf = (email = "ana@dev.test") => db.select().from(emailOutbox).where(eq(emailOutbox.recipientEmail, email));
const JOB_DUE_TAG = "br-jobs:due:email-outbox";

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

/** What Next runs once the press's response is out, in the order the press asked, the drain's clock starting now. */
async function runAfters(): Promise<void> {
  state.held.clockStart = state.held.clockAt = Date.now();
  for (const callback of state.held.afters.splice(0)) await callback();
}

/** The outbox job's pass at `now` (`processOutboxBatch`, what the pinger's run sends with), the same stub provider. */
async function jobPassAt(now: Date) {
  const { sender, route } = await createOutboxSender(db);
  return processOutboxBatch(db, { sender, route, render: createOutboxRenderer({ replyTo: undefined }), now });
}

describe("§1021 «Adaugă»: the club's invitation leaves a minute and a half after Zitadel's, sent by the press itself", () => {
  it("is due the gap after Zitadel's answer; the press's own drain waits once, for exactly that, then sends it", async () => {
    const before = Date.now();
    await redirectOf(inviteStaffAction(null, form({ uiLocale: "ro", ...person(), preferredLocale: "ro" })));
    const after = Date.now();
    const [row] = await outboxOf();
    expect(row.status).toBe("PENDING");
    expect(row.payloadJson).toMatchObject({ signInSteps: "zitadel", sentAtTurn: true });
    const due = row.nextAttemptAt!.getTime();
    expect(due).toBeGreaterThanOrEqual(before + INVITATION_GAP_MS);
    expect(due).toBeLessThanOrEqual(after + INVITATION_GAP_MS);
    // The job's cached quiet was forgotten at the press, before any wait: a wait that never ends still leaves it to the job.
    expect(fakeNextCache.invalidated).toContain(JOB_DUE_TAG);

    await runAfters();
    // One wait, for exactly what was left of the gap when the response was out — never longer than the gap.
    expect(state.held.slept).toEqual([due - state.held.clockStart]);
    expect(state.held.slept[0]).toBeGreaterThan(0);
    expect(state.held.slept[0]).toBeLessThanOrEqual(INVITATION_GAP_MS);
    // Sent once, at its turn, under the scheduled pass — the press's drain does not ask «Când pleacă emailurile».
    expect(state.held.sent).toEqual([{ to: "ana@dev.test", at: due }]);
    const [sent] = await outboxOf();
    expect(sent.status).toBe("SENT");
  });

  it("under «imediat» the ordinary drain after the response takes nothing early: the press's drain sends it, at its turn", async () => {
    await timing("immediate");
    await redirectOf(inviteStaffAction(null, form({ uiLocale: "ro", ...person(), preferredLocale: "ro" })));
    const [row] = await outboxOf();
    await runAfters();
    // Had the timing's drain taken it, it would have left at the clock's start, before the turn.
    expect(state.held.sent).toEqual([{ to: "ana@dev.test", at: row.nextAttemptAt!.getTime() }]);
  });

  it("the toast says when ours leaves — the turn — and that Zitadel's goes now", async () => {
    await redirectOf(inviteStaffAction(null, form({ uiLocale: "ro", ...person(), preferredLocale: "ro" })));
    const [row] = await outboxOf();
    const notice = decodeFlash(state.held.cookies.filter((cookie) => cookie.name === FLASH_COOKIE).at(-1)?.value);
    expect(notice).toMatchObject({ kind: "success", key: "invited", values: { mail: "at", mailType: "STAFF_INVITATION", mailZitadel: "1" } });
    expect(new Date(notice!.values!.mailAt!).getTime()).toBe(row.nextAttemptAt!.getTime());
    const t = createTranslator({ locale: "ro", messages: ro.Feedback as never }) as unknown as Parameters<typeof toastSentence>[1];
    const types = ro.Admin.emails.types as Record<string, string>;
    const said = toastSentence(notice!, t, (type) => types[type] ?? null, "ro");
    expect(said).toMatch(/^Persoana a fost adăugată în echipă\. Pleacă .+ \(estimat\): „Invitația în echipă” către 1 persoană\. Zitadel trimite separat, acum, linkul pentru parolă\.$/);
    expect(said.length).toBeLessThanOrEqual(200);
  });
});

describe("§1021 nothing claims the invitation before its turn, and a stopped wait leaves it to the job", () => {
  it("the job's pass and «Trimite acum»'s worker take nothing a moment before the turn, and the job takes it at the turn", async () => {
    await redirectOf(inviteStaffAction(null, form({ uiLocale: "ro", ...person(), preferredLocale: "ro" })));
    const [row] = await outboxOf();
    const due = row.nextAttemptAt!.getTime();
    expect((await jobPassAt(new Date(due - 1))).claimed).toBe(0);
    expect((await sendOutboxRowsNow(db, [row.id], new Date(due - 1))).claimed).toBe(0);
    expect(state.held.sent).toEqual([]);
    expect((await jobPassAt(new Date(due))).sent).toBe(1);
    expect(state.held.sent.map((send) => send.to)).toEqual(["ana@dev.test"]);
  });

  it("a function stopped mid-wait sends nothing: the row stays PENDING, due at its turn, and the job's next pass sends it once", async () => {
    state.held.stopped = true;
    await redirectOf(inviteStaffAction(null, form({ uiLocale: "ro", ...person(), preferredLocale: "ro" })));
    const [row] = await outboxOf();
    state.held.clockAt = Date.now();
    // The press's drain reaches its wait and never comes back (the platform stopped the function); the rest finish.
    const pending = state.held.afters.splice(0).map((callback) => callback());
    await vi.waitFor(() => expect(state.held.slept).toHaveLength(1));
    void Promise.all(pending);
    const [waiting] = await outboxOf();
    expect(waiting.status).toBe("PENDING");
    expect(waiting.nextAttemptAt?.getTime()).toBe(row.nextAttemptAt!.getTime());
    expect(state.held.sent).toEqual([]);
    expect((await jobPassAt(new Date(row.nextAttemptAt!.getTime()))).sent).toBe(1);
    const [sent] = await outboxOf();
    expect(sent.status).toBe("SENT");
  });

  it("does not wait for a turn further than its bound: nothing sent, the row left PENDING for the job", async () => {
    await inviteStaffUser(db, admin, person(), { zitadelInvite: true });
    const [row] = await outboxOf();
    state.held.clockAt = Date.now();
    const far = new Date(state.held.clockAt + TURN_WAIT_MAX_MS + 1_000);
    expect(await sendOutboxRowsAtTurn(db, [row.id], far)).toBeNull();
    expect(state.held.slept).toEqual([]);
    expect(state.held.sent).toEqual([]);
    const [left] = await outboxOf();
    expect(left.status).toBe("PENDING");
  });
});

describe("§1021 the other presses, and nothing to wait for", () => {
  it("«Retrimite invitația» with «Trimite acum»: «now»'s drain takes nothing before the turn; the press's drain sends it then", async () => {
    await inviteStaffUser(db, admin, person());
    // The first invitation (no press asked Zitadel then) is the job's; only the resend is this press's.
    await redirectOf(resendStaffInviteAction(null, form({ uiLocale: "ro", email: "ana@dev.test", delivery: "now" })));
    const again = (await outboxOf()).find((row) => row.isManualResend)!;
    expect(again.payloadJson).toMatchObject({ signInSteps: "zitadel", sentNow: true, sentAtTurn: true });
    await runAfters();
    expect(state.held.slept).toHaveLength(1);
    expect(state.held.sent).toEqual([{ to: "ana@dev.test", at: again.nextAttemptAt!.getTime() }]);
    const [resent] = (await outboxOf()).filter((row) => row.isManualResend);
    expect(resent.status).toBe("SENT");
  });

  it("«Adaugă mai mulți membri»: one wait, for the last member Zitadel answered, then every member's invitation", async () => {
    await redirectOf(inviteMembersAction(null, form({ uiLocale: "ro", preferredLocale: "ro", members: "m1@dev.test\nm2@dev.test" })));
    const rows = [...(await outboxOf("m1@dev.test")), ...(await outboxOf("m2@dev.test"))];
    expect(rows).toHaveLength(2);
    for (const row of rows) expect(row.payloadJson, row.recipientEmail).toMatchObject({ signInSteps: "zitadel", sentAtTurn: true });
    const last = Math.max(...rows.map((row) => row.nextAttemptAt!.getTime()));
    await runAfters();
    expect(state.held.slept).toHaveLength(1);
    expect(state.held.sent.map((send) => send.to).sort()).toEqual(["m1@dev.test", "m2@dev.test"]);
    for (const send of state.held.sent) expect(send.at, send.to).toBe(last);
  });

  for (const [label, setUp] of [
    ["Zitadel refused the account", () => (state.held.answer = { kind: "failed", reason: "403 permission denied" })],
    ["the account already signs in (`ready`)", () => (state.held.answer = { kind: "ready" })],
    ["no key: Zitadel is not asked", () => ((state.held.keySet = false), (state.held.answer = { kind: "unconfigured" }))],
  ] as const) {
    it(`waits for nothing when ${label}: the club's email is due at once and leaves as today`, async () => {
      setUp();
      await timing("immediate");
      await redirectOf(inviteStaffAction(null, form({ uiLocale: "ro", ...person(), preferredLocale: "ro" })));
      const [row] = await outboxOf();
      expect(row.nextAttemptAt).toBeNull();
      expect(row.payloadJson).not.toHaveProperty("sentAtTurn");
      expect(fakeNextCache.invalidated).not.toContain(JOB_DUE_TAG);
      await runAfters();
      // The «imediat» drain after the response sent it, at the clock's start: no wait.
      expect(state.held.slept).toEqual([]);
      expect(state.held.sent).toEqual([{ to: "ana@dev.test", at: state.held.clockAt }]);
    });
  }
});
