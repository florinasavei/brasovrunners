import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { emailOutbox } from "@/db/schema/email-outbox";
import { platformSettings } from "@/db/schema/platform-settings";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { getPathname } from "@/i18n/navigation";
import { textToBody } from "@/modules/legal-documents/domain/body-text";
import { legalTemplatesNoticeSchema, LEGAL_TEMPLATES_CHECK_MINUTES } from "@/modules/legal-documents/domain/templates-notice";
import { approveVersion, createDraftVersion, readLegalOverview, templateTranslations } from "@/modules/legal-documents/service";
import {
  announceLegalTemplateChanges,
  LEGAL_TEMPLATES_NOTICE_SETTING_KEY,
  legalTemplatesStamp,
  readLegalTemplatesNotice,
} from "@/modules/legal-documents/templates-notice";
import { type ClubFacts, clubFactsFromEnv } from "@/modules/legal-documents/templates/club-facts";
import { renderOutboxMessage } from "@/modules/notifications/render";
import { runRegistrationMaintenance } from "@/modules/registrations/maintenance";
import { env } from "@/shared/config/env";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * §NNN — «Șabloanele textelor legale s-au schimbat»: when a release moves a legal template, the
 * maintenance job emails every Administrator and Superadministrator, once per change, and the
 * platform still approves nothing. The trigger is `/admin/legal`'s own «Șablon nou» predicate
 * (`readLegalOverview`'s `templateNewer`); the throttle is one overview read an hour; the memory is
 * one `platform_settings` row.
 */
const NOW = new Date("2026-10-02T08:00:00.000Z");
const minutes = (count: number) => new Date(NOW.getTime() + count * 60_000);
const HOUR_LATER = minutes(LEGAL_TEMPLATES_CHECK_MINUTES);

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

describe("§NNN the Administrators are emailed when a release moves a legal template", () => {
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
  async function approveOwn(key: "TERMS" | "PRIVACY_NOTICE", suffix: string) {
    const draft = await createDraftVersion(db, admin, { key, translations: ownWords(suffix) }, NOW);
    await approveVersion(db, admin, draft, NOW);
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

  it("records the announcement in its platform_settings row, in the strict shape", async () => {
    await approveOwn("TERMS", "v1");
    await approveOwn("PRIVACY_NOTICE", "v1");
    await announceLegalTemplateChanges(db, facts, NOW);

    const [row] = await db.select().from(platformSettings).where(eq(platformSettings.key, LEGAL_TEMPLATES_NOTICE_SETTING_KEY));
    const value = legalTemplatesNoticeSchema.parse(row.value);
    expect(value.checkedAt).toBe(NOW.toISOString());
    expect(value.announcedAt).toBe(NOW.toISOString());
    expect(value.templatesStamp).toBe(legalTemplatesStamp());
    expect(value.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    // In the catalogue's order, and each with the template it was announced at.
    expect(value.keys).toEqual(["PRIVACY_NOTICE", "TERMS"]);
    expect(value.pairs).toHaveLength(2);
    expect(value.pairs.every((pair) => /^(PRIVACY_NOTICE|TERMS):[0-9a-f]{64}$/.test(pair))).toBe(true);
    // Strict: a field this code does not know is refused, never silently kept.
    expect(legalTemplatesNoticeSchema.safeParse({ ...value, extra: true }).success).toBe(false);
    // Nobody wrote it: the job did.
    expect(row.updatedByStaffUserId).toBeNull();
  });

  it("reads nothing and queues nothing a second time within the hour", async () => {
    await approveOwn("TERMS", "v1");
    expect((await announceLegalTemplateChanges(db, facts, NOW)).queued).toBe(2);

    const loadFacts = vi.fn(facts);
    const again = await announceLegalTemplateChanges(db, loadFacts, minutes(15));
    expect(again).toEqual({ checked: false, queued: 0, keys: [] });
    // The throttle answers from the row alone: the facts were not even asked for.
    expect(loadFacts).not.toHaveBeenCalled();
    expect((await readLegalTemplatesNotice(db)).checkedAt).toBe(NOW.toISOString());
    expect(await notices()).toHaveLength(2);
  });

  it("checks again after the hour, and queues nothing for the same change", async () => {
    await approveOwn("TERMS", "v1");
    await announceLegalTemplateChanges(db, facts, NOW);

    const later = await announceLegalTemplateChanges(db, facts, HOUR_LATER);
    expect(later).toEqual({ checked: true, queued: 0, keys: ["TERMS"] });
    expect(await notices()).toHaveLength(2);
    expect((await readLegalTemplatesNotice(db)).checkedAt).toBe(HOUR_LATER.toISOString());
    // The announcement itself is remembered as it was.
    expect((await readLegalTemplatesNotice(db)).announcedAt).toBe(NOW.toISOString());
  });

  it("queues nothing once the club has approved the newer texts", async () => {
    await approveOwn("TERMS", "v1");
    await announceLegalTemplateChanges(db, facts, NOW);
    await approveTemplate("TERMS", FACTS, minutes(30));

    const after = await announceLegalTemplateChanges(db, facts, HOUR_LATER);
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

    expect(await announceLegalTemplateChanges(db, facts, HOUR_LATER)).toEqual({ checked: true, queued: 0, keys: ["TERMS"] });
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
    const later = await announceLegalTemplateChanges(db, async () => moved, HOUR_LATER);
    expect(later).toEqual({ checked: true, queued: 2, keys: ["PRIVACY_NOTICE", "TERMS"] });

    const second = await readLegalTemplatesNotice(db);
    expect(second.fingerprint).not.toBe(first.fingerprint);
    expect(second.announcedAt).toBe(HOUR_LATER.toISOString());
    const rows = await notices();
    expect(rows).toHaveLength(4);
    expect(new Set(rows.map((row) => row.idempotencyKey)).size).toBe(4);
  });

  it("checks at once, inside the hour, on the first run of a release whose templates differ", async () => {
    await approveOwn("TERMS", "v1");
    await db.insert(platformSettings).values({
      key: LEGAL_TEMPLATES_NOTICE_SETTING_KEY,
      // The last check, five minutes ago, read another release's templates.
      value: { checkedAt: minutes(-5).toISOString(), templatesStamp: "0".repeat(64), fingerprint: null, announcedAt: null, keys: [], pairs: [] },
    });
    expect(await announceLegalTemplateChanges(db, facts, NOW)).toEqual({ checked: true, queued: 2, keys: ["TERMS"] });
  });

  it("sends one email per person per change, whatever happens to the settings row", async () => {
    await approveOwn("TERMS", "v1");
    await announceLegalTemplateChanges(db, facts, NOW);
    await db.delete(platformSettings).where(eq(platformSettings.key, LEGAL_TEMPLATES_NOTICE_SETTING_KEY));

    // The row is gone, so the same change reads as unannounced — and the idempotency key holds.
    expect((await announceLegalTemplateChanges(db, facts, minutes(5))).queued).toBe(0);
    expect(await notices()).toHaveLength(2);
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

describe("§NNN a failing check never fails the job's other work", () => {
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
