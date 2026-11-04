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
import { computeContentHash, type LegalDocumentTranslationInput } from "@/modules/legal-documents/domain/content-hash";
import { findCurrentApprovedDocument, insertLegalDocumentVersion } from "@/modules/legal-documents/repository";
import { canonicalizeEmail } from "@/modules/participants/domain/canonical-email";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";
import { TYPED_ANSWERS } from "../../helpers/missing-answers";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";

/**
 * «Eliberează singur locurile nesemnate la termen» (§NNN; BR-REQ-033-01, BR-REQ-033-02, BR-REQ-037-01) — what the public
 * pages promise of an unsigned place, and a signature that reaches the deadline first, on a real database.
 *
 * The signing page says the place goes at the deadline even with nobody waiting while the switch is on — never that it
 * stays theirs until the start — and, once the deadline has come and the release not yet run, that it is being released
 * rather than still theirs; a special guest's hold and the switch off keep today's words. «Înregistrările mele» and
 * «Ce îi spui» read the same rule (`releaseTakesHold`). A press that is itself the deadline's release saves nothing of
 * its own — no answer of «Completează-ți datele», no «Vreau să primesc oferte și beneficii», no signature — while the
 * release, its emails and the spent link commit, and the page then says the place is no longer held.
 *
 * The actions and pages on the real clock, with Next's redirect caught where the browser would follow it.
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
// The spent link's notice is an async Server Component: a stand-in that says which state it was given.
vi.mock("@/modules/registrations/ui/ActionLinkNotice", async () => {
  const { createElement } = await import("react");
  return { default: ({ status }: { status: { message: string } | null }) => createElement("div", { "data-testid": "link-notice" }, status?.message ?? "none") };
});

const { issueActionToken } = await import("@/modules/action-tokens/repository");
const { signDeclarationAction } = await import("@/app/[locale]/registrations/declare/[token]/actions");
const { default: DeclarePage } = await import("@/app/[locale]/registrations/declare/[token]/page");
const { listActiveRegistrationsForParticipant } = await import("@/modules/registrations/my-registrations");
const { findRegistrationDetailForAdmin } = await import("@/modules/registrations/admin-repository");
const { whatToTell } = await import("@/modules/registrations/ui/tell-words");

let participantId: string;

/** A person at their own address: two at one address and one event are a family, whose wizard the page draws instead. */
async function person(email: string): Promise<string> {
  const identity = canonicalizeEmail(email);
  const [row] = await db
    .insert(participants)
    .values({
      deliveryEmail: identity.deliveryEmail,
      normalizedEmail: identity.normalizedEmail,
      canonicalEmail: identity.canonicalEmail,
      canonicalizationVersion: identity.canonicalizationVersion,
      defaultName: "Mara Munteanu",
    })
    .returning();
  return row.id;
}

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
});
afterAll(async () => close());
beforeEach(async () => {
  language = "ro";
  jar.clear();
  await resetTables(db);
  for (const key of ["PRIVACY_NOTICE", "TERMS", "EVENT_DECLARATION"] as const) {
    // The notice describes the offers (§562), so a yes ticked while signing is kept — and its absence below means something.
    const paragraph = key === "PRIVACY_NOTICE" ? "Materiale promoționale: doar dacă bifezi {{promotionalMaterials}}." : "p";
    const translations: LegalDocumentTranslationInput[] = [
      { locale: "ro", title: key, body: { sections: [{ paragraphs: [paragraph] }] } },
      { locale: "en", title: key, body: { sections: [{ paragraphs: [paragraph] }] } },
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
  participantId = await person("mara@example.ro");
});

/**
 * A race `startsInDays` off on the real clock, asked 7 days and due 2 days before the start, the release switched on
 * unless told otherwise: its id and the window's deadline.
 */
async function race(startsInDays: number, release = true): Promise<{ id: string; deadline: Date }> {
  const startsAt = new Date(Date.now() + startsInDays * DAY);
  const [event] = await db
    .insert(events)
    .values({
      type: "RACE",
      startsAt,
      registrationMode: "INTERNAL",
      capacity: 20,
      editorialStatus: "PUBLISHED",
      publishedAt: new Date(),
      confirmationOpensDaysBefore: 7,
      confirmationDeadlineDaysBefore: 2,
      releaseUnsignedAtDeadline: release,
    })
    .returning();
  await db.insert(eventTranslations).values([
    { eventId: event.id, locale: "ro", title: "Crosul Tâmpei", slug: `crosul-tampei-${event.id.slice(0, 8)}` },
    { eventId: event.id, locale: "en", title: "The Tâmpa cross", slug: `tampa-cross-${event.id.slice(0, 8)}` },
  ]);
  return { id: event.id, deadline: new Date(startsAt.getTime() - 2 * DAY) };
}

/** A staff entry's held place (§905: a name and an address, the rest owed), due at `deadline`. */
async function held(eventId: string, deadline: Date, overrides: Partial<typeof registrations.$inferInsert> = {}): Promise<Registration> {
  const [row] = await db
    .insert(registrations)
    .values({
      eventId,
      participantId,
      status: "PENDING_DECLARATION",
      source: "STAFF",
      locale: "ro",
      firstName: "Mara",
      lastName: "Munteanu",
      registeredName: "Mara Munteanu",
      displayName: "Mara M.",
      privacyNoticeVersion: 1,
      privacyAcknowledgedAt: new Date(),
      resultsNameConsent: false,
      listOptOut: true,
      resultsConsentVersion: 1,
      tshirtSize: "NONE",
      holdExpiresAt: deadline,
      ...overrides,
    })
    .returning();
  return row;
}

async function link(registrationId: string): Promise<string> {
  const now = new Date();
  const [row] = await db.select({ participantId: registrations.participantId }).from(registrations).where(eq(registrations.id, registrationId));
  return (await issueActionToken(db, { participantId: row.participantId, registrationId, purpose: "COMPLETE_DECLARATION", expiresAt: new Date(now.getTime() + 7 * DAY), now })).secret;
}

function drawn(page: ReactElement, locale: "ro" | "en"): string {
  return renderToStaticMarkup(createElement(NextIntlClientProvider, { locale, messages: locale === "ro" ? ro : en } as unknown as ComponentProps<typeof NextIntlClientProvider>, page));
}

async function declarePage(secret: string, locale: "ro" | "en" = "ro"): Promise<string> {
  language = locale;
  return drawn((await DeclarePage({ params: Promise.resolve({ locale, token: secret }), searchParams: Promise.resolve({}) })) as ReactElement, locale);
}

/** A sentence of the catalogue up to its first placeholder: what the page prints before the instant. */
const lead = (sentence: string) => sentence.split("{")[0];
/** …and after its last one. */
const tail = (sentence: string) => sentence.slice(sentence.lastIndexOf("}") + 1);

/** The boxes as a person types them (`complete-missing-answers.test.ts`): the telephones as country and digits. */
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

/** The page's press with the answers and the offers' yes: the tick, the signature, the text's id and hash. */
async function pressWithEverything(secret: string): Promise<FormData> {
  const document = await findCurrentApprovedDocument(db, "EVENT_DECLARATION", "ro", new Date());
  const form = new FormData();
  form.set("locale", "ro");
  form.set("token", secret);
  form.set("accepted", "on");
  form.set("typedName", "Mara Munteanu");
  form.set("documentId", document?.id ?? "");
  form.set("contentSha256", document?.contentSha256 ?? "");
  form.set("promoConsent", "on");
  form.set("answersAsked", "1");
  for (const [name, value] of Object.entries(TYPED_BOXES)) form.set(name, value);
  return form;
}

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

const rowOf = async (id: string) => (await db.select().from(registrations).where(eq(registrations.id, id)))[0];
const completions = (id: string) => db.select().from(auditLogs).where(and(eq(auditLogs.entityId, id), eq(auditLogs.action, "registration.answers_completed")));
const spent = async () => (await db.select({ usedAt: emailActionTokens.usedAt }).from(emailActionTokens)).some((token) => token.usedAt !== null);

describe("BR-REQ-033-02 the signing page follows «Eliberează singur locurile nesemnate la termen» (§NNN)", () => {
  it("says the place goes at the deadline even with nobody waiting while the switch is on; today's words off it and for a special guest (ro, en)", async () => {
    const armed = await race(30);
    const off = await race(30, false);
    const releasedSecret = await link((await held(armed.id, armed.deadline)).id);
    const guestSecret = await link((await held(armed.id, armed.deadline, { outsideCapacity: true, participantId: await person("ana@example.ro") })).id);
    const offSecret = await link((await held(off.id, off.deadline)).id);
    for (const [locale, catalogue] of [
      ["ro", ro],
      ["en", en],
    ] as const) {
      const words = catalogue.Registrations.declare;
      const released = await declarePage(releasedSecret, locale);
      expect(released).toContain(tail(words.deadlineReleased));
      expect(released).not.toContain(tail(words.deadline));
      for (const kept of [await declarePage(guestSecret, locale), await declarePage(offSecret, locale)]) {
        expect(kept).toContain(tail(words.deadline));
        expect(kept).not.toContain(tail(words.deadlineReleased));
      }
    }
  });

  it("once the deadline has come and the release has not yet run, says the place is being released — never that it is still theirs (ro, en)", async () => {
    const armed = await race(1);
    const off = await race(1, false);
    const armedSecret = await link((await held(armed.id, armed.deadline)).id);
    const offSecret = await link((await held(off.id, off.deadline)).id);
    for (const [locale, catalogue] of [
      ["ro", ro],
      ["en", en],
    ] as const) {
      const words = catalogue.Registrations.declare;
      const releasing = await declarePage(armedSecret, locale);
      expect(releasing).toContain(lead(words.deadlineReleasing));
      expect(releasing).toContain(tail(words.deadlineReleasing));
      expect(releasing).not.toContain(tail(words.deadlinePassed));
      // Nobody waits and the switch is off (§160): the place is still theirs, as before.
      expect(await declarePage(offSecret, locale)).toContain(tail(words.deadlinePassed));
    }
  });
});

describe("BR-REQ-033-01 a signature that is itself the deadline's release saves nothing of its own (§NNN)", () => {
  it("no answer, no offers' yes, no signature: the release, its email and the spent link commit, and the page says the place is gone", async () => {
    // The control: the switch off, nobody waiting (§160) — the same press signs, keeps the answers and the yes.
    const off = await race(1, false);
    const kept = await held(off.id, off.deadline);
    expect(await redirectOf(signDeclarationAction(await pressWithEverything(await link(kept.id)))))
      .toMatch(/\?done=confirmed/);
    expect(await rowOf(kept.id)).toMatchObject({ status: "CONFIRMED", promoConsent: true, birthDate: TYPED_ANSWERS.birthDate, city: TYPED_ANSWERS.city });
    await db.delete(emailActionTokens);

    // The switch on: the press reaches the deadline before any job, so it is the release.
    const armed = await race(1);
    const row = await held(armed.id, armed.deadline);
    const secret = await link(row.id);
    const to = await redirectOf(signDeclarationAction(await pressWithEverything(secret)));
    expect(to).not.toContain("?");
    expect(await rowOf(row.id)).toMatchObject({ status: "EXPIRED", expiryReason: "DECLARATION_HOLD_LAPSED", promoConsent: false, birthDate: null, city: null, phone: null });
    expect(await completions(row.id)).toEqual([]);
    expect(await db.select().from(declarationAcceptances).where(eq(declarationAcceptances.registrationId, row.id))).toEqual([]);
    expect(await spent()).toBe(true);
    expect((await db.select().from(events).where(eq(events.id, armed.id)))[0].unsignedReleasedFor).toEqual(armed.deadline);
    const told = await db.select().from(emailOutbox).where(and(eq(emailOutbox.registrationId, row.id), eq(emailOutbox.messageType, "DECLARATION_HOLD_EXPIRED")));
    expect(told).toHaveLength(1);

    // The page the redirect lands on says where the registration went, in place of the form.
    const html = await declarePage(secret);
    expect(html).toContain('data-testid="link-notice"');
    expect(html).not.toContain('data-testid="link-notice">none<');
    expect(html).not.toContain('name="typedName"');
  });
});

describe("BR-REQ-037-01 «Înregistrările mele» and «Ce îi spui» say the place goes at the deadline (§NNN)", () => {
  it("reads the release off the event for a counted held place, never for a special guest's or with the switch off", async () => {
    const armed = await race(30);
    const off = await race(30, false);
    const released = await held(armed.id, armed.deadline);
    const guest = await held(armed.id, armed.deadline, { outsideCapacity: true });
    const kept = await held(off.id, off.deadline);

    const mine = new Map((await listActiveRegistrationsForParticipant(db, participantId, "ro", new Date())).map((item) => [item.id, item.releasesAtDeadline]));
    expect(Object.fromEntries([released, guest, kept].map((item) => [item.id, mine.get(item.id)]))).toEqual({ [released.id]: true, [guest.id]: false, [kept.id]: false });

    for (const [locale, catalogue] of [
      ["ro", ro],
      ["en", en],
    ] as const) {
      const words = catalogue.Registrations.mine;
      const detail = await findRegistrationDetailForAdmin(db, released.id);
      if (!detail) throw new Error("no detail");
      expect(detail.releasesAtDeadline).toBe(true);
      const lines = whatToTell(locale, detail, new Date()).join(" ");
      expect(lines).toContain(tail(words.confirmByReleased));
      expect(lines).not.toContain(tail(words.confirmBy));
      const keptDetail = await findRegistrationDetailForAdmin(db, kept.id);
      if (!keptDetail) throw new Error("no detail");
      expect(whatToTell(locale, keptDetail, new Date()).join(" ")).toContain(tail(words.confirmBy));
    }
  });
});
