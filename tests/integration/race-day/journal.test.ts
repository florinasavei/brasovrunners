import { type ComponentProps, createElement, type ReactNode } from "react";
import { renderToReadableStream } from "react-dom/server";
import { createTranslator, NextIntlClientProvider } from "next-intl";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { eventVolunteers } from "@/db/schema/event-volunteers";
import { events, eventTranslations } from "@/db/schema/events";
import { participants } from "@/db/schema/participants";
import { registrations } from "@/db/schema/registrations";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { findJournalEvent, readRaceDayJournal } from "@/modules/race-day/journal";
import { checkInByStaff, deleteRegistrationByStaff, recordCodeScan } from "@/modules/registrations/admin-service";
import { newCheckinCode } from "@/modules/registrations/checkin-code";
import { checkIn } from "@/modules/registrations/service";
import { type StaffRole, STAFF_ROLES } from "@/modules/staff-identity/domain/roles";
import { changeVolunteer } from "@/modules/volunteers/volunteers";
import { isDomainError } from "@/shared/errors/domain-error";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { atTheClock } from "../../helpers/clock";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";
import { statementsOf } from "../../helpers/statements";

/**
 * §996, BR-REQ-037-08, BR-REQ-050-02, BR-REQ-060-01 — «Ziua cursei» → «Jurnal» (the owner, 2026-11-19: «vreau si tracing pentru
 * voluntarim [voluntari] gen cine a scanat, cine a marcat prezent»), read from a real database through the page:
 *
 * - for the Organizer, the Administrator and the Superadministrator; a 404 and no tab for every other role, and the read refuses them;
 * - the chosen event's scans, check-ins (at the desk and by «Am ajuns») and undos and its volunteers' «Prezent» ticked and unticked,
 *   newest first, each line the time to the second on the event's clock (the day beside a line of another day), who — the account,
 *   «participantul», «cont șters» —, what, and whom as a link to the registration or the volunteer, a test registration marked;
 * - one line per account at the top, a test registration never counted;
 * - the GET form's two filters, by account and by kind, alone and together, anything else in the address being everybody;
 * - at most the newest 300 lines, then «și încă N» in the counted forms; a fixed number of queries whatever the rows;
 * - an erased registration's lines gone with it; an event the address names that is not on the desk's list; both languages.
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
// The house's typed routing, reduced to what the page asks of it: the locale's prefix, the params filled in, a query appended.
vi.mock("@/i18n/navigation", () => {
  type Href = string | { pathname: string; params?: Record<string, string>; query?: Record<string, string> };
  const hrefOf = (locale: string, href: Href) => {
    if (typeof href === "string") return `/${locale}${href}`;
    let path = href.pathname;
    for (const [key, value] of Object.entries(href.params ?? {})) path = path.replace(`[${key}]`, value);
    const query = href.query ? `?${new URLSearchParams(href.query).toString()}` : "";
    return `/${locale}${path}${query}`;
  };
  return {
    getPathname: ({ locale, href }: { locale: string; href: Href }) => hrefOf(locale, href),
    Link: ({ href, children, prefetch, ...rest }: { href: Href; children?: ReactNode; prefetch?: boolean } & Record<string, unknown>) =>
      createElement("a", { href: hrefOf(state.locale, href), "data-prefetch": String(prefetch), ...rest }, children),
  };
});
vi.mock("@/modules/staff-identity/session", () => ({
  DEV_STAFF_COOKIE: "dev-staff",
  requireStaff: async () => state.actor,
  requireStaffCapability: async () => state.actor,
}));
vi.mock("@/modules/notifications/send-now-choice", () => ({ sendNowChoiceFor: async () => null }));

const { default: JournalPage } = await import("@/app/[locale]/admin/checkin/jurnal/page");
const { default: DeskPage } = await import("@/app/[locale]/admin/checkin/page");

/** A tree as the server streams it, Suspense settled; Emotion's styles and React's separators out of the way. */
async function html(node: ReactNode): Promise<string> {
  const intl = { locale: state.locale, timeZone: "Europe/Bucharest", messages: state.locale === "ro" ? ro : en } as unknown as ComponentProps<typeof NextIntlClientProvider>;
  const stream = await renderToReadableStream(createElement(NextIntlClientProvider, intl, node), { onError: () => {} });
  await stream.allReady;
  return (await new Response(stream).text()).replace(/<style[\s\S]*?<\/style>/g, "").replace(/<!-- -->/g, "");
}
const words = (markup: string) => markup.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/\s+/g, " ").trim();

