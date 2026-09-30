import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { emailOutbox } from "@/db/schema/email-outbox";
import { events, eventTranslations } from "@/db/schema/events";
import { pendingFamilyEntries } from "@/db/schema/family-entries";
import { registrations } from "@/db/schema/registrations";
import { computeContentHash, type LegalDocumentTranslationInput } from "@/modules/legal-documents/domain/content-hash";
import { findCurrentApprovedDocument, insertLegalDocumentVersion } from "@/modules/legal-documents/repository";
import { declarationTrailEn, declarationTrailRo } from "@/modules/legal-documents/templates/declaration";
import { readRegistrationForm } from "@/modules/registrations/form-mapping";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * §NNN (amending §446 and §493) — a second person on the same address, from the public form, is
 * never answered «Ești deja înscris» (BR-REQ-032-03, BR-REQ-031-01 criterion 3).
 *
 * What QA showed on 2026-09-30: an address holding two confirmed runners at a race; the public form
 * sent again from it with another name and the other sex; the email answered with the confirmation
 * of the runner already registered — «Ești deja înscris… cu numărul 101 — nu s-a creat a doua
 * înscriere» — and the twins' sentence. The stored rows showed the one route to that answer: the
 * name differed from every registration's, and the posted birth date was the day of one of them
 * (the browser's own `bday` autofill, or the day reused), so the owner's rule (§446) read the form
 * as a slip of that runner. Another name *and* the other sex is two boxes changed, never a slip:
 * that person is another person now, and the address confirms them from its inbox, as it confirms
 * anybody else (§446). Same-sex twins keep the sentence that says how they are registered (§493).
 *
 * The form is posted as the page posts it — the birth date typed day first into its box
 * (`readRegistrationForm`, `normalizeTypedDate`, §561) — so a misread day is part of what is proven.
 * Made-up names only.
 */
const NOW = new Date("2026-09-25T10:00:00.000Z");
const EMAIL = "familia.munteanu@example.ro";

let db: TestDatabase;
let close: () => Promise<void>;

vi.mock("@/db/client", () => ({ getDb: () => db }));

const { submitRegistration, confirmEmail, signDeclaration, continueFamilySittingAndReserve } = await import("@/modules/registrations/service");
const { confirmFamilyEntry } = await import("@/modules/registrations/family-confirm");
const { renderOutboxMessage } = await import("@/modules/notifications/render");
const { listActiveRegistrationsForParticipant } = await import("@/modules/registrations/my-registrations");

type EventInput = Parameters<typeof submitRegistration>[1];

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
  await db.execute(sql`ALTER TABLE registrations DROP CONSTRAINT IF EXISTS registrations_event_participant_unique`);
});
afterAll(async () => close());
beforeEach(async () => {
  await resetTables(db);
  const privacy: LegalDocumentTranslationInput[] = [
    { locale: "ro", title: "Confidențialitate", body: { sections: [{ paragraphs: ["p"] }] } },
    { locale: "en", title: "Privacy", body: { sections: [{ paragraphs: ["p"] }] } },
  ];
  const declaration: LegalDocumentTranslationInput[] = [
    { locale: "ro", title: "Declarație pe proprie răspundere", body: declarationTrailRo },
    { locale: "en", title: "Declaration", body: declarationTrailEn },
  ];
  await insertLegalDocumentVersion(db, { key: "PRIVACY_NOTICE", version: 1, effectiveAt: new Date("2026-01-01T00:00:00Z"), isApproved: true, contentSha256: computeContentHash(privacy), translations: privacy, now: NOW });
  await insertLegalDocumentVersion(db, { key: "TERMS", version: 1, effectiveAt: new Date("2026-01-01T00:00:00Z"), isApproved: true, contentSha256: computeContentHash(privacy), translations: privacy, now: NOW });
  await insertLegalDocumentVersion(db, { key: "EVENT_DECLARATION", version: 1, effectiveAt: new Date("2026-01-01T00:00:00Z"), isApproved: true, contentSha256: computeContentHash(declaration), translations: declaration, now: NOW });
});

