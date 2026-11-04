import { eq } from "drizzle-orm";
import { createTranslator } from "next-intl";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { eventEliteEntries } from "@/db/schema/event-elite-entries";
import { events, eventTranslations } from "@/db/schema/events";
import { participants } from "@/db/schema/participants";
import { type RegistrationStatus, registrations } from "@/db/schema/registrations";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import type { PublicEvent } from "@/modules/events/repository";
import { listEliteEntries, listPublicEliteEntries } from "@/modules/registrations/elite-list";
import { listEliteTicks } from "@/modules/registrations/elite-mark";
import { resolveDisplayName } from "@/modules/registrations/names";
import { countAnonymousStartListEntries, countPublicStartList, countPublicStartListOthers, listPublicStartList, listPublicStartListOthers } from "@/modules/registrations/repository";
import type { StaffRole } from "@/modules/staff-identity/domain/roles";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { atTheClock } from "../../helpers/clock";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * «Apare pe site» (§NNN; the owner, 2026-11-04: per elite, «Apare în clasament» and «Apare pe site»; BR-REQ-039-01, BR-REQ-060-01) —
 * on real PostgreSQL. A line of the race's elite list ticked «Apare pe site» is named under «Elitele cursei», a name and a number and
 * nothing else, only while the event's public list is on; a registered runner marked «Elită» stays on «Cine vine» by their own tick,
 * and the club's tick only hides — a «Participant (nume ascuns)» row when confirmed, no row when pending — never showing anybody who
 * did not tick. The ticks are the Administrator's, asserted at each Server Action's door; the Organizer reads them.
 */
