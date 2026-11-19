import { type ComponentProps, createElement, type ReactNode } from "react";
import { renderToReadableStream } from "react-dom/server";
import { createTranslator, NextIntlClientProvider } from "next-intl";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { events, eventTranslations } from "@/db/schema/events";
import { participants } from "@/db/schema/participants";
import { registrations } from "@/db/schema/registrations";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { findRegistrationByCheckinCode, findRegistrationDetailForAdmin, listDeskRegistrations } from "@/modules/registrations/admin-repository";
import { checkInByStaff } from "@/modules/registrations/admin-service";
import { newCheckinCode } from "@/modules/registrations/checkin-code";
import { checkIn } from "@/modules/registrations/service";
import { type StaffRole, STAFF_ROLES } from "@/modules/staff-identity/domain/roles";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { atTheClock } from "../../helpers/clock";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";
import { statementsOf } from "../../helpers/statements";

/**
 * §NNN, BR-REQ-037-08 — the desk says who marked a runner present (the owner, 2026-11-19: «vreau și tracing pentru voluntariat,
 * gen cine a scanat, cine a marcat prezent»): «Prezent la 08:12 · QR1» on every desk row — the desk's list, a search by name and by
 * number, the scanned page — «· prin „Am ajuns”» for the person's own press and «· cont șters» for an account deleted since, for
 * every role that works the desk, in both languages; read by the desk's own queries — the account's name joined, the person's own
 * press told apart from a deleted account by one probe of the trail inside the same query — never a query per row. The
 * registration's page says the same.
 *
 * The race is in 2099; the made-up people and the desk accounts are nobody.
 */
const state = vi.hoisted(() => ({ db: undefined as unknown, actor: undefined as unknown, locale: "ro" as "ro" | "en" }));

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
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }), headers: async () => new Headers() }));
vi.mock("next/cache", async () => (await import("../../helpers/next-cache")).fakeNextCache.module);
vi.mock("@/auth", () => ({ auth: async () => null, signIn: async () => {}, signOut: async () => {} }));
vi.mock("@/db/client", () => ({ getDb: () => state.db }));
vi.mock("@/modules/staff-identity/session", () => ({
  DEV_STAFF_COOKIE: "dev-staff",
  requireStaff: async () => state.actor,
  requireStaffCapability: async () => state.actor,
}));
vi.mock("@/modules/notifications/send-now-choice", () => ({ sendNowChoiceFor: async () => null }));

const { default: DeskPage } = await import("@/app/[locale]/admin/checkin/page");
const { default: ScannedCodePage } = await import("@/app/[locale]/admin/checkin/[code]/page");

/** A tree as the server streams it, Suspense settled; Emotion's styles and React's separators out of the way. */
async function html(node: ReactNode): Promise<string> {
  const intl = { locale: state.locale, timeZone: "Europe/Bucharest", messages: state.locale === "ro" ? ro : en } as unknown as ComponentProps<typeof NextIntlClientProvider>;
  const stream = await renderToReadableStream(createElement(NextIntlClientProvider, intl, node), { onError: () => {} });
  await stream.allReady;
  return (await new Response(stream).text()).replace(/<style[\s\S]*?<\/style>/g, "").replace(/<!-- -->/g, "");
}
const words = (markup: string) => markup.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/\s+/g, " ").trim();

const START = new Date("2099-11-21T07:00:00.000Z");
/** «08:12» on the event's clock (UTC+2 in November). */
const at = (clock: string) => new Date(`2099-11-21T${String(Number(clock.slice(0, 2)) - 2).padStart(2, "0")}:${clock.slice(3)}:00.000Z`);
/** The desk's «today» for the race: the window `listEventsForDesk` reads is two days back to a month ahead. */
const MORNING = at("07:30");