const START = new Date("2099-11-21T07:00:00.000Z");
/** «08:05:03» on the event's clock (UTC+2 in November), on the race's day unless another is named. */
const at = (clock: string, day = "2099-11-21") => {
  const [hours, minutes, seconds = "00"] = clock.split(":");
  return new Date(`${day}T${String(Number(hours) - 2).padStart(2, "0")}:${minutes}:${seconds}.000Z`);
};
const MORNING = at("10:00");

let db: TestDatabase;
let close: () => Promise<void>;
let serial = 0;
const staff: Partial<Record<StaffRole, StaffUser>> = {};
const desk = {} as Record<"qr1" | "qr2" | "qr9" | "org1" | "org2", StaffUser>;
let eventId: string;
const people = { ana: "", ion: "", eva: "", test: "", mara: "", radu: "" };

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
  for (const [key, name, role] of [
    ["qr1", "QR1", "CONTRIBUTOR"],
    ["qr2", "QR2", "CONTRIBUTOR"],
    ["qr9", "QR9", "CONTRIBUTOR"],
    ["org1", "Org1", "MODERATOR"],
    ["org2", "Org2", "MODERATOR"],
  ] as const) {
    [desk[key]] = await db.insert(staffUsers).values({ email: `${key}@example.test`, displayName: name, role }).returning();
  }
  state.actor = staff.MODERATOR;
  eventId = await race();
});

async function race(over: Partial<typeof events.$inferInsert> = {}): Promise<string> {
  serial += 1;
  const [event] = await db
    .insert(events)
    .values({ type: "RACE", startsAt: START, timezone: "Europe/Bucharest", registrationMode: "INTERNAL", editorialStatus: "PUBLISHED", publishedAt: START, locationName: "Start", acceptsVolunteers: true, ...over })
    .returning({ id: events.id });
  await db.insert(eventTranslations).values([
    { eventId: event.id, locale: "ro", slug: `crosul-${serial}`, title: `Crosul ${serial}` },
    { eventId: event.id, locale: "en", slug: `cross-${serial}`, title: `The cross ${serial}` },
  ]);
  return event.id;
}

async function runner(name: string, bibNumber: number | null, more: Partial<typeof registrations.$inferInsert> = {}, onEvent = eventId): Promise<string> {
  serial += 1;
  const email = `runner-${serial}@example.test`;
  const [participant] = await db
    .insert(participants)
    .values({ deliveryEmail: email, normalizedEmail: email, canonicalEmail: email, canonicalizationVersion: 2, defaultName: name, preferredLocale: "ro" })
    .returning({ id: participants.id });
  const [row] = await db
    .insert(registrations)
    .values({
      eventId: onEvent,
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
      checkinCode: newCheckinCode(),
      ...more,
    })
    .returning({ id: registrations.id });
  return row.id;
}

async function volunteer(name: string, onEvent = eventId): Promise<string> {
  serial += 1;
  const email = `volunteer-${serial}@example.test`;
  const [row] = await db
    .insert(eventVolunteers)
    .values({ eventId: onEvent, name, email, canonicalEmail: email, canonicalizationVersion: 2, phone: "+40712345678", state: "CONFIRMED", source: "STAFF" })
    .returning({ id: eventVolunteers.id });
  return row.id;
}

const scan = async (actor: StaffUser, id: string, instant: Date) => {
  const [row] = await db.select({ participantId: registrations.participantId, eventId: registrations.eventId }).from(registrations).where(eq(registrations.id, id));
  await recordCodeScan(db, actor, { id, eventId: row.eventId, participantId: row.participantId }, instant);
};
const tick = (actor: StaffUser, id: string, present: boolean, instant: Date) => changeVolunteer(db, actor, { kind: "setPresent", eventId, id, present }, instant);

