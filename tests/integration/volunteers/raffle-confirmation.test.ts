import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { emailOutbox } from "@/db/schema/email-outbox";
import { eventRaffleEntries } from "@/db/schema/event-raffle-entries";
import { eventVolunteerRoleAssignments, eventVolunteerRoles, eventVolunteers } from "@/db/schema/event-volunteers";
import { events, eventTranslations } from "@/db/schema/events";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { computeContentHash, type LegalDocumentTranslationInput } from "@/modules/legal-documents/domain/content-hash";
import { insertLegalDocumentVersion } from "@/modules/legal-documents/repository";
import { LEGAL_TEMPLATES } from "@/modules/legal-documents/templates/catalogue";
import { exportPersonData } from "@/modules/registrations/person-data";
import { type StaffRole, STAFF_ROLES } from "@/modules/staff-identity/domain/roles";
import { confirmVolunteerForRaffle } from "@/modules/volunteers/raffle-confirmation";
import { signUpForRaffleByForm } from "@/modules/volunteers/raffle-entries";
import { buildRaffleCsv, buildRaffleRandomOrgText, canTakeRaffleList, exportRaffleList, type RaffleCsvWords } from "@/modules/volunteers/raffle-list";
import { raffleReasonsFor, readRaffleLine, readRaffleRosterRows } from "@/modules/volunteers/raffle-roster";
import { changeVolunteer } from "@/modules/volunteers/volunteers";
import { DomainError, isDomainError } from "@/shared/errors/domain-error";
import { decodeFlash, FLASH_COOKIE } from "@/shared/feedback/notice";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * §NNN (amending §984 and §1023), BR-REQ-071-01, BR-REQ-050-02, BR-REQ-060-01 — «Confirmă pentru tombolă», on real PostgreSQL
 * (PGlite), through the service and the tab's own action. The owner, 2026-11-20, the day before the race, of a volunteer of
 * seventeen — «Voluntar · Nu · neconfirmat» on «Tombolă», «Înscris», «Acordul părinților lipsește», «Link trimis părintelui» on her
 * page: «vreau să pot să o confirm și pe [ea] pentru tombolă, chiar și fără acordul părinților».
 *
 * - **Who**: the Organizer and the Administrators alone (`canTakeRaffleList`), at the action's door and in the service; the desk's
 *   Voluntar, the Redactor, Tehnic and a member are FORBIDDEN, with nothing written.
 * - **A minor** without the box or the way is refused, naming what is missing, with nothing written; with both, the agreement and
 *   its way are recorded; an adult is asked nothing and has nothing of a parent recorded.
 * - **One transaction under the event row's lock**: the V number drawn when there is none — the next one the event never gave, a
 *   deleted volunteer's retired one included —, never a second one, kept by a later «Confirmă»; the state, the agreement, the
 *   parent's link untouched; one audit row with the staff member, whether a minor and the way — never a name —; nobody emailed.
 * - **Eligibility everywhere**: the roster and its counts, the lists' «Tombolă» column, the volunteer's line, «Lista pentru tombolă»,
 *   the file for random.org, the public form's «Sunt voluntar»; «Scoate» still takes the person out; a cancelled volunteer is in
 *   nothing. «Cu înscriere separată» the press signs the person up by the organizers' own door, the rules' acceptance asked.
 *
 * The race is in 2099; the made-up people are nobody.
 */
const state = vi.hoisted(() => ({ db: undefined as unknown, actor: undefined as unknown, redirected: [] as string[], cookies: [] as Array<[string, string]> }));

vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  redirect: (url: string) => {
    state.redirected.push(url);
    throw new Error("NEXT_REDIRECT");
  },
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, set: (name: string, value: string) => void state.cookies.push([name, value]), delete: () => {} }),
  headers: async () => new Headers(),
}));
vi.mock("next/cache", async () => (await import("../../helpers/next-cache")).fakeNextCache.module);
vi.mock("@/db/client", () => ({ getDb: () => state.db }));
vi.mock("@/i18n/navigation", () => ({
  getPathname: ({ locale, href }: { locale: string; href: string | { pathname: string; params?: Record<string, string> } }) => {
    if (typeof href === "string") return `/${locale}${href}`;
    let path = href.pathname;
    for (const [key, value] of Object.entries(href.params ?? {})) path = path.replace(`[${key}]`, value);
    return `/${locale}${path}`;
  },
}));
vi.mock("@/modules/staff-identity/session", () => ({
  DEV_STAFF_COOKIE: "dev-staff",
  requireStaff: async () => state.actor,
  // The door's capability, asked as the real one asks it.
  requireStaffCapability: async (capability: (subject: unknown) => boolean) => {
    if (!state.actor) throw new DomainError("UNAUTHENTICATED", "no staff session");
    if (!capability(state.actor)) throw new DomainError("FORBIDDEN", "no");
    return state.actor;
  },
}));

const { raffleConfirmVolunteerAction } = await import("@/app/[locale]/admin/checkin/tombola/actions");

const START = new Date("2099-11-21T07:00:00.000Z");
const EFFECTIVE = new Date("2026-01-01T00:00:00.000Z");
const NOW = new Date("2099-11-20T18:00:00.000Z");

const WORDS: RaffleCsvWords = { number: "Număr", name: "Nume", kind: "Grupa", kinds: { RUNNER: "Alergător", ELITE: "Elită", VOLUNTEER: "Voluntar" }, present: "Prezent", presentYes: "Da", presentNo: "Nu" };

let db: TestDatabase;
let close: () => Promise<void>;
let serial = 0;
const staff: Partial<Record<StaffRole, StaffUser>> = {};
let eventId: string;
let roleId: string;

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
  state.db = db;
});
afterAll(async () => close());
beforeEach(async () => {
  await resetTables(db);
  state.redirected.length = 0;
  state.cookies.length = 0;
  for (const role of STAFF_ROLES) {
    [staff[role]] = await db.insert(staffUsers).values({ email: `${role.toLowerCase()}-confirm@example.test`, displayName: `Coleg ${role}`, role }).returning();
  }
  state.actor = staff.MODERATOR;
  ({ eventId, roleId } = await race());
});

/** A race in 2099 holding a raffle «Din oficiu», every group ticked. */
async function race(over: Partial<typeof events.$inferInsert> = {}) {
  serial += 1;
  const [event] = await db
    .insert(events)
    .values({ type: "RACE", startsAt: START, timezone: "Europe/Bucharest", registrationMode: "INTERNAL", editorialStatus: "PUBLISHED", publishedAt: EFFECTIVE, locationName: "Parcul Noua", hasRaffle: true, ...over })
    .returning({ id: events.id });
  await db.insert(eventTranslations).values([
    { eventId: event.id, locale: "ro", slug: `crosul-confirmarii-${serial}`, title: `Crosul ${serial}` },
    { eventId: event.id, locale: "en", slug: `the-confirmation-cross-${serial}`, title: `The cross ${serial}` },
  ]);
  const [role] = await db.insert(eventVolunteerRoles).values({ eventId: event.id, nameRo: "Punct de apă", nameEn: "Water point", needed: 9, position: 0 }).returning({ id: eventVolunteerRoles.id });
  return { eventId: event.id, roleId: role.id };
}

/** A volunteer as the hand entry leaves one: «Înscris», an address, the role given — and, for a minor, a parent named whose link waits. */
async function volunteer(name: string, more: Partial<typeof eventVolunteers.$inferInsert> = {}, at: { eventId: string; roleId: string } = { eventId, roleId }): Promise<string> {
  serial += 1;
  const email = `confirm-${serial}@example.test`;
  const [row] = await db
    .insert(eventVolunteers)
    .values({ eventId: at.eventId, name, email, canonicalEmail: email, canonicalizationVersion: 2, phone: "+40712345678", state: "REGISTERED", source: "STAFF", roleId: at.roleId, ...more })
    .returning({ id: eventVolunteers.id });
  await db.insert(eventVolunteerRoleAssignments).values({ volunteerId: row.id, roleId: at.roleId });
  return row.id;
}