async function createEvent(): Promise<EventInput> {
  const [event] = await db
    .insert(events)
    .values({ type: "RACE", startsAt: new Date("2026-10-11T07:00:00.000Z"), registrationMode: "INTERNAL", capacity: 20, locationName: "Parcul Tractorul", editorialStatus: "PUBLISHED", publishedAt: NOW })
    .returning();
  await db.insert(eventTranslations).values([
    { eventId: event.id, locale: "ro", title: "Crosul familiei", slug: "crosul-familiei" },
    { eventId: event.id, locale: "en", title: "The family cross", slug: "family-cross" },
  ]);
  return { id: event.id, raceId: null, capacity: event.capacity, registrationMode: "INTERNAL", registrationOpensAt: null, registrationClosesAt: null, startsAt: event.startsAt, eventStatus: event.eventStatus, publishedAt: NOW };
}

const at = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000);

/** The public form as the page posts it: every box by its name, the birth date as typed into its box. */
function posted(person: { firstName: string; lastName: string; birthDate: string; sex: "FEMALE" | "MALE" }, now: Date) {
  const form = new FormData();
  const boxes: Record<string, string> = {
    firstName: person.firstName,
    lastName: person.lastName,
    birthDate: person.birthDate,
    sex: person.sex,
    email: EMAIL,
    emailConfirm: EMAIL,
    nationality: "RO",
    country: "RO",
    city: "Brașov",
    phoneCountry: "RO",
    phone: "0711111111",
    emergencyContactName: "Vecinul de palier",
    emergencyContactPhoneCountry: "RO",
    emergencyContactPhone: "0722222222",
    fitnessDeclared: "on",
    rulesAcknowledged: "on",
    termsAccepted: "on",
    privacyAcknowledged: "on",
    preferredLocale: "ro",
    honeypot: "",
    renderedAt: new Date(now.getTime() - 30_000).toISOString(),
  };
  for (const [name, value] of Object.entries(boxes)) form.set(name, value);
  return readRegistrationForm(form, "ro", { displayName: false });
}

async function rowsOf(eventId: string) {
  return db.select().from(registrations).where(eq(registrations.eventId, eventId)).orderBy(registrations.createdAt);
}

async function outbox(type?: string) {
  const rows = await db.select().from(emailOutbox).orderBy(emailOutbox.createdAt);
  return type ? rows.filter((row) => row.messageType === type) : rows;
}

/** Every message that answered «you are registered already» (§235) — the one the owner received. */
async function alreadyRegisteredAnswers() {
  return (await outbox()).filter((row) => (row.payloadJson as { alreadyRegistered?: unknown }).alreadyRegistered === true);
}

async function render(row: Awaited<ReturnType<typeof outbox>>[number], now: Date) {
  return renderOutboxMessage({ ...row, status: "PROCESSING", attemptCount: 1, lockedAt: now }, db, now);
}

/** The first runner, confirmed with a number, as on QA: the address, the declaration, the signature. */
async function confirmedFirst(event: EventInput, person: Parameters<typeof posted>[0]) {
  await submitRegistration(db, event, posted(person, NOW), NOW);
  const [first] = await rowsOf(event.id);
  await confirmEmail(db, event, first.id, at(1));
  const document = await findCurrentApprovedDocument(db, "EVENT_DECLARATION", "ro", at(2));
  await signDeclaration(db, event, first.id, { accepted: true, typedName: `${person.firstName} ${person.lastName}`, idDocument: "BV 123456", documentId: document!.id, contentSha256: document!.contentSha256 }, at(2));
  const [confirmed] = await rowsOf(event.id);
  expect(confirmed.status).toBe("CONFIRMED");
  expect(confirmed.bibNumber).not.toBeNull();
  return confirmed;
}

/** The link of the latest «Înscrii încă o persoană?» message, pressed: the second person's registration. */
async function pressLatestOffer(now: Date) {
  const offer = (await outbox("REGISTER_ANOTHER_PERSON")).at(-1)!;
  const message = await render(offer, now);
  const secret = /\/inregistrari\/familie\/([A-Za-z0-9_-]+)/.exec(message.text)?.[1];
  if (!secret) throw new Error("the email carried no confirmation");
  return confirmFamilyEntry(db, secret, { fitnessAcknowledged: true }, now);
}

