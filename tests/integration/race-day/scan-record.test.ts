import { type ComponentProps, createElement, type ReactNode } from "react";
import { renderToReadableStream } from "react-dom/server";
import { createTranslator, NextIntlClientProvider } from "next-intl";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { events, eventTranslations } from "@/db/schema/events";
import { participants } from "@/db/schema/participants";
import { registrations } from "@/db/schema/registrations";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { CODE_SCAN_REPEAT_MS, deleteRegistrationByStaff, recordCodeScan } from "@/modules/registrations/admin-service";
import { newCheckinCode } from "@/modules/registrations/checkin-code";
import { listAuditTrail } from "@/modules/audit/repository";
import { type StaffRole, STAFF_ROLES } from "@/modules/staff-identity/domain/roles";
import { isDomainError } from "@/shared/errors/domain-error";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { atTheClock } from "../../helpers/clock";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * §NNN, BR-REQ-037-08, BR-REQ-060-01 — a scan is recorded (the owner, 2026-11-19: «vreau si tracing pentru voluntarim [voluntari] gen cine
 * a scanat, cine a marcat prezent»), read from a real database through the scanned page itself (`/admin/checkin/<code>`):
 *
 * - opened by a desk role for a code that names a registration: one `registration.code_scanned` row — the registration, the staff
 *   account, `{ eventId }` and nothing else (no name, no code); never for the page back from a desk verb (`saved`, `error`), the
 *   page switched to the other language (`from=language`, what the language switch lands with), a router prefetch
 *   (`Next-Router-Prefetch`, and the segment prefetch's header), the registration's own «Deschide la masă» (`from=registration`), an
 *   unknown or a malformed code, or a role that cannot work the desk (the 404, and the service's FORBIDDEN);
 * - one per account and registration within two minutes, again after; another account's own within them;
 * - a write that fails is a warning, and the runner is drawn all the same;
 * - erased, the registration's scan rows are scrubbed of whom like its other rows, and the trail of the registration names the scan;
 * - «Scanat înainte»: nothing when nobody scanned before; the newest three earlier scans, oldest first, with who and when, never the
 *   visit's own — the one it wrote, the one it repeats, or, back from a verb or in the other language, the viewer's newest —, the
 *   day beside one of another day, an account gone since as «cont șters»; both languages.
 *
 * The race is in 2099, so no date of the suite's calendar is reached; the made-up people and the desk accounts are nobody.
 */
const state = vi.hoisted(() => ({
  db: undefined as unknown,
  actor: undefined as unknown,
  locale: "ro" as "ro" | "en",
  headers: new Headers(),
}));

vi.mock("next-intl/server", () => ({
  getTranslations: async (arg: string | { locale?: "ro" | "en"; namespace: string }) => {
    const namespace = typeof arg === "string" ? arg : arg.namespace;
    const locale = typeof arg === "string" ? state.locale : (arg.locale ?? state.locale);
    const catalogue = (locale === "ro" ? ro : en) as unknown as Record<string, Record<string, unknown>>;
    return createTranslator({ locale, messages: catalogue[namespace] as never });
  },
  getLocale: async () => state.locale,
  setRequestLocale: () => undefined,
}));
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));
// The request's headers, as the test sets them: a prefetch is told by its own.
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }), headers: async () => state.headers }));
vi.mock("next/cache", async () => (await import("../../helpers/next-cache")).fakeNextCache.module);
vi.mock("@/auth", () => ({ auth: async () => null, signIn: async () => {}, signOut: async () => {} }));
vi.mock("@/db/client", () => ({ getDb: () => state.db }));
vi.mock("@/modules/staff-identity/session", () => ({
  DEV_STAFF_COOKIE: "dev-staff",
  requireStaff: async () => state.actor,
  requireStaffCapability: async () => state.actor,
}));
vi.mock("@/modules/notifications/send-now-choice", () => ({ sendNowChoiceFor: async () => null }));

const { default: ScannedCodePage } = await import("@/app/[locale]/admin/checkin/[code]/page");

/** A tree as the server streams it, Suspense settled; Emotion's styles and React's separators out of the way. */
async function html(node: ReactNode): Promise<string> {
  const intl = { locale: state.locale, timeZone: "Europe/Bucharest", messages: state.locale === "ro" ? ro : en } as unknown as ComponentProps<typeof NextIntlClientProvider>;
  const stream = await renderToReadableStream(createElement(NextIntlClientProvider, intl, node), { onError: () => {} });
  await stream.allReady;
  return (await new Response(stream).text()).replace(/<style[\s\S]*?<\/style>/g, "").replace(/<!-- -->/g, "");
}
const words = (markup: string) => markup.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/\s+/g, " ").trim();