const state = vi.hoisted(() => ({ db: undefined as unknown, actor: undefined as unknown, locale: "ro" as "ro" | "en" }));

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT ${url}`);
  },
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }), headers: async () => new Headers() }));
vi.mock("next/cache", async () => (await import("../../helpers/next-cache")).fakeNextCache.module);
vi.mock("@/auth", () => ({ auth: async () => null, signIn: async () => {}, signOut: async () => {} }));
vi.mock("@/db/client", () => ({ getDb: () => state.db }));
vi.mock("@/i18n/navigation", () => ({ getPathname: () => "/ro/admin/x" }));
vi.mock("next-intl/server", () => ({
  getTranslations: async (namespace: string) => {
    const catalogue = (state.locale === "ro" ? ro : en) as unknown as Record<string, Record<string, string>>;
    return createTranslator({ locale: state.locale, messages: catalogue[namespace], namespace: undefined });
  },
  getLocale: async () => state.locale,
}));
vi.mock("@/modules/staff-identity/session", () => ({
  DEV_STAFF_COOKIE: "dev-staff",
  requireStaff: async () => state.actor,
  requireStaffCapability: async (allowed: (role: string) => boolean) => {
    const { DomainError: Refusal } = await import("@/shared/errors/domain-error");
    if (!allowed((state.actor as StaffUser).role)) throw new Refusal("FORBIDDEN", "not this role");
    return state.actor;
  },
}));
vi.mock("@/modules/notifications/drain", () => ({ drainOutboxAfterResponse: () => undefined, drainOutboxRowsAfterResponse: () => undefined }));

const { setEliteEntryTickAction, setRegisteredEliteTickAction } = await import("@/app/[locale]/admin/actions");
const { setRegistrationEliteTickAction } = await import("@/app/[locale]/admin/registrations/actions");
const { default: StartListNow } = await import("@/modules/events/ui/StartList");

const NOW = new Date("2026-09-24T10:00:00.000Z");
const at = (hour: number) => new Date(Date.UTC(2026, 8, 20, hour));
/** The list asks the real clock whether its event is still ahead: rendered at NOW, on the fixture's calendar (§712). */
const StartList = (props: Parameters<typeof StartListNow>[0]) => atTheClock(NOW, () => StartListNow(props));

let db: TestDatabase;
let close: () => Promise<void>;
let eventId: string;
let serial = 0;

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
  state.db = db;
});
afterAll(async () => close());
beforeEach(async () => {
  state.locale = "ro";
  await resetTables(db);
  const [event] = await db
    .insert(events)
    .values({
      type: "RACE",
      startsAt: new Date("2026-11-21T07:00:00.000Z"),
      registrationMode: "INTERNAL",
      editorialStatus: "PUBLISHED",
      publishedAt: NOW,
      participantListVisibility: "NAMES",
    })
    .returning();
  await db.insert(eventTranslations).values([
    { eventId: event.id, locale: "ro", slug: "cros-elite", title: "Cros" },
    { eventId: event.id, locale: "en", slug: "cross-elite", title: "Cross" },
  ]);
  eventId = event.id;
});

const publicEvent = (visibility: "NAMES" | "HIDDEN" = "NAMES") =>
  ({ id: eventId, participantListVisibility: visibility, publicListClub: "as_typed", waitlistPublic: true, startsAt: new Date("2026-11-21T07:00:00.000Z"), endsAt: null }) as unknown as PublicEvent;

async function as(role: StaffRole): Promise<StaffUser> {
  serial += 1;
  const [user] = await db.insert(staffUsers).values({ email: `${role.toLowerCase()}-${serial}@dev.test`, displayName: role, role }).returning();
  state.actor = user;
  return user;
}

async function register(input: { name: string; status?: RegistrationStatus; ticked?: boolean; elite?: boolean; hiddenFromSite?: boolean; confirmedAt?: Date }) {
  serial += 1;
  const email = `runner${serial}@example.org`;
  const [participant] = await db
    .insert(participants)
    .values({ deliveryEmail: email, normalizedEmail: email, canonicalEmail: email, canonicalizationVersion: 1, defaultName: input.name, preferredLocale: "ro" })
    .returning();
  const status = input.status ?? "CONFIRMED";
  const [row] = await db
    .insert(registrations)
    .values({
      eventId,
      participantId: participant.id,
      status,
      kind: "REAL",
      locale: "ro",
      registeredName: input.name,
      displayName: resolveDisplayName({ legalName: input.name }),
      privacyNoticeVersion: 1,
      privacyAcknowledgedAt: NOW,
      resultsNameConsent: false,
      resultsConsentVersion: 1,
      listOptOut: input.ticked === false,
      confirmedAt: status === "CONFIRMED" ? (input.confirmedAt ?? at(1)) : null,
      emailConfirmedAt: at(0),
      elite: input.elite ?? false,
      eliteHiddenFromSite: input.hiddenFromSite ?? false,
    })
    .returning();
  return row;
}

async function line(name: string, values: { bibNumber?: number; onSite?: boolean; inResults?: boolean; at?: Date } = {}) {
  const [row] = await db
    .insert(eventEliteEntries)
    .values({ eventId, name, bibNumber: values.bibNumber ?? null, onSite: values.onSite ?? false, inResults: values.inResults ?? true, createdAt: values.at ?? NOW })
    .returning();
  return row;
}

/** The markup without Emotion's style tags. */
const markup = (html: string) => html.replace(/<style[\s\S]*?<\/style>/g, "");
const text = (fragment: string) => fragment.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ").trim();
/** The words of each «Elitele cursei» line. */
const elitesOf = (html: string) => [...markup(html).matchAll(/<li[^>]*data-testid="start-list-elite"[^>]*>([\s\S]*?)<\/li>/g)].map((match) => text(match[1]));
/** The table's body rows' name cells. */
const namesOf = (html: string) => {
  const body = markup(html).match(/<tbody\b[^>]*>([\s\S]*?)<\/tbody>/)?.[1] ?? "";
  return [...body.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/g)].map((row) => text(row[1]));
};

/** What a Server Action that redirects throws here (the mock above), or what it returned. */
async function outcomeOf(run: Promise<unknown>): Promise<{ redirect: string } | { returned: unknown }> {
  try {
    return { returned: await run };
  } catch (error) {
    const message = (error as Error).message;
    if (message.startsWith("REDIRECT ")) return { redirect: message.slice("REDIRECT ".length) };
    throw error;
  }
}

function form(fields: Record<string, string>): FormData {
  const posted = new FormData();
  posted.set("uiLocale", "ro");
  posted.set("eventId", eventId);
  for (const [name, value] of Object.entries(fields)) posted.set(name, value);
  return posted;
}

describe("§NNN «Elitele cursei» on the event page", () => {
  it("names only the lines ticked «Apare pe site», in the order typed, with their number — under «Cine vine», never in its table or count", async () => {
    await register({ name: "Ana Popescu" });
    await line("Eliud Kipchoge", { bibNumber: 7, onSite: true, at: at(2) });
    await line("Ascuns Fara Acord", { bibNumber: 8, onSite: false, at: at(3) });
    await line("Faith Kipyegon", { onSite: true, at: at(4) });

    const html = renderToStaticMarkup(await StartList({ event: publicEvent() }));
    expect(elitesOf(html)).toEqual(["Eliud Kipchoge · nr. 7", "Faith Kipyegon"]);
    expect(markup(html)).toContain(ro.Event.startList.elites.title);
    expect(markup(html)).toContain(ro.Event.startList.elites.note);
    expect(markup(html)).not.toContain("Ascuns Fara Acord");
    // Not registrations: the table and the title count Ana alone.
    expect(namesOf(html)).toEqual(["1 Ana Popescu"]);
    expect(markup(html)).toContain("Cine vine (1)");
    // Inside the list's own section, out of search snippets.
    expect(markup(html)).toMatch(/<section[^>]*data-nosnippet=""[\s\S]*data-testid="start-list-elites"/);

    state.locale = "en";
    const english = renderToStaticMarkup(await StartList({ event: publicEvent() }));
    expect(elitesOf(english)).toEqual(["Eliud Kipchoge · no. 7", "Faith Kipyegon"]);
    // React writes an apostrophe as an entity.
    expect(markup(english)).toContain(en.Event.startList.elites.title.replace(/'/g, "&#x27;"));
  });

  it("shows nothing while the event's public list is off, and no block while no line is ticked", async () => {
    await register({ name: "Ana Popescu" });
    await line("Eliud Kipchoge", { bibNumber: 7, onSite: true });
    expect(renderToStaticMarkup(await StartList({ event: publicEvent("HIDDEN") }))).not.toContain("Kipchoge");

    await db.update(eventEliteEntries).set({ onSite: false });
    const html = renderToStaticMarkup(await StartList({ event: publicEvent() }));
    expect(html).not.toContain('data-testid="start-list-elites"');
    expect(html).not.toContain("Kipchoge");
  });

  it("reads a name and a number and nothing else — no id, no tick, no date", async () => {
    await line("Eliud Kipchoge", { bibNumber: 7, onSite: true });
    await line("Fara Acord", { onSite: false });
    const read = await listPublicEliteEntries(db, eventId);
    expect(read).toEqual([{ name: "Eliud Kipchoge", bibNumber: 7 }]);
    expect(await listPublicEliteEntries(db, "not-a-uuid")).toEqual([]);
  });
});

describe("§NNN a registered elite on «Cine vine»: the club's tick only hides (BR-REQ-039-01)", () => {
  it("unticked, a ticked runner is a «Participant (nume ascuns)» row while confirmed, and counted as one", async () => {
    await register({ name: "Ana Popescu", confirmedAt: at(1) });
    await register({ name: "Dan Ionescu", confirmedAt: at(2), elite: true, hiddenFromSite: true });

    expect((await listPublicStartList(db, eventId)).map((row) => row.displayName)).toEqual(["Ana Popescu"]);
    expect(await countPublicStartList(db, eventId)).toBe(1);
    expect(await countAnonymousStartListEntries(db, eventId)).toBe(1);
    const html = renderToStaticMarkup(await StartList({ event: publicEvent() }));
    expect(namesOf(html)).toEqual(["1 Ana Popescu", "Participant (nume ascuns)"]);
    expect(markup(html)).not.toContain("Ionescu");
  });

  it("never shows a runner who did not tick, whatever the club's tick says, and a pending hidden elite is no row at all", async () => {
    // «Apare pe site» stands ticked (nothing hidden) on a runner who did not tick «Vreau să apar»: still anonymous.
    await register({ name: "Ion Discret", elite: true, hiddenFromSite: false, ticked: false });
    // Pending and hidden by the club: not a row and not counted, as one who did not tick.
    await register({ name: "Pending Ascuns", status: "PENDING_DECLARATION", elite: true, hiddenFromSite: true });
    await register({ name: "Pending Vizibil", status: "PENDING_DECLARATION" });
    expect(await listPublicStartList(db, eventId)).toEqual([]);
    expect(await countAnonymousStartListEntries(db, eventId)).toBe(1);
    expect((await listPublicStartListOthers(db, eventId, 1, true)).map((row) => row.displayName)).toEqual(["Pending Vizibil"]);
    expect(await countPublicStartListOthers(db, eventId, 1, true)).toMatchObject({ pending: 1 });
  });

  it("leaves the hide inert once the mark is off: the person's own tick decides again", async () => {
    await register({ name: "Dan Ionescu", elite: false, hiddenFromSite: true });
    expect((await listPublicStartList(db, eventId)).map((row) => row.displayName)).toEqual(["Dan Ionescu"]);
  });
});

describe("§NNN the ticks' readers and Server Actions (BR-REQ-060-01)", () => {
  it("lets the Organizer read the ticks and refuses Tehnic", async () => {
    const dan = await register({ name: "Dan Ionescu", elite: true, hiddenFromSite: true });
    await register({ name: "Ana Popescu" });
    const ticks = await listEliteTicks(db, await as("MODERATOR"), eventId);
    expect([...ticks]).toEqual([[dan.id, { inResults: true, onSite: false }]]);
    await expect(listEliteTicks(db, await as("DEV"), eventId)).rejects.toMatchObject({ code: "FORBIDDEN" });
    // The list's lines carry their ticks for every reader of the card.
    await line("Eliud Kipchoge", { onSite: true, inResults: false });
    expect((await listEliteEntries(db, await as("MODERATOR"), eventId)).map((entry) => [entry.name, entry.inResults, entry.onSite])).toEqual([["Eliud Kipchoge", false, true]]);
  });

  it("refuses the Organizer at each action's door, writing nothing", async () => {
    const dan = await register({ name: "Dan Ionescu", elite: true });
    const eliud = await line("Eliud Kipchoge", { bibNumber: 7 });
    await as("MODERATOR");
    expect(await outcomeOf(setEliteEntryTickAction(null, form({ entryId: eliud.id, tick: "onSite", on: "1" })))).toEqual({ redirect: "/ro/admin/x?error=FORBIDDEN#admin-alert" });
    expect(await outcomeOf(setRegisteredEliteTickAction(null, form({ registrationId: dan.id, tick: "inResults", on: "0" })))).toEqual({ redirect: "/ro/admin/x?error=FORBIDDEN#admin-alert" });
    expect(await outcomeOf(setRegistrationEliteTickAction(null, form({ registrationId: dan.id, tick: "onSite", on: "0" })))).toEqual({ redirect: "/ro/admin/x?error=FORBIDDEN#admin-alert" });
    const [stored] = await db.select().from(eventEliteEntries);
    expect([stored.onSite, stored.inResults]).toEqual([false, true]);
    const [registration] = await db.select().from(registrations).where(eq(registrations.id, dan.id));
    expect([registration.eliteHiddenFromResults, registration.eliteHiddenFromSite]).toEqual([false, false]);
    expect(await db.select().from(auditLogs)).toHaveLength(0);
  });

  it("ticks for the Administrator: the card's two actions land back on the card, the list's on the list, the page's on the page", async () => {
    const dan = await register({ name: "Dan Ionescu", elite: true });
    const eliud = await line("Eliud Kipchoge", { bibNumber: 7 });
    await as("ADMIN");
    expect(await outcomeOf(setEliteEntryTickAction(null, form({ entryId: eliud.id, tick: "onSite", on: "1" })))).toEqual({ redirect: "/ro/admin/x?saved=eliteTicked#bib-elite" });
    expect(await outcomeOf(setRegisteredEliteTickAction(null, form({ registrationId: dan.id, tick: "inResults", on: "0" })))).toEqual({ redirect: "/ro/admin/x?saved=eliteTicked#bib-elite" });
    expect(await outcomeOf(setRegistrationEliteTickAction(null, form({ registrationId: dan.id, tick: "onSite", on: "0", listQuery: "event=x&page=2" })))).toEqual({
      redirect: "/ro/admin/x?event=x&page=2&saved=eliteTicked#admin-alert",
    });
    expect(await outcomeOf(setRegistrationEliteTickAction(null, form({ registrationId: dan.id, tick: "onSite", on: "1" })))).toEqual({ redirect: "/ro/admin/x?saved=eliteTicked#admin-alert" });
    const [stored] = await db.select().from(eventEliteEntries);
    expect([stored.onSite, stored.inResults]).toEqual([true, true]);
    const [registration] = await db.select().from(registrations).where(eq(registrations.id, dan.id));
    expect([registration.eliteHiddenFromResults, registration.eliteHiddenFromSite]).toEqual([true, false]);
    // A tick the forms do not know is refused, nothing written.
    expect(await outcomeOf(setEliteEntryTickAction(null, form({ entryId: eliud.id, tick: "elite", on: "1" })))).toEqual({ redirect: "/ro/admin/x?error=VALIDATION_ERROR#admin-alert" });
    expect((await db.select().from(auditLogs)).map((row) => row.action)).toEqual(["event_elite.on_site", "registration.elite_out_of_results", "registration.elite_off_site", "registration.elite_on_site"]);
  });

  it("refuses a registration's ticks once its mark is gone, in its own words", async () => {
    const ana = await register({ name: "Ana Popescu" });
    await as("ADMIN");
    expect(await outcomeOf(setRegistrationEliteTickAction(null, form({ registrationId: ana.id, tick: "onSite", on: "0" })))).toEqual({ redirect: "/ro/admin/x?error=ELITE_NOT_MARKED#admin-alert" });
    expect(ro.Admin.errors.ELITE_NOT_MARKED).toContain("nu mai e marcată ca elită");
    expect(en.Admin.errors.ELITE_NOT_MARKED).toContain("no longer marked elite");
  });
});
