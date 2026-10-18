import { type ComponentProps, createElement, type ReactElement } from "react";
import { renderToReadableStream } from "react-dom/server";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { emailOutbox } from "@/db/schema/email-outbox";
import { eventRsvps, eventRsvpTokens } from "@/db/schema/event-rsvps";
import { eventTranslations, events } from "@/db/schema/events";
import { personSessions } from "@/db/schema/person-sessions";
import { computeContentHash, type LegalDocumentTranslationInput } from "@/modules/legal-documents/domain/content-hash";
import { insertLegalDocumentVersion } from "@/modules/legal-documents/repository";
import { privacyNoticeEn, privacyNoticeRo } from "@/modules/legal-documents/templates/privacy-notice";
import { PERSON_COOKIE, PERSON_HINT_COOKIE } from "@/modules/person-session/domain/hint";
import { renderOutboxMessage } from "@/modules/notifications/render";
import { identityOf } from "@/modules/rsvp/domain/identity";
import { answerRsvp } from "@/modules/rsvp/rsvp";
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
      const target = typeof href === "string" ? actual.getPathname({ locale: state.language, href: href as never }) : actual.getPathname({ locale: state.language, href: href as never });
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
 * §NNN («Vin!» part 1) — the page a message's two buttons open, and the two buttons' actions. The GET changes nothing (BR-REQ-036-02
 * criterion 4: a link scanner opens every link before its owner); the POST spends the link once, counts or deletes, remembers the
 * browser, and lands where the person can see it.
 */
