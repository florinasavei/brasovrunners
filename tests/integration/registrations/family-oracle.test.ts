import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { emailOutbox } from "@/db/schema/email-outbox";
import { events, eventTranslations } from "@/db/schema/events";
import { platformSettings } from "@/db/schema/platform-settings";
import { registrations } from "@/db/schema/registrations";
import { computeContentHash, type LegalDocumentTranslationInput } from "@/modules/legal-documents/domain/content-hash";
import { insertLegalDocumentVersion } from "@/modules/legal-documents/repository";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * §389 × §39 — the public form never tells a stranger whether an address is registered, now that a
 * second name on a registered address is answered by email (AGENTS.md §19.4; BR-REQ-031-01
 * criterion 3).
 *
 * The same submission — one address, one name — is posted to the real form action against three
 * states of the address: nobody registered on it (a registration is created), one registration
 * (the email for another person is queued), and the address at the club's limit (the email that
 * says so is queued). What the browser receives — the redirect and every cookie, opened — must be
 * byte for byte the same. Only the outbox, which only the address's owner reads, may differ.
 */
const EMAIL = "familia.pop@example.ro";
const SLUG = "crosul-familiei";

let db: TestDatabase;
let close: () => Promise<void>;

type SetCookie = { name: string; value: string; options: Record<string, unknown> };
const jar: SetCookie[] = [];

vi.mock("@/db/client", () => ({ getDb: () => db }));
vi.mock("next/cache", async () => (await import("../../helpers/next-cache")).fakeNextCache.module);
vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({
    get: () => undefined,
    set: (name: string, value: string, options: Record<string, unknown> = {}) => {
      jar.push({ name, value, options });
    },
  }),
}));
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  redirect: (url: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { redirectTo: url });
  },
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));
// No Cloudflare in a test: the hidden field and the timing check stand, as they do without keys.
vi.mock("@/modules/registrations/bot-check", () => ({ botCheckIsOn: async () => false, honeypotIsOn: async () => true }));

const { submitRegistrationAction } = await import("@/app/[locale]/events/[slug]/register/actions");
const { openFormDraft } = await import("@/modules/registrations/form-draft");
const { ADDRESS_CAP_SETTING_KEY } = await import("@/modules/registrations/address-cap");

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
  // The contract release (§389): migration 0073 already drops the constraint on a fresh database,
  // so every branch below is the new one. `IF EXISTS` keeps this working the day this file is run
  // before 0073 lands, too.
  await db.execute(sql`ALTER TABLE registrations DROP CONSTRAINT IF EXISTS registrations_event_participant_unique`);
});
afterAll(async () => close());
beforeEach(async () => {
  await resetTables(db);
  jar.length = 0;
  const privacy: LegalDocumentTranslationInput[] = [
    { locale: "ro", title: "Confidențialitate", body: { sections: [{ paragraphs: ["p"] }] } },
    { locale: "en", title: "Privacy", body: { sections: [{ paragraphs: ["p"] }] } },
  ];
  await insertLegalDocumentVersion(db, { key: "PRIVACY_NOTICE", version: 1, effectiveAt: new Date("2026-01-01T00:00:00Z"), isApproved: true, contentSha256: computeContentHash(privacy), translations: privacy, now: new Date() });
  await insertLegalDocumentVersion(db, { key: "TERMS", version: 1, effectiveAt: new Date("2026-01-01T00:00:00Z"), isApproved: true, contentSha256: computeContentHash(privacy), translations: privacy, now: new Date() });
  // The club's limit at two, so "at the limit" is two registrations on the address.
  await db.insert(platformSettings).values({ key: ADDRESS_CAP_SETTING_KEY, value: { registrationsPerAddress: 2 }, updatedAt: new Date() });
});

async function createEvent() {
  const now = Date.now();
  const [event] = await db
    .insert(events)
    .values({ type: "RACE", startsAt: new Date(now + 30 * 86_400_000), registrationMode: "INTERNAL", capacity: 50, editorialStatus: "PUBLISHED", publishedAt: new Date(now - 86_400_000) })
    .returning();
  await db.insert(eventTranslations).values([
    { eventId: event.id, locale: "ro", title: "Crosul familiei", slug: SLUG },
    { eventId: event.id, locale: "en", title: "The family cross", slug: "family-cross" },
  ]);
  return event;
}

const BIRTH_DATES: Record<string, string> = { Ana: "1985-03-02", Ion: "1987-02-14", Maria: "1990-07-11" };

function form(firstName: string, birthDate?: string): FormData {
  const data = new FormData();
  const fields: Record<string, string> = {
    locale: "ro",
    slug: SLUG,
    firstName,
    lastName: "Pop",
    // Each person their own birth date (§NNN): a different person differs in both.
    birthDate: birthDate ?? BIRTH_DATES[firstName] ?? "1980-01-01",
    sex: "UNSPECIFIED",
    email: EMAIL,
    emailConfirm: EMAIL,
    phone: "0711111111",
    phoneCountry: "RO",
    emergencyContactName: "Ion Vecinul",
    emergencyContactPhone: "0722222222",
    emergencyContactPhoneCountry: "RO",
    fitnessDeclared: "on",
    rulesAcknowledged: "on",
    termsAccepted: "on",
    privacyAcknowledged: "on",
    honeypot: "",
    renderedAt: new Date(Date.now() - 30_000).toISOString(),
  };
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
}

