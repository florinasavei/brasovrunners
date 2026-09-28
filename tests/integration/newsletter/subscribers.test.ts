import sharp from "sharp";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createTranslator } from "next-intl";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { auditLogs } from "@/db/schema/audit-logs";
import { emailOutbox } from "@/db/schema/email-outbox";
import { type NewsletterTopic, newsletterSends, newsletterSubscribers, newsletterTokens } from "@/db/schema/newsletter";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import type { RichTextDoc } from "@/modules/content/rich-text/domain/schema";
import { parseSubscriberListQuery } from "@/modules/newsletter/domain/subscriber-list";
import { sendNewsletter, unsubscribeNewsletterSubscriber } from "@/modules/newsletter/service";
import { listNewsletterSubscribers } from "@/modules/newsletter/subscribers";
import { issueNewsletterToken } from "@/modules/newsletter/tokens";
import { CSV_BOM } from "@/modules/newsletter/subscribers-csv";
import { enqueueEmail } from "@/modules/notifications/outbox";
import { renderOutboxMessage } from "@/modules/notifications/render";
import { canonicalizeEmail } from "@/modules/participants/domain/canonical-email";
import { listMediaAssetsForAdmin, ORPHAN_ASSET_DAYS, sweepOrphanAssets } from "@/modules/media/references";
import { uploadBodyImage } from "@/modules/media/service";
import { env } from "@/shared/config/env";
import { isDomainError } from "@/shared/errors/domain-error";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * §NNN (amending §445) — the newsletter's «Abonați» list, its CSV and its «Dezabonează», and the
 * letter written in the rich-text editor, on real PostgreSQL.
 *
 * The session is the real one (`session.ts`, the development switcher's cookie), so the CSV route
 * asks the role it asks in production: a volunteer is refused, an Organizer takes the file.
 */
const state = vi.hoisted(() => ({ db: undefined as unknown, cookie: undefined as string | undefined }));

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => (state.cookie ? { value: state.cookie } : undefined), set: () => {}, delete: () => {} }),
  headers: async () => new Headers(),
}));
vi.mock("@/auth", () => ({ auth: async () => null, signIn: async () => {}, signOut: async () => {} }));
vi.mock("@/db/client", () => ({ getDb: () => state.db }));
vi.mock("next-intl/server", () => ({
  setRequestLocale: () => {},
  getMessages: async () => ro,
  getTranslations: async (arg: string | { locale: string; namespace: string }) => {
    const namespace = typeof arg === "string" ? arg : arg.namespace;
    const locale = typeof arg === "string" ? "ro" : arg.locale;
    const catalogue = (locale === "en" ? en : ro) as Record<string, object>;
    return createTranslator({ locale, messages: catalogue[namespace] as Record<string, string>, namespace: undefined });
  },
}));

const { GET: downloadSubscribers } = await import("@/app/api/admin/newsletter/subscribers/route");

const NOW = new Date("2026-10-01T10:00:00.000Z");
const HOUR = 60 * 60_000;
const SEND_ID = "7c9e6679-7425-40de-944b-e07fc1f90ae7";

