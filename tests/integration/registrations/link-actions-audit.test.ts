import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { emailActionTokens } from "@/db/schema/email-action-tokens";
import { emailOutbox } from "@/db/schema/email-outbox";
import { events, eventTranslations } from "@/db/schema/events";
import { registrations } from "@/db/schema/registrations";
import { computeContentHash, type LegalDocumentTranslationInput } from "@/modules/legal-documents/domain/content-hash";
import { findCurrentApprovedDocument, insertLegalDocumentVersion } from "@/modules/legal-documents/repository";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * The registration audit (§NNN), at the three server actions a participant presses — each on the
 * real clock, as the actions read it, with Next's redirect caught where the browser would follow it:
 *
 * - the confirmation link of a registration that had already lapsed says "lapsed", never
 *   "confirmed, now sign" (BR-REQ-031-03 criterion 2, §217);
 * - a live declaration link on a registration that has moved on returns to its page, which says
 *   where the registration stands, rather than ending on the error page (AGENTS.md §14.3);
 * - a verified runner restarting a cancelled registration behind the public form is held until
 *   the participation window's deadline, as at every other door (§104).
 */
const SLUG = "crosul-auditului";
const DAY = 86_400_000;

let db: TestDatabase;
let close: () => Promise<void>;

vi.mock("@/db/client", () => ({ getDb: () => db }));
vi.mock("next/cache", async () => (await import("../../helpers/next-cache")).fakeNextCache.module);
vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }),
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
// The words of a kind of identity document: none is posted here, so the catalogue is never read.
vi.mock("next-intl/server", () => ({ getTranslations: async () => (key: string) => key }));
vi.mock("@/modules/registrations/bot-check", () => ({ botCheckIsOn: async () => false, honeypotIsOn: async () => true }));

const { submitRegistrationAction } = await import("@/app/[locale]/events/[slug]/register/actions");
const { confirmEmailAction } = await import("@/app/[locale]/registrations/confirm/[token]/actions");
const { signDeclarationAction } = await import("@/app/[locale]/registrations/declare/[token]/actions");
const { confirmEmail, unregister } = await import("@/modules/registrations/service");
const { renderOutboxMessage } = await import("@/modules/notifications/render");
const { publicFormEvent } = await import("@/modules/registrations/public-form-event");

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
});
afterAll(async () => close());
beforeEach(async () => {
  await resetTables(db);
  for (const key of ["PRIVACY_NOTICE", "EVENT_DECLARATION"] as const) {
    const translations: LegalDocumentTranslationInput[] = [
      { locale: "ro", title: key, body: { sections: [{ paragraphs: ["p"] }] } },
      { locale: "en", title: key, body: { sections: [{ paragraphs: ["p"] }] } },
    ];
    await insertLegalDocumentVersion(db, {
      key,
      version: 1,
      effectiveAt: new Date("2026-01-01T00:00:00Z"),
      isApproved: true,
      contentSha256: computeContentHash(translations),
      translations,
      now: new Date(),
    });
  }
});

/** A published race `daysAway` from now, with the column defaults' participation window (7 / 2 days). */
async function createEvent(daysAway: number) {
  const [event] = await db
    .insert(events)
    .values({
      type: "RACE",
      startsAt: new Date(Date.now() + daysAway * DAY),
      registrationMode: "INTERNAL",
      capacity: 50,
      editorialStatus: "PUBLISHED",
      publishedAt: new Date(Date.now() - DAY),
    })
    .returning();
  await db.insert(eventTranslations).values([
    { eventId: event.id, locale: "ro", title: "Crosul auditului", slug: SLUG },
    { eventId: event.id, locale: "en", title: "The audit cross", slug: "audit-cross" },
  ]);
  return event;
}

function registrationForm(firstName: string, email: string): FormData {
  const data = new FormData();
  const fields: Record<string, string> = {
    locale: "ro",
    slug: SLUG,
    firstName,
    lastName: "Pop",
    birthDate: "1985-03-02",
    sex: "UNSPECIFIED",
    email,
    emailConfirm: email,
    phone: "0711111111",
    phoneCountry: "RO",
    emergencyContactName: "Ion Vecinul",
    emergencyContactPhone: "0722222222",
    emergencyContactPhoneCountry: "RO",
    fitnessDeclared: "on",
    rulesAcknowledged: "on",
    privacyAcknowledged: "on",
    honeypot: "",
    renderedAt: new Date(Date.now() - 30_000).toISOString(),
  };
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
}

