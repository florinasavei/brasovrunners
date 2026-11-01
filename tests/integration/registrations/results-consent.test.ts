import { and, asc, eq } from "drizzle-orm";
import type { ReactElement, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { emailActionTokens } from "@/db/schema/email-action-tokens";
import { events } from "@/db/schema/events";
import { registrations, type Registration } from "@/db/schema/registrations";
import type { StaffUser } from "@/db/schema/staff-users";
import { issueActionToken } from "@/modules/action-tokens/repository";
import { DEFAULT_DEADLINES } from "@/modules/deadlines/domain/deadlines";
import { findFirstResultsNoticeVersion } from "@/modules/legal-documents/repository";
import type { PostedResultRow } from "@/modules/results/rows";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";
import { AFTER_THE_RACE, approvePrivacyNotice, approveResultsTexts, createRace, person, registerRunner, resetNoticeCounter, type Runner } from "../../helpers/results";

/**
 * BR-REQ-072-01, §NNN — «Vreau să apar cu numele în clasament» on the runner's own registration page.
 *
 * A runner who registered under a privacy notice that did not yet describe the results is «Participant #bib» in a published race's
 * results (§808). The owner asked for the way to be named: the runner's own press, from the manage link, recorded with the notice in
 * force. What is protected:
 *
 * - nothing is asked, and a yes is refused, until the notice in force describes the results; and never for a group run, for a
 *   registration made under the results notice, for a runner off the public list, or by the link for another adult on the address;
 * - the press is a POST through the manage link, read and never spent (GET never mutates: rendering the page writes nothing); it
 *   records `results_name_consent` and `results_consent_version` = the notice in force, once, with one audit row without the name;
 *   a second press withdraws;
 * - the published results name the runner with the consent and every condition they applied before, and not after a withdrawal.
 */
const NOW = AFTER_THE_RACE;
const LATER = new Date(NOW.getTime() + 60_000);

let db: TestDatabase;
let close: () => Promise<void>;
const revalidated = vi.hoisted(() => [] as string[]);

vi.mock("@/db/client", () => ({ getDb: () => db }));
vi.mock("@/modules/public-cache/cache", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/modules/public-cache/cache")>()),
  revalidatePublicContent: (content: string) => {
    revalidated.push(content);
  },
}));
// The manage page, rendered with the real catalogue.
vi.mock("next-intl/server", async (importOriginal) => {
  const { createTranslator } = await import("next-intl");
  const messages = (await import("../../../messages/ro.json")).default;
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    getTranslations: async (namespace: string) => createTranslator({ locale: "ro", messages, namespace: namespace as "Registrations" }),
    getLocale: async () => "ro",
    setRequestLocale: () => {},
  };
});
vi.mock("@/i18n/navigation", async (importOriginal) => {
  const { createElement } = await import("react");
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    Link: ({ href, children }: { href: unknown; children: ReactNode }) => createElement("a", { href: typeof href === "string" ? href : "#" }, children),
  };
});

const { setResultsNameConsent, setResultsNameConsentFromManageLink } = await import("@/modules/registrations/results-consent");
const { readPublicEventResults, saveEventResults, setResultsPublished } = await import("@/modules/results/results");
const { default: ManageRegistrationPage } = await import("@/app/[locale]/registrations/manage/[token]/page");

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
});
afterAll(async () => close());

let raceId: string;
let admin: StaffUser;

beforeEach(async () => {
  await resetTables(db);
  resetNoticeCounter();
  revalidated.length = 0;
  // The page reads the real clock; it is the day after the race.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  admin = await person(db, "ADMIN", "Ana Admin");
  raceId = (await createRace(db)).id;
});
afterEach(() => {
  vi.useRealTimers();
});

async function manageLink(registration: Registration): Promise<string> {
  const token = await issueActionToken(db, {
    participantId: registration.participantId,
    registrationId: registration.id,
    purpose: "MANAGE_REGISTRATION",
    expiresAt: new Date(NOW.getTime() + 14 * 24 * 3_600_000),
    now: new Date(NOW.getTime() - 60_000),
  });
  return token.secret;
}

async function rowOf(id: string): Promise<Registration> {
  const [row] = await db.select().from(registrations).where(eq(registrations.id, id));
  return row;
}

async function trail(id: string) {
  return db
    .select({ actor: auditLogs.actorStaffUserId, metadata: auditLogs.metadataJson })
    .from(auditLogs)
    .where(and(eq(auditLogs.action, "registration.results_name_consent_changed"), eq(auditLogs.entityId, id)))
    .orderBy(asc(auditLogs.createdAt), asc(auditLogs.id));
}

async function page(token: string, searchParams: Record<string, string> = {}) {
  const element = (await ManageRegistrationPage({ params: Promise.resolve({ locale: "ro", token }), searchParams: Promise.resolve(searchParams) })) as ReactElement;
  return renderToStaticMarkup(element).replace(/<style[^>]*>[\s\S]*?<\/style>/g, "");
}