/** Maria, seventeen on the race's day, her parent named and a link to them live: «Acordul părintelui lipsește», «Link trimis părintelui». */
const maria = () =>
  volunteer("Maria Minoră", {
    age: 17,
    dateOfBirth: "2082-05-01",
    guardianName: "Elena Minoră",
    guardianEmail: "elena-parent@example.test",
    guardianTokenHash: "a".repeat(64),
    guardianTokenExpiresAt: new Date("2099-11-25T00:00:00.000Z"),
    guardianRequestedAt: EFFECTIVE,
  });

const rowOf = async (id: string) => (await db.select().from(eventVolunteers).where(eq(eventVolunteers.id, id)))[0];
const trail = () => db.select().from(auditLogs).where(eq(auditLogs.action, "volunteer.raffle_confirmed"));
const confirm = (actor: StaffUser, volunteerId: string, more: Partial<{ guardianAgreed: unknown; guardianWay: unknown; accepted: boolean; eventId: string }> = {}) =>
  confirmVolunteerForRaffle(db, actor, { eventId: more.eventId ?? eventId, volunteerId, guardianAgreed: more.guardianAgreed ?? false, guardianWay: more.guardianWay ?? "", accepted: more.accepted ?? false }, NOW);

async function refusal(work: Promise<unknown>): Promise<DomainError> {
  try {
    await work;
  } catch (error) {
    if (isDomainError(error)) return error;
    throw error;
  }
  throw new Error("expected a refusal");
}

async function approveTexts() {
  const notice: LegalDocumentTranslationInput[] = [
    { locale: "ro", title: "Confidențialitate", body: { sections: [{ paragraphs: ["Tombola ({{raffle}}): păstrăm înscrierea."] }] } },
    { locale: "en", title: "Privacy", body: { sections: [{ paragraphs: ["The raffle ({{raffle}}): we keep the sign-up."] }] } },
  ];
  await insertLegalDocumentVersion(db, { key: "PRIVACY_NOTICE", version: 1, effectiveAt: EFFECTIVE, isApproved: true, contentSha256: computeContentHash(notice), translations: notice, now: EFFECTIVE });
  const rules: LegalDocumentTranslationInput[] = (["ro", "en"] as const).map((locale) => ({ locale, ...LEGAL_TEMPLATES.RAFFLE_RULES[locale] }));
  await insertLegalDocumentVersion(db, { key: "RAFFLE_RULES", version: 1, effectiveAt: EFFECTIVE, isApproved: true, contentSha256: computeContentHash(rules), translations: rules, now: EFFECTIVE });
}

