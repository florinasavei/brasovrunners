import { createFormatter, createTranslator, NextIntlClientProvider } from "next-intl";
import { type ComponentProps, createElement, type ReactNode } from "react";
import { renderToReadableStream } from "react-dom/server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eventRsvps } from "@/db/schema/event-rsvps";
import { eventTranslations, events } from "@/db/schema/events";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { computeContentHash, type LegalDocumentTranslationInput } from "@/modules/legal-documents/domain/content-hash";
import { findFirstRsvpMemberNoticeVersion, findFirstRsvpNoticeVersion, insertLegalDocumentVersion } from "@/modules/legal-documents/repository";
import { privacyNoticeEn, privacyNoticeRo } from "@/modules/legal-documents/templates/privacy-notice";
import { readPublicRsvps } from "@/modules/rsvp/rsvp";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";
import { fakeNextCache } from "../../helpers/next-cache";

const messages = { ro, en };
const state = vi.hoisted(() => ({ db: undefined as unknown, cookie: undefined as string | undefined, language: "ro" as "ro" | "en" }));

vi.mock("next/cache", async () => (await import("../../helpers/next-cache")).fakeNextCache.module);
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => (state.cookie ? { value: state.cookie } : undefined), set: () => {}, delete: () => {} }),
  headers: async () => new Headers(),
}));
vi.mock("@/auth", () => ({ auth: async () => null, signIn: async () => {}, signOut: async () => {} }));
vi.mock("@/db/client", () => ({ getDb: () => state.db }));
vi.mock("@/app/[locale]/admin/actions", () => ({ signOutAction: async () => {} }));
vi.mock("@/modules/diagnostics/budget-level", () => ({ peekNeonBudgetLevel: () => "unknown", lastKnownBudget: () => null }));
const request = vi.hoisted(() => ({ reads: new Map<string, Promise<unknown>>() }));
// The two reads the page makes for «Vin!»: wrapped, not replaced, so they still run for real — the test counts the calls and, once, makes the database go away.
const spied = vi.hoisted(() => ({ answered: [] as string[][], away: false, noSignIn: false }));
// A deployment with no sign-in at all (`STAFF_AUTH_MODE=disabled`): the one value the test flips, read live.
vi.mock("@/shared/config/env", async (original) => {
  const real = await original<typeof import("@/shared/config/env")>();
  return { ...real, env: new Proxy(real.env, { get: (target, key, receiver) => (key === "STAFF_AUTH_MODE" && spied.noSignIn ? "disabled" : Reflect.get(target, key, receiver)) }) };
});
vi.mock("@/modules/rsvp/counts", async (original) => {
  const real = await original<typeof import("@/modules/rsvp/counts")>();
  return {
    ...real,
    answeredByAccount: (...args: Parameters<typeof real.answeredByAccount>) => {
      spied.answered.push([...args[2]]);
      return real.answeredByAccount(...args);
    },
  };
});
vi.mock("@/modules/rsvp/public-page", async (original) => {
  const real = await original<typeof import("@/modules/rsvp/public-page")>();
  return {
    ...real,
    readPublicComing: (...args: Parameters<typeof real.readPublicComing>) => {
      if (spied.away) throw Object.assign(new Error("connect ECONNREFUSED 10.0.0.1:5432"), { code: "ECONNREFUSED" });
      return real.readPublicComing(...args);
    },
  };
});
vi.mock("@/modules/public-cache/request-memo", () => ({ thisRequestsReads: () => request.reads }));
vi.mock("next-intl/server", () => ({
  setRequestLocale: () => {},
  getLocale: async () => state.language,
  getMessages: async () => messages[state.language],
  getFormatter: async () => createFormatter({ locale: state.language, timeZone: "Europe/Bucharest" }),
  getTranslations: async (arg?: string | { locale?: "ro" | "en"; namespace: string }) => {
    const locale = typeof arg === "object" && arg.locale ? arg.locale : state.language;
    const namespace = typeof arg === "string" ? arg : arg?.namespace;
    return createTranslator({ locale, messages: messages[locale] as never, namespace: namespace as never });
  },
}));

const { answerAsMemberAction } = await import("@/app/[locale]/members-area/runs/actions");
const { default: RunsPage } = await import("@/app/[locale]/members-area/page"); // the runs are the zone's own page since §715 was amended (lane 73)

