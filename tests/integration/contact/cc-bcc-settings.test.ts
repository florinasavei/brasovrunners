import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { createCaptureSmtpTransport } from "@/infrastructure/email/smtp-adapter";
import { type ContactConfig, contactDeliveryFor } from "@/modules/contact/delivery";
import { addressListRefusal, CONTACT_RECIPIENTS_MAX, parseAddressList } from "@/modules/contact/domain/recipients";
import {
  CONTACT_RECIPIENTS_SETTING_ENTITY_ID,
  readContactRecipients,
  updateContactRecipients,
} from "@/modules/contact/recipients";
import { type ContactScreening, submitContactMessage } from "@/modules/contact/service";
import { isDomainError } from "@/shared/errors/domain-error";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * BR-REQ-070-04, `DECISIONS.md` §559 (amending §442 and §457) — the owner, 2026-09-29: «trebuie
 * să am o setare de CC și BCC și pentru mailurile trimise de pe pagina de contact».
 *
 * «Pagini» → «Contact» → «Cine primește mesajele de contact» holds «Către», «CC» and «BCC». This
 * walks the whole path the Administrator's press takes: the boxes as typed (commas or lines),
 * the setting saved and read back, a refused save naming the entry that is not an address, and
 * the message to the club carrying the CC as `cc` and the BCC as `bcc` — the «[posibil spam]»
 * delivery (§310) included. The visitor gets no copy of any kind: the form sends one message.
 */
const NOW = new Date("2026-09-29T10:00:00.000Z");
const RENDERED_AT = new Date(NOW.getTime() - 10_000).toISOString();
const PAGE = "http://localhost:47821/ro/contact";
const PERSON = {
  name: "Ana Popescu",
  email: "ana@example.com",
  message: "La ce oră începe alergarea de duminică?",
  locale: "ro" as const,
  renderedAt: RENDERED_AT,
};
const CONFIG: ContactConfig = {
  APP_ENV: "production",
  CONTACT_FORM_MODE: "capture",
  CONTACT_SMTP_HOST: "smtp.gmail.com",
  CONTACT_SMTP_PORT: 465,
  CONTACT_SMTP_USER: "club@example.com",
  CONTACT_SMTP_PASSWORD: "abcd efgh ijkl mnop",
  CONTACT_FORM_TO: [],
  EMAIL_FROM_NAME: "Brașov Runners",
};

/** What the action does with the three boxes (`admin/pages/contact/actions.ts`). */
function typed(to: string, cc: string, bcc: string) {
  return { to: parseAddressList(to), cc: parseAddressList(cc), bcc: parseAddressList(bcc) };
}

