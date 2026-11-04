import { and, eq } from "drizzle-orm";
import { NextIntlClientProvider } from "next-intl";
import { createElement, type ComponentProps, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { declarationAcceptances } from "@/db/schema/declaration-acceptances";
import { emailActionTokens } from "@/db/schema/email-action-tokens";
import { emailOutbox } from "@/db/schema/email-outbox";
import { events, eventTranslations } from "@/db/schema/events";
import { participants } from "@/db/schema/participants";
import { type Registration, registrations } from "@/db/schema/registrations";
import { staffUsers } from "@/db/schema/staff-users";
import { computeContentHash, type LegalDocumentTranslationInput } from "@/modules/legal-documents/domain/content-hash";
import { findCurrentApprovedDocument, insertLegalDocumentVersion } from "@/modules/legal-documents/repository";
import { canonicalizeEmail } from "@/modules/participants/domain/canonical-email";
import { registrationNameKey } from "@/modules/registrations/domain/name-key";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";
import { TYPED_ANSWERS } from "../../helpers/missing-answers";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";

/**
 * BR-REQ-037-05 criteria 23–27, BR-REQ-033-02 (§905; the owner, 2026-11-03: «am avut un bug când am trimis oferta
 * că oamenii nu aveau unde să își completeze datele lor, nume, data nașterii, etc.»).
 *
 * A registration a staff member entered with a name and an address — or a line of the internal list moved onto
 * the official one — owes the answers the public form requires. The person completes them from their own link:
 * on the declaration's page, above the signature and saved with it in one transaction, the signature refused
 * while one is missing (on the server, whatever the page drew) and every typed value kept after a refusal; and on
 * the manage page after a confirmation, the declaration untouched. Both writes are the person's own, audited with
 * no staff actor and no value. The backoffice marks such a row «Date lipsă» until it is complete; a registration
 * the public form wrote sees none of it anywhere.
 *
 * The actions and pages on the real clock, with Next's redirect caught where the browser would follow it and a
 * cookie jar that keeps what the actions seal.
 */
const DAY = 86_400_000;

let db: TestDatabase;
let close: () => Promise<void>;
let language: "ro" | "en" = "ro";
const jar = vi.hoisted(() => new Map<string, string>());

vi.mock("@/db/client", () => ({ getDb: () => db }));
vi.mock("next/cache", async () => (await import("../../helpers/next-cache")).fakeNextCache.module);
vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name) } : undefined),
    set: (name: string, value: string, options?: { maxAge?: number }) => {
      if (options?.maxAge === 0 || value === "") jar.delete(name);
      else jar.set(name, value);
    },
    delete: (name: string) => jar.delete(name),
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
vi.mock("next-intl/server", async (importOriginal) => {
  const { createTranslator } = await import("next-intl");
  const catalogues = { ro: (await import("../../../messages/ro.json")).default, en: (await import("../../../messages/en.json")).default };
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    getTranslations: async (arg: string | { locale?: string; namespace: string }) => {
      const namespace = typeof arg === "string" ? arg : arg.namespace;
      const locale = (typeof arg === "string" ? language : (arg.locale ?? language)) as "ro" | "en";
      return createTranslator({ locale, messages: catalogues[locale], namespace: namespace as "Registrations" });
    },
    getLocale: async () => language,
    setRequestLocale: () => {},
  };
});
vi.mock("@/i18n/navigation", async (importOriginal) => {
  const { createElement } = await import("react");
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    Link: ({ href, children }: { href: unknown; children: ReactNode }) => createElement("a", { href: typeof href === "string" ? href : "#" }, children),
  };
});
// Two async Server Components that read the request (the toast cookie, the journey's strip); neither is under test.
vi.mock("@/shared/feedback/PublicFlash", () => ({ default: () => null }));
vi.mock("@/modules/registrations/ui/RegistrationJourney", () => ({ default: () => null }));

const { issueActionToken } = await import("@/modules/action-tokens/repository");
const { signDeclarationAction } = await import("@/app/[locale]/registrations/declare/[token]/actions");
const { completeAnswersFromManageAction } = await import("@/app/[locale]/registrations/manage/[token]/actions");
const { default: DeclarePage } = await import("@/app/[locale]/registrations/declare/[token]/page");
const { default: ManageRegistrationPage } = await import("@/app/[locale]/registrations/manage/[token]/page");
const { consumeAndSignDeclaration } = await import("@/modules/registrations/token-actions");
const { findRegistrationDetailForAdmin, listRegistrationsForAdmin } = await import("@/modules/registrations/admin-repository");
const { missingAnswersHeld, ANSWERS_MISSING } = await import("@/modules/registrations/missing-answers");
const { enqueueEmail, processOutboxBatch } = await import("@/modules/notifications/outbox");
const { createOutboxRenderer } = await import("@/modules/notifications/render");
const { addReserveEntry, moveReserveEntryToWaitlist } = await import("@/modules/registrations/reserve-list");