/** A bold line, a link, a list and a picture: what the editor posts, as JSON. */
function letter(words: string): RichTextDoc {
  return {
    type: "doc",
    content: [
      { type: "paragraph", content: [{ type: "text", text: words, marks: [{ type: "bold" }] }] },
      { type: "paragraph", content: [{ type: "text", text: "pagina", marks: [{ type: "link", attrs: { href: "https://club.example/ro/evenimente" } }] }] },
      { type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Adu șosete" }] }] }] },
      {
        type: "image",
        attrs: { src: "/api/media/news/0f8fad5b-d9cb-469f-a165-70867728950e/web.webp", alt: "Pantofii", caption: "", width: 1200, height: 800, widthPercent: 100, align: "block", crop: null },
      },
    ],
  };
}

describe("§NNN the newsletter's subscribers, their CSV, the unsubscribe, and the letter in rich text", () => {
  let db: TestDatabase;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ db, close } = await createTestDatabase());
    state.db = db;
  });
  afterAll(async () => close());
  beforeEach(async () => {
    await resetTables(db);
    state.cookie = undefined;
  });

  async function staff(role: StaffUser["role"]): Promise<StaffUser> {
    const [row] = await db.insert(staffUsers).values({ email: `${role.toLowerCase()}@dev.test`, displayName: role, role }).returning();
    return row;
  }

  async function subscriber(email: string, options: { topics?: NewsletterTopic[]; confirmed?: boolean; locale?: "ro" | "en"; minutesAgo: number }) {
    const identity = canonicalizeEmail(email);
    const at = new Date(NOW.getTime() - options.minutesAgo * 60_000);
    const [row] = await db
      .insert(newsletterSubscribers)
      .values({
        deliveryEmail: identity.deliveryEmail,
        canonicalEmail: identity.canonicalEmail,
        canonicalizationVersion: identity.canonicalizationVersion,
        locale: options.locale ?? "ro",
        topics: options.topics ?? ["ALL"],
        privacyNoticeVersion: 1,
        createdAt: at,
        updatedAt: at,
        confirmedAt: options.confirmed === false ? null : at,
      })
      .returning();
    return row;
  }

  /** An outbox row, as the service queues one: inside a transaction. */
  const queue = (input: Parameters<typeof enqueueEmail>[1]) => db.transaction((tx) => enqueueEmail(tx, input));

  const list = (params: Record<string, string> = {}) => listNewsletterSubscribers(db, parseSubscriberListQuery(params), NOW);

  it("lists every subscriber newest first, with the counts the card's line says, and filters by topic and state", async () => {
    await subscriber("oldest@example.org", { topics: ["GEAR_TESTING"], minutesAgo: 300 });
    await subscriber("everything@example.org", { topics: ["ALL"], minutesAgo: 200 });
    await subscriber("pending@example.org", { topics: ["BIG_EVENTS"], confirmed: false, minutesAgo: 100 });
    await subscriber("newest@example.org", { topics: ["VOLUNTEERING"], locale: "en", minutesAgo: 10 });

    const all = await list();
    expect(all.rows.map((row) => row.email)).toEqual(["newest@example.org", "pending@example.org", "everything@example.org", "oldest@example.org"]);
    expect({ confirmed: all.confirmed, pending: all.pending, truncated: all.truncated }).toEqual({ confirmed: 3, pending: 1, truncated: false });
    expect(all.rows[0]).toMatchObject({ locale: "en", topics: ["VOLUNTEERING"] });

    // A topic is who receives it: its own subscribers and everything's.
    const gear = await list({ topic: "GEAR_TESTING" });
    expect(gear.rows.map((row) => row.email)).toEqual(["everything@example.org", "oldest@example.org"]);
    // «Toate noutățile» is who asked for everything.
    expect((await list({ topic: "ALL" })).rows.map((row) => row.email)).toEqual(["everything@example.org"]);

    // The state filter narrows the counts too, so the line and the table agree.
    const pending = await list({ state: "pending" });
    expect(pending.rows.map((row) => row.email)).toEqual(["pending@example.org"]);
    expect({ confirmed: pending.confirmed, pending: pending.pending }).toEqual({ confirmed: 0, pending: 1 });
    const confirmed = await list({ state: "confirmed", topic: "BIG_EVENTS" });
    expect(confirmed.rows.map((row) => row.email)).toEqual(["everything@example.org"]);

    // The table draws a bounded number of rows; the counts are the whole filter.
    const capped = await listNewsletterSubscribers(db, parseSubscriberListQuery({}), NOW, 2);
    expect(capped.rows).toHaveLength(2);
    expect({ confirmed: capped.confirmed, pending: capped.pending, truncated: capped.truncated }).toEqual({ confirmed: 3, pending: 1, truncated: true });
  });

  it("searches by the canonical address (§74): a Gmail spelling with capitals, a +tag and googlemail finds the row; another dotting does not", async () => {
    await subscriber("Ana.Pop+club@GoogleMail.com", { minutesAgo: 30 });
    await subscriber("ion@example.org", { minutesAgo: 20 });

    for (const q of ["ana.pop@gmail.com", "ANA.POP+alt@gmail.com", "Ana.Pop@googlemail.com"]) {
      const found = await list({ q });
      expect(found.rows.map((row) => row.email), q).toEqual(["Ana.Pop+club@GoogleMail.com"]);
    }
    // Gmail's dots are two identities since version 2 (§74): no raw loosening either way.
    expect((await list({ q: "anapop@gmail.com" })).rows).toEqual([]);
    // A fragment is a way to find a row, over the address as typed and its canonical form.
    expect((await list({ q: "GOOGLEMAIL" })).rows.map((row) => row.email)).toEqual(["Ana.Pop+club@GoogleMail.com"]);
    expect((await list({ q: "pop@gmail" })).rows.map((row) => row.email)).toEqual(["Ana.Pop+club@GoogleMail.com"]);
    // `%` and `_` are literal, never a pattern matching everybody.
    expect((await list({ q: "%" })).rows).toEqual([]);
  });

  it("says what a pending row's confirmation link is doing, from the tokens and the outbox", async () => {
    const live = await subscriber("live@example.org", { confirmed: false, minutesAgo: 50 });
    const expired = await subscriber("expired@example.org", { confirmed: false, minutesAgo: 40 });
    const sending = await subscriber("sending@example.org", { confirmed: false, minutesAgo: 30 });
    await subscriber("confirmed@example.org", { minutesAgo: 20 });
    const liveUntil = new Date(NOW.getTime() + 20 * HOUR);
    await issueNewsletterToken(db, { subscriberId: live.id, purpose: "CONFIRM", expiresAt: liveUntil, now: new Date(NOW.getTime() - HOUR) });
    await issueNewsletterToken(db, { subscriberId: expired.id, purpose: "CONFIRM", expiresAt: new Date(NOW.getTime() - HOUR), now: new Date(NOW.getTime() - 49 * HOUR) });
    await queue({
      participantId: null,
      registrationId: null,
      messageType: "NEWSLETTER_CONFIRM",
      locale: "ro",
      recipientEmail: sending.deliveryEmail,
      payload: { subscriberId: sending.id },
      idempotencyKey: `newsletter:${sending.id}:confirm:${NOW.getTime()}`,
      now: NOW,
      drainAfter: false,
    });

    const rows = (await list()).rows;
    const link = (email: string) => rows.find((row) => row.email === email)?.link;
    expect(link("live@example.org")).toEqual({ kind: "live", expiresAt: liveUntil });
    expect(link("expired@example.org")).toEqual({ kind: "expired" });
    expect(link("sending@example.org")).toEqual({ kind: "sending" });
    expect(link("confirmed@example.org")).toEqual({ kind: "confirmed" });
  });

  it("serves the CSV to an Organizer — BOM, the table's columns, the filter — records it without an address, and refuses a volunteer", async () => {
    const volunteer = await staff("CONTRIBUTOR");
    const organizer = await staff("MODERATOR");
    await subscriber("ana@example.org", { topics: ["GEAR_TESTING", "VOLUNTEERING"], minutesAgo: 30 });
    await subscriber("ion@example.org", { topics: ["BIG_EVENTS"], confirmed: false, minutesAgo: 20 });

    state.cookie = volunteer.id;
    expect((await downloadSubscribers(new Request("http://localhost/api/admin/newsletter/subscribers"))).status).toBe(403);
    state.cookie = undefined;
    expect((await downloadSubscribers(new Request("http://localhost/api/admin/newsletter/subscribers"))).status).toBe(401);

    state.cookie = organizer.id;
    const response = await downloadSubscribers(new Request("http://localhost/api/admin/newsletter/subscribers?lang=ro&topic=GEAR_TESTING"));
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("text/csv; charset=utf-8");
    expect(response.headers.get("Content-Disposition")).toMatch(/^attachment; filename="newsletter-abonati-\d{4}-\d{2}-\d{2}\.csv"$/);
    const body = new TextDecoder("utf-8", { ignoreBOM: true }).decode(await response.arrayBuffer());
    expect(body.startsWith(CSV_BOM)).toBe(true);
    const lines = body.slice(CSV_BOM.length).split("\r\n");
    expect(lines[0]).toBe("Adresa,Limba,Teme,Starea,Abonat din,Confirmat la");
    expect(lines).toHaveLength(2);
    expect(lines[1]).toMatch(/^ana@example\.org,RO,Testări de încălțăminte; Voluntariat,Confirmat,2026-10-01T09:30:00\.000Z,2026-10-01T09:30:00\.000Z$/);

    // In English, for an English reader.
    const english = await downloadSubscribers(new Request("http://localhost/api/admin/newsletter/subscribers?lang=en&state=pending"));
    const englishLines = new TextDecoder().decode(await english.arrayBuffer()).split("\r\n");
    expect(englishLines[0]).toBe("Address,Language,Topics,State,Subscribed,Confirmed");
    expect(englishLines[1]).toMatch(/^ion@example\.org,RO,Big events,Pending,/);

    const exports = await db.select().from(auditLogs).where(eq(auditLogs.action, "newsletter.subscribers_exported"));
    expect(exports).toHaveLength(2);
    expect(exports[0]).toMatchObject({ actorStaffUserId: organizer.id });
    expect(JSON.stringify(exports.map((row) => row.metadataJson))).not.toContain("@");
  });

  it("unsubscribes a row as the subscriber's own unsubscribe does — the row, its links, its waiting mail — with an audit row that never names the address", async () => {
    const admin = await staff("ADMIN");
    const ana = await subscriber("ana@example.org", { minutesAgo: 30 });
    const ion = await subscriber("ion@example.org", { minutesAgo: 20 });
    await issueNewsletterToken(db, { subscriberId: ana.id, purpose: "MANAGE", expiresAt: new Date(NOW.getTime() + 100 * HOUR), now: NOW });
    await issueNewsletterToken(db, { subscriberId: ion.id, purpose: "MANAGE", expiresAt: new Date(NOW.getTime() + 100 * HOUR), now: NOW });
    await queue({
      participantId: null,
      registrationId: null,
      messageType: "NEWSLETTER",
      locale: "ro",
      recipientEmail: ana.deliveryEmail,
      payload: { sendId: SEND_ID, subscriberId: ana.id },
      idempotencyKey: `newsletter:${SEND_ID}:subscriber:${ana.id}`,
      now: NOW,
      drainAfter: false,
    });

    expect(await unsubscribeNewsletterSubscriber(db, admin, ana.id, NOW)).toBe(true);
    expect((await db.select().from(newsletterSubscribers)).map((row) => row.deliveryEmail)).toEqual(["ion@example.org"]);
    expect(await db.select().from(newsletterTokens).where(eq(newsletterTokens.subscriberId, ana.id))).toEqual([]);
    expect(await db.select().from(newsletterTokens).where(eq(newsletterTokens.subscriberId, ion.id))).toHaveLength(1);
    expect(await db.select().from(emailOutbox).where(eq(emailOutbox.recipientEmail, "ana@example.org"))).toEqual([]);

    const [audit] = await db.select().from(auditLogs).where(eq(auditLogs.action, "newsletter.subscriber_unsubscribed"));
    expect(audit).toMatchObject({ actorStaffUserId: admin.id, entityType: "newsletter", entityId: ana.id });
    expect(audit.metadataJson).toMatchObject({ reason: "staff_unsubscribe", source: "subscribers_list", wasConfirmed: true });
    expect(JSON.stringify(audit)).not.toContain("ana@example.org");

    // A second press finds nothing and changes nothing.
    expect(await unsubscribeNewsletterSubscriber(db, admin, ana.id, NOW)).toBe(false);
    expect(await db.select().from(auditLogs).where(eq(auditLogs.action, "newsletter.subscriber_unsubscribed"))).toHaveLength(1);
  });

  it("refuses the unsubscribe to a role that only reads the list (BR-REQ-060-01)", async () => {
    const organizer = await staff("MODERATOR");
    const ana = await subscriber("ana@example.org", { minutesAgo: 30 });
    const refused = await unsubscribeNewsletterSubscriber(db, organizer, ana.id, NOW).catch((error: unknown) => error);
    expect(isDomainError(refused) && refused.code).toBe("FORBIDDEN");
    expect(await db.select().from(newsletterSubscribers)).toHaveLength(1);
    expect(await db.select().from(auditLogs)).toEqual([]);
  });

  it("stores a letter written in the editor as its JSON and renders it into the message; a plain send from before still renders", async () => {
    const organizer = await staff("MODERATOR");
    await subscriber("ana@example.org", { topics: ["GEAR_TESTING"], minutesAgo: 30 });
    const result = await sendNewsletter(
      db,
      organizer,
      {
        topic: "GEAR_TESTING",
        subject: { ro: "Testare", en: "Shoe test" },
        body: { ro: JSON.stringify(letter("Sâmbătă testăm pantofi")), en: JSON.stringify(letter("Shoes to try on Saturday")) },
        sendId: SEND_ID,
      },
      NOW,
    );
    expect(result).toEqual({ kind: "queued", recipients: 1 });
    const [send] = await db.select().from(newsletterSends).where(eq(newsletterSends.id, SEND_ID));
    expect(send.body).toEqual({ ro: letter("Sâmbătă testăm pantofi"), en: letter("Shoes to try on Saturday") });

    const [row] = await db.select().from(emailOutbox).where(eq(emailOutbox.messageType, "NEWSLETTER"));
    const message = await renderOutboxMessage(row, db, NOW);
    expect(message.html).toContain("<strong>Sâmbătă testăm pantofi</strong>");
    expect(message.html).toContain("<strong>Shoes to try on Saturday</strong>");
    expect(message.html).toContain(`src="${env.APP_BASE_URL}/api/media/news/0f8fad5b-d9cb-469f-a165-70867728950e/web.webp"`);
    expect(message.text).toContain("- Adu șosete");
    expect(message.text).toContain(`[Pantofii] ${env.APP_BASE_URL}/api/media/news/`);

    // The letter is in the subscribers' inboxes: the picture it names is kept from the sweep.
    const image = await sharp({ create: { width: 800, height: 600, channels: 3, background: "#3355aa" } }).jpeg().toBuffer();
    const stored = await uploadBodyImage(db, { actorId: organizer.id, file: image, originalFilename: "pantofi.jpg", now: NOW });
    const withStored: RichTextDoc = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Poza" }] },
        { type: "image", attrs: { src: stored.src, alt: "Pantofii", caption: "", width: 800, height: 600, widthPercent: 100, align: "block", crop: null } },
      ],
    };
    await db.update(newsletterSends).set({ body: { ro: withStored, en: withStored } }).where(eq(newsletterSends.id, SEND_ID));
    const muchLater = new Date(NOW.getTime() + ORPHAN_ASSET_DAYS * 3 * 24 * HOUR);
    expect(await sweepOrphanAssets(db, muchLater)).toBe(0);
    expect((await listMediaAssetsForAdmin(db, "ro")).find((row) => row.id === stored.assetId)?.references).toEqual([
      { kind: "newsletter", id: "newsletter", title: null },
    ]);

    // A send written before §NNN kept its words as plain text: it renders as it always did.
    await db.update(newsletterSends).set({ body: { ro: "Salut,\n\nne vedem sâmbătă.", en: "Hi,\n\nsee you on Saturday." } }).where(eq(newsletterSends.id, SEND_ID));
    const old = await renderOutboxMessage(row, db, NOW);
    expect(old.html).toContain(">Salut,</p>");
    expect(old.html).toContain(">ne vedem sâmbătă.</p>");
    expect(old.text).toContain("see you on Saturday.");
  });
});