/** The race morning, and a rehearsal the evening before. */
async function morning() {
  people.ana = await runner("Ana Pop", 27);
  people.ion = await runner("Ion Lupu", 28);
  people.eva = await runner("Eva Stan", 29);
  people.test = await runner("Test Pop", null, { kind: "TEST" });
  people.mara = await volunteer("Mara Dinu");
  people.radu = await volunteer("Radu Mircea");
  await scan(desk.qr1, people.ion, at("19:00:00", "2099-11-20"));
  await scan(desk.qr1, people.ana, at("08:05:03"));
  await checkInByStaff(db, desk.qr1, people.ana, "in", at("08:05:30"));
  await checkInByStaff(db, desk.qr2, people.ana, "undo", at("08:06:10"));
  await checkInByStaff(db, desk.qr2, people.ana, "in", at("08:06:40"));
  await checkIn(db, people.ion, null, at("08:10:00"));
  await scan(desk.qr9, people.eva, at("08:12:00"));
  await checkInByStaff(db, desk.qr9, people.eva, "in", at("08:12:20"));
  await tick(desk.org1, people.mara, true, at("08:20:00"));
  await tick(desk.org2, people.mara, false, at("08:25:00"));
  await tick(desk.org2, people.radu, true, at("08:26:00"));
  await scan(desk.qr1, people.test, at("08:30:00"));
  // QR9's account is removed from «Echipa» since: its rows keep no name.
  await db.delete(staffUsers).where(eq(staffUsers.id, desk.qr9.id));
}

