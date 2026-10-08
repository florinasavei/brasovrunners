import { isValidElement, type ReactElement, type ReactNode } from "react";
import { createTranslator } from "next-intl";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { events, eventTranslations } from "@/db/schema/events";
import { participants } from "@/db/schema/participants";
import { registrations } from "@/db/schema/registrations";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { auditLogs } from "@/db/schema/audit-logs";
import { emailOutbox } from "@/db/schema/email-outbox";
import { eq } from "drizzle-orm";
import { resolveDisplayName } from "@/modules/registrations/names";
import { CLUB_NAME } from "@/theme/brand";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * BR-REQ-037-03 criteria 12 and 13 (§645) — «Datele înscrierii» and the member tick's screens, read from
 * a real database.
 *
 * - the registration's page folds «Corectează numele» into «Datele înscrierii»: closed behind a plain
 *   link, opened (and the read recorded) with every answer prefilled, each beside its `was.` twin, the
 *   question naming the person and the fields changed; the address, the consents and the declaration
 *   read-only with one line each; the Organizer reads the same answers and gets no form (§289);
 * - the list's row offers «Nu e membru» / «E membru» behind "⋮", with a hidden form that comes back to
 *   the list;
 * - «Bife de membru fără cont de membru» shows with the members' filter on, for the Administrator
 *   only, and opens the preview: one ticked box per candidate, the count, the note; an empty preview
 *   says «Nicio bifă de scos».
 *
 * The pages are Server Components, so they are called and their element trees walked.
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
  bulkCancelRegistrationsAction: vi.fn(),
  bulkDeleteRegistrationsAction: vi.fn(),
  markBibsPrintedAction: vi.fn(),
  sendOutboxNowAction: vi.fn(),
  cancelRegistrationFromRowAction: vi.fn(),
  eraseRegistrationFromListAction: vi.fn(),
  setBibPrintedAction: vi.fn(),
  cancelRegistrationAction: vi.fn(),
  checkInAction: vi.fn(),
  confirmRegistrationNowAction: vi.fn(),
  // «Datele înscrierii» (§645), folding «Corectează numele».
  editRegistrationAnswersAction: vi.fn(),
  deleteRegistrationAction: vi.fn(),
  givePlaceNowAction: vi.fn(),
  offerPlaceAction: vi.fn(),
  promoteRegistrationAction: vi.fn(),
  setBibNumberAction: vi.fn(),
  withdrawConsentAction: vi.fn(),
  setOutsideCapacityAction: vi.fn(),
  declarationHoldAction: vi.fn(),
  // The member tick and its sweep (§645).
  setClubMemberDeclaredAction: vi.fn(),
  clearMemberTicksAction: vi.fn(),
}));
vi.mock("@/app/[locale]/admin/registrations/[id]/actions", () => ({
  resendFamilyEmailAction: vi.fn(),
  resendRegistrationEmailAction: vi.fn(),
}));
vi.mock("@/modules/notifications/send-now-choice", () => ({ sendNowChoiceFor: async () => null }));

const { default: AdminRegistrationsPage } = await import("@/app/[locale]/admin/registrations/(list)/page");
const { default: RegistrationDetailPage } = await import("@/app/[locale]/admin/registrations/[id]/page");
const { default: AdminTable } = await import("@/modules/staff-identity/ui/AdminTable");
const { default: GuardianForMinor } = await import("@/modules/registrations/ui/GuardianForMinor");
const { default: EmailStateLine } = await import("@/modules/registrations/ui/EmailStateLine");
const actions = await import("@/app/[locale]/admin/registrations/actions");

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

const byTestId = (tree: ReactNode, id: string) => elements(tree).filter((element) => element.props["data-testid"] === id);

let db: TestDatabase;
let close: () => Promise<void>;

