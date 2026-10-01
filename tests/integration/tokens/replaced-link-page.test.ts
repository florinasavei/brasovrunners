import { eq } from "drizzle-orm";
import type { ReactElement } from "react";
import { renderToReadableStream } from "react-dom/server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { emailActionTokens } from "@/db/schema/email-action-tokens";
import { emailOutbox } from "@/db/schema/email-outbox";
import { eventTranslations, events } from "@/db/schema/events";
import { participants } from "@/db/schema/participants";
import { registrations } from "@/db/schema/registrations";
import { staffUsers } from "@/db/schema/staff-users";
import { CLUB_TIME_ZONE, formatDay } from "@/i18n/dates";
import { canonicalizeEmail } from "@/modules/participants/domain/canonical-email";
import { withClientWords } from "../../helpers/client-words";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * §619 — a link a newer email replaced says so (BR-REQ-036-02).
 *
 * What happened: a resend mints a new link at send time (`notifications/render.ts`) and invalidates
 * the older one; the person who then pressed the older email read «Acest link nu mai este valabil»,
 * the same words a guessed URL gets, and took it for a failure. `invalidated_at` held two facts —
 * superseded, revoked — and the page could not tell which. `superseded_by_token_id` can.
 *
 * Asserted on the rendered page, through the real resend and the real renderer, in both languages:
 *
 * - the older link's page says a newer email has the working link, when it was sent, and keeps the
 *   resend path; the same for a replaced «Înscrierile mele» link;
 * - a link revoked for cause, an unknown token and a link replayed at another endpoint keep the one
 *   generic answer (§13.2), word for word as before;
 * - opening the page changes nothing (a GET never mutates, BR-REQ-036-02 criterion 4).
 */
const FIRST_SEND = new Date("2026-09-04T10:00:00.000Z");
const SECOND_SEND = new Date("2026-09-04T12:30:00.000Z");
const OPENED = new Date("2026-09-04T13:00:00.000Z");
const RACE_DAY = new Date("2026-10-01T09:00:00.000Z");

let db: TestDatabase;
let close: () => Promise<void>;
const lang = vi.hoisted(() => ({ current: "ro" as "ro" | "en" }));

vi.mock("@/db/client", () => ({ getDb: () => db }));
vi.mock("next/cache", async () => (await import("../../helpers/next-cache")).fakeNextCache.module);
// No family pass in this browser: the declaration page reads its cookie.
vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, getAll: () => [], has: () => false, set: () => {}, delete: () => {} }),
}));
// The pages, rendered with the real catalogues, in the language the test names.
vi.mock("next-intl/server", async (importOriginal) => {
  const { createTranslator } = await import("next-intl");
  const catalogues = {
    ro: (await import("../../../messages/ro.json")).default,
    en: (await import("../../../messages/en.json")).default,
  };
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    getTranslations: async (namespace: string) =>
      createTranslator({ locale: lang.current, messages: catalogues[lang.current], namespace: namespace as "Registrations" }),
    getLocale: async () => lang.current,
    setRequestLocale: () => {},
  };
});

const { resendRegistrationMessage } = await import("@/modules/registrations/admin-service");
const { renderOutboxMessage } = await import("@/modules/notifications/render");
const { issueActionToken } = await import("@/modules/action-tokens/repository");
const { readReplacedActionLink } = await import("@/modules/registrations/token-actions");
const { default: ConfirmEmailPage } = await import("@/app/[locale]/registrations/confirm/[token]/page");
const { default: DeclarePage } = await import("@/app/[locale]/registrations/declare/[token]/page");
const { default: MyRegistrationsPage } = await import("@/app/[locale]/registrations/mine/[token]/page");

const GENERIC_RO = "Acest link nu mai este valabil.";
const REPLACED_RO = "Acest link a fost înlocuit. Ți-am trimis un email mai nou, cu un link valabil";
const REPLACED_EN = "This link has been replaced. We sent you a newer email with a working link";