/** 09:00 in Brașov on the race's day; the desk opens at 08:00. */
const START = new Date("2099-11-21T07:00:00.000Z");
/** A moment of race morning, «08:05» on the event's clock (UTC+2 in November). */
const at = (clock: string, day = "2099-11-21") => new Date(`${day}T${String(Number(clock.slice(0, 2)) - 2).padStart(2, "0")}:${clock.slice(3)}:00.000Z`);

let db: TestDatabase;
let close: () => Promise<void>;
let serial = 0;
const staff: Partial<Record<StaffRole, StaffUser>> = {};
const desk: Record<"qr1" | "qr2" | "qr3", StaffUser> = {} as never;
let eventId: string;
let runnerId: string;
let code: string;

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
  state.db = db;
});
afterAll(async () => close());
beforeEach(async () => {
  await resetTables(db);
  state.locale = "ro";
  state.headers = new Headers();
  for (const role of STAFF_ROLES) {
    [staff[role]] = await db.insert(staffUsers).values({ email: `${role.toLowerCase()}@example.test`, displayName: `Coleg ${role}`, role }).returning();
  }
  for (const name of ["qr1", "qr2", "qr3"] as const) {
    [desk[name]] = await db.insert(staffUsers).values({ email: `${name}@example.test`, displayName: name.toUpperCase(), role: "CONTRIBUTOR" }).returning();
  }
  state.actor = desk.qr2;
  serial += 1;
  const [event] = await db
    .insert(events)
    .values({ type: "RACE", startsAt: START, timezone: "Europe/Bucharest", registrationMode: "INTERNAL", editorialStatus: "PUBLISHED", publishedAt: START, locationName: "Start" })
    .returning({ id: events.id });
  eventId = event.id;
  await db.insert(eventTranslations).values([
    { eventId, locale: "ro", slug: `crosul-${serial}`, title: `Crosul ${serial}` },
    { eventId, locale: "en", slug: `cross-${serial}`, title: `The cross ${serial}` },
  ]);
  ({ id: runnerId, code } = await runner("Ana Pop", 27));
});

async function runner(name: string, bibNumber: number): Promise<{ id: string; code: string; participantId: string }> {
  serial += 1;
  const email = `runner-${serial}@example.test`;
  const [participant] = await db
    .insert(participants)
    .values({ deliveryEmail: email, normalizedEmail: email, canonicalEmail: email, canonicalizationVersion: 2, defaultName: name, preferredLocale: "ro" })
    .returning({ id: participants.id });
  const checkinCode = newCheckinCode();
  const [row] = await db
    .insert(registrations)
    .values({
      eventId,
      participantId: participant.id,
      kind: "REAL",
      locale: "ro",
      registeredName: name,
      displayName: name,
      privacyNoticeVersion: 1,
      privacyAcknowledgedAt: START,
      resultsNameConsent: false,
      resultsConsentVersion: 1,
      status: "CONFIRMED",
      confirmedAt: START,
      bibNumber,
      checkinCode,
    })
    .returning({ id: registrations.id });
  return { id: row.id, code: checkinCode, participantId: participant.id };
}

/** The scanned page at `instant`, as `actor`, with the address's query: its markup. */
async function open(instant: Date, query: Record<string, string> = {}, options: { code?: string; actor?: StaffUser } = {}): Promise<string> {
  if (options.actor) state.actor = options.actor;
  const tree = await atTheClock(instant, () => ScannedCodePage({ params: Promise.resolve({ locale: state.locale, code: options.code ?? code }), searchParams: Promise.resolve(query) }));
  return html(tree);
}
const scans = () => db.select().from(auditLogs).where(eq(auditLogs.action, "registration.code_scanned"));
const scannedBefore = (page: string) => {
  const match = /data-testid="desk-scanned-before"[^>]*>([\s\S]*?)<\/div><\/div>/.exec(page);
  return match ? words(match[1]) : null;
};

