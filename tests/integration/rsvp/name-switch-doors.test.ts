import { and, eq } from "drizzle-orm";
import { type ComponentProps, createElement, type ReactElement } from "react";
import { renderToReadableStream } from "react-dom/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { emailOutbox } from "@/db/schema/email-outbox";
import { eventRsvps, eventRsvpTokens } from "@/db/schema/event-rsvps";
import { eventTranslations, events } from "@/db/schema/events";
import { computeContentHash, type LegalDocumentTranslationInput } from "@/modules/legal-documents/domain/content-hash";
import { findFirstRsvpNoticeVersion, insertLegalDocumentVersion } from "@/modules/legal-documents/repository";
import { privacyNoticeEn, privacyNoticeRo } from "@/modules/legal-documents/templates/privacy-notice";
import { renderOutboxMessage } from "@/modules/notifications/render";
import { rememberPerson } from "@/modules/person-session/session";
import { identityOf } from "@/modules/rsvp/domain/identity";
import { answerRsvp, readPublicRsvps } from "@/modules/rsvp/rsvp";
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
    Link: ({ href, children }: { href: unknown; children: unknown }) => h("a", { href: actual.getPathname({ locale: state.language, href: href as never }) }, children as string),
  };
});
const revalidated = vi.hoisted(() => [] as string[][]);
vi.mock("@/modules/public-cache/cache", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/modules/public-cache/cache")>()),
  revalidatePublicContent: (...contents: string[]) => {
    revalidated.push(contents);
  },
}));

const { default: RsvpLinkPage } = await import("@/app/[locale]/vin/[token]/page");
const { setNameByLinkAction, withdrawRsvpAction } = await import("@/app/[locale]/vin/[token]/actions");
const { rsvpGoAction, rsvpShowNameAction, rsvpStateAction } = await import("@/modules/rsvp/remembered-actions");

const NOW = new Date();
const HOUR = 60 * 60_000;
const DAY = 24 * HOUR;

/**
 * §NNN (BR-REQ-039-01, BR-REQ-036-02, BR-REQ-060-01; amends §812) — the name tick's two doors that are not the zone: the remembered browser's
 * server action (who is the cookie's, the island sees booleans only) and the «Nu mai vin» link's page (a GET that draws, a POST that reads the
 * link and does not spend it). The zone's door is proved in `zone-rsvp.test.ts`, the service in `name-switch.test.ts`, the journey in `rsvp.spec.ts`.
 */