describe("§NNN the page of a «Vin!» link", () => {
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
  const page = async (token: string, query: { invalid?: string; retras?: string } = {}, locale: "ro" | "en" = "ro") => {
    state.language = locale;
    return html(await RsvpLinkPage({ params: Promise.resolve({ locale, token }), searchParams: Promise.resolve(query) }));
  };

  /** Type an address under the answer and send the message: the two links as the email carries them. */
  async function sendLinks(email = "Ana@example.test", locale: "ro" | "en" = "ro") {
    await answerRsvp(db, eventId, identityOf("page", { email, displayName: "Ana", showName: true, locale }), NOW);
    const [row] = await db.select().from(emailOutbox).where(eq(emailOutbox.recipientEmail, email));
    const message = await renderOutboxMessage(row, db, NOW);
    const found = [...new Set([...message.text.matchAll(/\/(?:vin|coming)\/([A-Za-z0-9_-]{43})/g)].map((match) => match[1]))];
    return { confirm: found[0], withdraw: found[1] };
  }
  const form = (token: string, locale: "ro" | "en" = "ro") => {
    const data = new FormData();
    data.set("locale", locale);
    data.set("token", token);
    return data;
  };
  const press = async (action: (form: FormData) => Promise<void>, data: FormData) => {
    await action(data).catch((error: unknown) => {
      if (!(error instanceof Error) || error.message !== "NEXT_REDIRECT") throw error;
    });
    return state.redirected.at(-1);
  };

  it("names the event and draws ONE button — «Da, vin» — and changes nothing, however often it is opened", async () => {
    const { confirm } = await sendLinks();
    const tokensBefore = await db.select().from(eventRsvpTokens);
    const rowBefore = await db.select().from(eventRsvps);

    for (let i = 0; i < 3; i += 1) {
      const markup = await page(confirm);
      expect(markup).toContain("Confirmi că vii la Alergarea de joi?");
      expect(markup).toContain("Da, vin");
      expect(markup).toMatch(/<form/);
      expect(markup.match(/<button/g)).toHaveLength(1);
      // The secret travels in the form's body, so the button is a POST; the page is not the action.
      expect(markup).toContain(`name="token" value="${confirm}"`);
      expect(markup).toContain("Browserul tău rămâne recunoscut un an");
    }
    expect(await db.select().from(eventRsvpTokens)).toEqual(tokensBefore);
    expect(await db.select().from(eventRsvps)).toEqual(rowBefore);
    expect((await db.select().from(eventRsvps))[0].confirmedAt).toBeNull();
    expect(await db.select().from(personSessions)).toHaveLength(0);
  });

  it("draws «Nu mai vin» for the withdraw link, and still deletes nothing on a GET", async () => {
    const { withdraw } = await sendLinks();
    const markup = await page(withdraw);
    expect(markup).toContain("Nu mai vii la Alergarea de joi?");
    expect(markup).toContain("Nu mai vin");
    expect(markup.match(/<button/g)).toHaveLength(1);
    expect(await db.select().from(eventRsvps)).toHaveLength(1);
  });

  it("says the same in English, in the language the page was asked in", async () => {
    const { confirm } = await sendLinks("ion@example.test", "en");
    const markup = await page(confirm, {}, "en");
    expect(markup).toContain("Are you coming to Thursday run?");
    expect(markup).toContain("Yes, I&#x27;m coming");
  });

  it("counts the answer on «Da, vin», remembers the browser, and lands on the event page at the box", async () => {
    const { confirm } = await sendLinks();
    const target = await press(confirmRsvpAction, form(confirm));
    expect(target).toBe(`/ro/evenimente/${slug}#vin`);
    const [row] = await db.select().from(eventRsvps);
    expect(row.confirmedAt).not.toBeNull();
    // The browser is remembered: a secret in one cookie, only a hint beside it.
    expect(state.jar.get(PERSON_COOKIE)).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(decodeURIComponent(state.jar.get(PERSON_HINT_COOKIE) ?? "")).toContain("An…@example.test");
    expect(state.jar.get(PERSON_HINT_COOKIE)).not.toContain(state.jar.get(PERSON_COOKIE)!);
    const [session] = await db.select().from(personSessions);
    expect(session).toMatchObject({ canonicalEmail: "ana@example.test", displayName: "Ana" });
  });

  it("answers a second press of the same link with one sentence and the event page, and remembers nobody new", async () => {
    const { confirm } = await sendLinks();
    await press(confirmRsvpAction, form(confirm));
    state.jar.clear();
    const again = await press(confirmRsvpAction, form(confirm));
    expect(again).toMatch(/\/ro\/vin\/[A-Za-z0-9_-]{43}\?invalid=1$/);
    expect(state.jar.has(PERSON_COOKIE)).toBe(false);
    expect(await db.select().from(personSessions)).toHaveLength(1);

    const markup = await page(confirm);
    expect(markup).toContain("Linkul nu mai merge");
    expect(markup).toContain("A fost folosit sau a expirat");
    expect(markup).toContain(`href="/ro/evenimente/${slug}"`);
    expect(markup).not.toContain("<form");
  });

  it("deletes the answer on «Nu mai vin», remembers the browser and says so by name", async () => {
    const { withdraw } = await sendLinks();
    const target = await press(withdrawRsvpAction, form(withdraw));
    expect(target).toBe(`/ro/vin/${withdraw}?retras=${slug}`);
    expect(await db.select().from(eventRsvps)).toHaveLength(0);
    expect(state.jar.has(PERSON_COOKIE)).toBe(true);

    const done = await page(withdraw, { retras: slug });
    expect(done).toContain("ți-am șters răspunsul de la Alergarea de joi");
    expect(done).toContain(`href="/ro/evenimente/${slug}"`);
    expect(await page(withdraw, { retras: "no-such-event" })).toContain("Gata, ți-am șters răspunsul.");
    // And the link, now that the answer is gone, is an unknown one.
    expect(await page(withdraw)).toContain("Linkul nu mai merge");
  });

  it("says an unknown or malformed link is not working, and points at the events", async () => {
    for (const token of ["x".repeat(43), "short"]) {
      const markup = await page(token);
      expect(markup).toContain("Linkul nu mai merge");
      expect(markup).toContain('href="/ro/evenimente"');
      expect(markup).not.toContain("<form");
    }
  });

  it("says the event is over for a link past the start, without drawing a button", async () => {
    const { confirm } = await sendLinks();
    await db.update(events).set({ startsAt: new Date(NOW.getTime() - HOUR) }).where(eq(events.id, eventId));
    const markup = await page(confirm);
    expect(markup).toContain("Evenimentul a început sau a trecut");
    expect(markup).not.toContain("<form");
    expect(await press(confirmRsvpAction, form(confirm))).toMatch(/\?invalid=1$/);
    expect((await db.select().from(eventRsvps))[0].confirmedAt).toBeNull();
  });

  it("refuses to be hammered: a link read past the hourly limit looks like any unknown one", async () => {
    const { confirm } = await sendLinks();
    for (let i = 0; i < 10; i += 1) await page(confirm);
    expect(await page(confirm)).toContain("Linkul nu mai merge");
  });
});