describe("§NNN a scan is recorded when a desk role opens the code's page", () => {
  it("writes one row on open — the registration, the staff account and the event's id, never a name or the code — and draws the runner", async () => {
    const page = await open(at("08:12"));
    expect(words(page)).toContain("Ana Pop");
    const [row, ...more] = await scans();
    expect(more).toEqual([]);
    expect(row).toMatchObject({ entityType: "registration", entityId: runnerId, actorStaffUserId: desk.qr2.id, metadataJson: { eventId } });
    expect(row.createdAt.toISOString()).toBe(at("08:12").toISOString());
    expect(row.participantId).not.toBeNull();
    const metadata = JSON.stringify(row.metadataJson);
    expect(metadata).not.toContain("Ana Pop");
    expect(metadata).not.toContain(code);
  });

  it("writes nothing for the page coming back from a desk verb — `saved` or `error` —, switched to the other language, a router prefetch, or the registration's own link", async () => {
    await open(at("08:12"), { saved: "checkedIn" });
    await open(at("08:13"), { error: "CONFLICT" });
    state.headers = new Headers({ "Next-Router-Prefetch": "1" });
    await open(at("08:14"));
    state.headers = new Headers({ "Next-Router-Prefetch": "1", "Next-Router-Segment-Prefetch": "/_tree" });
    await open(at("08:15"));
    state.headers = new Headers();
    const fromRegistration = await open(at("08:16"), { from: "registration" }, { actor: staff.ADMIN });
    // What the language switch lands with (`events/locale-switch.ts`), whatever the page had: the page already open, never a scan.
    state.locale = "en";
    const otherLanguage = await open(at("08:17"), { from: "language" }, { actor: desk.qr2 });
    state.locale = "ro";
    // Each still draws the runner: the desk works the same, only the trail is spared.
    expect(words(fromRegistration)).toContain("Ana Pop");
    expect(words(otherLanguage)).toContain("Ana Pop");
    expect(await scans()).toEqual([]);
    // The same visit with no such sign is one.
    await open(at("08:17"));
    expect(await scans()).toHaveLength(1);
  });

  it("is one scan per account and registration within two minutes, again after — and another account's own within them", async () => {
    expect(CODE_SCAN_REPEAT_MS).toBe(120_000);
    await open(at("08:12"));
    await open(new Date(at("08:12").getTime() + 119_000));
    expect(await scans()).toHaveLength(1);
    // QR3 opens the same code a second later: its own scan.
    await open(new Date(at("08:12").getTime() + 1_000), {}, { actor: desk.qr3 });
    expect((await scans()).map((row) => row.actorStaffUserId).sort()).toEqual([desk.qr2.id, desk.qr3.id].sort());
    // QR2 again past the two minutes: a second scan of its own.
    await open(new Date(at("08:12").getTime() + 121_000), {}, { actor: desk.qr2 });
    expect((await scans()).filter((row) => row.actorStaffUserId === desk.qr2.id)).toHaveLength(2);
    // The service says which: the recent row it repeats, or the one it wrote.
    const repeat = await recordCodeScan(db, desk.qr2, { id: runnerId, eventId, participantId: (await scans())[0].participantId! }, new Date(at("08:12").getTime() + 150_000));
    expect(repeat.recorded).toBe(false);
  });

  it("writes nothing for a code nobody has, or one that is not a code — the page says so", async () => {
    const unknown = await open(at("08:12"), {}, { code: "ZZZZZZZZZZ" });
    expect(words(unknown)).toContain(ro.Admin.desk.unknownCode);
    await open(at("08:13"), {}, { code: "not-a-code" });
    expect(await scans()).toEqual([]);
  });

  it("is the 404 of an unknown page for a role that cannot work the desk, writing nothing — and the service refuses it", async () => {
    await expect(open(at("08:12"), {}, { actor: staff.MEMBER })).rejects.toThrow("NOT_FOUND");
    expect(await scans()).toEqual([]);
    await expect(recordCodeScan(db, staff.MEMBER!, { id: runnerId, eventId, participantId: null as never }, at("08:12"))).rejects.toSatisfy(
      (error: unknown) => isDomainError(error) && error.code === "FORBIDDEN",
    );
    // Every role that works the desk records its own.
    for (const [index, role] of (["CONTRIBUTOR", "COPYWRITER", "MODERATOR", "DEV", "ADMIN", "SUPERADMIN"] as const).entries()) {
      await open(new Date(at("08:20").getTime() + index * 1000), {}, { actor: staff[role] });
    }
    expect(new Set((await scans()).map((row) => row.actorStaffUserId))).toEqual(new Set(["CONTRIBUTOR", "COPYWRITER", "MODERATOR", "DEV", "ADMIN", "SUPERADMIN"].map((role) => staff[role as StaffRole]!.id)));
  });

  it("never breaks the page when the write fails: a warning in the log, and the runner drawn all the same", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const insert = vi.spyOn(db, "insert").mockImplementation(() => {
      throw new Error("the database said no");
    });
    try {
      const page = await open(at("08:12"));
      expect(words(page)).toContain("Ana Pop");
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("[desk] the scan was not recorded: the database said no"));
    } finally {
      insert.mockRestore();
      warn.mockRestore();
    }
    expect(await scans()).toEqual([]);
  });

  it("is scrubbed by the erase like the registration's other rows — no participant, no name — and the registration's trail names it", async () => {
    await open(at("08:12"));
    const trail = await listAuditTrail(db, "registration", runnerId, eventId);
    expect(trail.map((entry) => [entry.action, entry.actorName])).toContainEqual(["registration.code_scanned", "QR2"]);
    await deleteRegistrationByStaff(db, staff.ADMIN!, runnerId, "erasure request", at("09:30"));
    const [row] = await db.select().from(auditLogs).where(and(eq(auditLogs.action, "registration.code_scanned"), eq(auditLogs.entityId, runnerId)));
    // What was done, by whom and when stays; whom goes.
    expect(row).toMatchObject({ actorStaffUserId: desk.qr2.id, participantId: null, metadataJson: { eventId } });
    expect(JSON.stringify(row.metadataJson)).not.toContain("Ana Pop");
  });
});

