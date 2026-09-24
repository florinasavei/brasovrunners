import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { emailOutbox } from "@/db/schema/email-outbox";
import { platformSettings } from "@/db/schema/platform-settings";
import { staffUsers } from "@/db/schema/staff-users";
import { emailCopyKey } from "@/modules/notifications/domain/email-copy";
import { EmailCopySampleValueError } from "@/modules/notifications/domain/email-sample";
import {
  EMAIL_COPY_SETTING_KEY,
  forgetCachedEmailCopy,
  readEmailCopy,
  readEmailCopyForSending,
  updateEmailCopy,
} from "@/modules/notifications/email-copy";
import { sampleValuesIn } from "@/modules/notifications/email-copy-fields";
import { renderOutboxMessage } from "@/modules/notifications/render";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * `DECISIONS.md` §247 — the club's own wording, from the panel to the message that goes out.
 *
 * The unit test holds the rules about words and placeholders; this one holds the three things
 * only a database can answer: who may write them (§103 — the Redactor writes), that a saved
 * text is what the worker renders, and that "revino la textul platformei" really removes the
 * override rather than storing an empty one.
 */
const NOW = new Date("2026-10-11T09:00:00.000Z");
const KEY = emailCopyKey("REGISTRATION_CANCELLED", "ro");