describe("§NNN BR-REQ-060-01 «Confirmă pentru tombolă» is the Organizer's and the Administrators' alone", () => {
  it("is refused to the desk's Voluntar, the Redactor, Tehnic and a member — in the service and at the action's door — with nothing written", async () => {
    const id = await maria();
    for (const role of STAFF_ROLES) expect(canTakeRaffleList(staff[role]!), role).toBe(role === "MODERATOR" || role === "ADMIN" || role === "SUPERADMIN");
    for (const role of ["MEMBER", "CONTRIBUTOR", "COPYWRITER", "DEV"] as const) {
      expect((await refusal(confirm(staff[role]!, id, { guardianAgreed: true, guardianWay: "PHONE" }))).code, role).toBe("FORBIDDEN");
      state.actor = staff[role];
      state.redirected.length = 0;
      await expect(raffleConfirmVolunteerAction(null, actionForm(id, { raffleGuardianAgreed: "on", raffleGuardianWay: "PHONE" }))).rejects.toThrow("NEXT_REDIRECT");
      expect(state.redirected[0], role).toMatch(/[?&]error=FORBIDDEN#admin-alert$/);
    }
    const row = await rowOf(id);
    expect([row.raffleConfirmedAt, row.volunteerNumber, row.state]).toEqual([null, null, "REGISTERED"]);
    expect(await trail()).toEqual([]);
  });

  it("goes through for the Organizer, the Administrator and the Superadministrator", async () => {
    for (const role of ["MODERATOR", "ADMIN", "SUPERADMIN"] as const) {
      const id = await volunteer(`Adult ${role}`);
      expect(await confirm(staff[role]!, id), role).toMatchObject({ changed: true, minor: false, guardianWay: null });
      expect((await rowOf(id)).raffleConfirmedByStaffUserId, role).toBe(staff[role]!.id);
    }
  });
});

describe("§NNN a minor: the parent's or guardian's agreement, and how — required on the server", () => {
  it("refuses a minor without the box or the way, naming what is missing, with nothing written", async () => {
    const id = await maria();
    for (const [answers, missing] of [
      [{}, ["raffleGuardianAgreed", "raffleGuardianWay"]],
      [{ guardianWay: "PHONE" }, ["raffleGuardianAgreed"]],
      [{ guardianAgreed: true }, ["raffleGuardianWay"]],
      [{ guardianAgreed: true, guardianWay: "BY_PIGEON" }, ["raffleGuardianWay"]],
      [{ guardianAgreed: "on", guardianWay: "PHONE" }, ["raffleGuardianAgreed"]],
    ] as const) {
      const error = await refusal(confirm(staff.MODERATOR!, id, answers));
      expect([error.code, error.fields], JSON.stringify(answers)).toEqual(["RAFFLE_GUARDIAN_MISSING", missing]);
    }
    const row = await rowOf(id);
    expect([row.raffleConfirmedAt, row.raffleGuardianAgreed, row.raffleGuardianWay, row.volunteerNumber]).toEqual([null, null, null, null]);
    expect(await trail()).toEqual([]);
    // The tab's action reads the dialog's box and the select's way from the form: posted empty (no dialog, no script), refused by name.
    state.redirected.length = 0;
    await expect(raffleConfirmVolunteerAction(null, actionForm(id, {}))).rejects.toThrow("NEXT_REDIRECT");
    expect(state.redirected[0]).toMatch(/[?&]error=RAFFLE_GUARDIAN_MISSING#admin-alert$/);
  });

  it("confirms a minor «telefonic» for the raffle alone: the volunteer's state, agreement and parent's link stay exactly as they were", async () => {
    const id = await maria();
    const before = await rowOf(id);
    const result = await confirm(staff.MODERATOR!, id, { guardianAgreed: true, guardianWay: "PHONE" });
    expect(result).toEqual({ changed: true, volunteerNumber: 1, signedUp: false, minor: true, guardianWay: "PHONE" });
    const after = await rowOf(id);
    expect(after).toMatchObject({
      state: "REGISTERED",
      volunteerNumber: 1,
      raffleConfirmedAt: NOW,
      raffleConfirmedByStaffUserId: staff.MODERATOR!.id,
      raffleGuardianAgreed: true,
      raffleGuardianWay: "PHONE",
    });
    // Nothing of the volunteering agreement or the parent's link moved: «Acordul părintelui lipsește» and «Link trimis părintelui» stand.
    for (const column of ["agreementAcceptedAt", "guardianAcceptedAt", "guardianTokenHash", "guardianTokenExpiresAt", "guardianRequestedAt", "guardianName", "guardianEmail", "inRaffle", "present", "hasKit"] as const) {
      expect(after[column], column).toEqual(before[column]);
    }
    // Nobody is told.
    expect(await db.select().from(emailOutbox)).toEqual([]);
  });

  it("is in «Toate datele unei persoane» (art. 15): when, and how the parent agreed — columns of the row like any other", async () => {
    const id = await maria();
    await confirm(staff.MODERATOR!, id, { guardianAgreed: true, guardianWay: "IN_PERSON" });
    const data = await exportPersonData(db, staff.ADMIN!, (await rowOf(id)).canonicalEmail ?? "", NOW);
    expect(data.volunteerOffers).toHaveLength(1);
    expect(data.volunteerOffers[0]).toMatchObject({ state: "REGISTERED", raffleConfirmedAt: NOW, raffleGuardianAgreed: true, raffleGuardianWay: "IN_PERSON" });
  });

  it("asks an adult nothing, and keeps nothing of a parent whatever a form posts", async () => {
    const id = await volunteer("Adrian Adult", { age: 30, dateOfBirth: "2069-01-01" });
    await confirm(staff.ADMIN!, id, { guardianAgreed: true, guardianWay: "WRITING" });
    expect(await rowOf(id)).toMatchObject({ state: "REGISTERED", raffleConfirmedAt: NOW, raffleGuardianAgreed: null, raffleGuardianWay: null, volunteerNumber: 1 });
  });
});

describe("§NNN one transaction under the event row's lock: the V number, the record, one audit row", () => {
  it("draws the next V number the event never gave — after a deleted volunteer's — and never a second one", async () => {
    const first = await volunteer("Ana Prima");
    await changeVolunteer(db, staff.ADMIN!, { kind: "setState", eventId, id: first, state: "CONFIRMED" }, NOW, { sendEmail: false });
    const gone = await volunteer("Bogdan Plecat");
    await changeVolunteer(db, staff.ADMIN!, { kind: "setState", eventId, id: gone, state: "CONFIRMED" }, NOW, { sendEmail: false });
    await changeVolunteer(db, staff.ADMIN!, { kind: "delete", eventId, id: gone }, NOW);
    const id = await maria();
    expect((await confirm(staff.MODERATOR!, id, { guardianAgreed: true, guardianWay: "IN_PERSON" })).volunteerNumber).toBe(3);
    // A second press changes nothing and writes nothing: the number stands, one trail row.
    expect(await confirm(staff.ADMIN!, id, { guardianAgreed: true, guardianWay: "WRITING" })).toEqual({ changed: false, volunteerNumber: 3, signedUp: false, minor: true, guardianWay: "IN_PERSON" });
    expect(await trail()).toHaveLength(1);
    // A person who held a number keeps it: nothing is drawn.
    const numbered = await volunteer("Cezar Numerotat", { volunteerNumber: 7 });
    expect(await confirm(staff.MODERATOR!, numbered)).toMatchObject({ changed: true, volunteerNumber: 7 });
    expect((await trail()).find((row) => (row.metadataJson as { volunteerId: string }).volunteerId === numbered)?.metadataJson).toMatchObject({ volunteerNumber: 7, numberDrawn: false });
  });

  it("is kept by a later «Confirmă» as a volunteer — never a second number — once the parent's volunteering agreement arrives", async () => {
    const id = await volunteer("Dana Adultă");
    await confirm(staff.MODERATOR!, id);
    expect((await rowOf(id)).volunteerNumber).toBe(1);
    await volunteer("Emil Altul");
    await changeVolunteer(db, staff.MODERATOR!, { kind: "setState", eventId, id, state: "CONFIRMED" }, NOW, { sendEmail: false });
    const after = await rowOf(id);
    expect([after.state, after.volunteerNumber]).toEqual(["CONFIRMED", 1]);
    // The next one confirmed draws after it.
    const next = await volunteer("Florin Următor");
    await changeVolunteer(db, staff.MODERATOR!, { kind: "setState", eventId, id: next, state: "CONFIRMED" }, NOW, { sendEmail: false });
    expect((await rowOf(next)).volunteerNumber).toBe(2);
  });

  it("still holds a minor's «Confirmă» as a volunteer to the parent's volunteering agreement: the raffle's confirmation opens no other door", async () => {
    const id = await maria();
    await confirm(staff.MODERATOR!, id, { guardianAgreed: true, guardianWay: "PHONE" });
    expect((await refusal(changeVolunteer(db, staff.MODERATOR!, { kind: "setState", eventId, id, state: "CONFIRMED" }, NOW, { sendEmail: false }))).code).toBe("VOLUNTEER_GUARDIAN_MISSING");
    expect((await rowOf(id)).state).toBe("REGISTERED");
  });

  it("writes one audit row: the staff member the actor, whether a minor and the way in the data — never the name", async () => {
    const id = await maria();
    await confirm(staff.MODERATOR!, id, { guardianAgreed: true, guardianWay: "WRITING" });
    const rows = await trail();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actorStaffUserId: staff.MODERATOR!.id, entityType: "event", entityId: eventId });
    expect(rows[0].metadataJson).toEqual({ volunteerId: id, minor: true, guardianWay: "WRITING", volunteerNumber: 1, numberDrawn: true });
    expect(JSON.stringify(rows[0])).not.toContain("Maria");
    expect(JSON.stringify(rows[0])).not.toContain("Elena");
  });

  it("refuses with nothing written: an event without a raffle, another event's volunteer, a cancelled one, a raffle without the volunteers", async () => {
    const id = await volunteer("Gelu Refuzat");
    await db.update(events).set({ hasRaffle: false }).where(eq(events.id, eventId));
    expect((await refusal(confirm(staff.MODERATOR!, id))).code).toBe("RAFFLE_NOT_HELD");
    await db.update(events).set({ hasRaffle: true, raffleVolunteers: false }).where(eq(events.id, eventId));
    expect((await refusal(confirm(staff.MODERATOR!, id))).code).toBe("RAFFLE_NOT_ELIGIBLE");
    await db.update(events).set({ raffleVolunteers: true }).where(eq(events.id, eventId));
    const other = await race();
    expect((await refusal(confirm(staff.MODERATOR!, id, { eventId: other.eventId }))).code).toBe("NOT_FOUND");
    await changeVolunteer(db, staff.MODERATOR!, { kind: "setState", eventId, id, state: "CANCELLED" }, NOW, { sendEmail: false });
    expect((await refusal(confirm(staff.MODERATOR!, id))).code).toBe("RAFFLE_NOT_ELIGIBLE");
    expect((await refusal(confirm(staff.MODERATOR!, "not-a-uuid"))).code).toBe("NOT_FOUND");
    const row = await rowOf(id);
    expect([row.raffleConfirmedAt, row.volunteerNumber]).toEqual([null, null]);
    expect(await trail()).toEqual([]);
  });

  it("changes nothing for a volunteer confirmed already, who takes part by their own «Confirmă»", async () => {
    const id = await volunteer("Ioana Confirmată");
    await changeVolunteer(db, staff.ADMIN!, { kind: "setState", eventId, id, state: "CONFIRMED" }, NOW, { sendEmail: false });
    expect(await confirm(staff.MODERATOR!, id)).toMatchObject({ changed: false, volunteerNumber: 1 });
    expect((await rowOf(id)).raffleConfirmedAt).toBeNull();
    expect(await trail()).toEqual([]);
  });
});

