import { eq } from "drizzle-orm";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { events, eventTranslations } from "@/db/schema/events";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { listPartnerShares } from "@/modules/audit/repository";
import { STAFF_ROLES, canManageRegistrations, type StaffRole } from "@/modules/staff-identity/domain/roles";
import { isDomainError } from "@/shared/errors/domain-error";
import type { ConfirmSpec } from "@/shared/feedback/notice";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * §948 — «Șterge» on a row of «Liste date sponsorilor» (the owner, 2026-11-15, of a list downloaded by mistake: «vreau
 * să pot șterge (hard delete) și faza asta, pentru că am generat din greșeală!»). BR-REQ-071-01, and BR-REQ-060-01 for who.
 *
 * What is protected, on real PostgreSQL (PGlite), through the service, the register as the server draws it, the two
 * pages that hand it its press, and the real action:
 * - the list's own row is deleted for real: gone from the register on both doors and from «Dată partenerilor» of every
 *   registration the file held;
 * - only a list's row: the id of any other row of the trail deletes nothing;
 * - what is left is one row about the same event with the list's moment, count and file — never the recipient, never a
 *   registration's id;
 * - the Administrator's alone: every other role — the Organizer, who may take the list and read the register, among
 *   them — is refused on the server and offered no press;
 * - the press asks first, in words that say when it is right, and comes back to the register it was pressed in.
 */