async function createRace(title: string) {
  const [event] = await db
    .insert(events)
    .values({
      type: "RACE",
      surface: "ASPHALT",
      startsAt: new Date("2099-11-21T08:00:00.000Z"),
      timezone: "Europe/Bucharest",
      capacity: 150,
      registrationMode: "INTERNAL",
      editorialStatus: "PUBLISHED",
      publishedAt: new Date("2026-09-01T10:00:00.000Z"),
      featured: true,
    })
    .returning();
  await db.insert(eventTranslations).values([
    { eventId: event.id, locale: "ro", slug: `${title}-ro`, title },
    { eventId: event.id, locale: "en", slug: `${title}-en`, title },
  ]);
  return event;
}

let serial = 0;
async function register(eventId: string, row: Partial<typeof registrations.$inferInsert> = {}) {
  serial += 1;
  const email = `runner${serial}@example.org`;
  const [participant] = await db
    .insert(participants)
    .values({ deliveryEmail: email, normalizedEmail: email, canonicalEmail: email, canonicalizationVersion: 2, defaultName: `Runner ${serial}`, preferredLocale: "ro" })
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
      status: "CONFIRMED",
      clubMemberDeclared: true,
      clubName: CLUB_NAME,
      ...row,
    })
    .returning({ id: registrations.id });
  return created.id;
}

async function staff(role: "ADMIN" | "MODERATOR", email = `${role.toLowerCase()}@dev.test`): Promise<StaffUser> {
  const [user] = await db.insert(staffUsers).values({ email, displayName: role, role }).returning();
  return user;
}

async function listPage(searchParams: Record<string, string>) {
  return AdminRegistrationsPage({ params: Promise.resolve({ locale: "ro" }), searchParams: Promise.resolve(searchParams) } as never);
}

async function detailPage(id: string, searchParams: Record<string, string> = {}) {
  return RegistrationDetailPage({ params: Promise.resolve({ locale: "ro", id }), searchParams: Promise.resolve(searchParams) } as never);
}