describe("§NNN BR-REQ-071-01 a volunteer confirmed for the raffle takes part in every reader — «Scoate» still takes them out, a cancelled one is in nothing", () => {
  it("is in the roster and its counts, the lists' column, the person's line, «Lista pentru tombolă» and the file for random.org", async () => {
    const id = await maria();
    const waiting = await volunteer("Vlad Așteaptă");
    const before = await readRaffleRosterRows(db, eventId, NOW);
    expect(before?.rows.find((row) => row.ref.id === id)).toMatchObject({ reason: "notConfirmed", label: null, mayConfirmForRaffle: true, minor: true, raffleConfirmation: null });

    await confirm(staff.MODERATOR!, id, { guardianAgreed: true, guardianWay: "PHONE" });

    const roster = await readRaffleRosterRows(db, eventId, NOW);
    expect(roster?.rows.find((row) => row.ref.id === id)).toMatchObject({ kind: "VOLUNTEER", reason: "in", label: "V001", mayConfirmForRaffle: false, raffleConfirmation: { at: NOW, guardianWay: "PHONE" } });
    // The one still waiting is offered the press, and is out.
    expect(roster?.rows.find((row) => row.ref.id === waiting)).toMatchObject({ reason: "notConfirmed", mayConfirmForRaffle: true, minor: false });
    expect(roster?.counts).toMatchObject({ total: 1, in: { RUNNER: 0, ELITE: 0, VOLUNTEER: 1 } });
    expect((await raffleReasonsFor(db, eventId, { volunteerIds: [id, waiting] })).get(id)).toBe("in");
    expect(await readRaffleLine(db, { table: "volunteer", id }, NOW)).toMatchObject({ reason: "in", volunteer: { confirmedForRaffle: true, guardianWay: "PHONE", mayConfirmForRaffle: false, minor: true } });

    const list = await exportRaffleList(db, staff.MODERATOR!, eventId, NOW);
    expect(list.rows).toEqual([{ number: 1, label: "V001", name: "Maria Minoră", kind: "VOLUNTEER", present: false }]);
    expect(buildRaffleCsv(WORDS, list.rows)).toContain("V001,Maria Minoră,Voluntar,Nu");
    expect(buildRaffleRandomOrgText((await exportRaffleList(db, staff.ADMIN!, eventId, NOW, { format: "random-org" })).rows)).toBe("V001\r\n");
    // «— doar prezenții»: once ticked present, as any volunteer.
    await changeVolunteer(db, staff.MODERATOR!, { kind: "setPresent", eventId, id, present: true }, NOW);
    expect(buildRaffleRandomOrgText((await exportRaffleList(db, staff.MODERATOR!, eventId, NOW, { onlyPresent: true, format: "random-org" })).rows)).toBe("V001\r\n");
  });

  it("is taken out by «Scoate» as before, and put back", async () => {
    const id = await volunteer("Paul Scos");
    await confirm(staff.MODERATOR!, id);
    await changeVolunteer(db, staff.MODERATOR!, { kind: "setRaffle", eventId, id, inRaffle: false }, NOW);
    expect((await readRaffleRosterRows(db, eventId, NOW))?.rows.find((row) => row.ref.id === id)?.reason).toBe("takenOut");
    expect((await exportRaffleList(db, staff.MODERATOR!, eventId, NOW)).rows).toEqual([]);
    await changeVolunteer(db, staff.MODERATOR!, { kind: "setRaffle", eventId, id, inRaffle: true }, NOW);
    expect((await exportRaffleList(db, staff.MODERATOR!, eventId, NOW)).rows.map((row) => row.label)).toEqual(["V001"]);
  });

  it("leaves a cancelled volunteer out of everything, the confirmation kept on the row", async () => {
    const id = await volunteer("Radu Anulat");
    await confirm(staff.MODERATOR!, id);
    await changeVolunteer(db, staff.MODERATOR!, { kind: "setState", eventId, id, state: "CANCELLED" }, NOW, { sendEmail: false });
    expect((await readRaffleRosterRows(db, eventId, NOW))?.rows.some((row) => row.ref.id === id)).toBe(false);
    expect((await exportRaffleList(db, staff.MODERATOR!, eventId, NOW)).rows).toEqual([]);
    expect((await raffleReasonsFor(db, eventId, { volunteerIds: [id] })).get(id)).toBe("notConfirmed");
    expect((await rowOf(id)).raffleConfirmedAt).toEqual(NOW);
  });

  it("counts a minor's confirmation only with the parent's agreement: a date of birth corrected to a minor's offers the press again", async () => {
    const id = await volunteer("Sorin Corectat", { age: 25 });
    await confirm(staff.MODERATOR!, id);
    await db.update(eventVolunteers).set({ age: 16 }).where(eq(eventVolunteers.id, id));
    expect((await readRaffleRosterRows(db, eventId, NOW))?.rows.find((row) => row.ref.id === id)).toMatchObject({ reason: "notConfirmed", mayConfirmForRaffle: true, minor: true });
    expect((await refusal(confirm(staff.MODERATOR!, id))).code).toBe("RAFFLE_GUARDIAN_MISSING");
    expect(await confirm(staff.MODERATOR!, id, { guardianAgreed: true, guardianWay: "IN_PERSON" })).toMatchObject({ changed: true, volunteerNumber: 1, guardianWay: "IN_PERSON" });
    expect((await readRaffleRosterRows(db, eventId, NOW))?.rows.find((row) => row.ref.id === id)?.reason).toBe("in");
  });
});