let db: TestDatabase;
let close: () => Promise<void>;
let serial = 0;
const staff: Partial<Record<StaffRole, StaffUser>> = {};
let qr1: StaffUser;
let qr3: StaffUser;
let eventId: string;

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
  state.db = db;
});
afterAll(async () => close());
beforeEach(async () => {
  await resetTables(db);
  state.locale = "ro";
  for (const role of STAFF_ROLES) {
    [staff[role]] = await db.insert(staffUsers).values({ email: `${role.toLowerCase()}@example.test`, displayName: `Coleg ${role}`, role }).returning();
  }
  [qr1] = await db.insert(staffUsers).values({ email: "qr1@example.test", displayName: "QR1", role: "CONTRIBUTOR" }).returning();
  [qr3] = await db.insert(staffUsers).values({ email: "qr3@example.test", displayName: "QR3", role: "CONTRIBUTOR" }).returning();
  state.actor = qr1;
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
});

async function runner(name: string, bibNumber: number): Promise<{ id: string; code: string }> {
  serial += 1;
  const email = `runner-${serial}@example.test`;
  const [participant] = await db
    .insert(participants)
    .values({ deliveryEmail: email, normalizedEmail: email, canonicalEmail: email, canonicalizationVersion: 2, defaultName: name, preferredLocale: "ro" })
    .returning({ id: participants.id });
  const code = newCheckinCode();
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
      checkinCode: code,
    })
    .returning({ id: registrations.id });
  return { id: row.id, code };
}

/** The race morning: Ana marked at the desk by QR1, Ion by his own «Am ajuns», Eva by QR3 — an account deleted since — and Dan not here. */
async function morning() {
  const ana = await runner("Ana Pop", 27);
  const ion = await runner("Ion Lupu", 28);
  const eva = await runner("Eva Stan", 29);
  const dan = await runner("Dan Ene", 30);
  await checkInByStaff(db, qr1, ana.id, "in", at("08:12"));
  await checkIn(db, ion.id, null, at("08:20"));
  await checkInByStaff(db, qr3, eva.id, "in", at("08:25"));
  await db.delete(staffUsers).where(eq(staffUsers.id, qr3.id));
  return { ana, ion, eva, dan };
}

/** Each desk row's chip «Prezent la …», by the runner's name; null for a row that has none. */
function chipsOf(page: string): Record<string, string | null> {
  const rows = [...page.matchAll(/<li[^>]*data-testid="desk-row"[\s\S]*?<\/li>/g)].map((match) => match[0]);
  return Object.fromEntries(
    rows.map((row) => {
      const name = ["Ana Pop", "Ion Lupu", "Eva Stan", "Dan Ene"].find((candidate) => row.includes(candidate)) ?? "?";
      const chip = /data-testid="desk-checked-in"[\s\S]*?<span[^>]*>([^<]*)<\/span>/.exec(row);
      return [name, chip ? words(chip[1]) : null];
    }),
  );
}
const deskPage = async (query: Record<string, string> = {}) =>
  html(await atTheClock(MORNING, () => DeskPage({ params: Promise.resolve({ locale: state.locale }), searchParams: Promise.resolve({ eventId, ...query }) })));
const scannedPage = async (code: string) =>
  html(await atTheClock(at("08:40"), () => ScannedCodePage({ params: Promise.resolve({ locale: state.locale, code }), searchParams: Promise.resolve({ saved: "checkedIn" }) })));