/** Press a server action; return where the browser is sent. */
async function press(action: (form: FormData) => Promise<void>, form: FormData): Promise<string> {
  try {
    await action(form);
  } catch (error) {
    const to = (error as { redirectTo?: string }).redirectTo;
    if (to !== undefined) return to;
    throw error;
  }
  throw new Error("the action returned without redirecting");
}

async function onlyRegistration() {
  const [row] = await db.select().from(registrations);
  return row;
}

async function secretOf(messageType: string): Promise<string> {
  const row = (await db.select().from(emailOutbox).orderBy(emailOutbox.createdAt)).filter((candidate) => candidate.messageType === messageType).at(-1)!;
  const now = new Date();
  const message = await renderOutboxMessage({ ...row, status: "PROCESSING", attemptCount: 1, lockedAt: now }, db, now);
  const match = /[/=]([A-Za-z0-9_-]{43})(?![A-Za-z0-9_-])/.exec(message.text);
  if (!match) throw new Error(`no action link in the ${messageType} message`);
  return match[1];
}

describe("§NNN BR-REQ-031-03 criterion 2 the confirmation page of a lapsed registration", () => {
  it("says the registration lapsed, not 'confirmed, now sign'", async () => {
    await createEvent(30);
    expect(await press(submitRegistrationAction, registrationForm("Ana", "ana@example.ro"))).toContain("submitted=1");
    const row = await onlyRegistration();
    // A row written before §377's column, submitted two days and an hour ago: its link lapsed at 48 hours.
    await db
      .update(registrations)
      .set({ emailLinkExpiresAt: null, submittedAt: new Date(Date.now() - 49 * 3_600_000) })
      .where(eq(registrations.id, row.id));
    // The message rendered late, so its token is still good: only the registration's own clock can refuse.
    const token = await secretOf("VERIFY_REGISTRATION_EMAIL");

    const form = new FormData();
    form.set("locale", "ro");
    form.set("token", token);
    const to = await press(confirmEmailAction, form);
    expect(to).toContain(token);
    expect(to).toMatch(/\?invalid=1$/);
    expect((await onlyRegistration()).status).toBe("EXPIRED");
    expect((await db.select().from(emailOutbox)).map((message) => message.messageType)).not.toContain("COMPLETE_DECLARATION");
  });
});

describe("§NNN AGENTS.md §14.3 a live declaration link on a registration that has moved on", () => {
  it("returns to its page with nothing spent, instead of ending on the error page", async () => {
    const event = await createEvent(30);
    await press(submitRegistrationAction, registrationForm("Ana", "ana@example.ro"));
    const row = await onlyRegistration();
    const eventInput = publicFormEvent(event, event.publishedAt);
    await confirmEmail(db, eventInput, row.id, new Date());
    const token = await secretOf("COMPLETE_DECLARATION");
    // Cancelled from "Înscrierile mele": nothing invalidates the declaration's link on the way.
    await unregister(db, eventInput, row.id, "PARTICIPANT", new Date());

    const document = await findCurrentApprovedDocument(db, "EVENT_DECLARATION", "ro", new Date());
    const form = new FormData();
    form.set("locale", "ro");
    form.set("token", token);
    form.set("accepted", "on");
    form.set("typedName", "Ana Pop");
    form.set("documentId", document!.id);
    form.set("contentSha256", document!.contentSha256);
    const to = await press(signDeclarationAction, form);
    expect(to).toMatch(new RegExp(`/${token}$`));

    const [spent] = await db.select().from(emailActionTokens).where(eq(emailActionTokens.purpose, "COMPLETE_DECLARATION"));
    expect(spent.usedAt).toBeNull();
    expect((await onlyRegistration()).status).toBe("CANCELLED");
  });
});

describe("§NNN §104 the public form's restart holds the place until the participation window's deadline", () => {
  it("a verified runner registering again weeks before the race is held until two days before, not thirty minutes", async () => {
    const event = await createEvent(57);
    await press(submitRegistrationAction, registrationForm("Ana", "ana@example.ro"));
    const row = await onlyRegistration();
    const eventInput = publicFormEvent(event, event.publishedAt);
    await confirmEmail(db, eventInput, row.id, new Date());
    const deadline = new Date(event.startsAt.getTime() - 2 * DAY);
    expect((await onlyRegistration()).holdExpiresAt).toEqual(deadline);
    await unregister(db, eventInput, row.id, "PARTICIPANT", new Date());

    // The same runner, on the public form again: the address is verified, so the place is allocated at once.
    expect(await press(submitRegistrationAction, registrationForm("Ana", "ana@example.ro"))).toContain("submitted=1");
    const restarted = await onlyRegistration();
    expect(restarted.status).toBe("PENDING_DECLARATION");
    expect(restarted.holdExpiresAt).toEqual(deadline);
  });
});