describe("§NNN «Cu înscriere separată»: the press signs the volunteer up, by the organizers' own door", () => {
  const signUpMode = () => db.update(events).set({ raffleSignUp: true, raffleSignUpOpen: true }).where(eq(events.id, eventId));

  it("asks the rules' acceptance and the open gate before anything is written", async () => {
    const id = await maria();
    await signUpMode();
    // No texts in force: the gate is shut.
    expect((await refusal(confirm(staff.MODERATOR!, id, { guardianAgreed: true, guardianWay: "PHONE", accepted: true }))).code).toBe("RAFFLE_SIGN_UP_CLOSED");
    await approveTexts();
    const error = await refusal(confirm(staff.MODERATOR!, id, { guardianAgreed: true, guardianWay: "PHONE" }));
    expect([error.code, error.fields]).toEqual(["RAFFLE_RULES_NOT_ACCEPTED", ["accepted"]]);
    const row = await rowOf(id);
    expect([row.raffleConfirmedAt, row.volunteerNumber]).toEqual([null, null]);
    expect(await db.select().from(eventRaffleEntries)).toEqual([]);
    expect(await trail()).toEqual([]);
  });

  it("confirms and signs up in one press: a STAFF entry with the staff member as its recorder, the person in", async () => {
    await approveTexts();
    await signUpMode();
    const id = await maria();
    expect(await confirm(staff.ADMIN!, id, { guardianAgreed: true, guardianWay: "PHONE", accepted: true })).toMatchObject({ changed: true, signedUp: true, volunteerNumber: 1 });
    const [entry] = await db.select().from(eventRaffleEntries).where(eq(eventRaffleEntries.volunteerId, id));
    expect(entry).toMatchObject({ eventId, method: "STAFF", recordedByStaffUserId: staff.ADMIN!.id, typedName: null, ip: null });
    const [row] = await trail();
    expect(row.metadataJson).toMatchObject({ volunteerId: id, minor: true, guardianWay: "PHONE", raffleEntryId: entry.id });
    expect((await db.select().from(auditLogs).where(and(eq(auditLogs.action, "event_raffle.entry_created"), eq(auditLogs.entityId, eventId)))).map((one) => one.metadataJson)).toEqual([
      { entryId: entry.id, method: "STAFF", kind: "VOLUNTEER" },
    ]);
    expect((await readRaffleRosterRows(db, eventId, NOW))?.rows.find((one) => one.ref.id === id)?.reason).toBe("in");
  });

  it("lets the public form's «Sunt voluntar» find a volunteer confirmed for the raffle by their V number", async () => {
    await approveTexts();
    await signUpMode();
    const id = await volunteer("Tudor Formular");
    // Not confirmed either way: the form finds nobody.
    const typed = { number: "V001", name: "Tudor Formular", volunteer: true, accepted: true, locale: "ro" as const };
    await db.update(eventVolunteers).set({ volunteerNumber: 1 }).where(eq(eventVolunteers.id, id));
    expect(await signUpForRaffleByForm(db, eventId, typed, NOW)).toBe("noMatch");
    await confirm(staff.MODERATOR!, id, { accepted: true });
    // Signed up by the press already: the form's thank-you, and still the one entry.
    expect(await signUpForRaffleByForm(db, eventId, typed, NOW)).toBe("done");
    expect(await db.select().from(eventRaffleEntries)).toHaveLength(1);
    // A volunteer confirmed for the raffle and not signed up — the entry deleted since — signs up from the form.
    await db.delete(eventRaffleEntries);
    expect(await signUpForRaffleByForm(db, eventId, typed, NOW)).toBe("done");
    expect((await db.select().from(eventRaffleEntries))[0]).toMatchObject({ volunteerId: id, method: "FORM" });
  });
});