const FIRST = { firstName: "Andrei", lastName: "Munteanu", birthDate: "15.06.1984", sex: "MALE" } as const;

describe("§NNN a second person on the same address, from the public form", () => {
  it("reads the birth date typed day first as the day it is, and refuses one it cannot read, naming the box (§47, §561)", async () => {
    expect(posted(FIRST, NOW).birthDate).toBe("1984-06-15");
    expect(posted({ ...FIRST, birthDate: "15061984" }, NOW).birthDate).toBe("1984-06-15");
    const event = await createEvent();
    // An unreadable day is never "no date" and never the same day as anybody's: the form is refused, the box named.
    const refused = await submitRegistration(db, event, posted({ ...FIRST, birthDate: "15.06.84" }, NOW), NOW).then(
      () => null,
      (error: { fields?: string[] }) => error.fields ?? [],
    );
    expect(refused).toContain("birthDate");
    expect(await rowsOf(event.id)).toHaveLength(0);
  });

  it.each([
    ["a three-word name", { firstName: "Andrei duplicat", lastName: "Munteanu" }],
    ["another first and last name", { firstName: "Ion", lastName: "Popescu" }],
  ])("%s, another birth date and the other sex: the second person is registered, never «deja înscris»", async (_, name) => {
    const event = await createEvent();
    const first = await confirmedFirst(event, FIRST);

    await submitRegistration(db, event, posted({ ...name, birthDate: "21.09.1987", sex: "FEMALE" }, at(5)), at(5));

    // Nothing answered as the first runner, and the posted person is kept for the address to confirm (§446).
    expect(await alreadyRegisteredAnswers()).toHaveLength(0);
    const [entry] = await db.select().from(pendingFamilyEntries);
    expect(entry.fields).toMatchObject({ ...name, birthDate: "1987-09-21", sex: "FEMALE" });
    expect(await outbox("REGISTER_ANOTHER_PERSON")).toHaveLength(1);

    // The address confirms: the second person is registered under the same participant.
    expect(await pressLatestOffer(at(7))).toMatchObject({ ok: true });
    const rows = await rowsOf(event.id);
    expect(rows.map((row) => row.registeredName)).toEqual(["Andrei Munteanu", `${name.firstName} ${name.lastName}`]);
    expect(rows[1]).toMatchObject({ participantId: first.participantId, birthDate: "1987-09-21", sex: "FEMALE" });
    expect(rows[1].nameKey).not.toBe(rows[0].nameKey);

    // «Înscrierile mele» lists both.
    const mine = await listActiveRegistrationsForParticipant(db, first.participantId, "ro", at(8));
    expect(mine.map((item) => item.registeredName).sort()).toEqual(["Andrei Munteanu", `${name.firstName} ${name.lastName}`].sort());
  });

  it("the QA shape: another name and the other sex on a registered runner's birth date is another person, not a slip", async () => {
    const event = await createEvent();
    const first = await confirmedFirst(event, FIRST);

    // The first runner's own day — as a browser's `bday` autofill puts the device owner's in the box.
    await submitRegistration(db, event, posted({ firstName: "Andrei duplicat", lastName: "Munteanu", birthDate: FIRST.birthDate, sex: "FEMALE" }, at(5)), at(5));

    expect(await alreadyRegisteredAnswers()).toHaveLength(0);
    const [offer] = await outbox("REGISTER_ANOTHER_PERSON");
    const text = (await render(offer, at(6))).text;
    expect(text).toContain("Persoana din formular: Andrei duplicat Munteanu");
    expect(text).toContain("Data nașterii: 15 iunie 1984");
    expect(text).not.toContain("geamăn");
    expect(await pressLatestOffer(at(7))).toMatchObject({ ok: true });
    const rows = await rowsOf(event.id);
    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatchObject({ participantId: first.participantId, registeredName: "Andrei duplicat Munteanu", birthDate: first.birthDate, sex: "FEMALE" });
  });

  it("true twins — another name, the same birth date, the same sex — still hear how twins are registered (§493)", async () => {
    const event = await createEvent();
    const first = await confirmedFirst(event, FIRST);

    await submitRegistration(db, event, posted({ firstName: "Mihai", lastName: "Munteanu", birthDate: FIRST.birthDate, sex: "MALE" }, at(5)), at(5));

    expect(await rowsOf(event.id)).toHaveLength(1);
    expect(await db.select().from(pendingFamilyEntries)).toHaveLength(0);
    const [answer] = await alreadyRegisteredAnswers();
    expect(answer).toMatchObject({ messageType: "REGISTRATION_CONFIRMED", registrationId: first.id });
    expect(answer.payloadJson).toEqual({ alreadyRegistered: true, anotherPersonHint: true, sameBirthDateHint: true });
    const message = await render(answer, at(6));
    expect(message.text).toContain("Pentru un frate geamăn sau o soră geamănă, trimite formularul de pe altă adresă de email");
  });

  it("the same runner again, whatever sex is ticked, is the silent re-send: a slip in one box never registers anybody", async () => {
    const event = await createEvent();
    const first = await confirmedFirst(event, FIRST);

    await submitRegistration(db, event, posted({ ...FIRST, firstName: "ANDREI", sex: "FEMALE" }, at(5)), at(5));

    expect(await rowsOf(event.id)).toHaveLength(1);
    expect(await outbox("REGISTER_ANOTHER_PERSON")).toHaveLength(0);
    const [answer] = await alreadyRegisteredAnswers();
    expect(answer).toMatchObject({ registrationId: first.id });
    expect(answer.payloadJson).toEqual({ alreadyRegistered: true });
  });
});