let eventId: string;
let participantId: string;

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
});
afterAll(async () => close());
beforeEach(async () => {
  language = "ro";
  jar.clear();
  await resetTables(db);
  for (const key of ["PRIVACY_NOTICE", "TERMS", "EVENT_DECLARATION"] as const) {
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
  const identity = canonicalizeEmail("mara@example.ro");
  const [participant] = await db
    .insert(participants)
    .values({
      deliveryEmail: identity.deliveryEmail,
      normalizedEmail: identity.normalizedEmail,
      canonicalEmail: identity.canonicalEmail,
      canonicalizationVersion: identity.canonicalizationVersion,
      defaultName: "Mara Munteanu",
    })
    .returning();
  participantId = participant.id;
  const [event] = await db
    .insert(events)
    .values({ type: "RACE", startsAt: new Date(Date.now() + 30 * DAY), registrationMode: "INTERNAL", capacity: 20, editorialStatus: "PUBLISHED", publishedAt: new Date() })
    .returning();
  eventId = event.id;
  await db.insert(eventTranslations).values([
    { eventId: event.id, locale: "ro", title: "Crosul Tâmpei", slug: "crosul-tampei" },
    { eventId: event.id, locale: "en", title: "The Tâmpa cross", slug: "tampa-cross" },
  ]);
});

/** What the public form writes: every answer it requires. */
const PUBLIC_ANSWERS = {
  source: "PUBLIC" as const,
  firstName: "Mara",
  lastName: "Munteanu",
  birthDate: "1990-05-11",
  sex: "FEMALE" as const,
  nationality: "RO",
  country: "RO",
  city: "Sibiu",
  phone: "+40712345678",
  emergencyContactName: "Ion Pop",
  emergencyContactPhone: "+40722345678",
  tshirtSize: "NONE" as const,
};

/** A registration at `status`: a staff entry's name and address (`answers` empty), or the public form's answers. */
async function registration(
  status: Registration["status"],
  answers: Partial<Omit<typeof PUBLIC_ANSWERS, "source">> & { source?: Registration["source"] } = { source: "STAFF", firstName: "Mara", lastName: "Munteanu" },
): Promise<Registration> {
  const [row] = await db
    .insert(registrations)
    .values({
      eventId,
      participantId,
      status,
      locale: "ro",
      registeredName: "Mara Munteanu",
      displayName: "Mara M.",
      privacyNoticeVersion: 1,
      privacyAcknowledgedAt: new Date(),
      resultsNameConsent: false,
      listOptOut: true,
      resultsConsentVersion: 1,
      tshirtSize: "NONE",
      holdExpiresAt: status === "PENDING_DECLARATION" ? new Date(Date.now() + 2 * DAY) : null,
      confirmedAt: status === "CONFIRMED" ? new Date() : null,
      checkinCode: status === "CONFIRMED" ? `C${Math.random().toString(36).slice(2, 9).toUpperCase()}` : null,
      ...answers,
    })
    .returning();
  return row;
}

async function link(registrationId: string, purpose: "COMPLETE_DECLARATION" | "MANAGE_REGISTRATION"): Promise<string> {
  const now = new Date();
  return (await issueActionToken(db, { participantId, registrationId, purpose, expiresAt: new Date(now.getTime() + 7 * DAY), now })).secret;
}

/** The declaration's form as the page posts it: the tick, the signature, the text's id and hash — and, when drawn, the answers. */
async function declarationForm(secret: string, answers: Record<string, string> | null): Promise<FormData> {
  const document = await findCurrentApprovedDocument(db, "EVENT_DECLARATION", "ro", new Date());
  const form = new FormData();
  form.set("locale", "ro");
  form.set("token", secret);
  form.set("accepted", "on");
  form.set("typedName", "Mara Munteanu");
  form.set("documentId", document?.id ?? "");
  form.set("contentSha256", document?.contentSha256 ?? "");
  if (answers) {
    form.set("answersAsked", "1");
    for (const [name, value] of Object.entries(answers)) form.set(name, value);
  }
  return form;
}

/** The boxes as a person types them: the telephones as country and digits, the birth date day first. */
const TYPED_BOXES: Record<string, string> = {
  birthDate: "11.05.1990",
  sex: TYPED_ANSWERS.sex,
  nationality: TYPED_ANSWERS.nationality,
  city: TYPED_ANSWERS.city,
  phoneCountry: "RO",
  phone: "0712345678",
  emergencyContactName: TYPED_ANSWERS.emergencyContactName,
  emergencyContactPhoneCountry: "RO",
  emergencyContactPhone: "0722345678",
};

async function redirectOf(press: Promise<void>): Promise<string> {
  try {
    await press;
  } catch (error) {
    const to = (error as { redirectTo?: string }).redirectTo;
    if (to) return to;
    throw error;
  }
  throw new Error("the action did not redirect");
}

async function failureOf(work: Promise<unknown>): Promise<{ code?: string; fields?: readonly string[] }> {
  try {
    await work;
  } catch (error) {
    return error as { code?: string; fields?: readonly string[] };
  }
  throw new Error("expected a refusal");
}

/** One input of a drawn page, by the name it posts. */
function inputOf(html: string, name: string): string {
  return new RegExp(`<input[^>]*name="${name}"[^>]*>`).exec(html)?.[0] ?? "";
}

function drawn(page: ReactElement, locale: "ro" | "en" = "ro"): string {
  return renderToStaticMarkup(createElement(NextIntlClientProvider, { locale, messages: locale === "ro" ? ro : en } as unknown as ComponentProps<typeof NextIntlClientProvider>, page));
}

async function declarePage(secret: string, query: Record<string, string> = {}, locale: "ro" | "en" = "ro"): Promise<string> {
  language = locale;
  return drawn((await DeclarePage({ params: Promise.resolve({ locale, token: secret }), searchParams: Promise.resolve(query) })) as ReactElement, locale);
}

async function managePage(secret: string, query: Record<string, string> = {}): Promise<string> {
  language = "ro";
  return drawn((await ManageRegistrationPage({ params: Promise.resolve({ locale: "ro", token: secret }), searchParams: Promise.resolve(query) })) as ReactElement);
}

async function rowOf(id: string): Promise<Registration> {
  const [row] = await db.select().from(registrations).where(eq(registrations.id, id));
  return row;
}

async function completions(id: string) {
  return db.select().from(auditLogs).where(and(eq(auditLogs.entityId, id), eq(auditLogs.action, "registration.answers_completed")));
}

async function linkSpent(secret: string): Promise<boolean> {
  const tokens = await db.select({ usedAt: emailActionTokens.usedAt }).from(emailActionTokens);
  return tokens.some((token) => token.usedAt !== null) && secret.length > 0;
}

describe("BR-REQ-037-05 criterion 23: the declaration's page asks the missing answers first, and signs with them", () => {
  it("draws only the missing boxes, above the signature, in both languages — with the lead line before the text", async () => {
    const row = await registration("PENDING_DECLARATION");
    const secret = await link(row.id, "COMPLETE_DECLARATION");
    for (const [locale, catalogue] of [
      ["ro", ro],
      ["en", en],
    ] as const) {
      const html = await declarePage(secret, {}, locale);
      expect(html).toContain('data-testid="complete-answers-lead"');
      expect(html).toContain('data-testid="complete-answers"');
      expect(html).toContain(catalogue.Registrations.complete.title);
      expect(html).toContain('name="answersAsked"');
      for (const box of ["birthDate", "city", "sex", "nationality", "phone", "emergencyContactName", "emergencyContactPhone"]) {
        expect(html, box).toContain(`name="${box}"`);
      }
      // The answers the row holds are never asked again (the country, on Romania)…
      expect(html).not.toContain('name="country"');
      // …but a staff row's name is drawn, prefilled with what the club typed, for the person to check (§NNN).
      expect(inputOf(html, "firstName")).toContain('value="Mara"');
      expect(inputOf(html, "lastName")).toContain('value="Munteanu"');
      expect(html).toContain(catalogue.Registrations.complete.nameCheck);
      // The boxes come before the signature.
      expect(html.indexOf('data-testid="complete-answers"')).toBeLessThan(html.indexOf('name="typedName"'));
    }
  });

  it("refuses the signature on the server while an answer is missing — whatever the page posted — and spends nothing", async () => {
    const row = await registration("PENDING_DECLARATION");
    const secret = await link(row.id, "COMPLETE_DECLARATION");
    const document = await findCurrentApprovedDocument(db, "EVENT_DECLARATION", "ro", new Date());
    const refusal = await failureOf(
      consumeAndSignDeclaration(secret, { accepted: true, typedName: "Mara Munteanu", documentId: document?.id ?? "", contentSha256: document?.contentSha256 ?? "" }, new Date()),
    );
    expect(refusal.code).toBe("VALIDATION_ERROR");
    expect(refusal.fields).toEqual(["birthDate", "city", "sex", "nationality", "phone", "emergencyContactName", "emergencyContactPhone", ANSWERS_MISSING]);
    expect((await rowOf(row.id)).status).toBe("PENDING_DECLARATION");
    expect(await linkSpent(secret)).toBe(false);
    expect(await db.select().from(declarationAcceptances)).toEqual([]);

    // The page's own press without the boxes lands on them, named.
    const to = await redirectOf(signDeclarationAction(await declarationForm(secret, null)));
    expect(to).toMatch(/\?invalid=answers&answers=birthDate%2Ccity%2Csex%2Cnationality%2Cphone%2CemergencyContactName%2CemergencyContactPhone%2CanswersMissing#complete-details$/);
  });

  it("keeps every typed value after a refusal and names the box, and nothing is saved or signed", async () => {
    const row = await registration("PENDING_DECLARATION");
    const secret = await link(row.id, "COMPLETE_DECLARATION");
    const withoutCity = Object.fromEntries(Object.entries(TYPED_BOXES).filter(([name]) => name !== "city"));
    const to = await redirectOf(signDeclarationAction(await declarationForm(secret, withoutCity)));
    expect(to).toMatch(/\?invalid=answers&answers=city%2CanswersMissing#complete-details$/);
    expect(await rowOf(row.id)).toMatchObject({ status: "PENDING_DECLARATION", birthDate: null, phone: null });
    expect(await completions(row.id)).toEqual([]);
    expect(await linkSpent(secret)).toBe(false);

    const html = await declarePage(secret, { invalid: "answers", answers: "city,answersMissing" });
    expect(html).toContain('data-testid="complete-answers-refused"');
    expect(html).toContain(ro.Registrations.complete.refusedNothingSigned);
    expect(html).toContain('href="#f-city"');
    // What was typed comes back from the sealed draft: the emergency contact's name, the birth date, the signature.
    expect(html).toContain(`value="${TYPED_ANSWERS.emergencyContactName}"`);
    expect(html).toContain('value="11.05.1990"');
    expect(html).toContain('value="Mara Munteanu"');
    const city = /<input[^>]*name="city"[^>]*>/.exec(html)?.[0] ?? "";
    expect(city).toContain('aria-invalid="true"');
    // Never the generic sentence of a press that failed elsewhere.
    expect(html).not.toContain(ro.Registrations.declare.pressFailed);
  });

  it("saves the answers and signs in one press: confirmed, the answers the person's own, audited with no staff actor and no value", async () => {
    const row = await registration("PENDING_DECLARATION");
    const secret = await link(row.id, "COMPLETE_DECLARATION");
    const to = await redirectOf(signDeclarationAction(await declarationForm(secret, TYPED_BOXES)));
    expect(to).toMatch(/\?done=confirmed/);
    const signed = await rowOf(row.id);
    expect(signed).toMatchObject({
      status: "CONFIRMED",
      birthDate: TYPED_ANSWERS.birthDate,
      sex: TYPED_ANSWERS.sex,
      nationality: TYPED_ANSWERS.nationality,
      city: TYPED_ANSWERS.city,
      phone: TYPED_ANSWERS.phone,
      emergencyContactName: TYPED_ANSWERS.emergencyContactName,
      emergencyContactPhone: TYPED_ANSWERS.emergencyContactPhone,
    });
    const [trail] = await completions(row.id);
    expect(trail.actorStaffUserId).toBeNull();
    expect(trail.metadataJson).toEqual({ fields: ["birthDate", "sex", "nationality", "city", "phone", "emergencyContactName", "emergencyContactPhone"], via: "DECLARATION" });
    expect(JSON.stringify(trail.metadataJson)).not.toContain(TYPED_ANSWERS.phone);
    expect(await db.select().from(declarationAcceptances).where(eq(declarationAcceptances.registrationId, row.id))).toHaveLength(1);
  });

  it("a minor's birth date asks the parent or guardian at the same press (§108)", async () => {
    const row = await registration("PENDING_DECLARATION");
    const secret = await link(row.id, "COMPLETE_DECLARATION");
    const minor = { ...TYPED_BOXES, birthDate: "01.03.2010" };
    expect(await redirectOf(signDeclarationAction(await declarationForm(secret, minor)))).toMatch(/\?invalid=answers&answers=guardianName#complete-details$/);
    // The guardian signs a minor's declaration (§108): with the name, the press goes through under the guardian's signature.
    const form = await declarationForm(secret, { ...minor, guardianName: "Ion Munteanu" });
    form.set("typedName", "Ion Munteanu");
    expect(await redirectOf(signDeclarationAction(form))).toMatch(/\?done=confirmed/);
    expect(await rowOf(row.id)).toMatchObject({ status: "CONFIRMED", birthDate: "2010-03-01", guardianName: "Ion Munteanu" });
  });

  it("while the birth date is asked, the signature names nobody to match yet and says whose name it takes in either case", async () => {
    // A public row written before the birth date was asked: its name is the one it was registered under.
    const row = await registration("PENDING_DECLARATION", PUBLIC_ANSWERS);
    await db.update(registrations).set({ birthDate: null }).where(eq(registrations.id, row.id));
    const secret = await link(row.id, "COMPLETE_DECLARATION");
    for (const [locale, catalogue] of [
      ["ro", ro],
      ["en", en],
    ] as const) {
      const html = await declarePage(secret, {}, locale);
      // Under the box, both cases: the registered name, and a minor's parent or guardian typed above.
      expect(html).toContain(catalogue.Registrations.complete.signatureOpen.replace("{name}", "Mara Munteanu"));
      // Not «Mara must sign personally»: the birth date typed above may yet make her a minor, whose parent signs.
      expect(html).not.toContain(catalogue.Registrations.declare.signPersonally.replace("{participant}", "Mara Munteanu"));
    }
  });

  it("a staff row's name is checked above (§NNN): the open signature points at the name typed there, naming none", async () => {
    const row = await registration("PENDING_DECLARATION");
    const secret = await link(row.id, "COMPLETE_DECLARATION");
    for (const [locale, catalogue] of [
      ["ro", ro],
      ["en", en],
    ] as const) {
      const html = await declarePage(secret, {}, locale);
      expect(html).toContain(catalogue.Registrations.complete.signatureOpenName);
      expect(html).not.toContain(catalogue.Registrations.complete.signatureOpen.replace("{name}", "Mara Munteanu"));
      expect(html).not.toContain(catalogue.Registrations.declare.signPersonally.replace("{participant}", "Mara Munteanu"));
    }
  });

  it("a parent who signs with the minor's name is refused, and the page then asks the guardian typed above, named — the next press signs", async () => {
    const row = await registration("PENDING_DECLARATION");
    const secret = await link(row.id, "COMPLETE_DECLARATION");
    const minor = { ...TYPED_BOXES, birthDate: "01.03.2010", guardianName: "Ion Munteanu" };
    // The child's name as the signature: the answers make a minor, whose declarant is the guardian (§108).
    expect(await redirectOf(signDeclarationAction(await declarationForm(secret, minor)))).toMatch(/\?invalid=name#/);
    expect(await rowOf(row.id)).toMatchObject({ status: "PENDING_DECLARATION", birthDate: null, guardianName: null });
    expect(await completions(row.id)).toEqual([]);
    expect(await linkSpent(secret)).toBe(false);

    const html = await declarePage(secret, { invalid: "name" });
    // The box now wants the guardian's name, in bold, and the summary says where that name is corrected — above, not by cancelling.
    expect(html).toContain("<strong>Ion Munteanu</strong>");
    expect(html).toContain(ro.Registrations.complete.guardianTypedAbove);
    expect(html).not.toContain(ro.Registrations.complete.signatureOpen.replace("{name}", "Mara Munteanu"));
    // Every answer comes back, the guardian with them.
    expect(html).toContain('value="Ion Munteanu"');
    expect(html).toContain('value="01.03.2010"');

    const form = await declarationForm(secret, minor);
    form.set("typedName", "Ion Munteanu");
    expect(await redirectOf(signDeclarationAction(form))).toMatch(/\?done=confirmed/);
    expect(await rowOf(row.id)).toMatchObject({ status: "CONFIRMED", birthDate: "2010-03-01", guardianName: "Ion Munteanu" });
  });

});

describe("BR-REQ-037-05 criterion 26: the emails that open the signature say the details are asked there", () => {
  it("the offer of a freed place says it in the email, and the request to sign of a complete registration does not", async () => {
    const owing = await registration("WAITLIST_OFFERED");
    await db.update(registrations).set({ holdExpiresAt: new Date(Date.now() + DAY), offerCreatedAt: new Date() }).where(eq(registrations.id, owing.id));
    const sent: { text: string }[] = [];
    const sender = {
      async send(message: { text: string }) {
        sent.push(message);
        return { outcome: "sent" as const, providerMessageId: `id-${sent.length}` };
      },
    };
    const now = new Date();
    await db.transaction((tx) =>
      enqueueEmail(tx, { participantId, registrationId: owing.id, messageType: "WAITLIST_SPOT_OFFER", locale: "ro", recipientEmail: "mara@example.ro", payload: {}, idempotencyKey: `offer:${owing.id}`, now, drainAfter: false }),
    );
    await processOutboxBatch(db, { sender: sender as never, render: createOutboxRenderer(), now });
    expect(sent.map((message) => message.text).join("\n")).toContain("îți completezi mai întâi datele care lipsesc");

    await db.update(registrations).set({ ...PUBLIC_ANSWERS, status: "PENDING_DECLARATION" }).where(eq(registrations.id, owing.id));
    await db.delete(emailOutbox);
    sent.length = 0;
    await db.transaction((tx) =>
      enqueueEmail(tx, { participantId, registrationId: owing.id, messageType: "COMPLETE_DECLARATION", locale: "ro", recipientEmail: "mara@example.ro", payload: {}, idempotencyKey: `declare:${owing.id}`, now, drainAfter: false }),
    );
    await processOutboxBatch(db, { sender: sender as never, render: createOutboxRenderer(), now });
    expect(sent).toHaveLength(1);
    expect(sent[0].text).not.toContain("îți completezi mai întâi datele care lipsesc");
  });
});

describe("BR-REQ-037-05 criterion 24: the manage page completes a confirmed registration's answers", () => {
  it("draws a card with only the missing boxes and saves them through the form's rules, as the person's own", async () => {
    const row = await registration("CONFIRMED");
    // Confirmed on paper at the desk (§67): the declaration is signed, and stays as it was.
    const document = await findCurrentApprovedDocument(db, "EVENT_DECLARATION", "ro", new Date());
    const [desk] = await db.insert(staffUsers).values({ email: "desk@example.ro", displayName: "Desk", role: "MEMBER" }).returning();
    await db.insert(declarationAcceptances).values({
      registrationId: row.id,
      legalDocumentId: document?.id ?? "",
      declarationVersion: 1,
      contentSha256: document?.contentSha256 ?? "",
      locale: "ro",
      typedName: "Mara Munteanu",
      method: "PAPER",
      attestedByStaffUserId: desk.id,
      acceptedAt: new Date(),
    });
    const secret = await link(row.id, "MANAGE_REGISTRATION");

    const before = await managePage(secret);
    expect(before).toContain('data-testid="manage-complete-answers"');
    expect(before).toContain(ro.Registrations.complete.save);
    expect(before).not.toContain('name="firstName"');

    // Refused: an emergency contact who is the person — the box named, the rule's own sentence, what was typed kept.
    const refusedForm = new FormData();
    for (const [name, value] of Object.entries({ ...TYPED_BOXES, emergencyContactPhone: "0712345678", locale: "ro", token: secret, registrationId: row.id })) refusedForm.set(name, value);
    const refused = await redirectOf(completeAnswersFromManageAction(refusedForm));
    expect(refused).toMatch(/\?answers=0&answersRefused=emergencyContactPhone%2CemergencySame&person=.+#answers$/);
    expect(await completions(row.id)).toEqual([]);
    const again = await managePage(secret, { answers: "0", answersRefused: "emergencyContactPhone,emergencySame", person: row.id });
    expect(again).toContain('data-testid="complete-answers-refused"');
    expect(again).toContain(ro.Registration.errors.emergencySame);
    expect(again).toContain(`value="${TYPED_ANSWERS.city}"`);

    const form = new FormData();
    for (const [name, value] of Object.entries({ ...TYPED_BOXES, locale: "ro", token: secret, registrationId: row.id })) form.set(name, value);
    expect(await redirectOf(completeAnswersFromManageAction(form))).toMatch(/\?answers=1&person=.+#answers$/);

    expect(await rowOf(row.id)).toMatchObject({ status: "CONFIRMED", city: TYPED_ANSWERS.city, phone: TYPED_ANSWERS.phone, emergencyContactPhone: TYPED_ANSWERS.emergencyContactPhone });
    const [trail] = await completions(row.id);
    expect(trail).toMatchObject({ actorStaffUserId: null, participantId });
    expect(trail.metadataJson).toMatchObject({ via: "MANAGE_LINK" });
    // The declaration is the one signed on paper: nothing was added or changed.
    expect(await db.select().from(declarationAcceptances).where(eq(declarationAcceptances.registrationId, row.id))).toHaveLength(1);
    // The manage link was read, never spent: the page still cancels.
    expect(await linkSpent(secret)).toBe(false);

    const after = await managePage(secret, { answers: "1", person: row.id });
    expect(after).toContain('data-testid="manage-answers-saved"');
    expect(after).not.toContain('data-testid="manage-complete-answers"');
  });

  it("refuses a link that does not manage the person named, and writes nothing", async () => {
    const row = await registration("CONFIRMED");
    const secret = await link(row.id, "MANAGE_REGISTRATION");
    const form = new FormData();
    for (const [name, value] of Object.entries({ ...TYPED_BOXES, locale: "ro", token: secret, registrationId: "00000000-0000-4000-8000-000000000000" })) form.set(name, value);
    expect(await redirectOf(completeAnswersFromManageAction(form))).toMatch(/\?invalid=1$/);
    expect(await completions(row.id)).toEqual([]);
  });
});

describe("BR-REQ-037-05 criteria 25 and 27: «Date lipsă» in the backoffice, and a complete registration sees no change anywhere", () => {
  it("marks the staff entry's row and page until the person completes it", async () => {
    const row = await registration("PENDING_DECLARATION");
    const listed = async () => (await listRegistrationsForAdmin(db, { eventId })).find((candidate) => candidate.id === row.id);
    const detail = async () => findRegistrationDetailForAdmin(db, row.id);
    const listedRow = await listed();
    const detailRow = await detail();
    expect(listedRow && missingAnswersHeld(listedRow)).toEqual(["birthDate", "city", "sex", "nationality", "phone", "emergencyContactName", "emergencyContactPhone"]);
    expect(detailRow && missingAnswersHeld(detailRow)).toEqual(["birthDate", "city", "sex", "nationality", "phone", "emergencyContactName", "emergencyContactPhone"]);
    // The lists know the telephone is missing, never what it is.
    expect(listedRow).not.toHaveProperty("phone");
    expect(detailRow).not.toHaveProperty("emergencyContactPhone");

    const secret = await link(row.id, "COMPLETE_DECLARATION");
    await redirectOf(signDeclarationAction(await declarationForm(secret, TYPED_BOXES)));
    const completedRow = await listed();
    const completedDetail = await detail();
    expect(completedRow && missingAnswersHeld(completedRow)).toEqual([]);
    expect(completedDetail && missingAnswersHeld(completedDetail)).toEqual([]);
  });

  it("a registration the public form wrote: no lead, no boxes, no card, no chip — and it signs as it always did", async () => {
    const row = await registration("PENDING_DECLARATION", PUBLIC_ANSWERS);
    const secret = await link(row.id, "COMPLETE_DECLARATION");
    const html = await declarePage(secret);
    expect(html).not.toContain('data-testid="complete-answers');
    expect(html).not.toContain('name="answersAsked"');
    // The signature as it always was: the person's own name to match, and the line that they sign personally.
    expect(html).not.toContain(ro.Registrations.complete.signatureOpen.replace("{name}", "Mara Munteanu"));
    expect(html).toContain(ro.Registrations.declare.signPersonally.replace("{participant}", "Mara Munteanu"));
    const listedRow = (await listRegistrationsForAdmin(db, { eventId })).find((candidate) => candidate.id === row.id);
    expect(listedRow && missingAnswersHeld(listedRow)).toEqual([]);

    expect(await redirectOf(signDeclarationAction(await declarationForm(secret, null)))).toMatch(/\?done=confirmed/);
    expect(await completions(row.id)).toEqual([]);
    const manage = await managePage(await link(row.id, "MANAGE_REGISTRATION"));
    expect(manage).not.toContain('data-testid="manage-complete-answers"');
    expect(manage).not.toContain('data-testid="complete-answers');
  });
});

/**
 * §NNN (BR-REQ-037-05; the owner, 2026-11-04, of the people he offers places to: «… își pot completa toate datele gen
 * nume complet, DOB, oraș») — the name the club typed is the person's to check before they sign: a
 * staff row not yet signed draws it on the declaration's and the offer's page in the form's own two name boxes,
 * prefilled, and the one press saves it corrected with the answers and signs with it.
 */
describe("BR-REQ-037-05: the name the club typed, checked and corrected by the person before signing", () => {
  /** What the page posts for «Sebi Sebi» once the person corrected the name and typed the answers the line never had. */
  const SEBASTIAN = { ...TYPED_BOXES, firstName: "Sebastian", lastName: "Popescu" };

  /** The words inside a message's `<link>`: what a drawn lead shows of it in one piece. */
  const linkWords = (message: string) => /<link>(.*?)<\/link>/.exec(message)?.[1] ?? message;

  /**
   * «Sebi Sebi», a line of the internal list with an address and nothing else, offered a place on a full race with
   * «Oferă-i un loc acum» (§888): a staff row owing every answer — and the offer's own link.
   */
  async function sebiOffered(): Promise<{ row: Registration; secret: string }> {
    const [admin] = await db.insert(staffUsers).values({ email: "admin@example.ro", displayName: "Admin", role: "ADMIN" }).returning();
    await db.update(events).set({ capacity: 1 }).where(eq(events.id, eventId));
    await registration("CONFIRMED", PUBLIC_ANSWERS);
    const now = new Date();
    const line = await addReserveEntry(db, admin, eventId, { firstName: "Sebi", lastName: "Sebi", email: "sebi@example.ro", note: null }, now);
    const moved = await moveReserveEntryToWaitlist(db, admin, line.id, { email: null, relayedByParticipantRequest: true, locale: "ro", offerNow: { addPlaceTo: 2 } }, now);
    const row = await rowOf(moved.registrationId);
    const secret = (await issueActionToken(db, { participantId: row.participantId, registrationId: row.id, purpose: "WAITLIST_OFFER", expiresAt: new Date(now.getTime() + 2 * DAY), now })).secret;
    return { row, secret };
  }

  async function signedWith(secret: string, answers: Record<string, string>, typedName: string): Promise<string> {
    const form = await declarationForm(secret, answers);
    form.set("typedName", typedName);
    return redirectOf(signDeclarationAction(form));
  }

  it("the offer's page draws the name the club typed, prefilled and first, with the answers the line never had — in both languages", async () => {
    const { row, secret } = await sebiOffered();
    expect(row).toMatchObject({ source: "STAFF", status: "WAITLIST_OFFERED", registeredName: "Sebi Sebi", displayName: "Sebi Sebi", birthDate: null, city: null });
    for (const [locale, catalogue] of [
      ["ro", ro],
      ["en", en],
    ] as const) {
      const html = await declarePage(secret, {}, locale);
      expect(html).toContain('data-testid="complete-name-check"');
      expect(html).toContain(catalogue.Registrations.complete.nameCheck);
      expect(inputOf(html, "firstName")).toContain('value="Sebi"');
      expect(inputOf(html, "lastName")).toContain('value="Sebi"');
      expect(inputOf(html, "firstName")).toContain("required");
      for (const box of ["birthDate", "city", "sex", "phone", "emergencyContactName"]) expect(html, box).toContain(`name="${box}"`);
      expect(html.indexOf('name="firstName"')).toBeLessThan(html.indexOf('name="birthDate"'));
      // The lead before the text says the name is checked there too.
      expect(html).toContain(linkWords(catalogue.Registrations.complete.declareLeadName));
      // While the birth date is asked, the signature names nobody yet and points at the name typed above.
      expect(html).toContain(catalogue.Registrations.complete.signatureOpenName);
    }
  });

  it("one press saves the corrected name with the answers and signs with it: the name of record, its key and the list's name follow; audited as the person's, by field names", async () => {
    const { row, secret } = await sebiOffered();
    expect(await signedWith(secret, SEBASTIAN, "Sebastian Popescu")).toMatch(/\?done=confirmed/);
    expect(await rowOf(row.id)).toMatchObject({
      status: "CONFIRMED",
      firstName: "Sebastian",
      lastName: "Popescu",
      registeredName: "Sebastian Popescu",
      nameKey: registrationNameKey("Sebastian Popescu"),
      displayName: "Sebastian Popescu",
      birthDate: TYPED_ANSWERS.birthDate,
      city: TYPED_ANSWERS.city,
    });
    const [acceptance] = await db.select().from(declarationAcceptances).where(eq(declarationAcceptances.registrationId, row.id));
    expect(acceptance.typedName).toBe("Sebastian Popescu");
    const [trail] = await completions(row.id);
    expect(trail).toMatchObject({ actorStaffUserId: null, participantId: row.participantId });
    expect(trail.metadataJson).toEqual({
      fields: ["firstName", "lastName", "displayName", "birthDate", "sex", "nationality", "city", "phone", "emergencyContactName", "emergencyContactPhone", "registeredName"],
      via: "DECLARATION",
    });
    expect(JSON.stringify(trail.metadataJson)).not.toMatch(/Sebastian|Popescu|Sebi/);
    // The backoffice reads the name as now stored, and a name is never «Date lipsă».
    const detail = await findRegistrationDetailForAdmin(db, row.id);
    expect(detail?.registeredName).toBe("Sebastian Popescu");
    expect(detail && missingAnswersHeld(detail)).toEqual([]);
  });

  it("signing with the club's name after correcting it is refused — nothing saved, signed or spent — and the page then wants the corrected name, kept", async () => {
    const { row, secret } = await sebiOffered();
    expect(await signedWith(secret, SEBASTIAN, "Sebi Sebi")).toMatch(/\?invalid=name#/);
    expect(await rowOf(row.id)).toMatchObject({ status: "WAITLIST_OFFERED", registeredName: "Sebi Sebi", firstName: "Sebi", birthDate: null });
    expect(await completions(row.id)).toEqual([]);
    expect(await linkSpent(secret)).toBe(false);
    expect(await db.select().from(declarationAcceptances)).toEqual([]);

    const html = await declarePage(secret, { invalid: "name" });
    expect(inputOf(html, "firstName")).toContain('value="Sebastian"');
    expect(inputOf(html, "lastName")).toContain('value="Popescu"');
    // The box wants the corrected name, in bold, and the way out is above — never «write to us, the club corrects it».
    expect(html).toContain("<strong>Sebastian Popescu</strong>");
    expect(html).toContain(ro.Registrations.complete.nameTypedAbove);
    expect(html).not.toContain("clubul îl corectează");

    expect(await signedWith(secret, SEBASTIAN, "Sebastian Popescu")).toMatch(/\?done=confirmed/);
    expect(await rowOf(row.id)).toMatchObject({ status: "CONFIRMED", registeredName: "Sebastian Popescu" });
  });

  it("a press refused for another answer keeps the name as typed", async () => {
    const { row, secret } = await sebiOffered();
    const withoutCity = Object.fromEntries(Object.entries(SEBASTIAN).filter(([name]) => name !== "city"));
    expect(await signedWith(secret, withoutCity, "Sebastian Popescu")).toMatch(/\?invalid=answers&answers=city%2CanswersMissing#complete-details$/);
    expect(await rowOf(row.id)).toMatchObject({ registeredName: "Sebi Sebi", city: null });
    const html = await declarePage(secret, { invalid: "answers", answers: "city,answersMissing" });
    expect(inputOf(html, "firstName")).toContain('value="Sebastian"');
    expect(inputOf(html, "lastName")).toContain('value="Popescu"');
  });

  it("a staff row holding every answer: the name alone — its own heading and lead, no intro; left as typed nothing is written, corrected it is", async () => {
    const row = await registration("PENDING_DECLARATION", { ...PUBLIC_ANSWERS, source: "STAFF" });
    const secret = await link(row.id, "COMPLETE_DECLARATION");
    for (const [locale, catalogue] of [
      ["ro", ro],
      ["en", en],
    ] as const) {
      const html = await declarePage(secret, {}, locale);
      expect(html).toContain(catalogue.Registrations.complete.nameTitle);
      expect(html).toContain(linkWords(catalogue.Registrations.complete.nameLead));
      expect(html).not.toContain(catalogue.Registrations.complete.intro);
      expect(html).not.toContain('name="birthDate"');
      expect(inputOf(html, "lastName")).toContain('value="Munteanu"');
    }
    // The signature box asks for the name typed above, by name.
    expect(await declarePage(secret)).toContain("<strong>Mara Munteanu</strong>");

    expect(await signedWith(secret, { firstName: "Mara", lastName: "Munteanu" }, "Mara Munteanu")).toMatch(/\?done=confirmed/);
    expect(await rowOf(row.id)).toMatchObject({ status: "CONFIRMED", registeredName: "Mara Munteanu" });
    expect(await completions(row.id)).toEqual([]);
  });

  it("the name alone, corrected: written and audited — a list name chosen apart from it stays", async () => {
    const row = await registration("PENDING_DECLARATION", { ...PUBLIC_ANSWERS, source: "STAFF" });
    const secret = await link(row.id, "COMPLETE_DECLARATION");
    expect(await signedWith(secret, { firstName: "Mara", lastName: "Munteanu-Pop" }, "Mara Munteanu-Pop")).toMatch(/\?done=confirmed/);
    expect(await rowOf(row.id)).toMatchObject({ status: "CONFIRMED", lastName: "Munteanu-Pop", registeredName: "Mara Munteanu-Pop", displayName: "Mara M." });
    const [trail] = await completions(row.id);
    expect(trail.metadataJson).toEqual({ fields: ["lastName", "registeredName"], via: "DECLARATION" });
  });

  it("a public row draws no name boxes — even beside an answer to complete — and its press never moves the name", async () => {
    const row = await registration("PENDING_DECLARATION", PUBLIC_ANSWERS);
    await db.update(registrations).set({ city: null }).where(eq(registrations.id, row.id));
    const secret = await link(row.id, "COMPLETE_DECLARATION");
    const html = await declarePage(secret);
    expect(html).toContain('name="city"');
    expect(html).not.toContain('name="firstName"');
    expect(html).not.toContain('data-testid="complete-name-check"');
    expect(await signedWith(secret, { city: "Sibiu", firstName: "Altcineva", lastName: "Altfel" }, "Mara Munteanu")).toMatch(/\?done=confirmed/);
    expect(await rowOf(row.id)).toMatchObject({ registeredName: "Mara Munteanu", firstName: "Mara", city: "Sibiu" });
  });

  it("a signed staff row: the manage page draws no name boxes, and its press never moves the name", async () => {
    const row = await registration("CONFIRMED");
    const document = await findCurrentApprovedDocument(db, "EVENT_DECLARATION", "ro", new Date());
    const [desk] = await db.insert(staffUsers).values({ email: "desk@example.ro", displayName: "Desk", role: "MEMBER" }).returning();
    await db.insert(declarationAcceptances).values({
      registrationId: row.id,
      legalDocumentId: document?.id ?? "",
      declarationVersion: 1,
      contentSha256: document?.contentSha256 ?? "",
      locale: "ro",
      typedName: "Mara Munteanu",
      method: "PAPER",
      attestedByStaffUserId: desk.id,
      acceptedAt: new Date(),
    });
    const secret = await link(row.id, "MANAGE_REGISTRATION");
    const page = await managePage(secret);
    expect(page).toContain('data-testid="manage-complete-answers"');
    expect(page).not.toContain('name="firstName"');
    expect(page).not.toContain('data-testid="complete-name-check"');

    const form = new FormData();
    for (const [name, value] of Object.entries({ ...SEBASTIAN, locale: "ro", token: secret, registrationId: row.id })) form.set(name, value);
    expect(await redirectOf(completeAnswersFromManageAction(form))).toMatch(/\?answers=1&person=.+#answers$/);
    expect(await rowOf(row.id)).toMatchObject({ registeredName: "Mara Munteanu", firstName: "Mara", city: TYPED_ANSWERS.city });
  });
});
