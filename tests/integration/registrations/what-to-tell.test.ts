import { isValidElement, type ReactElement, type ReactNode } from "react";
import { eq } from "drizzle-orm";
import { createTranslator } from "next-intl";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { emailActionTokens } from "@/db/schema/email-action-tokens";
import { events, eventTranslations } from "@/db/schema/events";
import { participants } from "@/db/schema/participants";
import { registrations } from "@/db/schema/registrations";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { formatDay } from "@/i18n/dates";
import { issueActionToken } from "@/modules/action-tokens/repository";
import { findRegistrationDetailForAdmin } from "@/modules/registrations/admin-repository";
import { resolveDisplayName } from "@/modules/registrations/names";
import { readWaitlistPosition } from "@/modules/registrations/repository";
import { whatToTell } from "@/modules/registrations/ui/tell-words";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * BR-REQ-037-01 (§NNN) — «Ce îi spui» on the registration's page, from a real database:
 *
 * - the page's own query carries what the block says — where a waiting row stands, equal to the
 *   participant's reader (`readWaitlistPosition`), and the newest live link's expiry — no other read;
 * - the block sits under the state and above the verbs, for the Administrator and the Organizer alike,
 *   in the registration's language, with a caption naming that language only when it is not the reader's;
 * - it carries no address.
 */
const state = vi.hoisted(() => ({ db: undefined as unknown, actor: undefined as unknown, locale: "ro" as "ro" | "en" }));

vi.mock("next-intl/server", () => ({
  getTranslations: async (namespace: string) => {
    const catalogue = (state.locale === "ro" ? ro : en) as unknown as Record<string, Record<string, unknown>>;
    return createTranslator({ locale: state.locale, messages: catalogue[namespace] as never });
  },
  getLocale: async () => state.locale,
  setRequestLocale: () => undefined,
}));
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }), headers: async () => new Headers() }));
vi.mock("next/cache", async () => (await import("../../helpers/next-cache")).fakeNextCache.module);
vi.mock("@/auth", () => ({ auth: async () => null, signIn: async () => {}, signOut: async () => {} }));
vi.mock("@/db/client", () => ({ getDb: () => state.db }));
vi.mock("@/i18n/navigation", () => ({ getPathname: () => "/ro/admin/registrations", Link: () => null }));
vi.mock("@/modules/staff-identity/session", () => ({
  DEV_STAFF_COOKIE: "dev-staff",
  requireStaff: async () => state.actor,
  requireStaffCapability: async () => state.actor,
}));
vi.mock("@/app/[locale]/admin/registrations/actions", () => ({
  resendRegistrationEmailAction: vi.fn(),
  cancelRegistrationAction: vi.fn(),
  checkInAction: vi.fn(),
  confirmRegistrationNowAction: vi.fn(),
  editRegistrationAnswersAction: vi.fn(),
  deleteRegistrationAction: vi.fn(),
  givePlaceNowAction: vi.fn(),
  offerPlaceAction: vi.fn(),
  setOutsideCapacityAction: vi.fn(),
  promoteRegistrationAction: vi.fn(),
  setBibNumberAction: vi.fn(),
  withdrawConsentAction: vi.fn(),
  declarationHoldAction: vi.fn(),
}));
vi.mock("@/app/[locale]/admin/registrations/[id]/actions", () => ({
  resendFamilyEmailAction: vi.fn(),
  resendRegistrationEmailAction: vi.fn(),
}));
vi.mock("@/modules/notifications/send-now-choice", () => ({ sendNowChoiceFor: async () => null }));

const { default: RegistrationDetailPage } = await import("@/app/[locale]/admin/registrations/[id]/page");
const { default: WhatToTell } = await import("@/modules/registrations/ui/WhatToTell");
const { default: StaffJourney } = await import("@/modules/registrations/ui/StaffJourney");

type Props = Record<string, unknown> & { children?: ReactNode };

function elements(node: ReactNode, acc: ReactElement<Props>[] = []): ReactElement<Props>[] {
  if (Array.isArray(node)) {
    for (const child of node) elements(child as ReactNode, acc);
    return acc;
  }
  if (!isValidElement<Props>(node)) return acc;
  acc.push(node);
  elements(node.props.children, acc);
  return acc;
}

let db: TestDatabase;
let close: () => Promise<void>;

const HOUR = 60 * 60_000;

