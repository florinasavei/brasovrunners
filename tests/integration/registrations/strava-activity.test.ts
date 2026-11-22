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
import { findFirstResultsNameAskNoticeVersion, findFirstResultsNoticeVersion } from "@/modules/legal-documents/repository";
import type { PostedResultRow } from "@/modules/results/rows";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";
import { AFTER_THE_RACE, approveResultsTexts, createRace, person, registerRunner, resetNoticeCounter } from "../../helpers/results";

/**
 * §NNN — «Activitatea ta pe Strava» (the owner, 2026-11-22: «cât de greu ar fi să-i las să-și pună link către activitate strava din
 * aplicație?», then «da» to the shape). What is protected:
 *
 * - the runner writes the link from their own registration page, through the manage link — read, never spent; GET writes nothing —,
 *   only an activity on strava.com, kept as `https://www.strava.com/activities/<id>`; an empty box or «Scoate linkul» takes it off;
 * - only a confirmed runner at a race may write one; another adult on the address may have theirs taken off, never written;
 * - one audit row per change, with `set` or `cleared` and the door — never the link, which names its athlete;
 * - the published results print it only beside a name they print: a «Participant #bib» row carries no link.
 */
const NOW = AFTER_THE_RACE;
const ACTIVITY = "https://www.strava.com/activities/16512345678";

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

const { setStravaActivityFromManageLink } = await import("@/modules/registrations/strava-activity");
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

async function linkOf(id: string): Promise<string | null> {
  const [row] = await db.select({ url: registrations.stravaActivityUrl }).from(registrations).where(eq(registrations.id, id));
  return row.url;
}

async function trail(id: string) {
  return db
    .select({ actor: auditLogs.actorStaffUserId, metadata: auditLogs.metadataJson })
    .from(auditLogs)
    .where(and(eq(auditLogs.action, "registration.strava_activity_changed"), eq(auditLogs.entityId, id)))
    .orderBy(asc(auditLogs.createdAt), asc(auditLogs.id));
}

async function page(token: string, searchParams: Record<string, string> = {}) {
  const element = (await ManageRegistrationPage({ params: Promise.resolve({ locale: "ro", token }), searchParams: Promise.resolve(searchParams) })) as ReactElement;
  return renderToStaticMarkup(element).replace(/<style[^>]*>[\s\S]*?<\/style>/g, "");
}

const line = (bib: number, time: string): PostedResultRow => ({ key: `r[${bib}]`, bib: String(bib), name: "", sex: "", birthDate: "", time, status: "", chip: "", note: "" });

async function publicLinks() {
  const result = await readPublicEventResults(db, raceId, {
    now: NOW,
    deadlines: DEFAULT_DEADLINES,
    noticeDescribes: true,
    termsDescribe: true,
    firstResultsNoticeVersion: await findFirstResultsNoticeVersion(db),
    firstResultsNameAskNoticeVersion: await findFirstResultsNameAskNoticeVersion(db),
  });
  return Object.fromEntries((result?.rows ?? []).map((row) => [row.bibNumber, [row.name, row.stravaActivityUrl]]));
}