const tree = (query: Record<string, string> = {}) => atTheClock(MORNING, () => JournalPage({ params: Promise.resolve({ locale: state.locale }), searchParams: Promise.resolve({ eventId, ...query }) }));
const page = async (query: Record<string, string> = {}) => html(await tree(query));
/** The lines as they read, top to bottom. */
const linesOf = (markup: string) => [...markup.matchAll(/<li[^>]*data-testid="race-day-journal-line"[^>]*>([\s\S]*?)<\/li>/g)].map((match) => words(match[1]));
const summaryOf = (markup: string) => [...markup.matchAll(/<li[^>]*data-testid="race-day-journal-account-line"[^>]*>([\s\S]*?)<\/li>/g)].map((match) => words(match[1]));
const optionsOf = (markup: string, name: string) => {
  const select = new RegExp(`<select[^>]*name="${name}"[^>]*>([\\s\\S]*?)</select>`).exec(markup)?.[1] ?? "";
  return [...select.matchAll(/<option value="([^"]*)"( selected="")?>([^<]*)<\/option>/g)].map((match) => ({ value: match[1], selected: Boolean(match[2]), label: words(match[3]) }));
};
const tabsOf = (markup: string) => {
  const row = /<div[^>]*data-testid="race-day-tabs"[^>]*>([\s\S]*?)<\/nav>/.exec(markup);
  return row ? [...row[1].matchAll(/<a ([^>]*)>([\s\S]*?)<\/a>/g)].map((match) => ({ label: words(match[2]), current: match[1].includes('aria-current="page"'), href: (/href="([^"]*)"/.exec(match[1])?.[1] ?? "").replace(/&amp;/g, "&") })) : [];
};

const ALL_LINES = [
  "08:30:00 QR1 a scanat Test Pop (test)",
  "08:26:00 Org2 a bifat prezent Radu Mircea (voluntar)",
  "08:25:00 Org2 a debifat prezent Mara Dinu (voluntar)",
  "08:20:00 Org1 a bifat prezent Mara Dinu (voluntar)",
  "08:12:20 cont șters a marcat prezent Eva Stan (nr. 29)",
  "08:12:00 cont șters a scanat Eva Stan (nr. 29)",
  "08:10:00 participantul a marcat prezent Ion Lupu (nr. 28)",
  "08:06:40 QR2 a marcat prezent Ana Pop (nr. 27)",
  "08:06:10 QR2 a anulat prezența Ana Pop (nr. 27)",
  "08:05:30 QR1 a marcat prezent Ana Pop (nr. 27)",
  "08:05:03 QR1 a scanat Ana Pop (nr. 27)",
];

describe("§996 «Jurnal» — who may read it", () => {
  it("opens for the Organizer, the Administrator and the Superadministrator, and is a 404 for every other role", async () => {
    for (const role of ["MODERATOR", "ADMIN", "SUPERADMIN"] as const) {
      state.actor = staff[role];
      expect(words(await page()), role).toContain("Jurnalul zilei cursei");
    }
    for (const role of ["MEMBER", "CONTRIBUTOR", "COPYWRITER", "DEV"] as const) {
      state.actor = staff[role];
      await expect(page(), role).rejects.toThrow("NOT_FOUND");
    }
  });

  it("is refused by the read itself to every role that may not read it", async () => {
    const event = (await findJournalEvent(db, eventId, "ro"))!;
    for (const role of ["MEMBER", "CONTRIBUTOR", "COPYWRITER", "DEV"] as const) {
      await expect(readRaceDayJournal(db, staff[role]!, { event, account: { kind: "all" }, kind: null, locale: "ro" }), role).rejects.toSatisfy(
        (error: unknown) => isDomainError(error) && error.code === "FORBIDDEN",
      );
    }
  });

  it("is the tab of «Ziua cursei» before «Declarații» (§1018), the last, for those three, current on its page and carrying the event — and drawn for nobody else", async () => {
    state.actor = staff.ADMIN;
    const own = tabsOf(await page());
    expect(own.at(-2)).toEqual({ label: "Jurnal", current: true, href: `/ro/admin/checkin/jurnal?eventId=${eventId}` });
    expect(own.at(-1)).toEqual({ label: "Declarații", current: false, href: `/ro/admin/checkin/declaratii?eventId=${eventId}` });
    const deskTabs = async () => tabsOf(await html(await atTheClock(MORNING, () => DeskPage({ params: Promise.resolve({ locale: state.locale }), searchParams: Promise.resolve({ eventId }) }))));
    for (const role of ["MODERATOR", "ADMIN", "SUPERADMIN"] as const) {
      state.actor = staff[role];
      expect((await deskTabs()).map((tab) => tab.label).slice(-2), role).toEqual(["Jurnal", "Declarații"]);
    }
    for (const role of ["CONTRIBUTOR", "COPYWRITER", "DEV"] as const) {
      state.actor = staff[role];
      expect((await deskTabs()).map((tab) => tab.label), role).not.toContain("Jurnal");
    }
    state.actor = staff.MODERATOR;
    state.locale = "en";
    expect((await deskTabs()).map((tab) => tab.label).slice(-2)).toEqual(["Log", "Declarations"]);
  });
});

describe("§996 «Jurnal» — the lines and the summary", () => {
  it("lists every scan, check-in, undo and volunteer tick of the event, newest first, to the second, with who, what and whom", async () => {
    await morning();
    const markup = await page();
    const lines = linesOf(markup);
    expect(lines.slice(0, ALL_LINES.length)).toEqual(ALL_LINES);
    // The rehearsal of the evening before: its day beside its time.
    expect(lines).toHaveLength(ALL_LINES.length + 1);
    expect(lines.at(-1)).toMatch(/^19:00:00 \([^)]*20 nov\.\) QR1 a scanat Ion Lupu \(nr\. 28\)$/);
    // Each name is a link to its page, never prefetched; each line says its kind.
    const links = [...markup.matchAll(/<a href="([^"]*)" data-prefetch="([^"]*)"[^>]*data-testid="race-day-journal-whom"/g)].map((match) => [match[1], match[2]]);
    expect(links).toContainEqual([`/ro/admin/registrations/${people.ana}`, "false"]);
    expect(links).toContainEqual([`/ro/admin/volunteers/${people.mara}`, "false"]);
    expect(links.every(([, prefetch]) => prefetch === "false")).toBe(true);
    const kinds = [...markup.matchAll(/data-testid="race-day-journal-line" data-kind="([^"]*)"/g)].map((match) => match[1]);
    expect(kinds.slice(0, 4)).toEqual(["scanned", "volunteerPresent", "volunteerAbsent", "volunteerPresent"]);
  });

  it("says one line per account at the top — a test registration never counted — and offers each account to the filter", async () => {
    await morning();
    const markup = await page();
    expect(summaryOf(markup)).toEqual([
      "Org1 : 1 bifă la voluntari",
      "Org2 : 2 bife la voluntari",
      "QR1 : 2 scanări · 1 marcat prezent",
      "QR2 : 1 marcat prezent · 1 prezență anulată",
      "Conturi șterse : 1 scanare · 1 marcat prezent",
      "Participanții, prin „Am ajuns” : 1 marcat prezent",
    ]);
    expect(optionsOf(markup, "account").map((option) => option.label)).toEqual([
      "Toate conturile",
      "Org1",
      "Org2",
      "QR1",
      "QR2",
      "Conturi șterse",
      "Participanții, prin „Am ajuns”",
    ]);
    expect(optionsOf(markup, "kind").map((option) => option.value)).toEqual(["", "scanned", "checkedIn", "undone", "volunteerPresent", "volunteerAbsent"]);
  });

  it("says it in English", async () => {
    await morning();
    state.locale = "en";
    const markup = await page();
    expect(words(markup)).toContain("Race-day log");
    expect(linesOf(markup).slice(4, 11)).toEqual([
      "08:12:20 deleted account marked present Eva Stan (no. 29)",
      "08:12:00 deleted account scanned Eva Stan (no. 29)",
      "08:10:00 the participant marked present Ion Lupu (no. 28)",
      "08:06:40 QR2 marked present Ana Pop (no. 27)",
      "08:06:10 QR2 undid the check-in of Ana Pop (no. 27)",
      "08:05:30 QR1 marked present Ana Pop (no. 27)",
      "08:05:03 QR1 scanned Ana Pop (no. 27)",
    ]);
    expect(linesOf(markup)[1]).toBe("08:26:00 Org2 ticked present Radu Mircea (volunteer)");
    expect(summaryOf(markup)).toContain("QR1 : 2 scans · 1 marked present");
    expect(summaryOf(markup)).toContain("Participants, via “I have arrived” : 1 marked present");
  });

  it("says nothing yet for an event nobody worked, and names no account", async () => {
    const markup = await page();
    expect(words(markup)).toContain(ro.Admin.raceDay.journal.empty);
    expect(markup).not.toContain('data-testid="race-day-journal-summary"');
    expect(optionsOf(markup, "account").map((option) => option.label)).toEqual(["Toate conturile"]);
  });

  it("drops the lines of a registration erased since, with its counts", async () => {
    await morning();
    await deleteRegistrationByStaff(db, staff.ADMIN!, people.eva, "erasure request", at("09:00:00"));
    const markup = await page();
    expect(linesOf(markup).some((line) => line.includes("Eva Stan"))).toBe(false);
    expect(summaryOf(markup).some((line) => line.startsWith("Conturi șterse"))).toBe(false);
  });

  it("reads an event the address names that is not on the desk's list — a race closed since", async () => {
    await morning();
    await db.update(events).set({ eventStatus: "COMPLETED" }).where(eq(events.id, eventId));
    const markup = await page();
    expect(linesOf(markup)).toHaveLength(ALL_LINES.length + 1);
    expect(optionsOf(markup, "eventId").find((option) => option.selected)?.value).toBe(eventId);
  });
});

describe("§996 «Jurnal» — the filters", () => {
  const ids = () => ({ qr1: desk.qr1.id, qr2: desk.qr2.id });

  it("filters by account: one account, the participants' own «Am ajuns», the deleted accounts", async () => {
    await morning();
    expect(linesOf(await page({ account: ids().qr1 })).map((line) => line.slice(0, 8))).toEqual(["08:30:00", "08:05:30", "08:05:03", "19:00:00"]);
    expect(linesOf(await page({ account: "participant" }))).toEqual(["08:10:00 participantul a marcat prezent Ion Lupu (nr. 28)"]);
    expect(linesOf(await page({ account: "removed" }))).toEqual(["08:12:20 cont șters a marcat prezent Eva Stan (nr. 29)", "08:12:00 cont șters a scanat Eva Stan (nr. 29)"]);
    const markup = await page({ account: ids().qr1 });
    expect(optionsOf(markup, "account").find((option) => option.selected)?.label).toBe("QR1");
  });

  it("filters by kind, and by both together", async () => {
    await morning();
    expect(linesOf(await page({ kind: "scanned" })).map((line) => line.slice(0, 8))).toEqual(["08:30:00", "08:12:00", "08:05:03", "19:00:00"]);
    expect(linesOf(await page({ kind: "checkedIn" })).map((line) => line.slice(0, 8))).toEqual(["08:12:20", "08:10:00", "08:06:40", "08:05:30"]);
    expect(linesOf(await page({ kind: "undone" }))).toEqual(["08:06:10 QR2 a anulat prezența Ana Pop (nr. 27)"]);
    expect(linesOf(await page({ kind: "volunteerPresent" })).map((line) => line.slice(0, 8))).toEqual(["08:26:00", "08:20:00"]);
    expect(linesOf(await page({ kind: "volunteerAbsent" }))).toEqual(["08:25:00 Org2 a debifat prezent Mara Dinu (voluntar)"]);
    expect(linesOf(await page({ kind: "checkedIn", account: ids().qr2 }))).toEqual(["08:06:40 QR2 a marcat prezent Ana Pop (nr. 27)"]);
    const none = await page({ kind: "scanned", account: "participant" });
    expect(linesOf(none)).toEqual([]);
    expect(words(none)).toContain(ro.Admin.raceDay.journal.emptyFiltered);
    // The summary stays the whole event's, whatever the filter.
    expect(summaryOf(none)).toHaveLength(6);
  });

  it("reads anything else in the address as everybody and everything — another event's account too", async () => {
    await morning();
    const queries: Array<Record<string, string>> = [{ account: "junk" }, { kind: "junk" }, { account: staff.SUPERADMIN!.id }, { account: "", kind: "" }];
    for (const query of queries) {
      const markup = await page(query);
      expect(linesOf(markup), JSON.stringify(query)).toHaveLength(ALL_LINES.length + 1);
      expect(optionsOf(markup, "account").find((option) => option.selected)?.value ?? "", JSON.stringify(query)).toBe("");
    }
  });
});

describe("§996 «Jurnal» — the cap and the cost", () => {
  /** `n` scans of one runner by QR1, a second apart, written as the trail holds them. */
  async function scans(n: number, id: string) {
    const [row] = await db.select({ participantId: registrations.participantId }).from(registrations).where(eq(registrations.id, id));
    const base = at("07:00:00").getTime();
    await db.insert(auditLogs).values(
      Array.from({ length: n }, (_, index) => ({
        actorStaffUserId: desk.qr1.id,
        participantId: row.participantId,
        action: "registration.code_scanned",
        entityType: "registration",
        entityId: id,
        metadataJson: { eventId },
        createdAt: new Date(base + index * 1000),
      })),
    );
  }

  it("draws at most the newest 300 lines, then «și încă N» in the counted forms", async () => {
    await morning();
    await scans(330, people.ana);
    const markup = await page();
    const lines = linesOf(markup);
    expect(lines).toHaveLength(300);
    expect(lines[0]).toBe(ALL_LINES[0]);
    // 342 lines in all: the newest 300 shown, 42 more.
    expect(words(/data-testid="race-day-journal-more"[^>]*>([^<]*)</.exec(markup)![1])).toBe("și încă 42 de rânduri, mai vechi");
    expect(summaryOf(markup)).toContain("QR1 : 332 de scanări · 1 marcat prezent");
    // A filter the cap does not reach says nothing more.
    expect(await page({ kind: "volunteerPresent" })).not.toContain('data-testid="race-day-journal-more"');
    state.locale = "en";
    expect(words(/data-testid="race-day-journal-more"[^>]*>([^<]*)</.exec(await page())![1])).toBe("and 42 more lines, older");
  });

  it("sends the same number of statements for a quiet log as for a busy one", async () => {
    await morning();
    const statements = async () => (await statementsOf(db, () => page())).filter((text) => !text.includes('from "platform_settings"')).length;
    const quiet = await statements();
    await scans(400, people.ana);
    for (let index = 0; index < 8; index += 1) {
      const id = await runner(`Ana Pop ${index}`, 100 + index);
      await checkInByStaff(db, desk.qr2, id, "in", at(`08:4${index}:00`));
      const helper = await volunteer(`Mara Dinu ${index}`);
      await tick(desk.org1, helper, true, at(`08:5${index}:00`));
    }
    await checkIn(db, await runner("Ion Lupu 2", 200), null, at("09:01:00"));
    expect(await statements()).toBe(quiet);
  });

  it("never reads another event's rows", async () => {
    await morning();
    const other = await race();
    const stranger = await runner("Dan Ene", 31, {}, other);
    await recordCodeScan(db, desk.qr2, { id: stranger, eventId: other, participantId: (await db.select().from(registrations).where(eq(registrations.id, stranger)))[0].participantId }, at("08:40:00"));
    const helper = await volunteer("Zoe Manea", other);
    await changeVolunteer(db, desk.org1, { kind: "setPresent", eventId: other, id: helper, present: true }, at("08:41:00"));
    const lines = linesOf(await page());
    expect(lines.some((line) => line.includes("Dan Ene") || line.includes("Zoe Manea"))).toBe(false);
    expect(lines).toHaveLength(ALL_LINES.length + 1);
  });
});
