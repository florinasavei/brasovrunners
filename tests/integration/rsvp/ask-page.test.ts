import { type ComponentProps, createElement, type ReactElement } from "react";
import { renderToReadableStream } from "react-dom/server";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { emailOutbox } from "@/db/schema/email-outbox";
import { eventRsvps, eventRsvpTokens } from "@/db/schema/event-rsvps";
import { eventTranslations, events } from "@/db/schema/events";
import { newsletterSubscribers } from "@/db/schema/newsletter";
import { personSessions } from "@/db/schema/person-sessions";
import { computeContentHash, type LegalDocumentTranslationInput } from "@/modules/legal-documents/domain/content-hash";
import { insertLegalDocumentVersion } from "@/modules/legal-documents/repository";
import { privacyNoticeEn, privacyNoticeRo } from "@/modules/legal-documents/templates/privacy-notice";
import { PERSON_COOKIE } from "@/modules/person-session/domain/hint";
import { renderOutboxMessage } from "@/modules/notifications/render";
import { canonicalizeEmail } from "@/modules/participants/domain/canonical-email";
import { prepareRsvpAsk } from "@/modules/rsvp/ask";
import { identityOf } from "@/modules/rsvp/domain/identity";
import { answerRsvp } from "@/modules/rsvp/rsvp";
import { withdrawnProof } from "@/modules/rsvp/withdrawn-proof";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

const state = vi.hoisted(() => ({
  db: undefined as unknown,
  jar: new Map<string, string>(),
  redirected: [] as string[],
  language: "ro" as "ro" | "en",
}));
const messages = { ro, en };

vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  redirect: (url: string) => {
    state.redirected.push(url);
    throw new Error("NEXT_REDIRECT");
  },
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (state.jar.has(name) ? { name, value: state.jar.get(name)! } : undefined),
    set: (name: string, value: string) => void state.jar.set(name, value),
    delete: (name: string) => void state.jar.delete(name),
  }),
  headers: async () => new Headers(),
}));
vi.mock("@/db/client", () => ({ getDb: () => state.db }));
vi.mock("next-intl/server", async () => {
  const { createTranslator } = await import("next-intl");
  return {
    getTranslations: async (namespace: string | { namespace: string }) =>
      createTranslator({ locale: state.language, messages: messages[state.language] as never, namespace: (typeof namespace === "string" ? namespace : namespace.namespace) as never }),
    getLocale: async () => state.language,
    setRequestLocale: () => {},
  };
});
vi.mock("@/i18n/navigation", async (importOriginal) => {
  const { createElement: h } = await import("react");
  const actual = await importOriginal<typeof import("@/i18n/navigation")>();
  return {
    ...actual,
    Link: ({ href, children }: { href: unknown; children: unknown }) => {
      const target = actual.getPathname({ locale: state.language, href: href as never });
      return h("a", { href: target }, children as string);
    },
  };
});
vi.mock("@/modules/public-cache/cache", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/modules/public-cache/cache")>()),
  revalidatePublicContent: () => {},
}));

const { default: RsvpLinkPage } = await import("@/app/[locale]/vin/[token]/page");
const { confirmRsvpAction, withdrawRsvpAction } = await import("@/app/[locale]/vin/[token]/actions");

const NOW = new Date();
const HOUR = 60 * 60_000;
const DAY = 24 * HOUR;

/**
 * §NNN (amends §812) — the page the «Vii mâine la …?» email's two buttons open: the same token page as «Vin!»'s, for a row the
 * email made. «Vin» is ONE press with an optional name and the tick under it; «Nu vin» is ONE press that counts nobody and says so.
 * The GET changes nothing (BR-REQ-036-02 criterion 4).
 */