/** One press of the real action: where the browser is sent, and every cookie it is given, opened. */
async function press(firstName: string, birthDate?: string): Promise<string> {
  jar.length = 0;
  let redirectTo = "";
  try {
    await submitRegistrationAction(form(firstName, birthDate));
  } catch (error) {
    redirectTo = (error as { redirectTo?: string }).redirectTo ?? `threw: ${(error as Error).message}`;
  }
  const cookies = jar.map(({ name, value, options }) => ({ name, options, value: value === "" ? "" : openFormDraft(value) }));
  return JSON.stringify({ redirectTo, cookies });
}

/** Registrations already on the address, made through the same action and the emailed confirmation (§NNN). */
async function registered(names: string[]) {
  const event = await createEvent();
  const { confirmFamilyEntry } = await import("@/modules/registrations/family-confirm");
  const { renderOutboxMessage } = await import("@/modules/notifications/render");
  for (const [index, name] of names.entries()) {
    await press(name);
    if (index === 0) continue;
    const offer = (await db.select().from(emailOutbox)).filter((row) => row.messageType === "REGISTER_ANOTHER_PERSON").at(-1)!;
    const message = await renderOutboxMessage({ ...offer, status: "PROCESSING", attemptCount: 1, lockedAt: new Date() }, db, new Date());
    const secret = /\/inregistrari\/familie\/([A-Za-z0-9_-]+)/.exec(message.text)![1];
    await confirmFamilyEntry(db, secret, { fitnessAcknowledged: true }, new Date());
  }
  jar.length = 0;
  return event;
}

describe("§389 §39 the public form answers the same whatever the address holds", () => {
  it("is byte for byte the same response for 0, 1 and the limit of registrations on the address", async () => {
    await registered([]);
    const none = await press("Maria");
    expect((await db.select().from(registrations)).map((row) => row.registeredName)).toEqual(["Maria Pop"]);

    await resetTables(db);
    await beforeEachAgain();
    await registered(["Ana"]);
    const one = await press("Maria");
    expect((await db.select().from(registrations)).map((row) => row.registeredName)).toEqual(["Ana Pop"]);

    await resetTables(db);
    await beforeEachAgain();
    await registered(["Ana", "Ion"]);
    expect(await db.select().from(registrations)).toHaveLength(2);
    const atCap = await press("Maria");
    expect(await db.select().from(registrations)).toHaveLength(2);

    expect(none).toContain('"redirectTo":"/ro/evenimente/crosul-familiei/inscriere?submitted=1"');
    // The draft cleared and the "check your inbox" facts set — the whole of what the browser keeps.
    const cookies = (JSON.parse(none) as { cookies: { value: unknown }[] }).cookies;
    expect(cookies).toHaveLength(2);
    expect(cookies[1].value).toEqual({ email: EMAIL, firstName: "Maria" });
    expect(one).toBe(none);
    expect(atCap).toBe(none);

    // …and only the inbox learns which case it was.
    const offers = (await db.select().from(emailOutbox)).filter((row) => row.messageType === "REGISTER_ANOTHER_PERSON");
    expect(offers.at(-1)!.payloadJson).toEqual({ atCap: true, registrationsPerAddress: 2 });
  });

  it("is the same response for the same runner sent again", async () => {
    await registered([]);
    const first = await press("Maria");
    const again = await press("Maria");
    expect(again).toBe(first);
    expect(await db.select().from(registrations)).toHaveLength(1);
  });

  it("is the same response for a slip — the registered name with another birth date — which registers nobody (§NNN)", async () => {
    await registered([]);
    const first = await press("Maria");
    const slip = await press("Maria", "2001-01-01");
    expect(slip).toBe(first);
    expect(await db.select().from(registrations)).toHaveLength(1);
    // Only the inbox learns it: the re-send, with the sentence on registering somebody else.
    const resent = (await db.select().from(emailOutbox)).filter((row) => row.messageType === "VERIFY_REGISTRATION_EMAIL").at(-1)!;
    expect(resent.payloadJson).toEqual({ anotherPersonHint: true });
  });
});

/** The per-test state `beforeEach` sets, for a test that resets the tables in the middle. */
async function beforeEachAgain() {
  const privacy: LegalDocumentTranslationInput[] = [
    { locale: "ro", title: "Confidențialitate", body: { sections: [{ paragraphs: ["p"] }] } },
    { locale: "en", title: "Privacy", body: { sections: [{ paragraphs: ["p"] }] } },
  ];
  await insertLegalDocumentVersion(db, { key: "PRIVACY_NOTICE", version: 1, effectiveAt: new Date("2026-01-01T00:00:00Z"), isApproved: true, contentSha256: computeContentHash(privacy), translations: privacy, now: new Date() });
  await insertLegalDocumentVersion(db, { key: "TERMS", version: 1, effectiveAt: new Date("2026-01-01T00:00:00Z"), isApproved: true, contentSha256: computeContentHash(privacy), translations: privacy, now: new Date() });
  await db.insert(platformSettings).values({ key: ADDRESS_CAP_SETTING_KEY, value: { registrationsPerAddress: 2 }, updatedAt: new Date() });
}
