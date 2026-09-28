import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { emailOutbox } from "@/db/schema/email-outbox";
import { newsletterSubscribers, newsletterTokens } from "@/db/schema/newsletter";
import type { OutgoingEmail } from "@/infrastructure/email/adapter";
import { readNewsletterSubscription, requestNewsletterManageLink, unsubscribeNewsletter } from "@/modules/newsletter/service";
import { renderOutboxMessage } from "@/modules/notifications/render";
import { canonicalizeEmail } from "@/modules/participants/domain/canonical-email";
import { isDomainError } from "@/shared/errors/domain-error";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

const NOW = new Date("2026-10-01T10:00:00.000Z");
const RENDERED = new Date(NOW.getTime() - 60_000).toISOString();

/** The secret in a rendered link to the subscriber's own page. */
function manageSecretIn(message: OutgoingEmail): string {
  const match = message.text.match(/(?:noutati\/abonament|newsletter\/manage)\/([A-Za-z0-9_-]{43})/);
  if (!match) throw new Error("no manage link in the message");
  return match[1];
}

/**
 * §550 (amending §445; the owner, 2026-09-28 23:10: «oamenii pot să se și dezaboneze de la
 * newsletter») — «Vreau să mă dezabonez» on the contact page, on real PostgreSQL: a subscribed
 * address is mailed the link to its own page, whose «Dezabonează-mă de la tot» removes it; any other
 * address gets the same answer and no message; the sign-up's per-address bucket refuses the fourth.
 */
describe("§550 «Vreau să mă dezabonez»: the link to leave, mailed only to a subscriber", () => {
  let db: TestDatabase;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ db, close } = await createTestDatabase());
  });
  afterAll(async () => close());
  beforeEach(async () => {
    await resetTables(db);
  });

  async function subscriber(email: string, options: { confirmed: boolean; locale?: "ro" | "en" }) {
    const identity = canonicalizeEmail(email);
    const at = new Date(NOW.getTime() - 24 * 60 * 60_000);
    const [row] = await db
      .insert(newsletterSubscribers)
      .values({
        deliveryEmail: identity.deliveryEmail,
        canonicalEmail: identity.canonicalEmail,
        canonicalizationVersion: identity.canonicalizationVersion,
        locale: options.locale ?? "ro",
        topics: ["BIG_EVENTS"],
        privacyNoticeVersion: 1,
        createdAt: at,
        updatedAt: at,
        confirmedAt: options.confirmed ? at : null,
      })
      .returning();
    return row;
  }

  const ask = (email: string, extra: Record<string, unknown> = {}) => requestNewsletterManageLink(db, { email, renderedAt: RENDERED, ...extra }, NOW);
  const confirmations = () => db.select().from(emailOutbox).where(eq(emailOutbox.messageType, "NEWSLETTER_CONFIRM"));

  it("mails a subscribed address one link to its own page, in its own language and to its own spelling, and that link unsubscribes", async () => {
    const row = await subscriber("Ana.Pop+club@GoogleMail.com", { confirmed: true, locale: "en" });

    // Typed another way — capitals, another +tag, googlemail — it is the same identity (§74).
    expect(await ask("ANA.POP+other@gmail.com")).toBe("done");
    const queued = await confirmations();
    expect(queued).toHaveLength(1);
    expect(queued[0]).toMatchObject({ recipientEmail: "Ana.Pop+club@GoogleMail.com", locale: "en", status: "PENDING" });
    expect(queued[0].payloadJson).toEqual({ subscriberId: row.id, request: "manage" });
    // Nothing is minted or changed at the request: the link is minted when the message leaves (§14.5).
    expect(await db.select().from(newsletterTokens)).toHaveLength(0);

    const message = await renderOutboxMessage(queued[0], db, NOW);
    expect(message.text).toContain("asked, on our contact page, for the link to this address's subscription");
    const secret = manageSecretIn(message);
    const [token] = await db.select().from(newsletterTokens);
    expect(token).toMatchObject({ subscriberId: row.id, purpose: "MANAGE" });

    // The page the link opens is the subscriber's own, with the topics and «Dezabonează-mă de la tot».
    expect(await readNewsletterSubscription(db, secret, NOW)).toMatchObject({ email: "Ana.Pop+club@GoogleMail.com", topics: ["BIG_EVENTS"] });
    expect(await unsubscribeNewsletter(db, secret, NOW)).toBe(true);
    expect(await db.select().from(newsletterSubscribers)).toHaveLength(0);
    // Single use: the same link again finds nothing.
    expect(await unsubscribeNewsletter(db, secret, NOW)).toBe(false);
  });

  it("answers an unknown address and a pending one exactly as a subscriber, and queues nothing", async () => {
    await subscriber("pending@example.org", { confirmed: false });
    expect(await ask("stranger@example.org")).toBe("done");
    expect(await ask("pending@example.org")).toBe("done");
    expect(await confirmations()).toHaveLength(0);
    // The pending address is left as it was: its confirmation link is its only link.
    expect((await db.select().from(newsletterSubscribers)).map((row) => row.deliveryEmail)).toEqual(["pending@example.org"]);
  });

  it("refuses the fourth press in an hour for one address, a subscriber or not, as the sign-up's bucket does", async () => {
    await subscriber("ion@example.org", { confirmed: true });
    // A minute apart, inside one hour's window.
    const press = (email: string, n: number) => requestNewsletterManageLink(db, { email, renderedAt: RENDERED }, new Date(NOW.getTime() + n * 60_000));
    for (const email of ["ion@example.org", "nobody@example.org"]) {
      for (let n = 1; n <= 3; n += 1) expect(await press(email, n), `${email} press ${n}`).toBe("done");
      expect(await press(email, 4), `${email} press 4`).toBe("limited");
    }
    // The three allowed presses for the subscriber queued three links; the stranger's none.
    expect((await confirmations()).map((row) => row.recipientEmail)).toEqual(["ion@example.org", "ion@example.org", "ion@example.org"]);
  });

  it("refuses a malformed address by its box, and answers a bot's post in silence", async () => {
    await subscriber("ion@example.org", { confirmed: true });
    const refusal = await ask("not an address").catch((error: unknown) => error);
    expect(isDomainError(refusal) && refusal.code === "VALIDATION_ERROR" && refusal.fields).toEqual(["email"]);
    expect(await ask("ion@example.org", { honeypot: "filled" })).toBe("done");
    // Posted faster than a person types.
    expect(await ask("ion@example.org", { renderedAt: new Date(NOW.getTime() - 100).toISOString() })).toBe("done");
    expect(await confirmations()).toHaveLength(0);
  });
});
