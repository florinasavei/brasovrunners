import { isValidElement, type ReactElement, type ReactNode } from "react";
import { createTranslator } from "next-intl";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { declarationAcceptances } from "@/db/schema/declaration-acceptances";
import { emailOutbox } from "@/db/schema/email-outbox";
import { events, eventTranslations } from "@/db/schema/events";
import { participants } from "@/db/schema/participants";
import { registrations } from "@/db/schema/registrations";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { resolveDisplayName } from "@/modules/registrations/names";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * §640 — «Pune tooltip și info in back-office pt asta» (the owner, 2026-10-02, of «Confirmă pe
 * hârtie»): the registration's «Ziua cursei» box and the desk say what the paper confirmation is for,
 * what it does and what the person receives, in both languages.
 *
 * - the registration's page: an «i» beside the box's title and a caption under the button, only on a
 *   registration the button is for (not on a confirmed one);
 * - the desk: ONE «i», beside the line that says what the row buttons do — never one per row;
 * - the registrations list: «Confirmă pe hârtie» in the row menu carries the same four lines as its tooltip;
 * - the four lines the «i» says are the catalogue's, in order, and the caption's three sentences too.
 *
 * Both pages are Server Components: each is called, its element tree walked, and the async tip is
 * rendered with the real translator over the real catalogues.
 */
const state = vi.hoisted(() => ({ db: undefined as unknown, actor: undefined as unknown, locale: "ro" as "ro" | "en" }));

