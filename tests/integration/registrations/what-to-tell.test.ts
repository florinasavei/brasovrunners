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
import { formatDeadlineInSentence } from "@/modules/notifications/domain/deadline-in-sentence";
import { findRegistrationDetailForAdmin } from "@/modules/registrations/admin-repository";
import { resolveDisplayName } from "@/modules/registrations/names";
import { readWaitlistPosition } from "@/modules/registrations/repository";
import { confirmationDueMoment } from "@/modules/registrations/domain/hold-deadlines";
import { whatToTell } from "@/modules/registrations/ui/tell-words";
import { waitlistStandingPhrase } from "@/modules/registrations/ui/waitlist-position-words";
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

async function createRace(options: { autoOffer?: boolean; cancelled?: boolean; countPublic?: boolean } = {}) {
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
      waitlistCountPublic: options.countPublic ?? true,
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

  it("carries the declaration link's expiry: not a used, superseded, lapsed or unrelated one", async () => {
    const race = await createRace();
    const row = await register(race.id, "Semnează", { status: "PENDING_DECLARATION", holdExpiresAt: new Date(Date.now() + 48 * HOUR) });
    const now = new Date();
    expect((await findRegistrationDetailForAdmin(db, row.id, now))?.liveLinkExpiresAt).toBeNull();

    // As `render.ts` mints it: until the race's start, whatever the hold.
    const first = race.startsAt;
    await issueActionToken(db, { participantId: row.participantId, registrationId: row.id, purpose: "COMPLETE_DECLARATION", expiresAt: first, now });
    expect((await findRegistrationDetailForAdmin(db, row.id, now))?.liveLinkExpiresAt?.getTime()).toBe(first.getTime());

    // The public list's switch says nothing of where the registration stands.
    await issueActionToken(db, { participantId: row.participantId, registrationId: row.id, purpose: "LIST_CONSENT", expiresAt: new Date(now.getTime() + 90 * 24 * HOUR), now: new Date(now.getTime() + 1000) });
    expect((await findRegistrationDetailForAdmin(db, row.id, now))?.liveLinkExpiresAt?.getTime()).toBe(first.getTime());

    // A resend supersedes the earlier link: the newer one's expiry (the race moved an hour later meanwhile).
    const second = new Date(race.startsAt.getTime() + HOUR);
    await issueActionToken(db, { participantId: row.participantId, registrationId: row.id, purpose: "COMPLETE_DECLARATION", expiresAt: second, now: new Date(now.getTime() + 2000) });
    expect((await findRegistrationDetailForAdmin(db, row.id, now))?.liveLinkExpiresAt?.getTime()).toBe(second.getTime());

    // Past it, or once used, none.
    expect((await findRegistrationDetailForAdmin(db, row.id, new Date(second.getTime() + 1000)))?.liveLinkExpiresAt).toBeNull();
    await db.update(emailActionTokens).set({ usedAt: new Date() }).where(eq(emailActionTokens.purpose, "COMPLETE_DECLARATION"));
    expect((await findRegistrationDetailForAdmin(db, row.id, now))?.liveLinkExpiresAt).toBeNull();
  });
});