/** The page's markup — async Server Components and all — without Emotion's style tags; entities decoded. */
async function html(element: ReactElement): Promise<string> {
  const stream = await renderToReadableStream(withClientWords(element, lang.current));
  await stream.allReady;
  return (await new Response(stream).text())
    .replace(/<style[^>]*>[\s\S]*?<\/style>/g, "")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&");
}

async function confirmPage(token: string, locale: "ro" | "en"): Promise<string> {
  lang.current = locale;
  const element = (await ConfirmEmailPage({ params: Promise.resolve({ locale, token }), searchParams: Promise.resolve({}) })) as ReactElement;
  return await html(element);
}

describe("BR-REQ-036-02 §619 a link a newer email replaced", () => {
  let participantId: string;
  let registrationId: string;
  let adminId: string;

  beforeAll(async () => {
    ({ db, close } = await createTestDatabase());
  });
  afterAll(async () => close());
  afterEach(() => {
    vi.useRealTimers();
    lang.current = "ro";
  });

  beforeEach(async () => {
    await resetTables(db);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(OPENED);

    const [admin] = await db.insert(staffUsers).values({ email: "admin@dev.test", displayName: "Admin", role: "ADMIN" }).returning();
    adminId = admin.id;

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
    participantId = participant.id;

    const [event] = await db
      .insert(events)
      .values({ type: "GROUP_RUN", startsAt: RACE_DAY, registrationMode: "INTERNAL", editorialStatus: "PUBLISHED", publishedAt: FIRST_SEND })
      .returning();
    await db.insert(eventTranslations).values([
      { eventId: event.id, locale: "ro", slug: "crosul-brasovului", title: "Crosul Brașovului" },
      { eventId: event.id, locale: "en", slug: "brasov-cross", title: "Brașov Cross" },
    ]);

    const [registration] = await db
      .insert(registrations)
      .values({
        eventId: event.id,
        participantId,
        status: "PENDING_EMAIL_CONFIRMATION",
        locale: "ro",
        registeredName: "Ana Pop",
        displayName: "Ana P.",
        privacyNoticeVersion: 1,
        privacyAcknowledgedAt: FIRST_SEND,
        resultsNameConsent: false,
        listOptOut: false,
        resultsConsentVersion: 1,
        // The registration's own link window (§377): long enough that only the supersede refuses.
        emailLinkExpiresAt: RACE_DAY,
      })
      .returning();
    registrationId = registration.id;
  });

  /** An Administrator's resend, rendered as the outbox renders it at `at`: the link is minted then. */
  async function resendAndRender(at: Date): Promise<string> {
    await resendRegistrationMessage(db, { id: adminId, role: "ADMIN" }, registrationId, at);
    const [row] = await db.select().from(emailOutbox).where(eq(emailOutbox.status, "PENDING")).limit(1);
    const message = await renderOutboxMessage({ ...row, status: "PROCESSING", attemptCount: 1, lockedAt: at }, db, at);
    await db.update(emailOutbox).set({ status: "SENT", sentAt: at }).where(eq(emailOutbox.id, row.id));
    const match = /[/=]([A-Za-z0-9_-]{43})(?![A-Za-z0-9_-])/.exec(message.text);
    if (!match) throw new Error("no action link in the resent message");
    return match[1];
  }

  /** Every token of the address-confirmation purpose, oldest first (the email carries others beside it). */
  async function tokens() {
    return db
      .select({
        id: emailActionTokens.id,
        createdAt: emailActionTokens.createdAt,
        invalidatedAt: emailActionTokens.invalidatedAt,
        supersededByTokenId: emailActionTokens.supersededByTokenId,
        usedAt: emailActionTokens.usedAt,
      })
      .from(emailActionTokens)
      .where(eq(emailActionTokens.purpose, "VERIFY_REGISTRATION_EMAIL"))
      .orderBy(emailActionTokens.createdAt);
  }

  it("marks the earlier link superseded by the resend's, with the newer row's id", async () => {
    await resendAndRender(FIRST_SEND);
    await resendAndRender(SECOND_SEND);

    const [first, second] = await tokens();
    expect(first.invalidatedAt).toEqual(SECOND_SEND);
    expect(first.supersededByTokenId).toBe(second.id);
    expect(second.invalidatedAt).toBeNull();
    expect(second.supersededByTokenId).toBeNull();
  });

  it("says, on the earlier link's page, that a newer email was sent and when — in Romanian and in English", async () => {
    const older = await resendAndRender(FIRST_SEND);
    await resendAndRender(SECOND_SEND);
    const before = await tokens();

    const ro = await confirmPage(older, "ro");
    const sentRo = formatDay(SECOND_SEND, { locale: "ro", timeZone: CLUB_TIME_ZONE, withTime: true, position: "inline" });
    expect(sentRo).toContain("15:30");
    expect(ro).toContain(`${REPLACED_RO} (trimis ${sentRo}).`);
    expect(ro).toContain("caută în Spam și în Promoții");
    expect(ro).toContain('data-testid="link-replaced"');
    expect(ro).not.toContain(GENERIC_RO);
    // The resend path stays under the sentence, narrowed to the event in this language.
    expect(ro).toContain("?event=crosul-brasovului");
    // No second Spam box: the sentence already says it.
    expect(ro).not.toContain('data-testid="spam-hint"');

    const en = await confirmPage(older, "en");
    const sentEn = formatDay(SECOND_SEND, { locale: "en", timeZone: CLUB_TIME_ZONE, withTime: true, position: "inline" });
    expect(en).toContain(`${REPLACED_EN} (sent ${sentEn}).`);
    expect(en).toContain("check Spam and Promotions");
    expect(en).toContain("?event=brasov-cross");
    expect(en).not.toContain("This link is no longer valid.");

    // Two GETs, nothing moved: no token spent, minted or revived.
    expect(await tokens()).toEqual(before);
  });

  it("keeps the generic answer for a link revoked for cause", async () => {
    const link = await resendAndRender(FIRST_SEND);
    // No code path revokes today; this is the row such a path would leave: invalidated, no successor.
    await db.update(emailActionTokens).set({ invalidatedAt: SECOND_SEND });

    const ro = await confirmPage(link, "ro");
    expect(ro).toContain(GENERIC_RO);
    expect(ro).not.toContain("înlocuit");
    expect(ro).not.toContain('data-testid="link-replaced"');
  });

  it("keeps the generic answer for an unknown token", async () => {
    await resendAndRender(FIRST_SEND);
    const ro = await confirmPage("A".repeat(43), "ro");
    expect(ro).toContain(GENERIC_RO);
    expect(ro).not.toContain("înlocuit");
  });

  it("keeps the generic answer for a replaced link replayed at another endpoint", async () => {
    const older = await resendAndRender(FIRST_SEND);
    await resendAndRender(SECOND_SEND);

    lang.current = "ro";
    const element = (await DeclarePage({ params: Promise.resolve({ locale: "ro", token: older }), searchParams: Promise.resolve({}) })) as ReactElement;
    const page = await html(element);
    expect(page).toContain(GENERIC_RO);
    expect(page).not.toContain("înlocuit");
    // And the reader itself, asked under the wrong purpose, says nothing.
    expect(await readReplacedActionLink(older, [{ purpose: "COMPLETE_DECLARATION", reason: "SUPERSEDED" }], "ro", OPENED)).toBeNull();
  });

  it("says the same on a replaced «Înscrierile mele» link (MANAGE_PROFILE)", async () => {
    const mine = (at: Date) =>
      issueActionToken(db, { participantId, registrationId: null, purpose: "MANAGE_PROFILE", expiresAt: RACE_DAY, now: at });
    const older = (await mine(FIRST_SEND)).secret;
    await mine(SECOND_SEND);

    lang.current = "ro";
    const element = (await MyRegistrationsPage({ params: Promise.resolve({ locale: "ro", token: older }), searchParams: Promise.resolve({}) })) as ReactElement;
    const page = await html(element);
    expect(page).toContain(REPLACED_RO);
    expect(page).not.toContain(GENERIC_RO);
    // The way to a fresh link stays.
    expect(page).toContain("Cere un link nou");
  });
});