async function createRace(options: { autoOffer?: boolean; cancelled?: boolean } = {}) {
  const [event] = await db
    .insert(events)
    .values({
      type: "RACE",
      surface: "ASPHALT",
      startsAt: new Date("2099-11-21T08:00:00.000Z"),
      timezone: "Europe/Bucharest",
      capacity: 2,
      registrationMode: "INTERNAL",
      editorialStatus: "PUBLISHED",
      publishedAt: new Date("2026-09-01T10:00:00.000Z"),
      waitlistAutoOffer: options.autoOffer ?? true,
      eventStatus: options.cancelled ? "CANCELLED" : "SCHEDULED",
    })
    .returning();
  await db.insert(eventTranslations).values([
    { eventId: event.id, locale: "ro", slug: `cros-${event.id}-ro`, title: "Crosul" },
    { eventId: event.id, locale: "en", slug: `cros-${event.id}-en`, title: "The cross" },
  ]);
  return event;
}

let serial = 0;
async function register(eventId: string, name: string, row: Partial<typeof registrations.$inferInsert>) {
  serial += 1;
  const email = `runner${serial}@example.org`;
  const [participant] = await db
    .insert(participants)
    .values({ deliveryEmail: email, normalizedEmail: email, canonicalEmail: email, canonicalizationVersion: 1, defaultName: name, preferredLocale: "ro" })
    .returning();
  const [created] = await db
    .insert(registrations)
    .values({
      eventId,
      participantId: participant.id,
      kind: "REAL",
      locale: "ro",
      registeredName: name,
      displayName: resolveDisplayName({ legalName: name }),
      privacyNoticeVersion: 1,
      privacyAcknowledgedAt: new Date(),
      resultsNameConsent: false,
      resultsConsentVersion: 1,
      status: "CONFIRMED",
      ...row,
    })
    .returning({ id: registrations.id, participantId: registrations.participantId });
  return created;
}

async function staff(role: "ADMIN" | "MODERATOR"): Promise<StaffUser> {
  const [user] = await db.insert(staffUsers).values({ email: `${role.toLowerCase()}-${serial}@dev.test`, displayName: role, role }).returning();
  return user;
}

async function page(id: string) {
  const tree = await RegistrationDetailPage({ params: Promise.resolve({ locale: state.locale, id }), searchParams: Promise.resolve({}) } as never);
  return elements(tree);
}

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
  state.db = db;
});
afterAll(async () => close());
beforeEach(async () => {
  await resetTables(db);
  state.locale = "ro";
});

describe("§NNN «Ce îi spui» — the page's own query", () => {
  it("says where a waiting row stands exactly as the participant's reader does, a test row in the line too", async () => {
    for (const autoOffer of [true, false]) {
      const race = await createRace({ autoOffer });
      const base = Date.now() - 10 * HOUR;
      const waiting = [];
      for (const [index, kind] of (["REAL", "TEST", "REAL"] as const).entries()) {
        waiting.push(await register(race.id, `Așteaptă ${index}`, { status: "WAITLISTED", kind, waitlistedAt: new Date(base + index * HOUR) }));
      }
      const confirmed = await register(race.id, "Confirmat", { status: "CONFIRMED" });
      for (const row of waiting) {
        const detail = await findRegistrationDetailForAdmin(db, row.id);
        const reader = await readWaitlistPosition(db, row.id);
        expect(reader).not.toBeNull();
        expect({ position: detail?.waitlistPosition, length: detail?.waitlistLength, autoOffer: detail?.waitlistAutoOffer, countPublic: detail?.waitlistCountPublic }).toEqual(reader);
      }
      const notWaiting = await findRegistrationDetailForAdmin(db, confirmed.id);
      expect([notWaiting?.waitlistPosition, notWaiting?.waitlistLength]).toEqual([null, null]);
    }
  });

  it("says no position on a cancelled event, as the participant's reader does", async () => {
    const race = await createRace({ cancelled: true });
    const row = await register(race.id, "Așteaptă", { status: "WAITLISTED", waitlistedAt: new Date() });
    const detail = await findRegistrationDetailForAdmin(db, row.id);
    expect(await readWaitlistPosition(db, row.id)).toBeNull();
    expect([detail?.waitlistPosition, detail?.eventCancelled]).toEqual([null, true]);
  });

  it("carries the newest live link's expiry: not a used, superseded, lapsed or unrelated one", async () => {
    const race = await createRace();
    const row = await register(race.id, "Semnează", { status: "PENDING_DECLARATION", holdExpiresAt: new Date(Date.now() + 48 * HOUR) });
    const now = new Date();
    expect((await findRegistrationDetailForAdmin(db, row.id, now))?.liveLinkExpiresAt).toBeNull();

    const first = new Date(now.getTime() + 24 * HOUR);
    await issueActionToken(db, { participantId: row.participantId, registrationId: row.id, purpose: "COMPLETE_DECLARATION", expiresAt: first, now });
    expect((await findRegistrationDetailForAdmin(db, row.id, now))?.liveLinkExpiresAt?.getTime()).toBe(first.getTime());

    // The public list's switch says nothing of where the registration stands.
    await issueActionToken(db, { participantId: row.participantId, registrationId: row.id, purpose: "LIST_CONSENT", expiresAt: new Date(now.getTime() + 90 * 24 * HOUR), now: new Date(now.getTime() + 1000) });
    expect((await findRegistrationDetailForAdmin(db, row.id, now))?.liveLinkExpiresAt?.getTime()).toBe(first.getTime());

    // A resend supersedes the earlier link: the newer one's expiry.
    const second = new Date(now.getTime() + 30 * HOUR);
    await issueActionToken(db, { participantId: row.participantId, registrationId: row.id, purpose: "COMPLETE_DECLARATION", expiresAt: second, now: new Date(now.getTime() + 2000) });
    expect((await findRegistrationDetailForAdmin(db, row.id, now))?.liveLinkExpiresAt?.getTime()).toBe(second.getTime());

    // Past it, or once used, none.
    expect((await findRegistrationDetailForAdmin(db, row.id, new Date(second.getTime() + 1000)))?.liveLinkExpiresAt).toBeNull();
    await db.update(emailActionTokens).set({ usedAt: new Date() }).where(eq(emailActionTokens.purpose, "COMPLETE_DECLARATION"));
    expect((await findRegistrationDetailForAdmin(db, row.id, now))?.liveLinkExpiresAt).toBeNull();
  });
});