const state = vi.hoisted(() => ({ db: undefined as unknown, locale: "ro" as "ro" | "en", actor: undefined as unknown }));

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }), headers: async () => new Headers() }));
vi.mock("next/cache", async () => (await import("../../helpers/next-cache")).fakeNextCache.module);
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT ${url}`);
  },
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));
vi.mock("@/auth", () => ({ auth: async () => null, signIn: async () => {}, signOut: async () => {} }));
vi.mock("@/db/client", () => ({ getDb: () => state.db }));
vi.mock("@/i18n/navigation", () => ({ getPathname: ({ href }: { href: string | { pathname: string } }) => `/ro${typeof href === "string" ? href : href.pathname}`, Link: () => null }));
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
vi.mock("@/modules/notifications/send-now-choice", () => ({ sendNowChoiceFor: async () => null }));
// The register is a Server Component: its words from the catalogues, as the page has them.
vi.mock("next-intl/server", async (original) => {
  const { createTranslator } = await import("next-intl");
  return {
    ...(await original<typeof import("next-intl/server")>()),
    setRequestLocale: () => {},
    getLocale: async () => state.locale,
    getTranslations: async (arg: string | { locale: string; namespace: string }) => {
      const namespace = typeof arg === "string" ? arg : arg.namespace;
      const locale = typeof arg === "string" ? state.locale : (arg.locale as "ro" | "en");
      return createTranslator({ locale, messages: locale === "ro" ? ro : en, namespace: namespace as "Admin" });
    },
  };
});
vi.mock("@/shared/feedback/email-roads-request", () => ({
  emailRoadsForThisRequest: async () => ({ groups: { links: "mailgun", confirmations: "mailgun", reminders: "mailgun", announcements: "mailgun", club: "mailgun", newsletter: "mailgun" }, gmail: false }),
}));

const { deleteSponsorListRecord, readSponsorRegister, SPONSOR_REGISTER_ANCHOR } = await import("@/modules/registrations/sponsor-register");
const { default: SponsorListRegister } = await import("@/modules/registrations/ui/SponsorListRegister");
const { default: SponsorListButton } = await import("@/modules/registrations/ui/SponsorListButton");
const { default: PromoConsenters } = await import("@/modules/newsletter/ui/PromoConsenters");
const { default: AdminRegistrationsPage } = await import("@/app/[locale]/admin/registrations/(list)/page");
const { default: NewsletterPage } = await import("@/app/[locale]/admin/newsletter/page");
const { deleteSponsorListRecordAction } = await import("@/app/[locale]/admin/registrations/actions");

const NOW = new Date("2026-11-15T08:00:00.000Z");
const OVIDIU_AT = new Date("2026-11-14T18:00:00.000Z");
const DIANA_AT = new Date("2026-11-03T14:43:00.000Z");
const CLUB_AT = new Date("2026-10-20T07:28:00.000Z");
/** Two registrations' ids, as a download records them: this test reads them back, it needs no registration behind them. */
const ANA = "11111111-1111-4111-8111-111111111111";
const BEN = "22222222-2222-4222-8222-222222222222";

type Element = ReactElement<Record<string, unknown> & { children?: ReactNode }>;

let db: TestDatabase;
let close: () => Promise<void>;
let admin: StaffUser;
let seq = 0;

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
  state.db = db;
});
afterAll(async () => close());
beforeEach(async () => {
  await resetTables(db);
  state.locale = "ro";
  admin = await staff("ADMIN");
  state.actor = admin;
});

async function staff(role: StaffRole): Promise<StaffUser> {
  const [user] = await db.insert(staffUsers).values({ email: `${role.toLowerCase()}-${seq++}@dev.test`, displayName: `Colleague ${role}`, role }).returning();
  return user;
}

async function createEvent(title: string): Promise<string> {
  const [event] = await db
    .insert(events)
    .values({ type: "RACE", startsAt: new Date("2099-11-21T08:00:00.000Z"), registrationMode: "INTERNAL", editorialStatus: "PUBLISHED", publishedAt: NOW, capacity: 150, locationName: "Start" })
    .returning({ id: events.id });
  await db.insert(eventTranslations).values([
    { eventId: event.id, locale: "ro", slug: `${title}-ro-${seq}`, title },
    { eventId: event.id, locale: "en", slug: `${title}-en-${seq++}`, title: `${title} (en)` },
  ]);
  return event.id;
}

/** One list in the trail, as the download writes it; answers the row's id — the register row's own. */
async function given(at: Date, eventId: string | null, recipient: string | undefined, registrationIds: string[], format: "csv" | "xlsx" = "xlsx"): Promise<string> {
  const [row] = await db
    .insert(auditLogs)
    .values({
      actorStaffUserId: admin.id,
      action: "registrations.sponsor_list_exported",
      entityType: "event",
      entityId: eventId,
      metadataJson: { eventId, format, count: registrationIds.length, ...(recipient === undefined ? {} : { recipient }), registrationIds },
      createdAt: at,
    })
    .returning({ id: auditLogs.id });
  return row.id;
}

/** The race's three lists of the owner's screen: the one made by mistake the newest. */
async function threeLists() {
  const race = await createEvent("Crosul aniversar");
  const club = await given(CLUB_AT, race, "nistor", [ANA], "csv");
  const diana = await given(DIANA_AT, race, "Diana", [ANA, BEN]);
  const ovidiu = await given(OVIDIU_AT, race, "Ovidiu", [ANA, BEN]);
  return { race, club, diana, ovidiu };
}

async function failureOf(operation: Promise<unknown>) {
  try {
    await operation;
  } catch (error) {
    if (isDomainError(error)) return error;
    throw error;
  }
  throw new Error("expected a DomainError");
}

const recipientsOf = async (eventId?: string) => (await readSponsorRegister(db, admin, { eventId, locale: "ro" })).lists.map((list) => list.recipient);
const sharesOf = async (registrationId: string) => (await listPartnerShares(db, registrationId)).map((share) => share.recipient);
const trailOf = (action: string) => db.select().from(auditLogs).where(eq(auditLogs.action, action));

/** Every element of a tree: the children, and any element handed through another prop. */
function elements(node: unknown, acc: Element[] = []): Element[] {
  if (Array.isArray(node)) {
    for (const child of node) elements(child, acc);
    return acc;
  }
  if (!isValidElement<Record<string, unknown>>(node)) return acc;
  acc.push(node as Element);
  for (const value of Object.values(node.props)) if (Array.isArray(value) || isValidElement(value)) elements(value, acc);
  return acc;
}

/** The register's «Șterge» forms as the server draws them, by layout: each one's question, hidden fields and button. */
function removeForms(tree: unknown, layout: "table" | "lines") {
  return elements(tree)
    .filter((element) => element.props["data-testid"] === `sponsor-register-remove-form-${layout}`)
    .map((form) => {
      const within = elements(form.props.children);
      return {
        action: form.props.action,
        confirm: form.props.confirm as ConfirmSpec,
        hidden: Object.fromEntries(within.filter((element) => element.type === "input" && element.props.type === "hidden").map((input) => [String(input.props.name), String(input.props.value)])),
        button: within.find((element) => element.props.icon === "delete")?.props ?? {},
      };
    });
}

/** The action pressed with a form's hidden fields; answers the address it sends the browser to. */
async function press(hidden: Record<string, string>): Promise<string> {
  const form = new FormData();
  for (const [name, value] of Object.entries(hidden)) form.set(name, value);
  try {
    await deleteSponsorListRecordAction(null, form);
  } catch (error) {
    const message = (error as Error).message;
    if (message.startsWith("REDIRECT ")) return message.slice("REDIRECT ".length);
    throw error;
  }
  throw new Error("expected a redirect");
}

describe("§948 BR-REQ-071-01 «Șterge» deletes a list's own record from the sponsors' register, for real", () => {
  it("the row goes from the register on both doors and from «Dată partenerilor» of each registration it held; the other lists stay", async () => {
    const { race, ovidiu } = await threeLists();
    expect(await recipientsOf(race)).toEqual(["Ovidiu", "Diana", "nistor"]);
    expect(await sharesOf(BEN)).toEqual(["Ovidiu", "Diana"]);

    expect(await deleteSponsorListRecord(db, admin, ovidiu, NOW)).toEqual({ eventId: race });

    expect(await recipientsOf(race)).toEqual(["Diana", "nistor"]);
    // «Newsletter», the door of every list.
    expect(await recipientsOf()).toEqual(["Diana", "nistor"]);
    // The registrations' own pages: the list made by mistake was given to nobody.
    expect(await sharesOf(ANA)).toEqual(["Diana", "nistor"]);
    expect(await sharesOf(BEN)).toEqual(["Diana"]);
    // The row itself is gone, not hidden.
    expect(await db.select({ id: auditLogs.id }).from(auditLogs).where(eq(auditLogs.id, ovidiu))).toEqual([]);
    expect(await trailOf("registrations.sponsor_list_exported")).toHaveLength(2);
  });

  it("leaves one row about the same event — who deleted, the list's moment, count and file — never the recipient or a registration", async () => {
    const { race, ovidiu } = await threeLists();
    await deleteSponsorListRecord(db, admin, ovidiu, NOW);

    const [left, ...more] = await trailOf("registrations.sponsor_list_record_deleted");
    expect(more).toEqual([]);
    expect(left).toMatchObject({ actorStaffUserId: admin.id, participantId: null, entityType: "event", entityId: race, createdAt: NOW });
    expect(left.metadataJson).toEqual({ listedAt: OVIDIU_AT.toISOString(), count: 2, format: "xlsx" });
    const kept = JSON.stringify(left);
    for (const gone of ["Ovidiu", ANA, BEN, "registrationIds", "recipient"]) expect(kept).not.toContain(gone);
  });

  it("a list made for every event is deleted the same, and its row names no event", async () => {
    await createEvent("Crosul aniversar");
    const every = await given(OVIDIU_AT, null, "Decathlon", [ANA], "csv");
    expect(await deleteSponsorListRecord(db, admin, every, NOW)).toEqual({ eventId: null });
    expect(await recipientsOf()).toEqual([]);
    const [left] = await trailOf("registrations.sponsor_list_record_deleted");
    expect(left.entityId).toBeNull();
    expect(left.metadataJson).toEqual({ listedAt: OVIDIU_AT.toISOString(), count: 1, format: "csv" });
  });

  it("a row from before the recipient was asked for, with no recipient and no file named, is deleted as a CSV of its count", async () => {
    const race = await createEvent("Crosul aniversar");
    const [old] = await db
      .insert(auditLogs)
      .values({ actorStaffUserId: null, action: "registrations.sponsor_list_exported", entityType: "event", entityId: race, metadataJson: { eventId: race, count: 7, registrationIds: [ANA] }, createdAt: CLUB_AT })
      .returning({ id: auditLogs.id });
    await deleteSponsorListRecord(db, admin, old.id, NOW);
    expect((await trailOf("registrations.sponsor_list_record_deleted"))[0].metadataJson).toEqual({ listedAt: CLUB_AT.toISOString(), count: 7, format: "csv" });
  });

  it("deletes only a list's row: the id of any other row of the trail finds nothing, and that row stays", async () => {
    const { race, ovidiu } = await threeLists();
    const [other] = await db
      .insert(auditLogs)
      .values({ actorStaffUserId: admin.id, action: "event.invitation_deleted", entityType: "event", entityId: race, metadataJson: { invitationId: ANA, ended: "withdrawn" }, createdAt: NOW })
      .returning({ id: auditLogs.id });
    // The export's action on something that is not an event: not a list of the register either.
    const [stray] = await db
      .insert(auditLogs)
      .values({ actorStaffUserId: admin.id, action: "registrations.sponsor_list_exported", entityType: "registration", entityId: ANA, metadataJson: {}, createdAt: NOW })
      .returning({ id: auditLogs.id });

    for (const id of [other.id, stray.id]) expect((await failureOf(deleteSponsorListRecord(db, admin, id, NOW))).code).toBe("NOT_FOUND");
    expect((await db.select({ id: auditLogs.id }).from(auditLogs)).map((row) => row.id)).toEqual(expect.arrayContaining([other.id, stray.id, ovidiu]));
    expect(await trailOf("registrations.sponsor_list_record_deleted")).toEqual([]);
  });

  it("a second press, an id that names nothing and a malformed one find no list and write nothing", async () => {
    const { ovidiu } = await threeLists();
    await deleteSponsorListRecord(db, admin, ovidiu, NOW);
    for (const id of [ovidiu, "33333333-3333-4333-8333-333333333333", "not-an-id", ""]) {
      expect((await failureOf(deleteSponsorListRecord(db, admin, id, NOW))).code).toBe("NOT_FOUND");
    }
    expect(await trailOf("registrations.sponsor_list_record_deleted")).toHaveLength(1);
  });

  it.each(STAFF_ROLES.filter((role) => !canManageRegistrations(role)).map((role) => [role] as const))(
    "BR-REQ-060-01 refuses the %s role in the service: nothing is deleted and nothing written",
    async (role) => {
      const { race, ovidiu } = await threeLists();
      const colleague = await staff(role);
      expect((await failureOf(deleteSponsorListRecord(db, colleague, ovidiu, NOW))).code).toBe("FORBIDDEN");
      expect(await recipientsOf(race)).toEqual(["Ovidiu", "Diana", "nistor"]);
      expect(await trailOf("registrations.sponsor_list_record_deleted")).toEqual([]);
    },
  );

  it.each([["ADMIN"], ["SUPERADMIN"]] as const)("BR-REQ-060-01 serves the %s role", async (role) => {
    const { race, ovidiu } = await threeLists();
    await deleteSponsorListRecord(db, await staff(role), ovidiu, NOW);
    expect(await recipientsOf(race)).toEqual(["Diana", "nistor"]);
  });

  it("the Organizer may take the list and read the register, and still may not delete from it", () => {
    // The two rules are different on purpose: a record of a list is not the taker's to remove.
    expect(STAFF_ROLES.filter((role) => canManageRegistrations(role))).toEqual(expect.arrayContaining(["ADMIN", "SUPERADMIN"]));
    expect(canManageRegistrations("MODERATOR")).toBe(false);
  });
});

describe("§948 the register offers «Șterge» beside each list, to the Administrator alone, and asks first", () => {
  async function drawn(removal?: Parameters<typeof SponsorListRegister>[0]["removal"], saved = false) {
    const { race } = await threeLists();
    const { lists } = await readSponsorRegister(db, admin, { eventId: race, locale: state.locale });
    return { race, lists, tree: await SponsorListRegister({ locale: state.locale, lists, now: NOW, level: 3, removal, saved }) };
  }

  it("draws one form per list in the table and one under the phone's lines, each with the list's id, the door and the event", async () => {
    const action = vi.fn();
    const { lists, tree } = await drawn({ action, door: "registrations" });
    for (const layout of ["table", "lines"] as const) {
      const forms = removeForms(tree, layout);
      expect(forms.map((form) => form.hidden.listId)).toEqual(lists.map((list) => list.id));
      for (const form of forms) {
        expect(form.action).toBe(action);
        expect(form.hidden).toMatchObject({ uiLocale: "ro", door: "registrations" });
        expect(form.hidden).not.toHaveProperty("eventId");
        expect(form.button).toMatchObject({ icon: "delete", label: "Șterge", pendingLabel: "Se șterge…", color: "error" });
      }
    }
  });

  it("carries the page's event on an event's door, and none on «Newsletter»", async () => {
    const race = await createEvent("Crosul aniversar");
    await given(OVIDIU_AT, race, "Ovidiu", [ANA]);
    const { lists } = await readSponsorRegister(db, admin, { eventId: race, locale: "ro" });
    const onEvent = removeForms(await SponsorListRegister({ locale: "ro", lists, now: NOW, level: 3, removal: { action: vi.fn(), door: "registrations", eventId: race } }), "table");
    expect(onEvent[0].hidden).toEqual({ uiLocale: "ro", listId: lists[0].id, door: "registrations", eventId: race });
    const onNewsletter = removeForms(await SponsorListRegister({ locale: "ro", lists, now: NOW, level: 3, removal: { action: vi.fn(), door: "newsletter" } }), "table");
    expect(onNewsletter[0].hidden).toEqual({ uiLocale: "ro", listId: lists[0].id, door: "newsletter" });
  });

  it("asks first, naming the list by its recipient and day, saying what goes with it, that nobody is emailed and when the press is right", async () => {
    const { tree } = await drawn({ action: vi.fn(), door: "newsletter" });
    const [first] = removeForms(tree, "table");
    expect(first.confirm).toMatchObject({
      title: "Ștergi lista din registru?",
      destructive: true,
      confirmLabel: "Șterge",
      email: "Nu pleacă niciun email către Ovidiu.",
    });
    expect(first.confirm.body).toContain("„Ovidiu”");
    expect(first.confirm.body).toContain("14 nov.");
    expect(first.confirm.body).toContain("«Dată partenerilor»");
    expect(first.confirm.body).toContain("Nu se poate reveni.");
    expect(first.confirm.also?.map((line) => line.text)).toEqual([
      "Șterge doar o listă făcută din greșeală, care n-a ajuns la nimeni. Pentru una dată cuiva, registrul e răspunsul la „cui mi-ați dat datele?”.",
    ]);
    // The button says which list to whoever cannot see the row.
    expect(String(first.button.ariaLabel)).toContain("Ovidiu");
    expect(String(first.button.ariaLabel)).toContain("14 nov.");
  });

  it("names a list written with no recipient by the register's own words for it, and speaks English on the English page", async () => {
    const race = await createEvent("Crosul aniversar");
    await given(CLUB_AT, race, undefined, [ANA], "csv");
    state.locale = "en";
    const { lists } = await readSponsorRegister(db, admin, { eventId: race, locale: "en" });
    const [form] = removeForms(await SponsorListRegister({ locale: "en", lists, now: NOW, level: 3, removal: { action: vi.fn(), door: "newsletter" } }), "table");
    expect(form.confirm.title).toBe("Delete the list from the register?");
    expect(form.confirm.body).toContain(en.Admin.registrations.partnerShares.noRecipient);
    expect(form.confirm.body).toContain("«Given to partners»");
    expect(form.confirm.also?.[0]?.text).toContain("made by mistake");
    expect(form.button).toMatchObject({ label: "Delete", pendingLabel: "Deleting…" });
  });

  it("draws no press, no empty column and no question without the removal — the register as the Organizer reads it", async () => {
    const { tree } = await drawn();
    expect(removeForms(tree, "table")).toEqual([]);
    expect(removeForms(tree, "lines")).toEqual([]);
    expect(elements(tree).filter((element) => element.props["data-column"] === "remove")).toEqual([]);
  });

  it("is a fold with its own anchor, closed on arrival and open when the page comes back from a delete", async () => {
    const closed = (await drawn()).tree as unknown as Element;
    expect(closed.props).toMatchObject({ id: SPONSOR_REGISTER_ANCHOR, collapsible: true, openWhen: { saved: false } });
    await resetTables(db);
    admin = await staff("ADMIN");
    const open = (await drawn(undefined, true)).tree as unknown as Element;
    expect(open.props.openWhen).toEqual({ saved: true });
  });
});

describe("§948 BR-REQ-060-01 the two pages hand the register its «Șterge» only for a role that may delete", () => {
  const blockOf = (tree: unknown) => elements(tree).find((element) => element.type === SponsorListButton)?.props as unknown as Parameters<typeof SponsorListButton>[0] | undefined;

  it.each([["ADMIN"], ["SUPERADMIN"]] as const)("an event's registrations page hands the %s the press, on that event's door", async (role) => {
    const { race } = await threeLists();
    state.actor = await staff(role);
    const tree = await AdminRegistrationsPage({ params: Promise.resolve({ locale: "ro" }), searchParams: Promise.resolve({ eventId: race }) } as never);
    const block = blockOf(tree);
    expect(block?.registerRemoval).toEqual({ action: deleteSponsorListRecordAction, door: "registrations", eventId: race });
    expect(block?.registerSaved).toBe(false);
  });

  it("…and the Organizer the register alone, read-only", async () => {
    const { race } = await threeLists();
    state.actor = await staff("MODERATOR");
    const block = blockOf(await AdminRegistrationsPage({ params: Promise.resolve({ locale: "ro" }), searchParams: Promise.resolve({ eventId: race }) } as never));
    expect(block?.register.lists).toHaveLength(3);
    expect(block?.registerRemoval).toBeUndefined();
  });

  it("back from a delete, the fold «Lista pentru sponsori» and the register inside it open on what is left", async () => {
    const { race } = await threeLists();
    const tree = await AdminRegistrationsPage({ params: Promise.resolve({ locale: "ro" }), searchParams: Promise.resolve({ eventId: race, saved: "sponsorListDeleted" }) } as never);
    const fold = elements(tree).find((element) => element.props["data-testid"] === "registrations-sponsors");
    expect(fold?.props.openWhen).toEqual({ saved: true });
    expect(blockOf(tree)?.registerSaved).toBe(true);
    // Any other outcome leaves both closed.
    const other = await AdminRegistrationsPage({ params: Promise.resolve({ locale: "ro" }), searchParams: Promise.resolve({ eventId: race, saved: "ambassadorMarked" }) } as never);
    expect(elements(other).find((element) => element.props["data-testid"] === "registrations-sponsors")?.props.openWhen).toEqual({ saved: false });
  });

  it("«Newsletter» hands the Administrator the press on the door of every list, and the Organizer none", async () => {
    await threeLists();
    const promoOf = async (search: Record<string, string>) =>
      elements(await NewsletterPage({ params: Promise.resolve({ locale: "ro" }), searchParams: Promise.resolve(search) } as never)).find((element) => element.type === PromoConsenters)?.props as unknown as
        | Parameters<typeof PromoConsenters>[0]
        | undefined;

    const forAdmin = await promoOf({});
    expect(forAdmin?.sponsorRemoval).toEqual({ action: deleteSponsorListRecordAction, door: "newsletter" });
    expect(forAdmin?.sponsorSaved).toBe(false);
    expect((await promoOf({ saved: "sponsorListDeleted" }))?.sponsorSaved).toBe(true);

    state.actor = await staff("MODERATOR");
    const forOrganizer = await promoOf({});
    expect(forOrganizer?.sponsorRegister?.lists).toHaveLength(3);
    expect(forOrganizer?.sponsorRemoval).toBeUndefined();
  });
});

describe("§948 the press itself: «Șterge» posted from the register", () => {
  it("deletes the list and comes back to the register on the event's registrations page, saying so", async () => {
    const { race, ovidiu } = await threeLists();
    const to = await press({ uiLocale: "ro", listId: ovidiu, door: "registrations", eventId: race });
    expect(to).toBe(`/ro/admin/registrations?saved=sponsorListDeleted&eventId=${race}#${SPONSOR_REGISTER_ANCHOR}`);
    expect(await recipientsOf(race)).toEqual(["Diana", "nistor"]);
    expect(ro.Feedback.toast.sponsorListDeleted).toBe("Lista a fost ștearsă din registru.");
    expect(en.Feedback.toast.sponsorListDeleted).toBe("The list was deleted from the register.");
  });

  it("comes back to «Newsletter» from that door", async () => {
    const { ovidiu } = await threeLists();
    expect(await press({ uiLocale: "ro", listId: ovidiu, door: "newsletter" })).toBe(`/ro/admin/newsletter?saved=sponsorListDeleted#${SPONSOR_REGISTER_ANCHOR}`);
    expect(await recipientsOf()).toEqual(["Diana", "nistor"]);
  });

  it("never follows a path the form carries: an event id that is not one is dropped, and an unknown door is the registrations page", async () => {
    const { ovidiu } = await threeLists();
    const to = await press({ uiLocale: "ro", listId: ovidiu, door: "https://example.invalid/", eventId: "../../somewhere" });
    expect(to).toBe(`/ro/admin/registrations?saved=sponsorListDeleted#${SPONSOR_REGISTER_ANCHOR}`);
  });

  it("BR-REQ-060-01 refuses the Organizer at the action's door, in words, and deletes nothing", async () => {
    const { race, ovidiu } = await threeLists();
    state.actor = await staff("MODERATOR");
    const to = await press({ uiLocale: "ro", listId: ovidiu, door: "registrations", eventId: race });
    expect(to).toContain("error=FORBIDDEN");
    expect(await recipientsOf(race)).toEqual(["Ovidiu", "Diana", "nistor"]);
    expect(ro.Admin.errors.FORBIDDEN.length).toBeGreaterThan(0);
  });

  it("says a list that is no longer there — a second press, a colleague first — and writes nothing more", async () => {
    const { race, ovidiu } = await threeLists();
    await press({ uiLocale: "ro", listId: ovidiu, door: "registrations", eventId: race });
    expect(await press({ uiLocale: "ro", listId: ovidiu, door: "registrations", eventId: race })).toContain("error=NOT_FOUND");
    expect(await trailOf("registrations.sponsor_list_record_deleted")).toHaveLength(1);
  });
});