describe("§NNN the name tick's doors", () => {
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
    revalidated.length = 0;
    await approveNotice(1);
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

  async function approveNotice(version: number) {
    const translations: LegalDocumentTranslationInput[] = [
      { locale: "ro", title: "Confidențialitate", body: privacyNoticeRo },
      { locale: "en", title: "Privacy", body: privacyNoticeEn },
    ];
    await insertLegalDocumentVersion(db, {
      key: "PRIVACY_NOTICE",
      version,
      effectiveAt: new Date(NOW.getTime() - (version === 1 ? 400 * DAY : HOUR)),
      isApproved: true,
      contentSha256: computeContentHash(translations),
      translations,
      now: NOW,
    });
  }
  const publicRead = async () => readPublicRsvps(db, eventId, { firstRsvpNoticeVersion: await findFirstRsvpNoticeVersion(db) });
  const rows = () => db.select().from(eventRsvps);
  const jar = () => ({ get: (name: string) => (state.jar.has(name) ? { value: state.jar.get(name)! } : undefined), set: (name: string, value: string) => void state.jar.set(name, value), delete: (name: string) => void state.jar.delete(name) });

  describe("the remembered browser", () => {
    const remember = (email = "ana@example.test", displayName: string | null = "Ana") => rememberPerson(db, jar(), { email, displayName }, NOW);

    it("reads the cookie alone: no cookie, nothing written, and the island is told the browser is not remembered", async () => {
      await answerRsvp(db, eventId, identityOf("remembered", { email: "ana@example.test", displayName: "Ana", showName: false, locale: "ro" }), NOW);
      expect(await rsvpShowNameAction(slug, "ro", true, "Altcineva")).toEqual({ state: { remembered: false }, refused: null });
      expect(await rows()).toMatchObject([{ showName: false, displayName: "Ana" }]);
    });

    it("tells the island the tick's state — booleans only, never the name or the address — and flips it at once, in both directions", async () => {
      await remember();
      await rsvpGoAction(slug, "ro", false);
      const before = await rsvpStateAction(slug, "ro");
      expect(before).toEqual({ remembered: true, offered: true, going: true, showName: false, hasName: true, count: 1 });

      const on = await rsvpShowNameAction(slug, "ro", true, "");
      expect(on).toEqual({ state: { remembered: true, offered: true, going: true, showName: true, hasName: true, count: 1 }, refused: null });
      expect(await publicRead()).toEqual({ count: 1, names: ["Ana"], others: 0 });
      expect(revalidated.at(-1)).toEqual(["places"]);

      const off = await rsvpShowNameAction(slug, "ro", false, "");
      expect(off).toEqual({ state: { remembered: true, offered: true, going: true, showName: false, hasName: true, count: 1 }, refused: null });
      expect(await publicRead()).toEqual({ count: 1, names: [], others: 1 });
      expect(await rows()).toMatchObject([{ showName: false, displayName: "Ana" }]);
      // Nothing the island is handed holds an address or a name.
      for (const result of [before, on, off]) {
        const text = JSON.stringify(result);
        expect(text).not.toContain("example.test");
        expect(text).not.toContain("Ana");
      }
    });

    it("with no stored name, a tick without a typed one is refused with «name» and a typed one is taken", async () => {
      await remember("dan@example.test", null);
      await rsvpGoAction(slug, "ro", false);
      expect(await rsvpStateAction(slug, "ro")).toMatchObject({ going: true, showName: false, hasName: false });
      expect(await rsvpShowNameAction(slug, "ro", true, "   ")).toMatchObject({ refused: "name", state: { showName: false, hasName: false } });
      const taken = await rsvpShowNameAction(slug, "ro", true, "  Dan   P. ");
      expect(taken).toMatchObject({ refused: null, state: { going: true, showName: true, hasName: true } });
      expect(await publicRead()).toEqual({ count: 1, names: ["Dan P."], others: 0 });
    });

    it("says «none» for a remembered browser with no counted answer here, and writes nothing", async () => {
      await remember();
      expect(await rsvpShowNameAction(slug, "ro", true, "Ana")).toMatchObject({ refused: "none", state: { remembered: true, offered: true, going: false } });
      expect(await rows()).toHaveLength(0);
    });

    it("records the notice in force on a tick; an untick needs none, even when the event has stopped taking answers", async () => {
      await remember();
      await rsvpGoAction(slug, "ro", false);
      await approveNotice(2);
      await rsvpShowNameAction(slug, "ro", true, "");
      expect((await rows())[0].privacyNoticeVersion).toBe(2);
      await db.update(events).set({ rsvpEnabled: false }).where(eq(events.id, eventId));
      // The page is no longer offered: the island has nothing to draw, and an untick of the stale one still works.
      expect(await rsvpShowNameAction(slug, "ro", false, "")).toMatchObject({ refused: null, state: { remembered: true, offered: false } });
      expect((await rows())[0].showName).toBe(false);
      // …and a tick is refused: closed.
      expect(await rsvpShowNameAction(slug, "ro", true, "")).toMatchObject({ refused: "closed" });
    });
  });

  describe("the «Nu mai vin» link's page", () => {
    async function html(element: ReactElement): Promise<string> {
      const { NextIntlClientProvider } = await import("next-intl");
      const stream = await renderToReadableStream(createElement(NextIntlClientProvider, { locale: state.language, messages: messages[state.language] } as unknown as ComponentProps<typeof NextIntlClientProvider>, element));
      await stream.allReady;
      return (await new Response(stream).text()).replace(/<style[^>]*>[\s\S]*?<\/style>/g, "").replace(/<script[^>]*>[\s\S]*?<\/script>/g, "");
    }
    const page = async (token: string, query: { invalid?: string; nume?: string } = {}, locale: "ro" | "en" = "ro") => {
      state.language = locale;
      return html(await RsvpLinkPage({ params: Promise.resolve({ locale, token }), searchParams: Promise.resolve(query) }));
    };
    /** A typed answer, its email sent, and the two links as the email carries them — optionally counted by «Da, vin» first. */
    async function links(email = "ana@example.test", options: { counted?: boolean; name?: string | null; locale?: "ro" | "en" } = {}) {
      const locale = options.locale ?? "ro";
      await answerRsvp(db, eventId, identityOf("page", { email, displayName: options.name === undefined ? "Ana" : options.name, showName: false, locale }), NOW);
      const [mail] = await db.select().from(emailOutbox).where(eq(emailOutbox.recipientEmail, email));
      const message = await renderOutboxMessage(mail, db, NOW);
      const found = [...new Set([...message.text.matchAll(/\/(?:vin|coming)\/([A-Za-z0-9_-]{43})/g)].map((match) => match[1]))];
      if (options.counted !== false) await db.update(eventRsvps).set({ confirmedAt: NOW }).where(eq(eventRsvps.canonicalEmail, email));
      return { confirm: found[0], withdraw: found[1], message };
    }
    const form = (token: string, fields: Record<string, string> = {}, locale: "ro" | "en" = "ro") => {
      const data = new FormData();
      data.set("locale", locale);
      data.set("token", token);
      for (const [name, value] of Object.entries(fields)) data.set(name, value);
      return data;
    };
    const press = async (action: (form: FormData) => Promise<void>, data: FormData) => {
      await action(data).catch((error: unknown) => {
        if (!(error instanceof Error) || error.message !== "NEXT_REDIRECT") throw error;
      });
      return state.redirected.at(-1);
    };

    it("draws the tick above «Nu mai vin» for a live link of a counted answer — unticked, no name box when the answer has a name — and the GET writes nothing", async () => {
      const { withdraw } = await links();
      const tokensBefore = await db.select().from(eventRsvpTokens);
      const rowsBefore = await rows();
      const markup = await page(withdraw);
      expect(markup).toContain('data-testid="rsvp-name-switch"');
      expect(markup).toContain("Numele meu apare la „Cine vine”");
      expect(markup).toMatch(/<input[^>]*name="showName"[^>]*type="checkbox"|<input[^>]*type="checkbox"[^>]*name="showName"/);
      expect(markup).not.toMatch(/<input[^>]*name="showName"[^>]*checked|<input[^>]*checked[^>]*name="showName"/);
      expect(markup).not.toContain('name="name"');
      expect(markup).toContain("Salvează");
      // Above the withdraw button, in its own form: two forms, the tick first.
      expect(markup.indexOf('data-testid="rsvp-name-switch"')).toBeLessThan(markup.indexOf("Nu mai vin</"));
      expect(markup.match(/<form/g)).toHaveLength(2);
      // The form posts the link and the page's language, and nothing of the person's.
      expect(markup).toContain(`name="token" value="${withdraw}"`);
      expect(markup).not.toMatch(/name="(email|displayName|rsvpId|eventId)"/);
      expect(await db.select().from(eventRsvpTokens)).toEqual(tokensBefore);
      expect(await rows()).toEqual(rowsBefore);
    });

    it("draws the tick ticked once it is on, and the name box when the answer holds none — in English too", async () => {
      const { withdraw } = await links("ana@example.test", { name: null });
      const empty = await page(withdraw);
      expect(empty).toContain('name="name"');
      expect(empty).toContain("Numele tău");
      await db.update(eventRsvps).set({ displayName: "Ana", showName: true });
      const on = await page(withdraw);
      expect(on).toMatch(/<input[^>]*name="showName"[^>]*checked|<input[^>]*checked[^>]*name="showName"/);
      expect(on).not.toContain('name="name"');
      const english = await page(withdraw, {}, "en");
      expect(english).toContain("My name shows under “Who&#x27;s coming”");
      expect(english).toContain("Save");
    });

    it("draws no tick for an uncounted answer, a confirm link, a spent or unknown link", async () => {
      const waiting = await links("ion@example.test", { counted: false });
      expect(await page(waiting.withdraw)).not.toContain('data-testid="rsvp-name-switch"');
      expect(await page(waiting.confirm)).not.toContain('data-testid="rsvp-name-switch"');
      const counted = await links("ana@example.test");
      await press(withdrawRsvpAction, form(counted.withdraw));
      expect(await page(counted.withdraw)).not.toContain('data-testid="rsvp-name-switch"');
      expect(await page("x".repeat(43))).not.toContain('data-testid="rsvp-name-switch"');
    });

    it("turns the name on and off by POST WITHOUT spending the link: the same link still says «Nu mai vin» afterwards", async () => {
      const { withdraw } = await links();
      const on = await press(setNameByLinkAction, form(withdraw, { showName: "on" }));
      expect(on).toMatch(/\/ro\/vin\/[A-Za-z0-9_-]{43}\?nume=shown$/);
      expect(await publicRead()).toEqual({ count: 1, names: ["Ana"], others: 0 });
      // The page draws the new state and the sentence; the link is untouched.
      const [stored] = await db.select().from(eventRsvpTokens).where(and(eq(eventRsvpTokens.purpose, "RSVP_WITHDRAW")));
      expect(stored.usedAt).toBeNull();
      const drawn = await page(withdraw, { nume: "shown" });
      expect(drawn).toContain("Gata: numele tău apare la „Cine vine”.");
      expect(drawn).toMatch(/<input[^>]*name="showName"[^>]*checked|<input[^>]*checked[^>]*name="showName"/);

      const off = await press(setNameByLinkAction, form(withdraw));
      expect(off).toMatch(/\?nume=hidden$/);
      expect(await publicRead()).toEqual({ count: 1, names: [], others: 1 });
      expect(await page(withdraw, { nume: "hidden" })).toContain("Gata: numele tău nu mai apare; ești doar numărat.");
      expect(await rows()).toMatchObject([{ showName: false, displayName: "Ana" }]);

      // Still a live link: «Nu mai vin» deletes the answer, once.
      await press(setNameByLinkAction, form(withdraw, { showName: "on" }));
      const gone = await press(withdrawRsvpAction, form(withdraw));
      expect(gone).toMatch(/\?retras=/);
      expect(await rows()).toHaveLength(0);
    });

    it("takes the typed name only for an answer with none, with the tick; and refuses a tick with no name at the sentence", async () => {
      const { withdraw } = await links("ana@example.test", { name: null });
      expect(await press(setNameByLinkAction, form(withdraw, { showName: "on" }))).toMatch(/\?nume=name$/);
      expect(await rows()).toMatchObject([{ showName: false, displayName: null }]);
      expect(await page(withdraw, { nume: "name" })).toContain("Scrie numele cu care vrei să apari.");
      expect(await press(setNameByLinkAction, form(withdraw, { showName: "on", name: "  Ana   P. " }))).toMatch(/\?nume=shown$/);
      expect(await rows()).toMatchObject([{ showName: true, displayName: "Ana P." }]);
    });

    it("sends a link that is not live — spent, unknown, a confirm link — to «linkul nu mai merge» and writes nothing; a live link of an uncounted answer says «none»", async () => {
      const counted = await links("ana@example.test");
      const waiting = await links("ion@example.test", { counted: false });
      for (const token of ["x".repeat(43), counted.confirm, waiting.confirm]) {
        expect(await press(setNameByLinkAction, form(token, { showName: "on", name: "Cineva" }))).toMatch(/\?invalid=1$/);
      }
      expect(await press(setNameByLinkAction, form(waiting.withdraw, { showName: "on", name: "Cineva" }))).toMatch(/\?nume=none$/);
      expect((await rows()).every((row) => !row.showName)).toBe(true);
      await press(withdrawRsvpAction, form(counted.withdraw));
      expect(await press(setNameByLinkAction, form(counted.withdraw, { showName: "on" }))).toMatch(/\?invalid=1$/);
    });

    it("reads nothing about the person from the form: a forged address, row or event changes nothing", async () => {
      const mine = await links("ana@example.test");
      await links("dan@example.test", { name: "Dan" });
      await press(setNameByLinkAction, form(mine.withdraw, { showName: "on", email: "dan@example.test", displayName: "Altcineva", rsvpId: "x", eventId: "y" }));
      const all = await rows();
      expect(all.find((row) => row.canonicalEmail === "ana@example.test")).toMatchObject({ showName: true, displayName: "Ana" });
      expect(all.find((row) => row.canonicalEmail === "dan@example.test")).toMatchObject({ showName: false, displayName: "Dan" });
    });

    it("says only the sentences it knows for ?nume=, and nothing for anything else", async () => {
      const { withdraw } = await links();
      expect(await page(withdraw, { nume: "closed" })).toContain("nu mai primește răspunsuri „Vin!”");
      expect(await page(withdraw, { nume: "none" })).toContain("Nu găsim un răspuns „Vin!” de-al tău aici.");
      const unknown = await page(withdraw, { nume: "<b>x</b>" });
      expect(unknown).not.toContain('data-testid="rsvp-name-note"');
      expect(unknown).not.toContain("<b>x</b>");
    });
  });

  it("the confirmation email says under «Nu vin» that the same link shows or hides the name — in both languages, in the plain text too", async () => {
    await answerRsvp(db, eventId, identityOf("page", { email: "ana@example.test", displayName: "Ana", showName: false, locale: "ro" }), NOW);
    await answerRsvp(db, eventId, identityOf("page", { email: "liz@example.test", displayName: "Liz", showName: false, locale: "en" }), NOW);
    const sent = await db.select().from(emailOutbox);
    const texts = await Promise.all(sent.map(async (row) => ({ to: row.recipientEmail, message: await renderOutboxMessage(row, db, NOW) })));
    const roMail = texts.find((entry) => entry.to === "ana@example.test")!.message;
    const enMail = texts.find((entry) => entry.to === "liz@example.test")!.message;
    expect(roMail.text).toContain("Tot de aici îți arăți sau ascunzi numele");
    expect(roMail.html).toContain("Tot de aici îți arăți sau ascunzi numele");
    expect(enMail.text).toContain("You show or hide your name from here too");
    expect(enMail.html).toContain("You show or hide your name from here too");
    // Under the «Nu vin» button: after its link in the text, never before it.
    expect(roMail.text.indexOf("Tot de aici")).toBeGreaterThan(roMail.text.indexOf("Nu vin:"));
  });
});