describe("§NNN «Prezent la HH:MM · cine» on the desk", () => {
  it("names the account, the person's own «Am ajuns», or an account gone since — on the desk's list", async () => {
    await morning();
    expect(chipsOf(await deskPage())).toEqual({
      "Ana Pop": "Prezent la 08:12 · QR1",
      "Ion Lupu": "Prezent la 08:20 · prin „Am ajuns”",
      "Eva Stan": "Prezent la 08:25 · cont șters",
      "Dan Ene": null,
    });
  });

  it("says it on a search by name and by number, and on the scanned page", async () => {
    const { ana, ion, eva } = await morning();
    expect(chipsOf(await deskPage({ q: "lupu" }))).toEqual({ "Ion Lupu": "Prezent la 08:20 · prin „Am ajuns”" });
    expect(chipsOf(await deskPage({ q: "29" }))).toEqual({ "Eva Stan": "Prezent la 08:25 · cont șters" });
    expect(chipsOf(await scannedPage(ana.code))).toEqual({ "Ana Pop": "Prezent la 08:12 · QR1" });
    expect(chipsOf(await scannedPage(ion.code))).toEqual({ "Ion Lupu": "Prezent la 08:20 · prin „Am ajuns”" });
    expect(chipsOf(await scannedPage(eva.code))).toEqual({ "Eva Stan": "Prezent la 08:25 · cont șters" });
  });

  it("says it in English, and to every role that works the desk", async () => {
    await morning();
    state.locale = "en";
    expect(chipsOf(await deskPage())).toMatchObject({
      "Ana Pop": "Here since 08:12 · QR1",
      "Ion Lupu": "Here since 08:20 · via “I have arrived”",
      "Eva Stan": "Here since 08:25 · deleted account",
    });
    state.locale = "ro";
    for (const role of ["CONTRIBUTOR", "COPYWRITER", "MODERATOR", "DEV", "ADMIN", "SUPERADMIN"] as const) {
      state.actor = staff[role];
      expect(chipsOf(await deskPage())["Ana Pop"], role).toBe("Prezent la 08:12 · QR1");
    }
  });

  it("is read by the desk's own query: one statement names the trail, and as many statements read the page for four runners as for fourteen", async () => {
    await morning();
    /*
      Every statement the page sends, but the club's email settings a row's confirmation words read (`confirmWords`): a request's
      memo (`clubCopiesForThisRequest`, `emailRoadsForThisRequest`) answers those once per request on the server, and a test has
      no request to memoize them in. They were read per row before this change and are not about who marked anybody present.
    */
    const statements = async () => {
      const sent = (await statementsOf(db, () => deskPage())).filter((text) => !text.includes('from "platform_settings"'));
      return { count: sent.length, trail: sent.filter((text) => text.includes('"audit_logs"')) };
    };
    const few = await statements();
    // The desk's own list query, with the account joined and the person's own press probed inside it.
    expect(few.trail).toHaveLength(1);
    expect(few.trail[0]).toContain('"checked_in_by"');
    expect(few.trail[0]).toMatch(/NOT EXISTS \(SELECT 1 FROM "audit_logs"/);
    for (let index = 0; index < 10; index += 1) {
      const more = await runner(`Ana Pop ${index}`, 100 + index);
      if (index % 2 === 0) await checkInByStaff(db, qr1, more.id, "in", at("08:30"));
      else await checkIn(db, more.id, null, at("08:31"));
    }
    const many = await statements();
    expect(many.count).toBe(few.count);
    expect(many.trail).toHaveLength(1);
    // …and every one of the ten new rows says who.
    const page = words(await deskPage());
    expect(page.split("Prezent la 08:30 · QR1").length - 1).toBe(5);
    expect(page.split("Prezent la 08:31 · prin „Am ajuns”").length - 1).toBe(5);
  });

  it("is what the desk's reads return, and what the registration's page reads", async () => {
    const { ana, ion, eva } = await morning();
    const rows = await listDeskRegistrations(db, { eventId, query: "", locale: "ro" });
    const by = Object.fromEntries(rows.map((row) => [row.registeredName, [row.checkedInByName, row.checkedInBySelf]]));
    expect(by).toEqual({ "Ana Pop": ["QR1", false], "Ion Lupu": [null, true], "Eva Stan": [null, false], "Dan Ene": [null, false] });
    expect((await findRegistrationByCheckinCode(db, ion.code, "ro"))?.checkedInBySelf).toBe(true);
    expect((await findRegistrationDetailForAdmin(db, ion.id))?.checkedInBySelf).toBe(true);
    expect((await findRegistrationDetailForAdmin(db, eva.id))?.checkedInBySelf).toBe(false);
    expect((await findRegistrationDetailForAdmin(db, ana.id))).toMatchObject({ checkedInByName: "QR1", checkedInBySelf: false });
    // A desk press at a runner already here by «Am ajuns» is no check-in of its own: the person's press stays theirs.
    await checkInByStaff(db, qr1, ion.id, "in", at("08:45"));
    expect((await findRegistrationByCheckinCode(db, ion.code, "ro"))?.checkedInBySelf).toBe(true);
  });
});