describe("§NNN «Ce îi spui» — the link the state waits on, never the «Nu mai pot veni» one", () => {
  /*
    `render.ts` mints the fourteen-day `MANAGE_REGISTRATION` link (§547) in the same send as the address's,
    the declaration's and the offer's emails, at the same `now` — and any later message mints a newer one.
    The block must still say the expiry of the link the state waits on.
  */
  const cases = [
    { status: "PENDING_EMAIL_CONFIRMATION", purpose: "VERIFY_REGISTRATION_EMAIL", hours: 48, row: { emailLinkExpiresAt: new Date(Date.now() + 48 * HOUR) } },
    // `render.ts` mints the declaration's link until the race's start (`createRace`: 2099), not the hold's 48 hours.
    { status: "PENDING_DECLARATION", purpose: "COMPLETE_DECLARATION", hours: null, row: { holdExpiresAt: new Date(Date.now() + 48 * HOUR) } },
    { status: "WAITLIST_OFFERED", purpose: "WAITLIST_OFFER", hours: 24, row: { holdExpiresAt: new Date(Date.now() + 24 * HOUR), waitlistedAt: new Date() } },
  ] as const;
  for (const one of cases) {
    it(`${one.status}: the ${one.purpose} link's expiry, with a manage link minted at the same instant and after it`, async () => {
      const race = await createRace();
      const row = await register(race.id, "Ana", { status: one.status, ...one.row });
      const now = new Date();
      const action = one.hours === null ? race.startsAt : new Date(now.getTime() + one.hours * HOUR);
      const manage = new Date(now.getTime() + 14 * 24 * HOUR);
      await issueActionToken(db, { participantId: row.participantId, registrationId: row.id, purpose: one.purpose, expiresAt: action, now });
      await issueActionToken(db, { participantId: row.participantId, registrationId: row.id, purpose: "MANAGE_REGISTRATION", expiresAt: manage, now });
      expect((await findRegistrationDetailForAdmin(db, row.id, now))?.liveLinkExpiresAt?.getTime()).toBe(action.getTime());
      // A later organizer message's manage link is newer still: the action link's expiry all the same.
      await issueActionToken(db, { participantId: row.participantId, registrationId: row.id, purpose: "MANAGE_REGISTRATION", expiresAt: manage, now: new Date(now.getTime() + 60_000) });
      expect((await findRegistrationDetailForAdmin(db, row.id, now))?.liveLinkExpiresAt?.getTime()).toBe(action.getTime());
    });
  }

  it("a state that waits on no link says none, a live manage link notwithstanding", async () => {
    for (const status of ["CONFIRMED", "WAITLISTED"] as const) {
      const race = await createRace();
      const row = await register(race.id, "Ion", { status, ...(status === "WAITLISTED" ? { waitlistedAt: new Date() } : {}) });
      const now = new Date();
      await issueActionToken(db, { participantId: row.participantId, registrationId: row.id, purpose: "MANAGE_REGISTRATION", expiresAt: new Date(now.getTime() + 14 * 24 * HOUR), now });
      expect((await findRegistrationDetailForAdmin(db, row.id, now))?.liveLinkExpiresAt, status).toBeNull();
    }
  });
});