const TICK_WORDS = "Vreau să apar cu numele în clasament";

/** The older notice (v1) the runner registered under, then the texts that describe the results (notice v2, terms v1). */
async function olderRunner(over: Partial<Runner> = {}) {
  await approvePrivacyNotice(db, { results: false });
  const ana = await registerRunner(db, raceId, { name: "Ana Popescu", bibNumber: 101, noticeVersion: 1, ...over });
  return ana;
}

const line = (bib: number, time: string): PostedResultRow => ({ key: `r[${bib}]`, bib: String(bib), name: "", sex: "", birthDate: "", time, status: "", chip: "", note: "" });

async function publicNames() {
  const result = await readPublicEventResults(db, raceId, { now: NOW, deadlines: DEFAULT_DEADLINES, noticeDescribes: true, termsDescribe: true, firstResultsNoticeVersion: await findFirstResultsNoticeVersion(db) });
  return Object.fromEntries((result?.rows ?? []).map((row) => [row.bibNumber, row.name]));
}

describe("BR-REQ-072-01 §NNN the runner's page asks «Vreau să apar cu numele în clasament» only when it may", () => {
  it("shows nothing and refuses a yes while the notice in force does not describe the results", async () => {
    const ana = await olderRunner();
    const token = await manageLink(ana);
    expect(await page(token)).not.toContain(TICK_WORDS);
    await expect(setResultsNameConsentFromManageLink(db, token, true, NOW)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(await rowOf(ana.id)).toMatchObject({ resultsNameConsent: false, resultsConsentVersion: 1 });
    expect(await trail(ana.id)).toEqual([]);
  });

  it("shows the tick, empty, with what is published, once the notice in force describes the results — and rendering writes nothing", async () => {
    const ana = await olderRunner();
    await approveResultsTexts(db);
    const token = await manageLink(ana);
    const before = await rowOf(ana.id);
    const html = await page(token);
    expect(html).toContain(TICK_WORDS);
    expect(html).toContain('data-testid="manage-results-name-tick"');
    expect(html).toMatch(/role="checkbox"[^>]*aria-checked="false"/);
    expect(html).toContain("doar cât ești pe lista publică");
    // GET never mutates (BR-REQ-036-02 criterion 4): the row and the token are as they were.
    expect(await rowOf(ana.id)).toEqual(before);
    const [link] = await db.select({ usedAt: emailActionTokens.usedAt }).from(emailActionTokens).where(eq(emailActionTokens.registrationId, ana.id));
    expect(link.usedAt).toBeNull();
  });

  it("does not ask a runner who registered under the results notice", async () => {
    await approveResultsTexts(db);
    const ana = await registerRunner(db, raceId, { name: "Ana Popescu", bibNumber: 101, noticeVersion: 1 });
    const token = await manageLink(ana);
    expect(await page(token)).not.toContain(TICK_WORDS);
    await expect(setResultsNameConsentFromManageLink(db, token, true, NOW)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("does not ask at an event that takes no results", async () => {
    await db.update(events).set({ type: "GROUP_RUN" }).where(eq(events.id, raceId));
    const ana = await olderRunner();
    await approveResultsTexts(db);
    const token = await manageLink(ana);
    expect(await page(token)).not.toContain(TICK_WORDS);
    await expect(setResultsNameConsentFromManageLink(db, token, true, NOW)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("does not ask a runner off the public list: the name in the results follows the list's tick", async () => {
    const ana = await olderRunner({ ticked: false });
    await approveResultsTexts(db);
    const token = await manageLink(ana);
    expect(await page(token)).not.toContain(TICK_WORDS);
    await expect(setResultsNameConsentFromManageLink(db, token, true, NOW)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });
});

describe("BR-REQ-072-01 §NNN the press", () => {
  it("records the consent and the notice in force through the manage link, once, audited without the name; a second press withdraws", async () => {
    const ana = await olderRunner();
    await approveResultsTexts(db);
    const token = await manageLink(ana);

    await expect(setResultsNameConsentFromManageLink(db, token, true, NOW)).resolves.toEqual({ ok: true, consent: true, changed: true });
    expect(await rowOf(ana.id)).toMatchObject({ resultsNameConsent: true, resultsConsentVersion: 2, privacyNoticeVersion: 1 });
    expect(revalidated).toEqual(["places"]);
    // The same answer twice is one change and one audit row.
    await expect(setResultsNameConsentFromManageLink(db, token, true, NOW)).resolves.toEqual({ ok: true, consent: true, changed: false });

    // The page now draws the tick ticked; the token was read, never spent.
    const html = await page(token, { results: "1", person: ana.id });
    expect(html).toMatch(/role="checkbox"[^>]*aria-checked="true"/);
    expect(html).toContain("Am salvat alegerea ta pentru clasament.");

    await expect(setResultsNameConsentFromManageLink(db, token, false, LATER)).resolves.toEqual({ ok: true, consent: false, changed: true });
    expect(await rowOf(ana.id)).toMatchObject({ resultsNameConsent: false });
    await expect(setResultsNameConsentFromManageLink(db, token, false, LATER)).resolves.toEqual({ ok: true, consent: false, changed: false });

    const rows = await trail(ana.id);
    expect(rows).toEqual([
      { actor: null, metadata: { to: true, via: "MANAGE_LINK", noticeVersion: 2 } },
      { actor: null, metadata: { to: false, via: "MANAGE_LINK" } },
    ]);
    expect(JSON.stringify(rows)).not.toContain("Ana");
  });

  it("refuses a yes for another adult on the address, accepts the way out for them, and refuses a stranger's registration", async () => {
    const ana = await olderRunner();
    await approveResultsTexts(db);
    const [mihai] = await db
      .insert(registrations)
      .values({ ...ana, id: undefined, registeredName: "Mihai Popescu", displayName: "Mihai", bibNumber: 102, checkinCode: null, birthDate: "1987-02-14", createdAt: undefined, updatedAt: undefined })
      .returning();
    const stranger = await registerRunner(db, raceId, { name: "Ion Străin", bibNumber: 103, noticeVersion: 1 });
    const token = await manageLink(ana);

    await expect(setResultsNameConsentFromManageLink(db, token, true, NOW, mihai.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(setResultsNameConsentFromManageLink(db, token, true, NOW, stranger.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await page(token)).toContain("Acordul de a apărea cu numele în clasament îl dă doar persoana");

    // Mihai said yes from his own link; Ana's link may take it back.
    await setResultsNameConsent(db, { registrationId: mihai.id, consent: true, via: "MANAGE_LINK", now: NOW });
    await expect(setResultsNameConsentFromManageLink(db, token, false, NOW, mihai.id)).resolves.toMatchObject({ ok: true, changed: true });
    expect(await rowOf(mihai.id)).toMatchObject({ resultsNameConsent: false });
  });

  it("keeps offering the way out of a yes after the notice in force stops describing the results, while a new yes is refused", async () => {
    const ana = await olderRunner();
    await approveResultsTexts(db);
    const token = await manageLink(ana);
    await setResultsNameConsentFromManageLink(db, token, true, NOW);
    // A later notice without the results (v3) comes into force.
    await approvePrivacyNotice(db, { results: false });
    const html = await page(token);
    expect(html).toContain(TICK_WORDS);
    expect(html).toMatch(/role="checkbox"[^>]*aria-checked="true"/);
    await expect(setResultsNameConsentFromManageLink(db, token, false, LATER)).resolves.toMatchObject({ ok: true, changed: true });
    expect(await page(token)).not.toContain(TICK_WORDS);
    await expect(setResultsNameConsentFromManageLink(db, token, true, LATER)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("refuses a link that is not a manage link", async () => {
    const ana = await olderRunner();
    await approveResultsTexts(db);
    await expect(setResultsNameConsentFromManageLink(db, "not-a-real-secret", true, NOW)).resolves.toMatchObject({ ok: false });
    expect(await rowOf(ana.id)).toMatchObject({ resultsNameConsent: false });
  });
});

describe("BR-REQ-072-01 §NNN the published results", () => {
  it("name the older runner with a consent, not without it, not after a withdrawal — and leave the newer registrant and the unticked as they were", async () => {
    const ana = await olderRunner();
    await approveResultsTexts(db);
    // Under the results notice (v2): named by the tick alone; Dan did not tick.
    await registerRunner(db, raceId, { name: "Bia Marin", bibNumber: 102, noticeVersion: 2 });
    await registerRunner(db, raceId, { name: "Dan Ionescu", bibNumber: 103, noticeVersion: 2, ticked: false });
    await saveEventResults(db, admin, { eventId: raceId, rows: [line(101, "50:00"), line(102, "45:00"), line(103, "40:00")] }, NOW);
    await setResultsPublished(db, admin, raceId, true, NOW);

    expect(await publicNames()).toEqual({ 101: null, 102: "Bia Marin", 103: null });

    const token = await manageLink(ana);
    await setResultsNameConsentFromManageLink(db, token, true, NOW);
    expect(await publicNames()).toEqual({ 101: "Ana Popescu", 102: "Bia Marin", 103: null });

    // Leaving the list takes the name off the results too: the tick is still required.
    await db.update(registrations).set({ listOptOut: true }).where(eq(registrations.id, ana.id));
    expect((await publicNames())[101]).toBeNull();
    await db.update(registrations).set({ listOptOut: false }).where(eq(registrations.id, ana.id));

    await setResultsNameConsentFromManageLink(db, token, false, NOW);
    expect(await publicNames()).toEqual({ 101: null, 102: "Bia Marin", 103: null });
  });
});