describe("§NNN «Scanat înainte» under the scanned row", () => {
  it("says nothing when nobody opened the code before", async () => {
    expect(scannedBefore(await open(at("08:12")))).toBeNull();
  });

  it("names the newest three earlier scans, oldest first, with who and when — never this visit's own", async () => {
    await open(at("08:01"), {}, { actor: desk.qr3 });
    await open(at("08:05"), {}, { actor: desk.qr1 });
    await open(at("08:07"), {}, { actor: desk.qr3 });
    await open(at("08:09"), {}, { actor: staff.ADMIN });
    const page = await open(at("08:12"), {}, { actor: desk.qr2 });
    expect(scannedBefore(page)).toBe("Scanat înainte: QR1 la 08:05, QR3 la 08:07, Coleg ADMIN la 08:09");
    // A reload within the two minutes repeats this visit's scan, and leaves it out the same.
    expect(scannedBefore(await open(at("08:13")))).toBe("Scanat înainte: QR1 la 08:05, QR3 la 08:07, Coleg ADMIN la 08:09");
    // Back from a verb, a press later: the viewer's own newest scan is the visit's, still left out.
    expect(scannedBefore(await open(at("08:20"), { saved: "checkedIn" }))).toBe("Scanat înainte: QR1 la 08:05, QR3 la 08:07, Coleg ADMIN la 08:09");
    // Switched to the other language and back past the two minutes (`from=language`): the same visit, no new scan, its own still left out.
    expect(scannedBefore(await open(at("08:25"), { from: "language" }))).toBe("Scanat înainte: QR1 la 08:05, QR3 la 08:07, Coleg ADMIN la 08:09");
    // Past the two minutes, a new visit: the 08:12 scan is an earlier one now.
    expect(scannedBefore(await open(at("08:30")))).toBe("Scanat înainte: QR3 la 08:07, Coleg ADMIN la 08:09, QR2 la 08:12");
  });

  it("says the day beside a scan of another day, and «cont șters» for an account gone since — in English too", async () => {
    await open(at("22:10", "2099-11-20"), {}, { actor: desk.qr1 });
    await open(at("08:05"), {}, { actor: desk.qr3 });
    await db.delete(staffUsers).where(eq(staffUsers.id, desk.qr3.id));
    const page = await open(at("08:12"), {}, { actor: desk.qr2 });
    expect(scannedBefore(page)).toMatch(/^Scanat înainte: QR1 la 22:10 \([^)]*20 nov\.\), cont șters la 08:05$/);
    state.locale = "en";
    const english = await open(at("08:13"), {}, { actor: desk.qr2 });
    expect(scannedBefore(english)).toMatch(/^Scanned before: QR1 at 22:10 \([^)]*20 Nov\), deleted account at 08:05$/);
  });

  it("is read from the scans of this code alone: another runner's scans never reach it", async () => {
    const other = await runner("Ion Lupu", 28);
    await open(at("08:05"), {}, { code: other.code, actor: desk.qr1 });
    expect(scannedBefore(await open(at("08:12"), {}, { actor: desk.qr2 }))).toBeNull();
  });
});