describe("§NNN «Ce îi spui» — every state on the page, for the Administrator and the Organizer", () => {
  const roR = createTranslator({ locale: "ro", messages: ro, namespace: "Registrations" }) as unknown as (key: string, values?: Record<string, string | number>) => string;
  const tell = ro.Admin.registrations.tell;
  const at = (instant: Date) => formatDay(instant, { locale: "ro", timeZone: "Europe/Bucharest", style: "long", withTime: true, position: "inline" });
  const stateLine = (status: string) => tell.state.replace("{state}", roR(`mine.status.${status}`));
  const linkUntil = (instant: Date) => tell.linkUntil.replace("{instant}", at(instant));
  const spam = roR("spamHint.body");
  // A confirmed row says its state once, in the confirmation's own sentence.
  const confirmed = `${roR("spent.CONFIRMED.title")}.`;

  type Case = { name: string; setup: () => Promise<{ id: string; expected: string[] }> };
  const cases: Case[] = [
    {
      name: "an address to confirm, its link alive",
      setup: async () => {
        const race = await createRace();
        const link = new Date(Date.now() + 48 * HOUR);
        const row = await register(race.id, "Ana", { status: "PENDING_EMAIL_CONFIRMATION", emailLinkExpiresAt: link });
        await issueActionToken(db, { participantId: row.participantId, registrationId: row.id, purpose: "VERIFY_REGISTRATION_EMAIL", expiresAt: link, now: new Date() });
        // The link is the only instant this row has: said once.
        return { id: row.id, expected: [stateLine("PENDING_EMAIL_CONFIRMATION"), tell.PENDING_EMAIL_CONFIRMATION, linkUntil(link), spam] };
      },
    },
    {
      name: "an address to confirm, its link lapsed",
      setup: async () => {
        const race = await createRace();
        const row = await register(race.id, "Ana", { status: "PENDING_EMAIL_CONFIRMATION", emailLinkExpiresAt: new Date(Date.now() - HOUR) });
        return { id: row.id, expected: [stateLine("PENDING_EMAIL_CONFIRMATION"), tell.linkLapsed] };
      },
    },
    {
      name: "an address to confirm, a family's place reserved",
      setup: async () => {
        const race = await createRace();
        const until = new Date(Date.now() + 24 * HOUR);
        const row = await register(race.id, "Ana", { status: "PENDING_EMAIL_CONFIRMATION", holdExpiresAt: until });
        return { id: row.id, expected: [stateLine("PENDING_EMAIL_CONFIRMATION"), roR("mine.reservedUntil", { until: at(until) }), spam] };
      },
    },
    {
      name: "a declaration to sign, its link minted until the start as `render.ts` does: the hold's deadline, not the link's",
      setup: async () => {
        const race = await createRace();
        const hold = new Date(Date.now() + 48 * HOUR);
        const row = await register(race.id, "Ana", { status: "PENDING_DECLARATION", holdExpiresAt: hold });
        const now = new Date();
        await issueActionToken(db, { participantId: row.participantId, registrationId: row.id, purpose: "COMPLETE_DECLARATION", expiresAt: race.startsAt, now });
        await issueActionToken(db, { participantId: row.participantId, registrationId: row.id, purpose: "MANAGE_REGISTRATION", expiresAt: new Date(now.getTime() + 14 * 24 * HOUR), now });
        const due = confirmationDueMoment("ro", { at: hold, startsAt: race.startsAt }, at(hold));
        return { id: row.id, expected: [stateLine("PENDING_DECLARATION"), roR("mine.confirmBy", { due }), spam] };
      },
    },
    ...([
      [true, true],
      [false, true],
      [true, false],
    ] as const).map(([autoOffer, countPublic]): Case => ({
      name: `waiting, offers ${autoOffer ? "automatic" : "by the club"}, the count ${countPublic ? "public" : "private"}`,
      setup: async () => {
        const race = await createRace({ autoOffer, countPublic });
        await register(race.id, "Primul", { status: "WAITLISTED", waitlistedAt: new Date(Date.now() - 2 * HOUR) });
        const row = await register(race.id, "Al doilea", { status: "WAITLISTED", waitlistedAt: new Date(Date.now() - HOUR) });
        const standing = waitlistStandingPhrase(roR, "ro", { position: 2, length: 2, autoOffer, countPublic });
        return { id: row.id, expected: [stateLine("WAITLISTED"), standing, tell.WAITLISTED] };
      },
    })),
    {
      name: "an offer open, with the manage link minted beside it",
      setup: async () => {
        const race = await createRace();
        const now = new Date();
        const due = new Date(now.getTime() + 24 * HOUR);
        const row = await register(race.id, "Ana", { status: "WAITLIST_OFFERED", holdExpiresAt: due, waitlistedAt: new Date(now.getTime() - HOUR) });
        await issueActionToken(db, { participantId: row.participantId, registrationId: row.id, purpose: "WAITLIST_OFFER", expiresAt: due, now });
        await issueActionToken(db, { participantId: row.participantId, registrationId: row.id, purpose: "MANAGE_REGISTRATION", expiresAt: new Date(now.getTime() + 14 * 24 * HOUR), now });
        // The offer's link lapses with the offer: its instant is said once.
        // Its deadline as the offer email writes it (`render.ts`, `holdExpiresAtFormatted`).
        const said = confirmationDueMoment("ro", { at: due, startsAt: race.startsAt }, formatDeadlineInSentence(due, "Europe/Bucharest", "ro"));
        return { id: row.id, expected: [stateLine("WAITLIST_OFFERED"), tell.offer.replace("{due}", said), spam] };
      },
    },
    {
      name: "an offer lapsed",
      setup: async () => {
        const race = await createRace();
        const row = await register(race.id, "Ana", { status: "WAITLIST_OFFERED", holdExpiresAt: new Date(Date.now() - HOUR), waitlistedAt: new Date(Date.now() - 30 * HOUR) });
        return { id: row.id, expected: [stateLine("WAITLIST_OFFERED"), tell.offerLapsed] };
      },
    },
    {
      name: "an offer lapsed, a resend having minted a live offer link: no link line",
      setup: async () => {
        const race = await createRace();
        const now = new Date();
        const row = await register(race.id, "Ana", { status: "WAITLIST_OFFERED", holdExpiresAt: new Date(now.getTime() - HOUR), waitlistedAt: new Date(now.getTime() - 30 * HOUR) });
        await issueActionToken(db, { participantId: row.participantId, registrationId: row.id, purpose: "WAITLIST_OFFER", expiresAt: new Date(now.getTime() + 48 * HOUR), now });
        return { id: row.id, expected: [stateLine("WAITLIST_OFFERED"), tell.offerLapsed] };
      },
    },
    {
      name: "confirmed and checked in",
      setup: async () => {
        const race = await createRace();
        const row = await register(race.id, "Ion", { status: "CONFIRMED", bibNumber: 9, checkedInAt: new Date() });
        return { id: row.id, expected: [confirmed, tell.CONFIRMED, tell.bib.replace("{number}", "9"), roR("manage.selfCheckInDone")] };
      },
    },
    {
      name: "on «Lista de invitați speciali»: the confirmed sentence",
      setup: async () => {
        const race = await createRace();
        const row = await register(race.id, "Invitat", { status: "CONFIRMED", outsideCapacity: true, bibNumber: 3 });
        return { id: row.id, expected: [confirmed, tell.CONFIRMED, tell.bib.replace("{number}", "3")] };
      },
    },
    {
      name: "cancelled",
      setup: async () => {
        const race = await createRace();
        const row = await register(race.id, "Ana", { status: "CANCELLED", cancelledAt: new Date(), cancellationSource: "PARTICIPANT" });
        // Its own sentence names the state: said once, not framed «Înscrierea ta: Anulată.» first.
        return { id: row.id, expected: [tell.CANCELLED] };
      },
    },
    {
      name: "expired, its declaration hold lapsed",
      setup: async () => {
        const race = await createRace();
        const row = await register(race.id, "Ana", { status: "EXPIRED", expiredAt: new Date(), expiryReason: "DECLARATION_HOLD_LAPSED" });
        return { id: row.id, expected: [tell.holdLapsed] };
      },
    },
    {
      name: "expired, its address never confirmed",
      setup: async () => {
        const race = await createRace();
        const row = await register(race.id, "Ana", { status: "EXPIRED", expiredAt: new Date(), expiryReason: "EMAIL_CONFIRMATION_LAPSED" });
        return { id: row.id, expected: [tell.EXPIRED] };
      },
    },
    {
      name: "a cancelled event: the cancellation alone",
      setup: async () => {
        const race = await createRace({ cancelled: true });
        const row = await register(race.id, "Ana", { status: "PENDING_DECLARATION", holdExpiresAt: new Date(Date.now() + 48 * HOUR) });
        await issueActionToken(db, { participantId: row.participantId, registrationId: row.id, purpose: "COMPLETE_DECLARATION", expiresAt: race.startsAt, now: new Date() });
        return { id: row.id, expected: [stateLine("PENDING_DECLARATION"), roR("manage.eventCancelled")] };
      },
    },
  ];

  for (const one of cases) {
    it(one.name, async () => {
      const { id, expected } = await one.setup();
      for (const role of ["ADMIN", "MODERATOR"] as const) {
        state.actor = await staff(role);
        for (const reader of ["ro", "en"] as const) {
          state.locale = reader;
          const block = (await page(id)).find((element) => element.type === WhatToTell);
          expect(block, `${role} ${reader}`).toBeDefined();
          const props = block!.props as unknown as { languageNote: string | null; lang: string; lines: string[] };
          expect(props.lines, `${role} ${reader}`).toEqual(expected);
          // The link's expiry at most once, and never beside a held place's deadline.
          const linkLines = props.lines.filter((line) => line.startsWith(tell.linkUntil.slice(0, tell.linkUntil.indexOf("{"))));
          expect(linkLines.length, `${role} ${reader}`).toBeLessThanOrEqual(1);
          expect(props.lang).toBe("ro");
          // The registration is Romanian: a Romanian reader gets no caption, an English one is told the language.
          expect(props.languageNote).toBe(reader === "ro" ? null : en.Admin.registrations.tell.inLanguage.ro);
          for (const line of props.lines) {
            expect(line.length, line).toBeLessThan(200);
            expect(line).not.toContain("@");
          }
          // No address and no link in the block's markup — only the expiry of one.
          const html = renderToStaticMarkup(block!).replace(/<style[^>]*>[\s\S]*?<\/style>/g, "");
          for (const forbidden of ["@", "http", "://", "/registrations/"]) expect(html, forbidden).not.toContain(forbidden);
        }
      }
    });
  }
});

describe("§NNN «Ce îi spui» — on the registration's page", () => {
  it("under the state and above the verbs, for the Administrator and the Organizer, in the registration's language", async () => {
    const race = await createRace();
    const hold = new Date(Date.now() + 48 * HOUR);
    const row = await register(race.id, "Ana Semnează", { status: "PENDING_DECLARATION", holdExpiresAt: hold, locale: "en" });
    // As `render.ts` mints it: the declaration's link lives until the race's start.
    const link = race.startsAt;
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
      // The hold's deadline is the one to tell: the link's later expiry is not said.
      expect(props.lines.join(" ")).not.toContain(at);
      expect(props.lines.some((line) => line.startsWith("The link in the email is valid until"))).toBe(false);

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
    expect(props.lines).toEqual(["Înscrierea ta este confirmată.", ro.Admin.registrations.tell.CONFIRMED, "Numărul tău de concurs: 17."]);
  });
});