describe("§NNN the tab's action", () => {
  it("comes back to the tab at the row with its toast, or to the volunteer's page", async () => {
    const id = await maria();
    await expect(raffleConfirmVolunteerAction(null, actionForm(id, { raffleGuardianAgreed: "on", raffleGuardianWay: "PHONE", filter: "out" }))).rejects.toThrow("NEXT_REDIRECT");
    expect(state.redirected[0]).toBe(`/ro/admin/checkin/tombola?eventId=${eventId}&filter=out#raffle-${id}`);
    expect(decodeFlash(state.cookies.find(([name]) => name === FLASH_COOKIE)?.[1])).toMatchObject({ key: "raffleConfirmed" });
    state.redirected.length = 0;
    state.cookies.length = 0;
    await expect(raffleConfirmVolunteerAction(null, actionForm(id, { back: "volunteer", raffleGuardianAgreed: "on", raffleGuardianWay: "PHONE" }))).rejects.toThrow("NEXT_REDIRECT");
    expect(state.redirected[0]).toBe(`/ro/admin/volunteers/${id}#volunteer-raffle`);
    expect(decodeFlash(state.cookies.find(([name]) => name === FLASH_COOKIE)?.[1])).toMatchObject({ key: "raffleConfirmedAlready", kind: "info" });
  });
});

function actionForm(volunteerId: string, fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries({ uiLocale: "ro", eventId, table: "volunteer", personId: volunteerId, back: "raffle", ...fields })) data.set(key, value);
  return data;
}
