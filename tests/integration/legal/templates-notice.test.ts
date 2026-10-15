import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { emailOutbox } from "@/db/schema/email-outbox";
import { platformSettings } from "@/db/schema/platform-settings";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { getPathname } from "@/i18n/navigation";
import { textToBody } from "@/modules/legal-documents/domain/body-text";
import { legalTemplatesNoticeSchema } from "@/modules/legal-documents/domain/templates-notice";
import { approveVersion, createDraftVersion, readLegalOverview, templateTranslations } from "@/modules/legal-documents/service";
import {
  announceLegalTemplateChanges,
  LEGAL_TEMPLATES_NOTICE_SETTING_KEY,
  readLegalTemplatesNotice,
} from "@/modules/legal-documents/templates-notice";
import { type ClubFacts, clubFactsFromEnv } from "@/modules/legal-documents/templates/club-facts";
import { renderOutboxMessage } from "@/modules/notifications/render";
import { runRegistrationMaintenance } from "@/modules/registrations/maintenance";
import { env } from "@/shared/config/env";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * §639 — «Șabloanele textelor legale s-au schimbat»: when a release moves a legal template, the
 * maintenance job emails every Administrator and Superadministrator, once per change, and the
 * platform still approves nothing. The trigger is `/admin/legal`'s own «Șablon nou» predicate
 * (`readLegalOverview`'s `templateNewer`); the throttle is one overview read a club day, the first run
 * after 08:00 (§775); the memory is one `platform_settings` row.
 */
const NOW = new Date("2026-10-02T08:00:00.000Z");
const minutes = (count: number) => new Date(NOW.getTime() + count * 60_000);
const HOUR_LATER = minutes(60);
// §775: one email per club day, so a second look at the same change is a day on (11:00 club time again).
const DAY_LATER = minutes(24 * 60);

const FACTS: ClubFacts = clubFactsFromEnv({
  CLUB_LEGAL_NAME: "Asociația Exemplu",
  CLUB_REGISTRATION_NUMBER: "CIF 12345678",
  CLUB_REGISTERED_ADDRESS: "Str. Exemplu nr. 1, Brașov",
  EMAIL_REPLY_TO: "contact@example.test",
});
const facts = async () => FACTS;

/** A text the club wrote itself: never the template's words, so the template reads as newer. */
const ownWords = (suffix: string) => [
  { locale: "ro" as const, title: `Text ${suffix}`, body: textToBody(`Textul clubului ${suffix}.`) },
  { locale: "en" as const, title: `Text ${suffix}`, body: textToBody(`The club's text ${suffix}.`) },
];

describe("§639 the Administrators are emailed when a release moves a legal template", () => {
  let db: TestDatabase;
  let close: () => Promise<void>;
  let superadmin: StaffUser;
  let admin: StaffUser;

  beforeAll(async () => {
    ({ db, close } = await createTestDatabase());
  });
  afterAll(async () => close());
  beforeEach(async () => {
    await resetTables(db);
    [superadmin] = await db.insert(staffUsers).values({ email: "super@dev.test", displayName: "Ana", role: "SUPERADMIN" }).returning();
    [admin] = await db
      .insert(staffUsers)
      .values({ email: "admin@dev.test", displayName: "John", role: "ADMIN", preferredLocale: "en" })
      .returning();
    // An Organizer, a Tehnic, a Redactor and a member: none of them approves a legal text, so none is told.
    await db.insert(staffUsers).values([
      { email: "org@dev.test", displayName: "Org", role: "MODERATOR" },
      { email: "tech@dev.test", displayName: "Tech", role: "DEV" },
      { email: "copy@dev.test", displayName: "Copy", role: "COPYWRITER" },
      { email: "member@dev.test", displayName: "Member", role: "MEMBER" },
      // An Administrator's row with no address to write to is skipped, never an error.
      { email: "", displayName: "Nobody", role: "ADMIN" },
    ]);
  });

  /** The club approves a text of its own words: from then on the template reads as newer than it. */
  async function approveOwn(key: "TERMS" | "PRIVACY_NOTICE", suffix: string, at: Date = NOW) {
    const draft = await createDraftVersion(db, admin, { key, translations: ownWords(suffix) }, at);
    await approveVersion(db, admin, draft, at);
  }

  /** The club approves the template's own words, its facts written in: «Șablon nou» goes. */
  async function approveTemplate(key: "TERMS" | "PRIVACY_NOTICE", with_: ClubFacts, at: Date) {
    const draft = await createDraftVersion(db, admin, { key, translations: templateTranslations(key, with_) }, at);
    await approveVersion(db, admin, draft, at);
  }

  const notices = () => db.select().from(emailOutbox).where(eq(emailOutbox.messageType, "LEGAL_TEMPLATES_CHANGED"));

  it("queues one email per Administrator and Superadministrator from one job run, naming the newer texts", async () => {
    await approveOwn("TERMS", "v1");
    // `/admin/legal`'s own predicate says the terms' template is newer, and nothing else is in force.
    const overview = await readLegalOverview(db, FACTS, NOW);
    expect(overview.TERMS.templateNewer).toBe(true);

    const run = await runRegistrationMaintenance(db, NOW);
    expect(run.legalTemplatesNoticesQueued).toBe(2);

    const rows = await notices();
    expect(rows.map((row) => row.recipientEmail).sort()).toEqual(["admin@dev.test", "super@dev.test"]);
    for (const row of rows) {
      // Staff only: no participant, no registration behind it.
      expect(row.participantId).toBeNull();
      expect(row.registrationId).toBeNull();
      expect(row.status).toBe("PENDING");
      expect((row.payloadJson as { keys: string[] }).keys).toEqual(["TERMS"]);
    }
    // Each in the language of their own row; one key per person per change.
    const byAddress = Object.fromEntries(rows.map((row) => [row.recipientEmail, row]));
    expect(byAddress["super@dev.test"].locale).toBe("ro");
    expect(byAddress["admin@dev.test"].locale).toBe("en");
    const { fingerprint } = await readLegalTemplatesNotice(db);
    expect(byAddress["super@dev.test"].idempotencyKey).toBe(`legal-templates:${fingerprint}:${superadmin.id}`);
    expect(byAddress["admin@dev.test"].idempotencyKey).toBe(`legal-templates:${fingerprint}:${admin.id}`);
  });

  it("records the announcement in its platform_settings row, in its shape", async () => {
    await approveOwn("TERMS", "v1");
    await approveOwn("PRIVACY_NOTICE", "v1");
    await announceLegalTemplateChanges(db, facts, NOW);

    const [row] = await db.select().from(platformSettings).where(eq(platformSettings.key, LEGAL_TEMPLATES_NOTICE_SETTING_KEY));
    const value = legalTemplatesNoticeSchema.parse(row.value);
    expect(value.checkedAt).toBe(NOW.toISOString());
    expect(value.announcedAt).toBe(NOW.toISOString());
    expect(value.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    // In the catalogue's order, and each with the template it was announced at.
    expect(value.keys).toEqual(["PRIVACY_NOTICE", "TERMS"]);
    expect(value.pairs).toHaveLength(2);
    expect(value.pairs.every((pair) => /^(PRIVACY_NOTICE|TERMS):[0-9a-f]{64}$/.test(pair))).toBe(true);
    // A field this code does not know is dropped, never kept and never an error (rows kept before the digest carry one).
    expect(legalTemplatesNoticeSchema.parse({ ...value, extra: true })).toEqual(value);
    // Nobody wrote it: the job did.
    expect(row.updatedByStaffUserId).toBeNull();
  });

  it("reads nothing and queues nothing a second time the same day", async () => {
    await approveOwn("TERMS", "v1");
    expect((await announceLegalTemplateChanges(db, facts, NOW)).queued).toBe(2);

    const loadFacts = vi.fn(facts);
    const again = await announceLegalTemplateChanges(db, loadFacts, minutes(15));
    expect(again).toEqual({ checked: false, queued: 0, keys: [] });
    // The day's look answers from the row alone: the facts were not even asked for.
    expect(loadFacts).not.toHaveBeenCalled();
    expect((await readLegalTemplatesNotice(db)).checkedAt).toBe(NOW.toISOString());
    expect(await notices()).toHaveLength(2);
  });

  it("checks again the next day, and queues nothing for the same change", async () => {
    await approveOwn("TERMS", "v1");
    await announceLegalTemplateChanges(db, facts, NOW);

    // The same day, even after the hour, it is not the digest's turn again: the row alone answers.
    const sameDay = vi.fn(facts);
    expect(await announceLegalTemplateChanges(db, sameDay, HOUR_LATER)).toEqual({ checked: false, queued: 0, keys: [] });
    expect(sameDay).not.toHaveBeenCalled();

    const later = await announceLegalTemplateChanges(db, facts, DAY_LATER);
    expect(later).toEqual({ checked: true, queued: 0, keys: ["TERMS"] });
    expect(await notices()).toHaveLength(2);
    expect((await readLegalTemplatesNotice(db)).checkedAt).toBe(DAY_LATER.toISOString());
    // The announcement itself is remembered as it was.
    expect((await readLegalTemplatesNotice(db)).announcedAt).toBe(NOW.toISOString());
  });

  it("queues nothing once the club has approved the newer texts", async () => {
    await approveOwn("TERMS", "v1");
    await announceLegalTemplateChanges(db, facts, NOW);
    await approveTemplate("TERMS", FACTS, minutes(30));

    const after = await announceLegalTemplateChanges(db, facts, DAY_LATER);
    expect(after).toEqual({ checked: true, queued: 0, keys: [] });
    expect(await notices()).toHaveLength(2);
  });

  it("never announces a change the club approved before the check", async () => {
    await approveTemplate("TERMS", FACTS, NOW);
    expect(await announceLegalTemplateChanges(db, facts, NOW)).toEqual({ checked: true, queued: 0, keys: [] });
    expect(await notices()).toHaveLength(0);
    // Nothing was announced, so nothing is remembered but the check.
    const notice = await readLegalTemplatesNotice(db);
    expect(notice.fingerprint).toBeNull();
    expect(notice.announcedAt).toBeNull();
  });

  it("does not announce again while the club approves part of what it was told", async () => {
    await approveOwn("TERMS", "v1");
    await approveOwn("PRIVACY_NOTICE", "v1");
    expect((await announceLegalTemplateChanges(db, facts, NOW)).queued).toBe(2);
    await approveTemplate("PRIVACY_NOTICE", FACTS, minutes(10));

    expect(await announceLegalTemplateChanges(db, facts, DAY_LATER)).toEqual({ checked: true, queued: 0, keys: ["TERMS"] });
    expect(await notices()).toHaveLength(2);
  });

  it("queues again for a later change of the templates: a new fingerprint", async () => {
    await approveTemplate("TERMS", FACTS, NOW);
    await approveOwn("PRIVACY_NOTICE", "v1");
    expect((await announceLegalTemplateChanges(db, facts, NOW)).queued).toBe(2);
    const first = await readLegalTemplatesNotice(db);

    // The terms' filled template now reads differently (here through the facts written into it, as a
    // release that rewrote a sentence would): «Șablon nou» on the terms too.
    const moved: ClubFacts = { ...FACTS, contactEmail: "nou@example.test", contactEmailEn: "nou@example.test" };
    const later = await announceLegalTemplateChanges(db, async () => moved, DAY_LATER);
    expect(later).toEqual({ checked: true, queued: 2, keys: ["PRIVACY_NOTICE", "TERMS"] });

    const second = await readLegalTemplatesNotice(db);
    expect(second.fingerprint).not.toBe(first.fingerprint);
    expect(second.announcedAt).toBe(DAY_LATER.toISOString());
    const rows = await notices();
    expect(rows).toHaveLength(4);
    expect(new Set(rows.map((row) => row.idempotencyKey)).size).toBe(4);
  });

  it("reads a row the hourly check kept before the digest: its stamp is ignored, its announcement still counts", async () => {
    await approveOwn("TERMS", "v1");
    await announceLegalTemplateChanges(db, facts, NOW);
    const [row] = await db.select().from(platformSettings).where(eq(platformSettings.key, LEGAL_TEMPLATES_NOTICE_SETTING_KEY));
    // As the row looked before §775: the same fields and a `templatesStamp`, the last look yesterday.
    await db
      .update(platformSettings)
      .set({ value: { ...(row.value as object), templatesStamp: "0".repeat(64), checkedAt: new Date(NOW.getTime() - 24 * 60 * 60_000).toISOString() } })
      .where(eq(platformSettings.key, LEGAL_TEMPLATES_NOTICE_SETTING_KEY));
    // Today's look is due, finds the same change, and says nothing again: no second email.
    expect(await announceLegalTemplateChanges(db, facts, NOW)).toEqual({ checked: true, queued: 0, keys: ["TERMS"] });
    expect(await notices()).toHaveLength(2);
    expect(await readLegalTemplatesNotice(db)).not.toHaveProperty("templatesStamp");
  });

  it("sends one email per person per change, whatever happens to the settings row", async () => {
    await approveOwn("TERMS", "v1");
    await announceLegalTemplateChanges(db, facts, NOW);
    await db.delete(platformSettings).where(eq(platformSettings.key, LEGAL_TEMPLATES_NOTICE_SETTING_KEY));

    // The row is gone, so the same change reads as unannounced — and the idempotency key holds.
    expect((await announceLegalTemplateChanges(db, facts, minutes(5))).queued).toBe(0);
    expect(await notices()).toHaveLength(2);
  });

  /*
    §775 — the digest. 2026-10-03 in Brașov is summer time (UTC+3): 00:00Z is 03:00, 05:00Z is 08:00.
    Every instant is the run's `now`, handed in; nothing here reads the real clock. All of them come
    after NOW, when the club's own texts were approved, so each template reads as newer.
  */
  const NIGHT = new Date("2026-10-03T00:00:00.000Z"); // 03:00 club time
  const BEFORE_EIGHT = new Date("2026-10-03T04:59:00.000Z"); // 07:59
  const MORNING = new Date("2026-10-03T05:30:00.000Z"); // 08:30
  const MID_MORNING = new Date("2026-10-03T06:00:00.000Z"); // 09:00
  const NEXT_MORNING = new Date("2026-10-04T05:30:00.000Z"); // 08:30 the next day

  it("two changes before the morning, one email per person naming both texts", async () => {
    // Two releases in a night: the terms' template moves, the runs before 08:00 say nothing, then the notice's moves too.
    await approveOwn("TERMS", "v1");
    const early = vi.fn(facts);
    expect(await announceLegalTemplateChanges(db, early, NIGHT)).toEqual({ checked: false, queued: 0, keys: [] });
    await approveOwn("PRIVACY_NOTICE", "v1");
    expect(await announceLegalTemplateChanges(db, early, BEFORE_EIGHT)).toEqual({ checked: false, queued: 0, keys: [] });
    // Before 08:00 the step reads the row and nothing else: not the overview, not the facts.
    expect(early).not.toHaveBeenCalled();
    expect(await notices()).toHaveLength(0);

    expect(await announceLegalTemplateChanges(db, facts, MORNING)).toEqual({ checked: true, queued: 2, keys: ["PRIVACY_NOTICE", "TERMS"] });
    const rows = await notices();
    expect(rows).toHaveLength(2);
    for (const row of rows) expect((row.payloadJson as { keys: string[] }).keys).toEqual(["PRIVACY_NOTICE", "TERMS"]);
    // The email names both texts, grouped on its one bold line.
    const mail = await renderOutboxMessage(rows.find((row) => row.locale === "ro")!, db, MORNING);
    expect(mail.text).toContain("Șablon nou: GDPR · Termeni de concurs");
  });

  it("sends nothing when nothing changed, that morning or the next", async () => {
    await approveTemplate("TERMS", FACTS, NOW);
    expect(await announceLegalTemplateChanges(db, facts, MORNING)).toEqual({ checked: true, queued: 0, keys: [] });
    expect(await announceLegalTemplateChanges(db, facts, NEXT_MORNING)).toEqual({ checked: true, queued: 0, keys: [] });
    expect(await notices()).toHaveLength(0);
    expect((await readLegalTemplatesNotice(db)).announcedAt).toBeNull();
  });

  it("holds a change that lands after the day's digest for the next day's, which names it with the rest", async () => {
    await approveOwn("TERMS", "v1");
    expect((await announceLegalTemplateChanges(db, facts, MORNING)).queued).toBe(2);

    // 09:00: another template moves. Not the digest's turn again today, however often the job runs.
    await approveOwn("PRIVACY_NOTICE", "v1", MID_MORNING);
    const sameDay = vi.fn(facts);
    for (const at of [MID_MORNING, new Date("2026-10-03T15:00:00.000Z"), new Date("2026-10-03T20:59:00.000Z")]) {
      expect(await announceLegalTemplateChanges(db, sameDay, at)).toEqual({ checked: false, queued: 0, keys: [] });
    }
    expect(sameDay).not.toHaveBeenCalled();
    expect(await notices()).toHaveLength(2);

    // 08:30 the next day: one more email each, naming the new text and the one still waiting.
    expect(await announceLegalTemplateChanges(db, facts, NEXT_MORNING)).toEqual({ checked: true, queued: 2, keys: ["PRIVACY_NOTICE", "TERMS"] });
    const rows = await notices();
    expect(rows).toHaveLength(4);
    expect(new Set(rows.map((row) => row.idempotencyKey)).size).toBe(4);
    expect((await readLegalTemplatesNotice(db)).announcedAt).toBe(NEXT_MORNING.toISOString());
  });

  it("is one look a day: after a morning that found nothing, changes at 10:00 and 14:00 send nothing that day and one email the next morning naming both", async () => {
    // 08:30: nothing newer than the text in force, so nothing is sent — and that was the day's look.
    await approveTemplate("TERMS", FACTS, NOW);
    await approveTemplate("PRIVACY_NOTICE", FACTS, NOW);
    expect(await announceLegalTemplateChanges(db, facts, MORNING)).toEqual({ checked: true, queued: 0, keys: [] });

    // 10:00 (07:00Z) the terms' template moves, 14:00 (11:00Z) the notice's: a club's own text goes in force over each.
    await approveOwn("TERMS", "v1", new Date("2026-10-03T07:00:00.000Z"));
    await approveOwn("PRIVACY_NOTICE", "v1", new Date("2026-10-03T11:00:00.000Z"));
    const sameDay = vi.fn(facts);
    // Every fifteen minutes from 10:00 to 22:45 club time (07:00Z–19:45Z): the row alone answers, never a second email.
    for (let at = Date.parse("2026-10-03T07:00:00.000Z"); at <= Date.parse("2026-10-03T19:45:00.000Z"); at += 15 * 60_000) {
      expect(await announceLegalTemplateChanges(db, sameDay, new Date(at))).toEqual({ checked: false, queued: 0, keys: [] });
    }
    expect(sameDay).not.toHaveBeenCalled();
    expect(await notices()).toHaveLength(0);

    // 08:30 the next day: ONE email each, naming both.
    expect(await announceLegalTemplateChanges(db, facts, NEXT_MORNING)).toEqual({ checked: true, queued: 2, keys: ["PRIVACY_NOTICE", "TERMS"] });
    const rows = await notices();
    expect(rows).toHaveLength(2);
    for (const row of rows) expect((row.payloadJson as { keys: string[] }).keys).toEqual(["PRIVACY_NOTICE", "TERMS"]);
  });

  it("a release at 22:30 is not emailed that night: the hourly night runs at 23:00 and 00:00 say nothing, 08:00 does", async () => {
    await approveTemplate("TERMS", FACTS, NOW);
    expect(await announceLegalTemplateChanges(db, facts, MORNING)).toEqual({ checked: true, queued: 0, keys: [] });

    // 22:30 club time is 19:30Z; the night runs are hourly, at :02.
    await approveOwn("TERMS", "v1", new Date("2026-10-03T19:30:00.000Z"));
    for (const at of ["2026-10-03T20:02:00.000Z", "2026-10-03T21:02:00.000Z", "2026-10-04T00:02:00.000Z", "2026-10-04T04:02:00.000Z"]) {
      expect(await announceLegalTemplateChanges(db, facts, new Date(at)), at).toEqual({ checked: false, queued: 0, keys: [] });
    }
    expect(await notices()).toHaveLength(0);
    expect((await announceLegalTemplateChanges(db, facts, NEXT_MORNING)).queued).toBe(2);
  });

  it("at most one digest per environment per day, however often the job runs", async () => {
    await approveOwn("TERMS", "v1");
    let queued = 0;
    // Every fifteen minutes from 07:00 to 20:00 club time (04:00Z–17:00Z).
    for (let at = Date.parse("2026-10-03T04:00:00.000Z"); at <= Date.parse("2026-10-03T17:00:00.000Z"); at += 15 * 60_000) {
      queued += (await announceLegalTemplateChanges(db, facts, new Date(at))).queued;
    }
    expect(queued).toBe(2);
    expect(await notices()).toHaveLength(2);
  });

  it("keeps «the last digest» in storage: a restart reads the mark back and sends nothing again", async () => {
    await approveOwn("TERMS", "v1");
    expect((await announceLegalTemplateChanges(db, facts, MORNING)).queued).toBe(2);

    // What survives a restart is the row, read raw: the mark is `announcedAt`, in the strict shape.
    const [row] = await db.select().from(platformSettings).where(eq(platformSettings.key, LEGAL_TEMPLATES_NOTICE_SETTING_KEY));
    expect(legalTemplatesNoticeSchema.parse(row.value).announcedAt).toBe(MORNING.toISOString());

    // A new process: every module loaded afresh, nothing remembered but what the database holds.
    vi.resetModules();
    const fresh = await import("@/modules/legal-documents/templates-notice");
    await approveOwn("PRIVACY_NOTICE", "v1", MID_MORNING);
    const afterRestart = vi.fn(facts);
    expect(await fresh.announceLegalTemplateChanges(db, afterRestart, MID_MORNING)).toEqual({ checked: false, queued: 0, keys: [] });
    expect(afterRestart).not.toHaveBeenCalled();
    expect((await fresh.readLegalTemplatesNotice(db)).announcedAt).toBe(MORNING.toISOString());
    // …and the next day it sends, from the same row.
    expect((await fresh.announceLegalTemplateChanges(db, facts, NEXT_MORNING)).queued).toBe(2);
    expect(await notices()).toHaveLength(4);
  });

  it("goes only to Administrators and Superadministrators, each once a day, never an Organizer, a Tehnic, a Redactor or a member", async () => {
    await approveOwn("TERMS", "v1");
    await announceLegalTemplateChanges(db, facts, MORNING);
    await announceLegalTemplateChanges(db, facts, MID_MORNING);
    expect((await notices()).map((row) => row.recipientEmail).sort()).toEqual(["admin@dev.test", "super@dev.test"]);
  });

  it("opens at 08:00 club time in winter time too: 06:00Z, not 05:00Z", async () => {
    await approveOwn("TERMS", "v1");
    // 2026-11-10 is winter time (UTC+2): 05:30Z is 07:30 — too early — and 06:00Z is 08:00.
    expect(await announceLegalTemplateChanges(db, facts, new Date("2026-11-10T05:59:00.000Z"))).toEqual({ checked: false, queued: 0, keys: [] });
    expect((await announceLegalTemplateChanges(db, facts, new Date("2026-11-10T06:00:00.000Z"))).queued).toBe(2);
  });

  it("says so in both languages: one sitting approves them all, and the email comes at most once a day", async () => {
    await approveOwn("TERMS", "v1");
    await announceLegalTemplateChanges(db, facts, MORNING);
    const rows = await notices();
    const ro = await renderOutboxMessage(rows.find((row) => row.locale === "ro")!, db, MORNING);
    expect(ro.text).toContain("Aprobă-le pe toate într-o singură ședință");
    expect(ro.text).toContain("cel mult o dată pe zi, după ora 08:00 (ora României), cu tot ce așteaptă încă aprobarea");
    expect(ro.text).not.toContain("o singură dată pentru fiecare schimbare");
    const en = await renderOutboxMessage(rows.find((row) => row.locale === "en")!, db, MORNING);
    expect(en.text).toContain("Approve them all in one sitting");
    expect(en.text).toContain("at most once a day, after 08:00 Romanian time, with everything still waiting for approval");
    expect(en.text).not.toContain("once for each change");
  });

  it("renders in the recipient's language first, names the texts, and links «Versiune nouă» on APP_BASE_URL", async () => {
    await approveOwn("TERMS", "v1");
    await approveOwn("PRIVACY_NOTICE", "v1");
    await announceLegalTemplateChanges(db, facts, NOW);
    const rows = await notices();

    const ro = await renderOutboxMessage(rows.find((row) => row.locale === "ro")!, db, NOW);
    expect(ro.to).toBe("super@dev.test");
    expect(ro.subject).toBe("Șabloanele textelor legale s-au schimbat: regenerează și aprobă / The legal templates changed: regenerate and approve");
    expect(ro.text).toContain("Salut, Ana");
    expect(ro.text).toContain("Șablon nou: GDPR · Termeni de concurs");
    expect(ro.text).toContain("New template: GDPR · Racing TOS");
    expect(ro.text).toContain("«Documente legale» → «Versiune nouă» → «Regenerează toate»");
    expect(ro.text).toContain("«O ciornă așteaptă deja»");
    // Only the terms and the notice moved: the lawyer is asked for the changed texts, the terms above all, never the declarations.
    expect(ro.text).toContain("Înainte de aprobare, un jurist ar trebui să citească textele schimbate, mai ales termenii.");
    expect(ro.text).not.toContain("citească declarațiile");
    expect(ro.text).toContain("Textele în vigoare rămân cum sunt");
    expect(ro.html).toContain(`${env.APP_BASE_URL}${getPathname({ locale: "ro", href: "/admin/legal/new" })}`);
    // No token, no participant's privacy line, no participant's links.
    expect(ro.html).not.toContain("token");
    expect(ro.text).not.toContain("Nu mai pot ajunge");

    const en = await renderOutboxMessage(rows.find((row) => row.locale === "en")!, db, NOW);
    expect(en.to).toBe("admin@dev.test");
    expect(en.subject).toBe("The legal templates changed: regenerate and approve / Șabloanele textelor legale s-au schimbat: regenerează și aprobă");
    expect(en.text).toContain("Hi John,");
    expect(en.text).toContain("«Legal documents» → «New version» → «Regenerate all»");
    expect(en.text).toContain("Before approving, a lawyer should read the changed texts, above all the terms.");
    expect(en.html).toContain(`${env.APP_BASE_URL}${getPathname({ locale: "en", href: "/admin/legal/new" })}`);
  });
});

describe("§639 a failing check never fails the job's other work", () => {
  let db: TestDatabase;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ db, close } = await createTestDatabase());
  });
  afterAll(async () => {
    vi.doUnmock("@/modules/legal-documents/templates-notice");
    vi.resetModules();
    await close();
  });

  it("counts the failure, logs it by its kind, and is not retryable", async () => {
    vi.resetModules();
    vi.doMock("@/modules/legal-documents/templates-notice", () => ({
      announceLegalTemplateChanges: async () => {
        throw new TypeError("a template that cannot be read");
      },
      legalFactsInForce: async () => ({}),
    }));
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const { runRegistrationMaintenance: run } = await import("@/modules/registrations/maintenance");

    const result = await run(db, NOW);
    expect(result.legalTemplatesNoticesQueued).toBe(0);
    expect(result.errorCount).toBe(1);
    expect(result.retryableErrorCount).toBe(0);
    // By its kind, never the error's text.
    expect(logged).toHaveBeenCalledWith("[legal-templates] the check of the legal templates failed", "TypeError");
    logged.mockRestore();
  });
});