describe("the club's own wording (§247)", () => {
  let db: TestDatabase;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ db, close } = await createTestDatabase());
  });
  afterAll(async () => close());
  beforeEach(async () => {
    await resetTables(db);
    forgetCachedEmailCopy();
  });

  async function staff(role: "CONTRIBUTOR" | "COPYWRITER" | "MODERATOR" | "ADMIN") {
    const [user] = await db
      .insert(staffUsers)
      .values({ email: `${role.toLowerCase()}@dev.test`, displayName: role, role })
      .returning();
    return user;
  }

  const words = { subject: "Îți anulăm locul la {eventTitle}", paragraphs: ["{participantName}, locul tău a fost anulat.", "Ne vedem data viitoare."] };

  it("lets the Redactor and the Administrator write, and refuses the Organizer and the volunteer", async () => {
    // §103: "Redactorul scrie, Organizatorul organizează". The words are the Redactor's, and
    // an Organizer who may open every event still may not rewrite what participants receive.
    await expect(
      updateEmailCopy(db, await staff("MODERATOR"), { messageType: "REGISTRATION_CANCELLED", locale: "ro", entry: words }, NOW),
    ).rejects.toThrow();
    await expect(
      updateEmailCopy(db, await staff("CONTRIBUTOR"), { messageType: "REGISTRATION_CANCELLED", locale: "ro", entry: words }, NOW),
    ).rejects.toThrow();

    const saved = await updateEmailCopy(db, await staff("COPYWRITER"), { messageType: "REGISTRATION_CANCELLED", locale: "ro", entry: words }, NOW);
    expect(saved.copy[KEY]).toEqual(words);
    expect((await readEmailCopy(db)).copy[KEY]).toEqual(words);
  });

  it("records the one message that changed, from and to", async () => {
    const author = await staff("COPYWRITER");
    await updateEmailCopy(db, author, { messageType: "REGISTRATION_CANCELLED", locale: "ro", entry: words }, NOW);
    const [row] = await db.select().from(auditLogs).where(eq(auditLogs.action, "email_copy.changed"));
    expect(row.actorStaffUserId).toBe(author.id);
    expect(row.metadataJson).toEqual({ key: KEY, from: null, to: words });
  });

  it("sends what the club wrote, and keeps everything the message carries", async () => {
    await updateEmailCopy(db, await staff("COPYWRITER"), { messageType: "REGISTRATION_CANCELLED", locale: "ro", entry: words }, NOW);

    const [queued] = await db
      .insert(emailOutbox)
      .values({
        messageType: "REGISTRATION_CANCELLED",
        locale: "ro",
        recipientEmail: "ana@example.ro",
        payloadJson: {},
        idempotencyKey: "cancelled-one",
        createdAt: NOW,
      })
      .returning();

    const message = await renderOutboxMessage({ ...queued, status: "PROCESSING", attemptCount: 1, lockedAt: NOW }, db, NOW);
    // The Romanian half is the club's; the English half is still the platform's (§96, §247).
    expect(message.subject).toContain("Îți anulăm locul la");
    expect(message.subject).toContain("Your registration has been cancelled");
    expect(message.text).toContain("locul tău a fost anulat");
    expect(message.text).toContain("Ne vedem data viitoare.");
    // The sign-off and the card are the platform's, whatever the club wrote.
    expect(message.text).toContain("Echipa Brașov Runners");
    expect(message.html).toContain("logo-email-banner.png");
  });

  it("goes back to the platform's text, and the next send sees it at once", async () => {
    const author = await staff("COPYWRITER");
    await updateEmailCopy(db, author, { messageType: "REGISTRATION_CANCELLED", locale: "ro", entry: words }, NOW);
    // The memo the send path uses is warm now — and a reset must not wait for it to expire.
    expect((await readEmailCopyForSending(db, NOW))[KEY]).toEqual(words);

    const after = await updateEmailCopy(db, author, { messageType: "REGISTRATION_CANCELLED", locale: "ro", entry: null }, NOW);
    expect(after.copy).toEqual({});
    expect(await readEmailCopyForSending(db, NOW)).toEqual({});
    const [, second] = await db.select().from(auditLogs).where(eq(auditLogs.action, "email_copy.changed"));
    expect(second.metadataJson).toEqual({ key: KEY, from: words, to: null });
  });

  /*
    §359 — no sample value is stored. The owner, 2026-09-24: the editor offered "Ai început
    înscrierea la Crosul de toamnă", the page's sample event, and a save would have sent that title
    to every participant of every event.
  */
  it("refuses a sample value, naming the box, the value and its field, and changes nothing (§359)", async () => {
    const author = await staff("COPYWRITER");
    await updateEmailCopy(db, author, { messageType: "REGISTRATION_CANCELLED", locale: "ro", entry: words }, NOW);
    const attempt = updateEmailCopy(
      db,
      author,
      {
        messageType: "REGISTRATION_CANCELLED",
        locale: "ro",
        entry: { subject: "Anulat: Crosul de toamnă", paragraphs: ["Salut Ana Popescu, codul EXAMPL nu mai e valabil."] },
      },
      NOW,
    );
    await expect(attempt).rejects.toBeInstanceOf(EmailCopySampleValueError);
    await expect(attempt).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      fields: ["subject", "body"],
      hits: [
        { field: "subject", value: "Crosul de toamnă", placeholder: "eventTitle" },
        { field: "body", value: "Ana Popescu", placeholder: "participantName" },
        { field: "body", value: "EXAMPL", placeholder: "checkinCode" },
      ],
    });
    // The English sample in a Romanian text is as wrong as the Romanian one.
    await expect(
      updateEmailCopy(db, author, { messageType: "REGISTRATION_CANCELLED", locale: "ro", entry: { subject: "Anulat", paragraphs: ["The autumn cross"] } }, NOW),
    ).rejects.toBeInstanceOf(EmailCopySampleValueError);
    expect((await readEmailCopy(db)).copy[KEY]).toEqual(words);
    expect(await db.select().from(auditLogs).where(eq(auditLogs.action, "email_copy.changed"))).toHaveLength(1);
  });

  it("replaces the sample values with their fields for the Redactor, audited like a save, and refuses the Organizer (§359)", async () => {
    const sampled = { subject: "Anulat: Crosul de toamnă", paragraphs: ["Salut Ana Popescu.", "Numărul tău de concurs: **42**."] };
    await expect(
      updateEmailCopy(db, await staff("MODERATOR"), { messageType: "EVENT_REMINDER", locale: "ro", entry: sampled, replaceSampleValues: true }, NOW),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await readEmailCopy(db)).copy).toEqual({});

    const author = await staff("COPYWRITER");
    const saved = await updateEmailCopy(db, author, { messageType: "EVENT_REMINDER", locale: "ro", entry: sampled, replaceSampleValues: true }, NOW);
    const key = emailCopyKey("EVENT_REMINDER", "ro");
    expect(saved.copy[key]).toEqual({
      subject: "Anulat: {eventTitle}",
      paragraphs: ["Salut {participantName}.", "Numărul tău de concurs: **{bibNumber}**."],
    });
    const [row] = await db.select().from(auditLogs).where(eq(auditLogs.action, "email_copy.changed"));
    expect(row.actorStaffUserId).toBe(author.id);
    expect(row.metadataJson).toEqual({
      key,
      from: null,
      to: saved.copy[key],
      replacedSampleValues: ["Crosul de toamnă", "Ana Popescu", "42"],
    });
  });

  it("still reads and sends a text saved with sample values before the guard, and says which (§359)", async () => {
    // Written the way the old editor let a Redactor write it: straight into the setting.
    const stale = { subject: "Anulat: Crosul de toamnă", paragraphs: ["Înscrierea ta la Crosul de toamnă a fost anulată."] };
    await db.insert(platformSettings).values({ key: EMAIL_COPY_SETTING_KEY, value: { [KEY]: stale }, updatedAt: NOW });
    const stored = (await readEmailCopy(db)).copy[KEY];
    expect(stored).toEqual(stale);
    expect(sampleValuesIn(stored, "REGISTRATION_CANCELLED", "ro")).toEqual([
      { field: "subject", value: "Crosul de toamnă", placeholder: "eventTitle" },
      { field: "body", value: "Crosul de toamnă", placeholder: "eventTitle" },
    ]);

    const [queued] = await db
      .insert(emailOutbox)
      .values({ messageType: "REGISTRATION_CANCELLED", locale: "ro", recipientEmail: "ana@example.ro", payloadJson: {}, idempotencyKey: "stale-one", createdAt: NOW })
      .returning();
    const message = await renderOutboxMessage({ ...queued, status: "PROCESSING", attemptCount: 1, lockedAt: NOW }, db, NOW);
    // Exactly what it said before §359: the guard is the save's, never the send's.
    expect(message.subject).toContain("Anulat: Crosul de toamnă");
  });

  it("refuses a field the platform cannot fill, and changes nothing", async () => {
    const author = await staff("COPYWRITER");
    await updateEmailCopy(db, author, { messageType: "REGISTRATION_CANCELLED", locale: "ro", entry: words }, NOW);
    await expect(
      updateEmailCopy(
        db,
        author,
        { messageType: "REGISTRATION_CANCELLED", locale: "ro", entry: { subject: "Salut {clubPresident}", paragraphs: ["x"] } },
        NOW,
      ),
    ).rejects.toThrow();
    expect((await readEmailCopy(db)).copy[KEY]).toEqual(words);
  });
});