describe("§NNN «Ce îi spui» — on the registration's page", () => {
  it("under the state and above the verbs, for the Administrator and the Organizer, in the registration's language", async () => {
    const race = await createRace();
    const hold = new Date(Date.now() + 48 * HOUR);
    const row = await register(race.id, "Ana Semnează", { status: "PENDING_DECLARATION", holdExpiresAt: hold, locale: "en" });
    const link = new Date(Date.now() + 24 * HOUR);
    await issueActionToken(db, { participantId: row.participantId, registrationId: row.id, purpose: "COMPLETE_DECLARATION", expiresAt: link, now: new Date() });

    for (const role of ["ADMIN", "MODERATOR"] as const) {
      state.actor = await staff(role);
      const all = await page(row.id);
      const block = all.find((element) => element.type === WhatToTell);
      expect(block, role).toBeDefined();
      const props = block!.props as unknown as { title: string; help: string; languageNote: string | null; lang: string; lines: string[] };
      expect(props.title).toBe("Ce îi spui");
      expect(props.help).toBe(ro.Admin.registrations.tell.help);
      // The registration is English and the reader reads Romanian: the caption names the language.
      expect(props.languageNote).toBe("În engleză, limba în care s-a înscris.");
      expect(props.lang).toBe("en");
      const detail = await findRegistrationDetailForAdmin(db, row.id);
      expect(props.lines).toEqual(whatToTell("en", detail!, new Date()));
      expect(props.lines[0]).toBe("Your registration: Awaiting the declaration.");
      const at = formatDay(link, { locale: "en", timeZone: "Europe/Bucharest", style: "long", withTime: true, position: "inline" });
      expect(props.lines).toContain(`The link in the email is valid until ${at}.`);

      // Under the journey, above the first verb.
      const index = (predicate: (element: ReactElement<Props>) => boolean) => all.findIndex(predicate);
      expect(index((element) => element.type === StaffJourney)).toBeLessThan(index((element) => element.type === WhatToTell));
      if (role === "ADMIN") expect(index((element) => element.type === WhatToTell)).toBeLessThan(index((element) => element.props["data-testid"] === "resend-form"));

      // No address in what is told, nor in the block's markup.
      const html = renderToStaticMarkup(block!);
      expect(html).not.toContain("@example.org");
      expect(html).toContain("data-testid=\"what-to-tell\"");
    }
  });

  it("names no language when the registration's is the reader's", async () => {
    const race = await createRace();
    const row = await register(race.id, "Ion Confirmat", { status: "CONFIRMED", bibNumber: 17 });
    state.actor = await staff("ADMIN");
    const block = (await page(row.id)).find((element) => element.type === WhatToTell);
    const props = block!.props as unknown as { languageNote: string | null; lines: string[] };
    expect(props.languageNote).toBeNull();
    expect(props.lines).toEqual(["Înscrierea ta: Confirmată.", ro.Admin.registrations.tell.CONFIRMED, "Numărul tău de concurs: 17."]);
  });
});