describe("BR-REQ-070-04 CC and BCC on the contact page's messages", () => {
  let db: TestDatabase;
  let close: () => Promise<void>;
  let admin: StaffUser;
  let organizer: StaffUser;

  beforeAll(async () => {
    ({ db, close } = await createTestDatabase());
  });
  afterAll(async () => close());
  beforeEach(async () => {
    await resetTables(db);
    [admin] = await db.insert(staffUsers).values({ email: "admin@dev.test", displayName: "Admin", role: "ADMIN" }).returning();
    [organizer] = await db
      .insert(staffUsers)
      .values({ email: "organizer@dev.test", displayName: "Organizer", role: "MODERATOR" })
      .returning();
  });

  it("saves the CC and BCC typed on lines or with commas, and reads them back", async () => {
    const input = typed("club@example.com", "ioana@example.org\nmihai@example.org", "arhiva@example.org, presedinte@example.org");
    await updateContactRecipients(db, admin, input, NOW);

    expect(await readContactRecipients(db)).toEqual({
      to: ["club@example.com"],
      cc: ["ioana@example.org", "mihai@example.org"],
      bcc: ["arhiva@example.org", "presedinte@example.org"],
      updatedAt: NOW,
    });

    // One audit row under the setting's own id, from nothing to the lists (§483).
    const audits = await db.select().from(auditLogs).where(eq(auditLogs.entityId, CONTACT_RECIPIENTS_SETTING_ENTITY_ID));
    expect(audits).toHaveLength(1);
    expect(audits[0]?.metadataJson).toMatchObject({
      to: { cc: ["ioana@example.org", "mihai@example.org"], bcc: ["arhiva@example.org", "presedinte@example.org"] },
    });
  });

  it("keeps a repeat once: an address already under «Către» is neither CC'd nor BCC'd", async () => {
    await updateContactRecipients(db, admin, typed("club@example.com", "Club@example.com, ioana@example.org", "IOANA@example.org arhiva@example.org arhiva@example.org"), NOW);
    expect(await readContactRecipients(db)).toMatchObject({
      to: ["club@example.com"],
      cc: ["ioana@example.org"],
      bcc: ["arhiva@example.org"],
    });
  });

  it("refuses a save with an entry that is not an address, names it, and keeps what was saved", async () => {
    await updateContactRecipients(db, admin, typed("club@example.com", "ioana@example.org", ""), NOW);
    const bad = typed("club@example.com", "ioana@example.org", "arhiva@example");

    const refusal = await updateContactRecipients(db, admin, bad, NOW).catch((error: unknown) => error);
    expect(isDomainError(refusal) && refusal.code).toBe("VALIDATION_ERROR");
    // The sentence the summary prints names the entry, as on «Setări» → «Emailuri» (§457).
    expect(addressListRefusal([bad.to, bad.cc, bad.bcc], CONTACT_RECIPIENTS_MAX)).toEqual({
      error: "INVALID_ADDRESSES",
      errorValues: { addresses: "arhiva@example" },
    });
    expect(await readContactRecipients(db)).toMatchObject({ cc: ["ioana@example.org"], bcc: [] });
  });

  it("is the Administrator's alone, asserted by the service", async () => {
    const refusal = await updateContactRecipients(db, organizer, typed("x@example.com", "y@example.com", ""), NOW).catch((error: unknown) => error);
    expect(isDomainError(refusal) && refusal.code).toBe("FORBIDDEN");
    expect(await readContactRecipients(db)).toMatchObject({ to: [], cc: [], bcc: [] });
  });

  it("sends the club's message with the CC as cc and the BCC as bcc, and nothing to the visitor", async () => {
    await updateContactRecipients(db, admin, typed("club@example.com", "ioana@example.org", "arhiva@example.org"), NOW);
    const route = contactDeliveryFor(CONFIG, await readContactRecipients(db));
    expect(route).not.toBeNull();
    const capture = createCaptureSmtpTransport();

    expect(await submitContactMessage(db, { ...route!, transport: capture }, PERSON, NOW, PAGE)).toEqual({ outcome: "sent" });
    // One message, to the club: the visitor is its Reply-To, never a recipient or a copy.
    expect(capture.messages).toHaveLength(1);
    const [message] = capture.messages;
    expect(message.to).toEqual(["club@example.com"]);
    expect(message.cc).toEqual(["ioana@example.org"]);
    expect(message.bcc).toEqual(["arhiva@example.org"]);
    expect(message.replyTo).toEqual({ name: "Ana Popescu", address: "ana@example.com" });
    const everyone = [...message.to, ...(message.cc ?? []), ...(message.bcc ?? [])];
    expect(everyone).not.toContain("ana@example.com");
  });

  it("carries the CC and BCC on a message delivered marked «[posibil spam]» too (§310)", async () => {
    await updateContactRecipients(db, admin, typed("club@example.com", "ioana@example.org", "arhiva@example.org"), NOW);
    const route = contactDeliveryFor(CONFIG, await readContactRecipients(db));
    const capture = createCaptureSmtpTransport();
    const noToken: ContactScreening = { botCheckOn: true, tokenPresent: false, turnstileVerdict: "unavailable", clubHost: "club.example" };
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    try {
      const post = { ...PERSON, email: "domains@search-club.example", message: "Feature club.example in Google's Search Index https://searchregister.net/submit" };
      expect(await submitContactMessage(db, { ...route!, transport: capture }, post, NOW, PAGE, noToken)).toEqual({ outcome: "sent" });
    } finally {
      log.mockRestore();
    }
    const [message] = capture.messages;
    expect(message.subject.startsWith("[posibil spam] ")).toBe(true);
    expect(message.cc).toEqual(["ioana@example.org"]);
    expect(message.bcc).toEqual(["arhiva@example.org"]);
  });

  it("sends no Cc or Bcc at all while both boxes are empty", async () => {
    await updateContactRecipients(db, admin, typed("club@example.com", "", ""), NOW);
    const route = contactDeliveryFor(CONFIG, await readContactRecipients(db));
    const capture = createCaptureSmtpTransport();
    await submitContactMessage(db, { ...route!, transport: capture }, PERSON, NOW, PAGE);
    expect(capture.messages[0]?.cc ?? []).toEqual([]);
    expect(capture.messages[0]?.bcc ?? []).toEqual([]);
  });
});