describe("§NNN the page of the «Vii?» email's links", () => {
  let db: TestDatabase;
  let close: () => Promise<void>;
  let eventId: string;
  let slug: string;

  beforeAll(async () => {
    ({ db, close } = await createTestDatabase());
    state.db = db;
  });
  afterAll(async () => close());
  beforeEach(async () => {
    await resetTables(db);
    state.jar.clear();
    state.redirected.length = 0;
    state.language = "ro";
    const translations: LegalDocumentTranslationInput[] = [
      { locale: "ro", title: "Confidențialitate", body: privacyNoticeRo },
      { locale: "en", title: "Privacy", body: privacyNoticeEn },
    ];
    await insertLegalDocumentVersion(db, { key: "PRIVACY_NOTICE", version: 1, effectiveAt: new Date(NOW.getTime() - 400 * DAY), isApproved: true, contentSha256: computeContentHash(translations), translations, now: NOW });
    const [event] = await db
      .insert(events)
      .values({ type: "GROUP_RUN", startsAt: new Date(NOW.getTime() + 2 * DAY), registrationMode: "NONE", rsvpEnabled: true, editorialStatus: "PUBLISHED", publishedAt: new Date(NOW.getTime() - DAY) })
      .returning();
    eventId = event.id;
    slug = `alergare-${event.id.slice(0, 8)}`;
    await db.insert(eventTranslations).values([
      { eventId, locale: "ro", slug, title: "Alergarea de joi" },
      { eventId, locale: "en", slug: `run-${event.id.slice(0, 8)}`, title: "Thursday run" },
    ]);
  });

  async function html(element: ReactElement): Promise<string> {
    const { NextIntlClientProvider } = await import("next-intl");
    const stream = await renderToReadableStream(createElement(NextIntlClientProvider, { locale: state.language, messages: messages[state.language] } as unknown as ComponentProps<typeof NextIntlClientProvider>, element));
    await stream.allReady;
    return (await new Response(stream).text()).replace(/<style[^>]*>[\s\S]*?<\/style>/g, "").replace(/<script[^>]*>[\s\S]*?<\/script>/g, "");
  }
  const page = async (token: string, query: { invalid?: string; retras?: string; ok?: string; nu?: string } = {}, locale: "ro" | "en" = "ro") => {
    state.language = locale;
    return html(await RsvpLinkPage({ params: Promise.resolve({ locale, token }), searchParams: Promise.resolve(query) }));
  };

  /** A confirmed subscriber, asked: the two secrets as the email carries them. */
  async function asked(email = "ana@example.test", locale: "ro" | "en" = "ro") {
    const who = canonicalizeEmail(email);
    const [subscriber] = await db
      .insert(newsletterSubscribers)
      .values({ deliveryEmail: who.deliveryEmail, canonicalEmail: who.canonicalEmail, canonicalizationVersion: who.canonicalizationVersion, locale, topics: ["RSVP_ASK"], privacyNoticeVersion: 1, confirmedAt: NOW })
      .returning();
    const prepared = await prepareRsvpAsk(db, { eventId, subscriberId: subscriber.id, recipientEmail: email, now: NOW });
    return { confirm: prepared.confirm, withdraw: prepared.withdraw };
  }
  const form = (token: string, locale: "ro" | "en" = "ro", extra: Record<string, string> = {}) => {
    const data = new FormData();
    data.set("locale", locale);
    data.set("token", token);
    for (const [key, value] of Object.entries(extra)) data.set(key, value);
    return data;
  };
  const press = async (action: (form: FormData) => Promise<void>, data: FormData) => {
    await action(data).catch((error: unknown) => {
      if (!(error instanceof Error) || error.message !== "NEXT_REDIRECT") throw error;
    });
    return state.redirected.at(-1);
  };

  it("asks «Vii la <event>?» and draws ONE button — with an optional name and the tick under «Vin» — and changes nothing on a GET", async () => {
    const { confirm } = await asked();
    const rowsBefore = await db.select().from(eventRsvps);
    const tokensBefore = await db.select().from(eventRsvpTokens);
    for (let i = 0; i < 3; i += 1) {
      const markup = await page(confirm);
      expect(markup).toContain("Vii la Alergarea de joi? O apăsare și te numărăm.");
      expect(markup).toMatch(/<h1[^>]*>Vii\?<\/h1>/);
      expect(markup.match(/<button/g)).toHaveLength(1);
      expect(markup).toContain("Da, vin");
      // The event page card's own box and tick, optional.
      expect(markup).toContain('name="name"');
      expect(markup).toContain("Numele tău (opțional)");
      expect(markup).toContain('name="showName"');
      expect(markup).toContain("Vreau să apar cu numele");
      expect(markup).not.toContain("required");
    }
    expect(await db.select().from(eventRsvps)).toEqual(rowsBefore);
    expect(await db.select().from(eventRsvpTokens)).toEqual(tokensBefore);
    expect(await db.select().from(personSessions)).toHaveLength(0);
  });

  it("counts the subscriber at once on one press with no name — nobody is made up — and lands on the event page", async () => {
    const { confirm } = await asked();
    const target = await press(confirmRsvpAction, form(confirm));
    expect(target).toBe(`/ro/evenimente/${slug}#vin`);
    const [row] = await db.select().from(eventRsvps);
    expect(row).toMatchObject({ displayName: null, showName: false });
    expect(row.confirmedAt).not.toBeNull();
    // The browser is remembered, so the next event is one tap.
    expect(state.jar.get(PERSON_COOKIE)).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(await db.select().from(personSessions)).toHaveLength(1);
  });

  it("takes the name and the tick typed under the button in the same press", async () => {
    const { confirm } = await asked();
    await press(confirmRsvpAction, form(confirm, "ro", { name: "Ana Pop", showName: "on" }));
    const [row] = await db.select().from(eventRsvps);
    expect(row).toMatchObject({ displayName: "Ana Pop", showName: true });
    expect(row.confirmedAt).not.toBeNull();
  });

  it("does not offer the name box on a link whose answer was typed on the event's page", async () => {
    await answerRsvp(db, eventId, identityOf("page", { email: "ion@example.test", displayName: null, showName: false, locale: "ro" }), NOW);
    const [typedMessage] = await db.select().from(emailOutbox).where(eq(emailOutbox.recipientEmail, "ion@example.test"));
    const message = await renderOutboxMessage(typedMessage, db, NOW);
    const [confirm] = [...new Set([...message.text.matchAll(/\/vin\/([A-Za-z0-9_-]{43})/g)].map((match) => match[1]))];
    const markup = await page(confirm);
    expect(markup).toContain("Confirmi că vii la Alergarea de joi?");
    expect(markup).not.toContain('name="name"');
    expect(markup).not.toContain("Vii la Alergarea de joi? O apăsare");
  });

  it("draws «Nu vin» for the other link — one button, nothing deleted on a GET — and counts nobody on the press", async () => {
    const { withdraw } = await asked();
    const markup = await page(withdraw);
    expect(markup).toMatch(/<h1[^>]*>Nu vii\?<\/h1>/);
    expect(markup).toContain("Nu vii la Alergarea de joi? Apasă butonul și nu te numărăm.");
    expect(markup.match(/<button/g)).toHaveLength(1);
    expect(markup).toContain("Nu vin");
    expect(markup).not.toContain("Nu mai vin");
    expect(await db.select().from(eventRsvps)).toHaveLength(1);

    const target = await press(withdrawRsvpAction, form(withdraw, "ro", { asked: "1" }));
    expect(target).toBe(`/ro/vin/${withdraw}?retras=${slug}&ok=${withdrawnProof(withdraw, slug)}&nu=1`);
    expect(await db.select().from(eventRsvps)).toHaveLength(0);

    const done = await page(withdraw, { retras: slug, ok: withdrawnProof(withdraw, slug), nu: "1" });
    expect(done).toContain("Bine, nu te numărăm. Poți răspunde altfel până la start.");
    expect(done).toContain(`href="/ro/evenimente/${slug}"`);
    expect(done).not.toContain("ți-am șters răspunsul");
  });

  it("says «Nu mai vin» as before on the link of an answer that is already counted", async () => {
    const { confirm, withdraw } = await asked();
    await press(confirmRsvpAction, form(confirm));
    const markup = await page(withdraw);
    expect(markup).toContain("Nu mai vii la Alergarea de joi? Răspunsul tău se șterge.");
    expect(markup).toContain("Nu mai vin");
  });

  it("says the same in English, on the /coming/ page", async () => {
    const { confirm, withdraw } = await asked("ion@example.test", "en");
    const yes = await page(confirm, {}, "en");
    expect(yes).toContain("Are you coming to Thursday run? One press and you&#x27;re counted.");
    expect(yes).toContain("Your name (optional)");
    expect(yes).toContain("I want my name to show");
    const no = await page(withdraw, {}, "en");
    expect(no).toContain("Not coming to Thursday run? Press the button and we don&#x27;t count you.");
    expect(no).toContain("I&#x27;m not coming");
    const done = await page(withdraw, { retras: slug, ok: withdrawnProof(withdraw, slug), nu: "1" }, "en");
    expect(done).toContain("Okay, we won&#x27;t count you. You can answer differently until the start.");
  });
});
