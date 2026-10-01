import { eq } from "drizzle-orm";
import { NextIntlClientProvider } from "next-intl";
import { createElement, type ComponentProps, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { events, eventTranslations } from "@/db/schema/events";
import { participants } from "@/db/schema/participants";
import { registrations } from "@/db/schema/registrations";
import { computeContentHash, type LegalDocumentTranslationInput } from "@/modules/legal-documents/domain/content-hash";
import { insertLegalDocumentVersion } from "@/modules/legal-documents/repository";
import { canonicalizeEmail } from "@/modules/participants/domain/canonical-email";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";

/**
 * §NNN, BR-REQ-033-02 — a press with the declaration's acceptance box unticked is refused at the
 * box: the action sends the browser to `?invalid=accept#accepted` before the service is called
 * (the box is MUI's hidden native input, whose own bubble does not show on a phone), and the page
 * it lands on says it twice, in either language — one summary line linking to the box and a helper
 * text under it, `aria-invalid` and `aria-describedby` on the input — and no longer shows the
 * generic «pressFailed» sentence. Nothing is recorded and the link is not spent.
 */
const DAY = 86_400_000;

let db: TestDatabase;
let close: () => Promise<void>;
let language: "ro" | "en" = "ro";

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
const { default: DeclarePage } = await import("@/app/[locale]/registrations/declare/[token]/page");

let secret: string;
let registrationId: string;

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
});
afterAll(async () => close());
beforeEach(async () => {
  language = "ro";
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
  const identity = canonicalizeEmail("ana@example.ro");
  const [participant] = await db
    .insert(participants)
    .values({
      deliveryEmail: identity.deliveryEmail,
      normalizedEmail: identity.normalizedEmail,
      canonicalEmail: identity.canonicalEmail,
      canonicalizationVersion: identity.canonicalizationVersion,
      defaultName: "Ana Pop",
    })
    .returning();
  const [event] = await db
    .insert(events)
    .values({ type: "RACE", startsAt: new Date(Date.now() + 30 * DAY), registrationMode: "INTERNAL", capacity: 20, editorialStatus: "PUBLISHED", publishedAt: new Date() })
    .returning();
  await db.insert(eventTranslations).values([
    { eventId: event.id, locale: "ro", title: "Crosul Tâmpei", slug: "crosul-tampei" },
    { eventId: event.id, locale: "en", title: "The Tâmpa cross", slug: "tampa-cross" },
  ]);
  const [row] = await db
    .insert(registrations)
    .values({
      eventId: event.id,
      participantId: participant.id,
      status: "PENDING_DECLARATION",
      locale: "ro",
      registeredName: "Ana Pop",
      displayName: "Ana P.",
      privacyNoticeVersion: 1,
      privacyAcknowledgedAt: new Date(),
      resultsNameConsent: false,
      listOptOut: false,
      resultsConsentVersion: 1,
    })
    .returning();
  registrationId = row.id;
  const now = new Date();
  secret = (
    await issueActionToken(db, { participantId: participant.id, registrationId: row.id, purpose: "COMPLETE_DECLARATION", expiresAt: new Date(now.getTime() + 7 * DAY), now })
  ).secret;
});

function formOf(locale: "ro" | "en", ticked: boolean): FormData {
  const form = new FormData();
  form.set("locale", locale);
  form.set("token", secret);
  form.set("typedName", "Ana Pop");
  form.set("documentId", "00000000-0000-0000-0000-000000000000");
  form.set("contentSha256", "x");
  if (ticked) form.set("accepted", "on");
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

async function pageAfter(locale: "ro" | "en", invalid: string): Promise<string> {
  language = locale;
  const page = (await DeclarePage({ params: Promise.resolve({ locale, token: secret }), searchParams: Promise.resolve({ invalid }) })) as ReactElement;
  // The client islands (the signature box) read the catalogue the way the layout provides it.
  return renderToStaticMarkup(createElement(NextIntlClientProvider, { locale, messages: locale === "ro" ? ro : en } as unknown as ComponentProps<typeof NextIntlClientProvider>, page));
}

describe("§NNN the declaration's acceptance box, unticked", () => {
  it("is refused at the box before the service is called, and nothing is spent", async () => {
    for (const locale of ["ro", "en"] as const) {
      const to = await redirectOf(signDeclarationAction(formOf(locale, false)));
      expect(to).toMatch(/\?invalid=accept#accepted$/);
    }
    const [row] = await db.select().from(registrations).where(eq(registrations.id, registrationId));
    expect(row.status).toBe("PENDING_DECLARATION");
  });

  for (const [locale, catalogue] of [
    ["ro", ro],
    ["en", en],
  ] as const) {
    it(`${locale}: the page says it in the summary and under the box, and not with the generic sentence`, async () => {
      const declare = catalogue.Registrations.declare;
      const html = await pageAfter(locale, "accept");
      // The summary: one line, a link to the box.
      expect(html).toContain('data-testid="unticked-box-summary"');
      expect(html).toContain('href="#accepted"');
      expect(html).toContain(declare.acceptSummary);
      // Under the box: the helper text, named by the input and the input marked invalid.
      const helper = /<p[^>]*id="([^"]+)"[^>]*data-testid="checkbox-error"[^>]*>([^<]*)<\/p>/.exec(html) ?? /<p[^>]*data-testid="checkbox-error"[^>]*id="([^"]+)"[^>]*>([^<]*)<\/p>/.exec(html);
      expect(helper).not.toBeNull();
      expect(helper![2]).toBe(declare.acceptInline);
      const input = /<input[^>]*name="accepted"[^>]*>/.exec(html)![0];
      expect(input).toContain('id="accepted"');
      expect(input).toContain('aria-invalid="true"');
      expect(input).toContain(`aria-describedby="${helper![1]}"`);
      expect(input).toContain("required");
      expect(html).not.toContain(declare.pressFailed);
    });
  }

  it("a plain page, and every other refusal, carries no summary and no helper text", async () => {
    const html = await pageAfter("ro", "name");
    expect(html).not.toContain('data-testid="unticked-box-summary"');
    expect(html).not.toContain('data-testid="checkbox-error"');
    expect(html).not.toContain('aria-invalid="true"');
  });

  it("the generic sentence stays for a refusal that is not the box", async () => {
    const html = await pageAfter("ro", "1");
    expect(html).toContain(ro.Registrations.declare.pressFailed);
    expect(html).not.toContain('data-testid="unticked-box-summary"');
  });
});