describe("§NNN «Activitatea ta pe Strava» on the runner's own page", () => {
  it("asks a confirmed runner at a race after its start, the box empty — and rendering writes nothing", async () => {
    const ana = await registerRunner(db, raceId, { name: "Ana Popescu", bibNumber: 101 });
    const token = await manageLink(ana);
    const html = await page(token);
    expect(html).toContain("Activitatea ta pe Strava");
    expect(html).toContain('data-testid="manage-strava-activity-box"');
    expect(html).not.toContain('data-testid="manage-strava-activity-remove"');
    // GET never mutates (BR-REQ-036-02 criterion 4): the link is not spent and nothing is written.
    const [link] = await db.select({ usedAt: emailActionTokens.usedAt }).from(emailActionTokens).where(eq(emailActionTokens.registrationId, ana.id));
    expect(link.usedAt).toBeNull();
    expect(await trail(ana.id)).toEqual([]);
  });

  it("does not ask before the race's start, at an event that takes no results, or a registration not confirmed", async () => {
    const ana = await registerRunner(db, raceId, { name: "Ana Popescu", bibNumber: 101 });
    const bia = await registerRunner(db, raceId, { name: "Bia Marin", bibNumber: 102, status: "PENDING_DECLARATION" });
    const [anaLink, biaLink] = [await manageLink(ana), await manageLink(bia)];
    expect(await page(biaLink)).not.toContain('data-testid="manage-strava-activity"');
    await expect(setStravaActivityFromManageLink(db, biaLink, ACTIVITY, NOW)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await db.update(events).set({ type: "GROUP_RUN" }).where(eq(events.id, raceId));
    expect(await page(anaLink)).not.toContain('data-testid="manage-strava-activity"');
    await expect(setStravaActivityFromManageLink(db, anaLink, ACTIVITY, NOW)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await db.update(events).set({ type: "RACE", startsAt: new Date(NOW.getTime() + 24 * 3_600_000) }).where(eq(events.id, raceId));
    expect(await page(anaLink)).not.toContain('data-testid="manage-strava-activity"');
    expect(await linkOf(ana.id)).toBeNull();
  });

  it("keeps a strava.com activity, normalised, audited without the link; the same link again writes nothing; an empty box takes it off", async () => {
    const ana = await registerRunner(db, raceId, { name: "Ana Popescu", bibNumber: 101 });
    const token = await manageLink(ana);
    expect(await setStravaActivityFromManageLink(db, token, "strava.com/activities/16512345678/overview", NOW)).toEqual({ ok: true, changed: true });
    expect(await linkOf(ana.id)).toBe(ACTIVITY);
    expect(revalidated).toContain("places");
    expect(await setStravaActivityFromManageLink(db, token, ACTIVITY, NOW)).toEqual({ ok: true, changed: false });
    // The page draws it back in the box, with the way out.
    const html = await page(token, { strava: "1" });
    expect(html).toContain(`value="${ACTIVITY}"`);
    expect(html).toContain('data-testid="manage-strava-activity-remove"');
    expect(html).toContain("Am salvat linkul activității.");
    expect(await setStravaActivityFromManageLink(db, token, "  ", new Date(NOW.getTime() + 60_000))).toEqual({ ok: true, changed: true });
    expect(await linkOf(ana.id)).toBeNull();
    const rows = await trail(ana.id);
    expect(rows).toEqual([
      { actor: null, metadata: { to: "set", via: "MANAGE_LINK" } },
      { actor: null, metadata: { to: "cleared", via: "MANAGE_LINK" } },
    ]);
    expect(JSON.stringify(rows)).not.toContain("16512345678");
  });

  it("refuses the app's redirector, a profile or another site, and keeps what was there", async () => {
    const ana = await registerRunner(db, raceId, { name: "Ana Popescu", bibNumber: 101 });
    const token = await manageLink(ana);
    await setStravaActivityFromManageLink(db, token, ACTIVITY, NOW);
    for (const typed of ["https://strava.app.link/AbCdEf", "https://www.strava.com/athletes/12345", "https://example.org/activities/1"]) {
      await expect(setStravaActivityFromManageLink(db, token, typed, NOW)).rejects.toMatchObject({ code: "VALIDATION_ERROR", fields: ["stravaActivityInvalid"] });
    }
    expect(await linkOf(ana.id)).toBe(ACTIVITY);
    expect(await page(token, { strava: "i" })).toContain("Linkul nu e al unei activități de pe strava.com");
  });

  it("lets the link take another adult's link off, never write one; a stranger's registration is NOT_FOUND", async () => {
    const ana = await registerRunner(db, raceId, { name: "Ana Popescu", bibNumber: 101 });
    const other = await registerRunner(db, raceId, { name: "Dan Ionescu", bibNumber: 103 });
    // Dan on Ana's address: another adult (§421).
    await db.update(registrations).set({ participantId: ana.participantId }).where(eq(registrations.id, other.id));
    const token = await manageLink(ana);
    await expect(setStravaActivityFromManageLink(db, token, ACTIVITY, NOW, other.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await db.update(registrations).set({ stravaActivityUrl: ACTIVITY }).where(eq(registrations.id, other.id));
    expect(await setStravaActivityFromManageLink(db, token, "", NOW, other.id)).toEqual({ ok: true, changed: true });
    expect(await linkOf(other.id)).toBeNull();
    const stranger = await registerRunner(db, raceId, { name: "Eli Vasile", bibNumber: 104 });
    await expect(setStravaActivityFromManageLink(db, token, "", NOW, stranger.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("§NNN the published results print the link only beside a name they print", () => {
  it("links Ana, named, and not Bia, who is «Participant #102»", async () => {
    await approveResultsTexts(db);
    const ana = await registerRunner(db, raceId, { name: "Ana Popescu", bibNumber: 101 });
    const bia = await registerRunner(db, raceId, { name: "Bia Marin", bibNumber: 102, ticked: false });
    await setStravaActivityFromManageLink(db, await manageLink(ana), ACTIVITY, NOW);
    await setStravaActivityFromManageLink(db, await manageLink(bia), "https://www.strava.com/activities/999", NOW);
    await saveEventResults(db, admin, { eventId: raceId, rows: [line(101, "50:00"), line(102, "45:00")] }, NOW);
    await setResultsPublished(db, admin, raceId, true, NOW);
    expect(await publicLinks()).toEqual({ 101: ["Ana Popescu", ACTIVITY], 102: [null, null] });
    // A value written any other way is checked again: never a link to anywhere else.
    await db.update(registrations).set({ stravaActivityUrl: "https://example.org/x" }).where(eq(registrations.id, ana.id));
    expect((await publicLinks())[101]).toEqual(["Ana Popescu", null]);
  });
});