const DAY = 86_400_000;
let db: TestDatabase;
let close: () => Promise<void>;
let member: StaffUser;
let other: StaffUser;

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
  state.db = db;
});
afterAll(async () => close());
beforeEach(async () => {
  await resetTables(db);
  fakeNextCache.reset();
  request.reads.clear();
  spied.answered.length = 0;
  spied.away = false;
  spied.noSignIn = false;
  state.cookie = undefined;
  state.language = "ro";
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("NEXT_RUNTIME", "nodejs");
  vi.spyOn(console, "log").mockImplementation(() => {});
  [member] = await db.insert(staffUsers).values({ email: "membru@dev.test", displayName: "Ana Membru", role: "MEMBER" }).returning();
  [other] = await db.insert(staffUsers).values({ email: "alt.membru@dev.test", displayName: "Dan Altul", role: "MEMBER" }).returning();
  await approveNotice(true);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

async function approveNotice(describes: boolean, version = 1) {
  const translations: LegalDocumentTranslationInput[] = describes
    ? [
        { locale: "ro", title: "Confidențialitate", body: privacyNoticeRo },
        { locale: "en", title: "Privacy", body: privacyNoticeEn },
      ]
    : [
        { locale: "ro", title: "Confidențialitate", body: { sections: [{ heading: "1", paragraphs: ["Nimic."] }] } },
        { locale: "en", title: "Privacy", body: { sections: [{ heading: "1", paragraphs: ["Nothing."] }] } },
      ];
  await insertLegalDocumentVersion(db, {
    key: "PRIVACY_NOTICE",
    version,
    // A later version takes over an hour ago: the notice in force is the newest one that has taken effect.
    effectiveAt: new Date(Date.now() - (version === 1 ? 400 * DAY : 3_600_000)),
    isApproved: true,
    contentSha256: computeContentHash(translations),
    translations,
    now: new Date(),
  });
}

async function seed(title: string, over: Partial<typeof events.$inferInsert> = {}, inDays = 2) {
  const [event] = await db
    .insert(events)
    .values({
      type: "GROUP_RUN",
      startsAt: new Date(Date.now() + inDays * DAY),
      registrationMode: "NONE",
      rsvpEnabled: true,
      editorialStatus: "PUBLISHED",
      publishedAt: new Date(Date.now() - DAY),
      locationName: "Parcul Tractorul",
      ...over,
    })
    .returning();
  const id = event.id.slice(0, 8);
  await db.insert(eventTranslations).values([
    { eventId: event.id, locale: "ro", slug: `e-${id}`, title },
    { eventId: event.id, locale: "en", slug: `x-${id}`, title: `${title} (en)` },
  ]);
  return event.id;
}

const formOf = (fields: Record<string, string>) => {
  const form = new FormData();
  for (const [name, value] of Object.entries(fields)) form.set(name, value);
  return form;
};

/** Where a Next `redirect()` pointed, read from the error it throws. */
async function redirectedTo(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    const digest = (error as { digest?: string }).digest ?? "";
    if (digest.startsWith("NEXT_REDIRECT")) return digest.split(";")[2];
    throw error;
  }
  throw new Error("expected a redirect");
}

const answers = () => db.select().from(eventRsvps);
const press = (eventId: string, extra: Record<string, string> = {}) => formOf({ uiLocale: "ro", eventId, ...extra });

/**
 * §831 (BR-REQ-060-01, BR-REQ-039-01; amends §812 and §796) — the member mark on the zone's door of «Vin!». An answer an account gives from «Alergări» is
 * marked `ACCOUNT` **by the server, from the account's role**: every role the club's accounts have is at least a member (the owner, 2026-10-19: «organizatorii
 * și administratorii sunt peste membri»), and nothing the form posts — a tick, a kind, a role — can make it «declared» or take the mark away. The row says
 * «Membru» as a fact, with no box. Real database (PGlite), the real session, the real service; the other doors are `member-mark.test.ts`.
 */
/** A page's markup with its async server components resolved. */
async function markup(node: ReactNode): Promise<string> {
  // The cards' locale-aware links read the language from the provider, as the layout gives it (the page's own tree sits under it).
  const stream = await renderToReadableStream(createElement(NextIntlClientProvider, { locale: state.language, messages: messages[state.language] } as unknown as ComponentProps<typeof NextIntlClientProvider>, node));
  await stream.allReady;
  return (await new Response(stream).text()).replace(/<style[^>]*>[\s\S]*?<\/style>/g, "");
}

const runs = async (searchParams: { vin?: string } = {}, locale: "ro" | "en" = "ro") => {
  state.language = locale;
  request.reads.clear();
  return markup(await RunsPage({ params: Promise.resolve({ locale }), searchParams: Promise.resolve(searchParams) }));
};

/** The row under one run: the slice of the page from its anchor to the next row's (or the end). */
const rowOf = (html: string, eventId: string) => {
  const start = html.indexOf(`id="vin-${eventId}"`);
  if (start === -1) return null;
  const next = html.indexOf('id="vin-', start + 10);
  return html.slice(start, next === -1 ? undefined : next);
};

const ROLES = ["MEMBER", "CONTRIBUTOR", "COPYWRITER", "MODERATOR", "DEV", "ADMIN", "SUPERADMIN"] as const;
const publicRead = async (eventId: string) =>
  readPublicRsvps(db, eventId, { firstRsvpNoticeVersion: await findFirstRsvpNoticeVersion(db), firstMemberNoticeVersion: await findFirstRsvpMemberNoticeVersion(db) });

describe("§831 the zone's answer is marked from the account's role", () => {
  it("marks ACCOUNT for every role of the club's accounts, with no tick on the form", async () => {
    const eventId = await seed("Alergarea de joi");
    for (const role of ROLES) {
      const [account] = await db.insert(staffUsers).values({ email: `${role.toLowerCase()}@dev.test`, displayName: `Cont ${role}`, role }).returning();
      state.cookie = account.id;
      await redirectedTo(answerAsMemberAction(press(eventId)));
      const row = (await answers()).find((candidate) => candidate.canonicalEmail === account.email);
      expect(row?.clubMember, role).toBe("ACCOUNT");
      expect(row?.confirmedAt, role).not.toBeNull();
    }
    expect(await answers()).toHaveLength(ROLES.length);
  });

  it("takes nothing about the kind from the form: a forged tick, kind or role is ignored — never «declared», never taken away", async () => {
    const eventId = await seed("Alergarea de joi");
    state.cookie = member.id;
    await redirectedTo(answerAsMemberAction(press(eventId, { clubMember: "on", kind: "DECLARED", club_member: "DECLARED", clubMemberKind: "DECLARED", role: "ADMIN" })));
    expect((await answers())[0].clubMember).toBe("ACCOUNT");
    // A second press that «unticks» (it has no box) cannot lower it either.
    await redirectedTo(answerAsMemberAction(press(eventId, { clubMember: "off" })));
    expect((await answers())).toHaveLength(1);
    expect((await answers())[0].clubMember).toBe("ACCOUNT");
  });

  it("puts the mark beside the name the account chose to show, and counts it as a member when it shows none", async () => {
    const eventId = await seed("Alergarea de joi");
    state.cookie = member.id;
    await redirectedTo(answerAsMemberAction(press(eventId, { showName: "on" })));
    state.cookie = other.id;
    await redirectedTo(answerAsMemberAction(press(eventId)));
    const read = await publicRead(eventId);
    expect(read).toMatchObject({ count: 2, names: ["Ana Membru"], others: 1, memberMarks: [true], members: 2 });
    expect(JSON.stringify(read)).not.toContain("Dan Altul");
  });

  it("keeps no mark for an answer given before the notice described it — and the zone then says nothing of it", async () => {
    // The notice in force says «Vin!» and nothing about a mark: the answer is taken, the mark is not kept (nothing was told of it).
    await approveNotice(false, 2);
    await db.delete(eventRsvps);
    const strip = (body: unknown) => JSON.parse(JSON.stringify(body).replaceAll("{{rsvpMember}}", ""));
    const translations: LegalDocumentTranslationInput[] = [
      { locale: "ro", title: "Confidențialitate", body: strip(privacyNoticeRo) },
      { locale: "en", title: "Privacy", body: strip(privacyNoticeEn) },
    ];
    await insertLegalDocumentVersion(db, { key: "PRIVACY_NOTICE", version: 3, effectiveAt: new Date(Date.now() - 1800_000), isApproved: true, contentSha256: computeContentHash(translations), translations, now: new Date() });
    const eventId = await seed("Alergarea de joi");
    state.cookie = member.id;
    await redirectedTo(answerAsMemberAction(press(eventId, { showName: "on" })));
    expect((await answers())[0].clubMember).toBeNull();
    expect(await publicRead(eventId)).toEqual({ count: 1, names: ["Ana Membru"], others: 0 });
    expect(rowOf(await runs(), eventId)).not.toContain('data-testid="zone-rsvp-member"');
  });
});

describe("§831 the zone's row says «Membru» as a fact", () => {
  it("draws «Membru» beside «Tu vii ✓» for an account's answer — no box, no kind in the markup — in both languages", async () => {
    const eventId = await seed("Alergarea de joi");
    state.cookie = member.id;
    await redirectedTo(answerAsMemberAction(press(eventId)));
    const row = rowOf(await runs(), eventId)!;
    expect(row).toContain('data-testid="zone-rsvp-member"');
    expect(row).toContain("Membru");
    expect(row).not.toContain('name="clubMember"');
    expect(row).not.toMatch(/ACCOUNT|DECLARED/);
    const english = rowOf(await runs({}, "en"), eventId)!;
    expect(english).toContain('data-testid="zone-rsvp-member"');
    expect(english).toContain("Member");
  });

  it("draws no fact before the answer, and none for an answer that holds no mark", async () => {
    const eventId = await seed("Alergarea de joi");
    state.cookie = member.id;
    expect(rowOf(await runs(), eventId)).not.toContain('data-testid="zone-rsvp-member"');
    await redirectedTo(answerAsMemberAction(press(eventId)));
    await db.update(eventRsvps).set({ clubMember: null });
    expect(rowOf(await runs(), eventId)).not.toContain('data-testid="zone-rsvp-member"');
  });

  it("has no member tick on the form at all: «Vin!» carries only the name's tick", async () => {
    const eventId = await seed("Alergarea de joi");
    state.cookie = member.id;
    const row = rowOf(await runs(), eventId)!;
    expect(row).toContain('name="showName"');
    expect(row).not.toContain('name="clubMember"');
    expect(row).not.toContain("Sunt membru al grupului");
  });
});