describe("§NNN the same rule in a family sitting (§519, §543)", () => {
  const PUBLIC = { source: "PUBLIC" as const, createdByStaffUserId: null };
  const WINDOW_MS = 10 * 60_000;

  /** The first form and «Da, încă o persoană» at the same minute, as the action presses it (§536). */
  async function start(event: EventInput) {
    const result = await submitRegistration(db, event, posted(FIRST, at(0)), at(0), "REAL", { ...PUBLIC, sitting: { id: null, joined: false } });
    const pressed = await continueFamilySittingAndReserve(
      db,
      { sittingId: null, seed: result.sittingSeed ?? null, eventId: event.id, locale: "ro" },
      new Date(at(0).getTime() + WINDOW_MS),
      at(0),
      { firstWindowEnd: new Date(at(0).getTime() + WINDOW_MS) },
    );
    return pressed.sittingId;
  }

  async function send(event: EventInput, sittingId: string | null, person: Parameters<typeof posted>[0], minute: number) {
    const result = await submitRegistration(db, event, posted(person, at(minute)), at(minute), "REAL", { ...PUBLIC, sitting: { id: sittingId, joined: true, newPerson: true } });
    return result.sittingId ?? null;
  }

  const names = async (eventId: string) => (await rowsOf(eventId)).map((row) => [row.registeredName, row.sex]);

  it("another name and the other sex on the first person's birth date is the sitting's next registration", async () => {
    const event = await createEvent();
    const sittingId = await start(event);
    await send(event, sittingId, { firstName: "Andreea", lastName: "Munteanu", birthDate: FIRST.birthDate, sex: "FEMALE" }, 2);
    expect(await names(event.id)).toEqual([
      ["Andrei Munteanu", "MALE"],
      ["Andreea Munteanu", "FEMALE"],
    ]);
    expect(await alreadyRegisteredAnswers()).toHaveLength(0);
  });

  it("another name and the same sex on it is still not added (§493)", async () => {
    const event = await createEvent();
    const sittingId = await start(event);
    await send(event, sittingId, { firstName: "Mihai", lastName: "Munteanu", birthDate: FIRST.birthDate, sex: "MALE" }, 2);
    expect(await names(event.id)).toEqual([["Andrei Munteanu", "MALE"]]);
  });
});