vi.mock("next-intl/server", () => ({
  getTranslations: async (namespace: string) => {
    const catalogue = (state.locale === "ro" ? ro : en) as unknown as Record<string, Record<string, unknown>>;
    return createTranslator({ locale: state.locale, messages: catalogue[namespace] as never });
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
vi.mock("@/i18n/navigation", () => ({ getPathname: () => "/ro/admin/registrations", Link: () => null }));
vi.mock("@/modules/staff-identity/session", () => ({
  DEV_STAFF_COOKIE: "dev-staff",
  requireStaff: async () => state.actor,
  requireStaffCapability: async () => state.actor,
}));
vi.mock("@/app/[locale]/admin/registrations/actions", () => ({
  setOutsideCapacityAction: vi.fn(),
  resendRegistrationEmailAction: vi.fn(),
  givePlaceNowAction: vi.fn(),
  bulkCancelRegistrationsAction: vi.fn(),
  bulkDeleteRegistrationsAction: vi.fn(),
  markBibsPrintedAction: vi.fn(),
  sendOutboxNowAction: vi.fn(),
  cancelRegistrationAction: vi.fn(),
  checkInAction: vi.fn(),
  confirmRegistrationNowAction: vi.fn(),
  correctRegisteredNameAction: vi.fn(),
  deleteRegistrationAction: vi.fn(),
  offerPlaceAction: vi.fn(),
  promoteRegistrationAction: vi.fn(),
  setBibNumberAction: vi.fn(),
  withdrawConsentAction: vi.fn(),
  declarationHoldAction: vi.fn(),
  undoCheckInAction: vi.fn(),
  cancelRegistrationFromRowAction: vi.fn(),
  eraseRegistrationFromListAction: vi.fn(),
  setBibPrintedAction: vi.fn(),
}));
vi.mock("@/app/[locale]/admin/registrations/[id]/actions", () => ({
  resendFamilyEmailAction: vi.fn(),
  resendRegistrationEmailAction: vi.fn(),
}));
vi.mock("@/modules/notifications/send-now-choice", () => ({ sendNowChoiceFor: async () => null }));

const { confirmRegistrationByStaff } = await import("@/modules/registrations/admin-service");
const { default: RegistrationDetailPage } = await import("@/app/[locale]/admin/registrations/[id]/page");
const { default: AdminRegistrationsPage } = await import("@/app/[locale]/admin/registrations/(list)/page");
const { default: RegistrationRowMenu } = await import("@/modules/registrations/ui/RegistrationRowMenu");
const { default: DeskPage } = await import("@/app/[locale]/admin/checkin/page");
const { default: PaperConfirmationTip } = await import("@/modules/registrations/ui/PaperConfirmationTip");
const { default: HiddenListRadio } = await import("@/modules/registrations/ui/HiddenListRadio");

type Props = Record<string, unknown> & { children?: ReactNode };

/** Every element under `node`, depth first. */
function elements(node: ReactNode, acc: ReactElement<Props>[] = []): ReactElement<Props>[] {
  if (Array.isArray(node)) {
    for (const child of node) elements(child as ReactNode, acc);
    return acc;
  }
  if (!isValidElement<Props>(node)) return acc;
  acc.push(node);
  elements(node.props.children, acc);
  return acc;
}

/** Every string child under `node`: the sentences a page writes as text. */
function sentences(node: ReactNode, acc: string[] = []): string[] {
  if (typeof node === "string") acc.push(node);
  else if (Array.isArray(node)) for (const child of node) sentences(child as ReactNode, acc);
  else if (isValidElement<Props>(node)) sentences(node.props.children, acc);
  return acc;
}

/** The markup's attribute text, entities back. */
function decoded(html: string): string {
  return html.replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/&quot;/g, '"');
}

const catalogues = { ro, en } as const;
const KEYS = ["paperWhen", "paperPlace", "paperEmail", "paperNot"] as const;
const desk = (locale: "ro" | "en", key: string) => (catalogues[locale].Admin.desk as unknown as Record<string, string>)[key];

let db: TestDatabase;
let close: () => Promise<void>;

async function createRace(capacity = 150) {
  const [event] = await db
    .insert(events)
    .values({
      type: "RACE",
      surface: "ASPHALT",
      startsAt: new Date("2099-11-21T08:00:00.000Z"),
      timezone: "Europe/Bucharest",
      capacity,
      registrationMode: "INTERNAL",
      editorialStatus: "PUBLISHED",
      publishedAt: new Date("2026-09-01T10:00:00.000Z"),
      featured: true,
    })
    .returning();
  await db.insert(eventTranslations).values([
    { eventId: event.id, locale: "ro", slug: "crosul-ro", title: "Crosul" },
    { eventId: event.id, locale: "en", slug: "crosul-en", title: "Crosul" },
  ]);
  return event;
}

let serial = 0;
async function register(eventId: string, status: "PENDING_DECLARATION" | "PENDING_EMAIL_CONFIRMATION" | "CONFIRMED") {
  serial += 1;
  const email = `runner${serial}@example.org`;
  const [participant] = await db
    .insert(participants)
    .values({ deliveryEmail: email, normalizedEmail: email, canonicalEmail: email, canonicalizationVersion: 1, defaultName: `Runner ${serial}`, preferredLocale: "ro" })
    .returning();
  const [created] = await db
    .insert(registrations)
    .values({
      eventId,
      participantId: participant.id,
      kind: "REAL",
      locale: "ro",
      registeredName: `Runner ${serial}`,
      displayName: resolveDisplayName({ legalName: `Runner ${serial}` }),
      privacyNoticeVersion: 1,
      privacyAcknowledgedAt: new Date(),
      resultsNameConsent: false,
      resultsConsentVersion: 1,
      status,
      ...(status === "PENDING_DECLARATION" ? { holdExpiresAt: new Date("2099-11-19T08:00:00.000Z") } : {}),
      ...(status === "PENDING_EMAIL_CONFIRMATION" ? { emailLinkExpiresAt: new Date(Date.now() + 2 * 24 * 60 * 60_000) } : {}),
    })
    .returning({ id: registrations.id });
  return created.id;
}

async function staff(role: "ADMIN" | "CONTRIBUTOR" | "MODERATOR"): Promise<StaffUser> {
  const [user] = await db.insert(staffUsers).values({ email: `${role.toLowerCase()}@dev.test`, displayName: role, role }).returning();
  return user;
}

async function detailPage(id: string) {
  return RegistrationDetailPage({ params: Promise.resolve({ locale: state.locale, id }), searchParams: Promise.resolve({}) } as never);
}

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
  state.db = db;
});
afterAll(async () => close());
beforeEach(async () => {
  await resetTables(db);
  state.locale = "ro";
});

describe("§640 the tip's four lines", () => {
  for (const locale of ["ro", "en"] as const) {
    it(`${locale}: when, the place, the email, what it is not — in that order, from the catalogue`, async () => {
      state.locale = locale;
      const markup = decoded(renderToStaticMarkup(await PaperConfirmationTip()));
      const positions = KEYS.map((key) => markup.indexOf(desk(locale, key)));
      expect(positions.every((position) => position >= 0), markup).toBe(true);
      expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    });
  }
});

describe("§640 the lines are true of every row the press is offered on", () => {
  // What the press queues on the waiting list is nothing: the allocator sends no email, and the declaration stays unrecorded.
  const waitingPhrase = {
    ro: { email: "niciun email acum", dialog: "fără email acum", guide: "nu primește niciun email acum și oferta vine pe email dacă i se oferă loc" },
    en: { email: "no email now", dialog: "no email yet", guide: "get no email now, and the offer comes by email if they are offered a place" },
  } as const;
  for (const locale of ["ro", "en"] as const) {
    it(`${locale}: the lines say the waiting list gets no email now and the offer if offered a place; none promises a waiting-list email or a confirmation unconditionally`, () => {
      const email = desk(locale, "paperEmail");
      const phrase = waitingPhrase[locale];
      // A row waiting for its address gets it recorded on the staff member's name before the allocator may waitlist it.
      expect(email, "the address's condition is kept: only an unconfirmed address is recorded on the staff member's name").toMatch(locale === "ro" ? /neconfirmat/i : /unconfirmed/i);
      expect(email, "never «either way»").not.toMatch(/oricum|either way/);
      expect(email, "the offer comes if the person is offered a place, not whenever one frees").toMatch(locale === "ro" ? /dacă i se oferă loc/ : /if offered a place/);
      expect(email, "never «a place frees»").not.toMatch(/un loc liber|a place frees/);
      expect(email, "the waiting list is named, with no email").toContain(phrase.email);
      expect(email.toLowerCase(), "never «nothing is recorded»").not.toMatch(/nu se înregistrează nimic|nothing is recorded/);
      expect(email, "never its own email").not.toMatch(/emailul ei|its own email/);
      expect(email.length).toBeLessThan(200);
      const dialog = catalogues[locale].Admin.registrations as unknown as Record<string, string>;
      for (const key of ["confirmOnPaperBody", "confirmOnPaperBodyMinor"]) {
        expect(dialog[key].length, `${key} length`).toBeLessThan(200);
        expect(dialog[key], key).toContain(phrase.dialog);
        expect(dialog[key], key).not.toMatch(/sau al listei de așteptare|or the waiting list's/);
      }
      const guide = JSON.stringify(catalogues[locale]);
      expect(guide, "the guide says nothing is sent on the waiting list").toContain(phrase.guide);
      expect(guide, "the guide never promises a waiting-list email").not.toMatch(/sau pe cel de pe lista de așteptare|or the waiting-list one/);
    });
  }

  // The words above are checked against the code: a registration waiting for its address, on a full event,
  // goes through the allocator to the waiting list and queues nothing.
  it("on a full event the press on a registration waiting for its address lands on the waiting list, queues no email, records the address on the staff member and no declaration", async () => {
    const race = await createRace(1);
    await register(race.id, "CONFIRMED");
    const waiting = await register(race.id, "PENDING_EMAIL_CONFIRMATION");
    const admin = await staff("ADMIN");
    const before = await db.select().from(emailOutbox);

    const result = await confirmRegistrationByStaff(db, admin, waiting, new Date());

    expect(result.status).toBe("WAITLISTED");
    const after = await db.select().from(emailOutbox);
    expect(after.length, "the press queued no email").toBe(before.length);
    const row = (await db.select().from(registrations).where(eq(registrations.id, waiting)))[0];
    expect(row.emailConfirmedByStaffUserId, "the address is on the staff member's name").toBe(admin.id);
    expect(row.emailConfirmedAt).not.toBeNull();
    const acceptances = await db.select().from(declarationAcceptances).where(eq(declarationAcceptances.registrationId, waiting));
    expect(acceptances, "no declaration is recorded").toHaveLength(0);
  });
});

describe("§640 the registration's «Ziua cursei» box", () => {
  for (const locale of ["ro", "en"] as const) {
    it(`${locale}: the «i» beside the title and the caption under the button, on a registration the button is for`, async () => {
      state.locale = locale;
      const race = await createRace();
      state.actor = await staff("ADMIN");
      for (const status of ["PENDING_DECLARATION", "PENDING_EMAIL_CONFIRMATION"] as const) {
        const tree = await detailPage(await register(race.id, status));
        expect(elements(tree).filter((element) => element.type === PaperConfirmationTip), status).toHaveLength(1);
        const written = sentences(tree).join("\n");
        // The caption: when, what the person gets, what it is not.
        for (const key of ["paperWhen", "paperEmail", "paperNot"] as const) expect(written, `${status} ${key}`).toContain(desk(locale, key));
      }
    });
  }

  it("a confirmed registration has no button, so no tip and no caption", async () => {
    const race = await createRace();
    state.actor = await staff("ADMIN");
    const tree = await detailPage(await register(race.id, "CONFIRMED"));
    expect(elements(tree).some((element) => element.type === PaperConfirmationTip)).toBe(false);
    expect(sentences(tree).join("\n")).not.toContain(desk("ro", "paperWhen"));
  });
});

describe("§640 the desk: one «i» for every row", () => {
  for (const locale of ["ro", "en"] as const) {
    it(`${locale}: beside the line that says what the row buttons do, however many rows there are`, async () => {
      state.locale = locale;
      const race = await createRace();
      for (let index = 0; index < 3; index += 1) await register(race.id, "PENDING_DECLARATION");
      // Every staff role works the desk (§289): the volunteer reads it too.
      for (const role of ["ADMIN", "CONTRIBUTOR"] as const) {
        state.actor = await staff(role);
        const tree = await DeskPage({ params: Promise.resolve({ locale }), searchParams: Promise.resolve({ eventId: race.id }) } as never);
        expect(elements(tree).filter((element) => element.type === PaperConfirmationTip), role).toHaveLength(1);
        expect(sentences(tree).join("\n"), role).toContain(desk(locale, "rowHelp"));
        await db.delete(staffUsers);
      }
    });
  }
});

describe("§640 the registrations list's row menu", () => {
  for (const locale of ["ro", "en"] as const) {
    it(`${locale}: «Confirmă pe hârtie» carries the four lines as its tooltip, and the other items none`, async () => {
      state.locale = locale;
      const race = await createRace();
      await register(race.id, "PENDING_DECLARATION");
      state.actor = await staff("ADMIN");
      const tree = await AdminRegistrationsPage({ params: Promise.resolve({ locale }), searchParams: Promise.resolve({ eventId: race.id }) } as never);
      const table = elements(tree).find((element) => typeof element.props.rowActions === "function");
      expect(table).toBeDefined();
      const rows = table!.props.rows as readonly unknown[];
      const actions = table!.props.rowActions as (row: unknown) => ReactNode;
      const menu = elements(actions(rows[0])).find((element) => element.type === RegistrationRowMenu);
      expect(menu).toBeDefined();
      const items = menu!.props.items as readonly { kind: string; icon: string; hint?: string }[];
      const paper = items.find((item) => item.icon === "confirm");
      expect(paper?.hint).toBe(KEYS.map((key) => desk(locale, key)).join("\n"));
      expect(items.filter((item) => item.hint && item !== paper)).toHaveLength(0);
    });
  }
});

/**
 * §NNN — «Lista ascunsă» on the registration's own page: the block is drawn while the event's «Folosește
 * lista ascunsă» is on, or for a row already on the list (then with the line that the switch is off); the
 * Administrator gets the two radios inside the form that posts the hidden `outside` value — the opposite
 * of the stored state — and the Organizer (MODERATOR, §289) the same radios disabled, with no form.
 */
describe("§NNN the registration's «Lista ascunsă» block", () => {
  const section = (tree: ReactNode) => elements(tree).find((element) => element.props["data-testid"] === "outside-capacity");
  const radios = (tree: ReactNode) => elements(section(tree)).filter((element) => element.type === HiddenListRadio);
  const outsideInput = (tree: ReactNode) => elements(section(tree)).find((element) => element.type === "input" && element.props.name === "outside");
  const switchOffLine = (tree: ReactNode) => elements(section(tree)).find((element) => element.props["data-testid"] === "hidden-list-switch-off");

  async function race(switchOn: boolean) {
    const created = await createRace();
    await db.update(events).set({ hiddenListEnabled: switchOn }).where(eq(events.id, created.id));
    return created.id;
  }
  async function row(status: "PENDING_DECLARATION" | "CONFIRMED", input: { switchOn: boolean; onList: boolean; eventId?: string }) {
    const id = await register(input.eventId ?? (await race(input.switchOn)), status);
    if (input.onList) await db.update(registrations).set({ outsideCapacity: true }).where(eq(registrations.id, id));
    return id;
  }

  it("is not drawn when the switch is off and the row is not on the list", async () => {
    state.actor = await staff("ADMIN");
    const tree = await detailPage(await row("CONFIRMED", { switchOn: false, onList: false }));
    expect(section(tree)).toBeUndefined();
  });

  it("is drawn for a row already on the list with the switch off: the radios and the line that the switch is off", async () => {
    state.actor = await staff("ADMIN");
    const tree = await detailPage(await row("CONFIRMED", { switchOn: false, onList: true }));
    expect(section(tree)).toBeDefined();
    expect(radios(tree)).toHaveLength(1);
    expect(radios(tree)[0].props.onList).toBe(true);
    expect(switchOffLine(tree)).toBeDefined();
    expect(sentences(tree).join("\n")).toContain(ro.Admin.registrations.outside.switchOff);
    // Taking somebody off is the only thing that means anything: the form posts `false`.
    expect(outsideInput(tree)?.props.value).toBe("false");
  });

  it("with the switch on, the Administrator's form posts the opposite of the stored state, in every active state", async () => {
    state.actor = await staff("ADMIN");
    const eventId = await race(true);
    for (const status of ["PENDING_DECLARATION", "CONFIRMED"] as const) {
      for (const onList of [false, true]) {
        const tree = await detailPage(await row(status, { switchOn: true, onList, eventId }));
        expect(radios(tree), `${status} ${onList}`).toHaveLength(1);
        expect(radios(tree)[0].props.onList, `${status} ${onList}`).toBe(onList);
        expect(radios(tree)[0].props.disabled ?? false, `${status} ${onList}`).toBe(false);
        expect(outsideInput(tree)?.props.value, `${status} ${onList}`).toBe(onList ? "false" : "true");
        expect(switchOffLine(tree), `${status} ${onList}`).toBeUndefined();
      }
    }
  });

  it("the Organizer reads the radios disabled, with no form and no hidden value", async () => {
    state.actor = await staff("MODERATOR");
    const tree = await detailPage(await row("CONFIRMED", { switchOn: true, onList: true }));
    expect(radios(tree)).toHaveLength(1);
    expect(radios(tree)[0].props.disabled).toBe(true);
    expect(radios(tree)[0].props.onList).toBe(true);
    expect(outsideInput(tree)).toBeUndefined();
  });
});