/** What the list's "⋮" holds for each row: the table's own `rowActions`, walked. */
function rowActionsOf(tree: ReactNode): ReactElement<Props>[] {
  const table = elements(tree).find((element) => element.type === AdminTable);
  if (!table) return [];
  const rows = table.props.rows as { id: string }[];
  const render = table.props.rowActions as (row: { id: string }) => ReactNode;
  return rows.flatMap((row) => elements(render(row)));
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

describe("BR-REQ-037-03 criterion 12: «Datele înscrierii» on the registration's page", () => {
  it("is closed behind a plain link, and nothing is read or recorded until it is opened", async () => {
    const race = await createRace("Crosul");
    state.actor = await staff("ADMIN");
    const tree = await detailPage(await register(race.id));
    const [open] = byTestId(tree, "answers-open");
    expect(open.props.href).toBe("/ro/admin/registrations?answers=1#answers");
    expect(open.props.children).toBe("Modifică datele");
    expect(byTestId(tree, "answers-form")).toHaveLength(0);
    expect(await db.select().from(auditLogs).where(eq(auditLogs.action, "registration.answers_viewed"))).toHaveLength(0);
  });

  it("opens with every answer prefilled beside its `was.` twin, asks naming the person and the fields changed, and records the read", async () => {
    const race = await createRace("Crosul");
    const admin = await staff("ADMIN");
    state.actor = admin;
    const id = await register(race.id, { firstName: "Ana", lastName: "Pop", phone: "+40712345678", city: "Brașov" });

    const tree = await detailPage(id, { answers: "1" });
    const [form] = byTestId(tree, "answers-form");
    expect(form.props.action).toBe(actions.editRegistrationAnswersAction);
    const confirm = form.props.confirm as { title: string; body: string; changedFields: { labels: Record<string, string> } };
    expect(confirm.title).toBe("Corectezi datele?");
    // The person by name; `{fields}` is filled in the browser from the boxes that moved.
    expect(confirm.body).toBe(`Corectezi la Runner ${serial}: {fields}. Nimic altceva nu se schimbă, niciun email; valorile vechi rămân în jurnal.`);
    expect(confirm.changedFields.labels).toMatchObject({ firstName: "Prenume", phone: "Telefon", clubMemberDeclared: `Membru ${CLUB_NAME} (declarat)` });
    // Never the address, a consent or the declaration: not on the form at all.
    for (const locked of ["email", "listOptOut", "promoConsent", "healthNotes", "fitnessDeclared", "termsAccepted"]) {
      expect(elements(form).some((element) => element.props.name === locked), locked).toBe(false);
    }

    const twin = (field: string) => elements(form).find((element) => element.props.name === `was.${field}`)?.props.value;
    expect(twin("firstName")).toBe("Ana");
    expect(twin("phone")).toBe("+40712345678");
    expect(twin("clubMemberDeclared")).toBe("on");
    expect(twin("sex")).toBe("");
    // The event gives no T-shirt: its size is not on the form.
    expect(twin("tshirtSize")).toBeUndefined();
    expect(elements(form).find((element) => element.props.name === "city")?.props.defaultValue).toBe("Brașov");

    expect(byTestId(tree, "answers-locked")).toHaveLength(1);
    const [viewed] = await db.select().from(auditLogs).where(eq(auditLogs.action, "registration.answers_viewed"));
    expect(viewed).toMatchObject({ actorStaffUserId: admin.id, entityId: id, metadataJson: {} });
  });

  it("shows the Organizer the same answers read-only, and no form (§289)", async () => {
    const race = await createRace("Crosul");
    state.actor = await staff("MODERATOR");
    const id = await register(race.id, { firstName: "Ana", lastName: "Pop", city: "Brașov" });

    const closed = await detailPage(id);
    expect(byTestId(closed, "answers-open")[0].props.children).toBe("Arată datele");

    const tree = await detailPage(id, { answers: "1" });
    expect(byTestId(tree, "answers-form")).toHaveLength(0);
    const [read] = byTestId(tree, "answers-read");
    const lines = elements(read).filter((element) => element.type !== read.type).map((element) => (element.props.children as ReactNode[]).join(""));
    expect(lines).toContain("Orașul: Brașov");
    expect(lines).toContain(`Membru ${CLUB_NAME} (declarat): Da`);
    expect(byTestId(tree, "answers-locked")).toHaveLength(1);
    // The chip still says what the person declared.
    expect(elements(tree).some((element) => element.props.label === "Membru (declarat)")).toBe(true);
  });

  it("shows the guardian's box only for a minor's row, or once the birth-date box makes it one on the day the row was written (§108)", async () => {
    const race = await createRace("Crosul");
    state.actor = await staff("ADMIN");
    const guardianBox = async (id: string) => {
      const [form] = byTestId(await detailPage(id, { answers: "1" }), "answers-form");
      const [block] = elements(form).filter((element) => element.type === GuardianForMinor);
      expect(elements(block.props.children).some((element) => element.props.name === "guardianName")).toBe(true);
      return block.props as { birthDateId: string; forceOpen: boolean; minorOn: string };
    };

    // An adult's row: closed, opened in the browser by the date typed into the birth-date box.
    const adult = await register(race.id, { birthDate: "1990-05-01" });
    const [written] = await db.select({ createdAt: registrations.createdAt }).from(registrations).where(eq(registrations.id, adult));
    expect(await guardianBox(adult)).toMatchObject({ birthDateId: "field-answers-birthDate", forceOpen: false, minorOn: written.createdAt.toISOString() });
    // A minor's row: open, the guardian in view.
    const minor = await register(race.id, { birthDate: "2012-03-01", guardianName: "Maria Pop", clubMemberDeclared: false, clubName: null });
    expect((await guardianBox(minor)).forceOpen).toBe(true);
  });

  it("asks the day the answers were written, not the row's creation: a minor's row restarted as an adult stays closed (§654)", async () => {
    const race = await createRace("Crosul");
    state.actor = await staff("ADMIN");
    const guardianBox = async (id: string) => {
      const [form] = byTestId(await detailPage(id, { answers: "1" }), "answers-form");
      const [block] = elements(form).filter((element) => element.type === GuardianForMinor);
      return block.props as { forceOpen: boolean; minorOn: string };
    };
    // Eighteen on 2026-03-01: created at seventeen, its answers written again after the birthday — no guardian kept.
    const createdAt = new Date("2026-01-10T10:00:00.000Z");
    const restartedAt = new Date("2026-06-01T10:00:00.000Z");
    const restarted = await register(race.id, { birthDate: "2008-03-01", createdAt, answersWrittenAt: restartedAt });
    expect(await guardianBox(restarted)).toEqual(expect.objectContaining({ forceOpen: false, minorOn: restartedAt.toISOString() }));
    // The mirror: created and written again while still seventeen — open, the guardian owed.
    const writtenAsMinor = new Date("2026-02-01T10:00:00.000Z");
    const minor = await register(race.id, { birthDate: "2008-03-01", createdAt, answersWrittenAt: writtenAsMinor });
    expect(await guardianBox(minor)).toEqual(expect.objectContaining({ forceOpen: true, minorOn: writtenAsMinor.toISOString() }));
  });
});

describe("BR-REQ-037-03 criterion 13: the registrations list", () => {
  it("puts the verb behind each row's ⋮ for the Administrator, coming back to the list, and nowhere for the Organizer", async () => {
    const race = await createRace("Crosul");
    const id = await register(race.id);

    state.actor = await staff("ADMIN");
    const forms = rowActionsOf(await listPage({ eventId: race.id })).filter((element) => element.props.id === `member-${id}`);
    expect(forms).toHaveLength(1);
    expect(forms[0].props.action).toBe(actions.setClubMemberDeclaredAction);
    expect(elements(forms[0]).some((element) => element.props.name === "listQuery")).toBe(true);

    state.actor = await staff("MODERATOR");
    expect(rowActionsOf(await listPage({ eventId: race.id })).filter((element) => element.props.id === `member-${id}`)).toHaveLength(0);
  });

  it("offers «Bife de membru fără cont de membru» only with the members' filter on, and only to the Administrator", async () => {
    const race = await createRace("Crosul");
    await register(race.id);
    state.actor = await staff("ADMIN");
    const label = "Bife de membru fără cont de membru";
    const hasButton = (tree: ReactNode) => elements(tree).some((element) => element.props.icon === "memberCheck" && element.props.children === label);

    expect(hasButton(await listPage({ eventId: race.id }))).toBe(false);
    expect(hasButton(await listPage({ eventId: race.id, clubMember: "1" }))).toBe(true);
    // A summary pill keeps the filter's key (§626), so the button stays with a state chosen too.
    expect(hasButton(await listPage({ eventId: race.id, clubMember: "1", status: "CONFIRMED" }))).toBe(true);

    state.actor = await staff("MODERATOR");
    expect(hasButton(await listPage({ eventId: race.id, clubMember: "1" }))).toBe(false);
    expect(byTestId(await listPage({ eventId: race.id, clubMember: "1", memberSweep: "1" }), "member-sweep")).toHaveLength(0);
  });

  it("opens the preview: one ticked box per candidate, the count, the event's scope — members and unticked rows left out", async () => {
    const race = await createRace("Crosul");
    const stranger = await register(race.id);
    const another = await register(race.id);
    await register(race.id, { clubMemberDeclared: false, clubName: null });
    const memberRow = await register(race.id);
    // That row's address is a member's account (the participant's canonical address, `runnerN@example.org`).
    await db.insert(staffUsers).values({ email: `runner${serial}@example.org`, displayName: "Member", role: "MEMBER" });
    state.actor = await staff("ADMIN");

    const tree = await listPage({ eventId: race.id, clubMember: "1", memberSweep: "1" });
    const [form] = byTestId(tree, "member-sweep-form");
    expect(form.props.action).toBe(actions.clearMemberTicksAction);
    const boxes = elements(form).filter((element) => element.props.name === "registrationId");
    expect(boxes.map((box) => box.props.value).sort()).toEqual([stranger, another].sort());
    expect(boxes.every((box) => box.props.defaultChecked === true)).toBe(true);
    // Each row's box says what its tick means: unticked is «Lasă bifa».
    expect(boxes.every((box) => box.props.help === "Bifat = se scoate bifa · debifat = Lasă bifa")).toBe(true);
    expect(boxes.map((box) => box.props.value)).not.toContain(memberRow);
    expect(elements(form).find((element) => element.props.name === "eventId")?.props.value).toBe(race.id);
    expect(byTestId(form, "member-sweep-count")[0].props.children).toBe("2 înscrieri cu bifa de membru fără cont de membru");
    expect(form.props.confirm).toMatchObject({ title: "Scoți bifele de membru?", confirmLabel: "Scoate bifa la cele 2" });
    expect((form.props.confirm as { bodyCount: { field: string } }).bodyCount.field).toBe("registrationId");
  });

  it("says «Nicio bifă de scos» when every ticked row is a member's", async () => {
    const race = await createRace("Crosul");
    await register(race.id);
    await db.insert(staffUsers).values({ email: `runner${serial}@example.org`, displayName: "Member", role: "MEMBER" });
    state.actor = await staff("ADMIN");

    const tree = await listPage({ eventId: race.id, clubMember: "1", memberSweep: "1" });
    expect(byTestId(tree, "member-sweep-form")).toHaveLength(0);
    expect(byTestId(tree, "member-sweep-empty")).toHaveLength(1);
  });

  it("names the sweep's count after the press, in its counted form", async () => {
    await createRace("Crosul");
    state.actor = await staff("ADMIN");
    const tree = await listPage({ clubMember: "1", saved: "memberTicksCleared", count: "3" });
    const [banner] = byTestId(tree, "member-ticks-cleared");
    expect(banner.props.children).toBe("Am scos bifa de membru la 3 înscrieri. Nimic altceva nu s-a schimbat.");
  });
});

describe("BR-REQ-037-03 criterion 14: the members' and the bounced filters are ticks", () => {
  /*
    The members' filter and the bounced filter are ticks of the promo filter's kind (§650): a
    two-option select showed its label inside the closed box, so «Membri …» read as a chosen value,
    and its empty option spoke of events. Same parameters, `1` when ticked, nothing otherwise.
  */
  it("draws the members' and the bounced filters as ticks named by what they keep, in both languages (§650)", async () => {
    const race = await createRace("Crosul");
    await register(race.id);
    state.actor = await staff("ADMIN");
    const ticks = (tree: ReactNode) =>
      Object.fromEntries(
        elements(tree)
          .filter((element) => element.props.name === "clubMember" || element.props.name === "bounced")
          .map((element) => [element.props.name as string, element]),
      );
    const text = (node: unknown): string =>
      typeof node === "string" ? node : Array.isArray(node) ? node.map(text).join("") : isValidElement(node) ? text((node.props as Props).children) : "";

    for (const locale of ["ro", "en"] as const) {
      state.locale = locale;
      const words = (locale === "ro" ? ro : en).Admin.registrations;
      const off = ticks(await listPage({ eventId: race.id }));
      expect(Object.keys(off).sort()).toEqual(["bounced", "clubMember"]);
      for (const tick of Object.values(off)) {
        // Not a select: no `select` prop, no options, a value of `1` and nothing ticked by default.
        expect(tick.props.select, locale).toBeUndefined();
        expect(tick.props.value, locale).toBe("1");
        expect(tick.props.defaultChecked, locale).toBe(false);
      }
      expect(text(off.clubMember.props.children)).toBe(words.clubMemberOnly.replace("{club}", CLUB_NAME));
      expect(off.clubMember.props.help).toBe(words.clubMemberOnlyHelp.replaceAll("{club}", CLUB_NAME));
      // With how many it would keep (§NNN): nobody's email asks for anything at this race.
      expect(text(off.bounced.props.children)).toBe(words.bouncedOnly.replace("{count}", "0"));
      expect(off.bounced.props.help).toBe(words.bouncedOnlyHelp);
      // Each carries its glyph first, as the promo tick does, so the dense glyph column is not a gap.
      expect(byTestId(off.clubMember.props.children, "registrations-filter-member-glyph")).toHaveLength(1);
      expect(byTestId(off.bounced.props.children, "registrations-filter-bounced-glyph")).toHaveLength(1);
      // «Toate evenimentele» is the events select's alone: the status select says its own words.
      const selects = elements(await listPage({ eventId: race.id })).filter((element) => element.props.select === true);
      expect(selects.map((element) => element.props.name)).not.toContain("clubMember");
      expect(selects.map((element) => element.props.name)).not.toContain("bounced");
      const statusSelect = selects.find((element) => element.props.name === "status");
      const empty = elements(statusSelect?.props.children).find((element) => element.props.value === "");
      expect(text(empty?.props.children), locale).toBe(words.statusAll);
      expect(text(empty?.props.children), locale).not.toBe(words.filterAll);

      const on = ticks(await listPage({ eventId: race.id, clubMember: "1", bounced: "1" }));
      expect(on.clubMember.props.defaultChecked).toBe(true);
      expect(on.bounced.props.defaultChecked).toBe(true);
    }
    state.locale = "ro";
  });

  it("draws a bounced row's email state in one line under the name, a link to its «Emailuri» (BR-REQ-038-01 criterion 8)", async () => {
    const race = await createRace("Crosul");
    const bounced = await register(race.id);
    const reached = await register(race.id);
    // The participant's own message (§NNN): their id on the row, as every message to them carries it.
    const [{ participantId }] = await db.select({ participantId: registrations.participantId }).from(registrations).where(eq(registrations.id, bounced));
    await db.insert(emailOutbox).values({
      participantId,
      messageType: "REGISTRATION_CONFIRMED",
      recipientEmail: "runner-bounced@example.org",
      locale: "ro",
      payloadJson: {},
      idempotencyKey: "bounced-row",
      status: "BOUNCED",
      lastError: "550 5.1.1 mailbox unavailable",
      registrationId: bounced,
    });
    state.actor = await staff("ADMIN");
    const tree = await listPage({ eventId: race.id, bounced: "1" });
    const table = elements(tree).find((element) => element.type === AdminTable);
    const rows = table?.props.rows as { id: string }[];
    expect(rows.map((row) => row.id)).toEqual([bounced]);
    const nameColumn = (table?.props.columns as { key: string; render: (row: unknown) => ReactNode }[]).find((column) => column.key === "name");
    // Since §NNN one line under the name, a link to the registration's «Emailuri» — no tooltip island — and no
    // list payload carries the provider's words: the small print is the registration page's alone.
    const lines = elements(nameColumn?.render(rows[0])).filter((element) => element.type === EmailStateLine);
    expect(lines).toHaveLength(1);
    const words = lines[0].props.words as { line: string; tone: string };
    expect(words.tone).toBe("error");
    expect(words.line).toContain(ro.Admin.emails.typesShort.REGISTRATION_CONFIRMED.replaceAll(" ", " "));
    expect(lines[0].props.href).toMatch(/#emailuri$/);
    expect(JSON.stringify(lines[0].props)).not.toContain("550 5.1.1");

    const all = await listPage({ eventId: race.id });
    const allTable = elements(all).find((element) => element.type === AdminTable);
    const reachedRow = (allTable?.props.rows as { id: string }[]).find((row) => row.id === reached);
    const allName = (allTable?.props.columns as { key: string; render: (row: unknown) => ReactNode }[]).find((column) => column.key === "name");
    expect(elements(allName?.render(reachedRow)).filter((element) => element.type === EmailStateLine)).toHaveLength(0);
  });
});
