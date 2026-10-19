import { eq } from "drizzle-orm";
import { createFormatter, createTranslator, NextIntlClientProvider } from "next-intl";
import { type ComponentProps, createElement, type ReactNode } from "react";
import { renderToReadableStream } from "react-dom/server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { emailOutbox } from "@/db/schema/email-outbox";
import { eventRsvps } from "@/db/schema/event-rsvps";
import { eventTranslations, events } from "@/db/schema/events";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { computeContentHash, type LegalDocumentTranslationInput } from "@/modules/legal-documents/domain/content-hash";
import { findFirstRsvpNoticeVersion, insertLegalDocumentVersion } from "@/modules/legal-documents/repository";
import { privacyNoticeEn, privacyNoticeRo } from "@/modules/legal-documents/templates/privacy-notice";
import { answerRsvp, readPublicRsvps } from "@/modules/rsvp/rsvp";
import { identityOf } from "@/modules/rsvp/domain/identity";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";
import { fakeNextCache } from "../../helpers/next-cache";

/**
 * §822 (BR-REQ-060-01, BR-REQ-039-01; amends §812 and §815) — «Vin!» in the members' zone. A signed-in member answers a run's «Vii?» with one
 * press in «Alergări»: the action reads the account from the session and nothing about the person from the form, answers as
 * `source: "account"` (verified: counted at once, no email), shows a name only on the person's own tick and only through the service's
 * rule, takes the answer back on «Nu mai vin», and refuses a run that does not take answers without an error page. The page draws the row
 * only under a run that takes answers, with this account's own state read live. Real database (PGlite), the real session, the real service.
 */
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
const spied = vi.hoisted(() => ({ answered: [] as string[][], away: false, namesAway: false, noSignIn: false, notice: 0, publicReads: [] as string[], gathered: [] as string[][] }));
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
    readPublicRsvpsFor: (...args: Parameters<typeof real.readPublicRsvpsFor>) => {
      // The names' gathering alone goes away: the counts' read (`readPublicComing`) still answers, so the card's «Vin!» row can be drawn.
      if (spied.namesAway) throw Object.assign(new Error("connect ECONNREFUSED 10.0.0.1:5432"), { code: "ECONNREFUSED" });
      spied.gathered.push([...args[0]]);
      return real.readPublicRsvpsFor(...args);
    },
  };
});
// «Cine vine» under each run (§715 amended): the notice's version and each run's public read, counted — one gathering for the page, never one per card.
vi.mock("@/modules/public-cache/reads", async (original) => {
  const real = await original<typeof import("@/modules/public-cache/reads")>();
  return {
    ...real,
    cachedFirstRsvpNoticeVersion: (...args: Parameters<typeof real.cachedFirstRsvpNoticeVersion>) => {
      spied.notice += 1;
      return real.cachedFirstRsvpNoticeVersion(...args);
    },
    cachedPublicRsvps: (...args: Parameters<typeof real.cachedPublicRsvps>) => {
      spied.publicReads.push(args[0]);
      return real.cachedPublicRsvps(...args);
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

const { answerAsMemberAction, leaveAsMemberAction, setNameAsMemberAction } = await import("@/app/[locale]/members-area/runs/actions");
// «Alergări» is the zone's own address since the zone opens on the runs (§715 amended).
const { default: RunsPage } = await import("@/app/[locale]/members-area/page");

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
  spied.namesAway = false;
  spied.noSignIn = false;
  spied.notice = 0;
  spied.publicReads.length = 0;
  spied.gathered.length = 0;
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
const mails = () => db.select().from(emailOutbox);
const press = (eventId: string, extra: Record<string, string> = {}) => formOf({ uiLocale: "ro", eventId, ...extra });

describe("§822 the zone's «Vin!» — who answers is the session's", () => {
  it("sends a stranger to the sign-in in the members' words and writes nothing", async () => {
    const eventId = await seed("Alergarea de joi");
    expect(await redirectedTo(answerAsMemberAction(press(eventId)))).toBe("/ro/autentificare?to=members");
    expect(await redirectedTo(leaveAsMemberAction(press(eventId)))).toBe("/ro/autentificare?to=members");
    expect(await answers()).toHaveLength(0);
    expect(await mails()).toHaveLength(0);
  });

  it("answers as the account: its address, counted at once, no email, no name shown unless ticked", async () => {
    const eventId = await seed("Alergarea de joi");
    state.cookie = member.id;
    const to = await redirectedTo(answerAsMemberAction(press(eventId)));
    expect(to).toBe(`/ro/zona-membri?vin=went#vin-${eventId}`);

    const [row] = await answers();
    // Unticked, the account's name is not stored either: it is the person's to show, never to keep (§143, §396).
    expect(row).toMatchObject({ eventId, canonicalEmail: "membru@dev.test", showName: false, displayName: null });
    expect(row.confirmedAt).not.toBeNull();
    // Counted at once and no message of any kind: the account's address is already proved.
    expect(await mails()).toHaveLength(0);
    const shown = await readPublicRsvps(db, eventId, { firstRsvpNoticeVersion: await findFirstRsvpNoticeVersion(db) });
    expect(shown).toEqual({ count: 1, names: [], others: 1 });
  });

  it("carries the person's own tick and then shows the account's name, only as the notice's rule allows", async () => {
    const eventId = await seed("Alergarea de joi");
    state.cookie = member.id;
    await redirectedTo(answerAsMemberAction(press(eventId, { showName: "on" })));
    const [row] = await answers();
    expect(row).toMatchObject({ showName: true, displayName: "Ana Membru" });
    expect(await readPublicRsvps(db, eventId, { firstRsvpNoticeVersion: await findFirstRsvpNoticeVersion(db) })).toEqual({ count: 1, names: ["Ana Membru"], others: 0 });
  });

  it("takes nothing about the person from the form: a forged address, name or role is ignored", async () => {
    const eventId = await seed("Alergarea de joi");
    state.cookie = member.id;
    await redirectedTo(answerAsMemberAction(press(eventId, { email: "victima@example.test", displayName: "Altcineva", name: "Altcineva", role: "ADMIN", source: "page", verified: "false", showName: "on" })));
    const rows = await answers();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ canonicalEmail: "membru@dev.test", displayName: "Ana Membru", showName: true });
    expect(rows[0].confirmedAt).not.toBeNull();
    expect(await mails()).toHaveLength(0);
  });

  it("answers in the page's language: the address goes back to the zone in that language", async () => {
    const eventId = await seed("Alergarea de joi");
    state.cookie = member.id;
    expect(await redirectedTo(answerAsMemberAction(formOf({ uiLocale: "en", eventId })))).toBe(`/en/members-area?vin=went#vin-${eventId}`);
    expect((await answers())[0].locale).toBe("en");
  });

  it("never swaps a name the person typed for the account's: an unticked press keeps «Ana» (a stale tab)", async () => {
    const eventId = await seed("Alergarea de joi");
    await answerRsvp(db, eventId, identityOf("link", { email: member.email, displayName: "Ana", showName: true, locale: "ro" }), new Date());
    state.cookie = member.id;
    await redirectedTo(answerAsMemberAction(press(eventId)));
    const rows = await answers();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ showName: true, displayName: "Ana" });
    expect(await readPublicRsvps(db, eventId, { firstRsvpNoticeVersion: await findFirstRsvpNoticeVersion(db) })).toEqual({ count: 1, names: ["Ana"], others: 0 });
  });

  it("is idempotent for one account and keeps a name once shown: a second press shows no less", async () => {
    const eventId = await seed("Alergarea de joi");
    state.cookie = member.id;
    await redirectedTo(answerAsMemberAction(press(eventId, { showName: "on" })));
    await redirectedTo(answerAsMemberAction(press(eventId)));
    const rows = await answers();
    expect(rows).toHaveLength(1);
    expect(rows[0].showName).toBe(true);
  });

  it("says «closed» for a run that takes no answers — not ticked, started, cancelled, a registration run, a members' event, no such event — and writes nothing", async () => {
    state.cookie = member.id;
    const notTicked = await seed("Netickuit", { rsvpEnabled: false });
    const started = await seed("Început", { startsAt: new Date(Date.now() - 3_600_000) });
    const cancelled = await seed("Anulat", { eventStatus: "CANCELLED" });
    const registration = await seed("Cu înscriere", { registrationMode: "INTERNAL" });
    const membersOnly = await seed("Doar membri", { membersOnly: true });
    for (const eventId of [notTicked, started, cancelled, registration, membersOnly, "11111111-1111-4111-8111-111111111111", "not-a-uuid", ""]) {
      const to = await redirectedTo(answerAsMemberAction(press(eventId)));
      // The run's row is not drawn any more, so the page lands on the sentence, not on a row that is gone.
      expect(to, eventId).toBe("/ro/zona-membri?vin=closed#vin-outcome");
    }
    expect(await answers()).toHaveLength(0);
  });

  it("says «closed» while the notice in force does not describe «Vin!» (§812): no answer is taken before the disclosure is described", async () => {
    await approveNotice(false, 2);
    const eventId = await seed("Alergarea de joi");
    state.cookie = member.id;
    expect(await redirectedTo(answerAsMemberAction(press(eventId)))).toMatch(/vin=closed/);
    expect(await answers()).toHaveLength(0);
  });

  it("«Nu mai vin» takes the account's own answer back and no one else's", async () => {
    const eventId = await seed("Alergarea de joi");
    await answerRsvp(db, eventId, identityOf("account", { email: other.email, displayName: other.displayName, showName: false, locale: "ro" }), new Date());
    state.cookie = member.id;
    await redirectedTo(answerAsMemberAction(press(eventId)));
    expect(await answers()).toHaveLength(2);

    expect(await redirectedTo(leaveAsMemberAction(press(eventId)))).toBe(`/ro/zona-membri?vin=left#vin-${eventId}`);
    const rows = await answers();
    expect(rows).toHaveLength(1);
    expect(rows[0].canonicalEmail).toBe("alt.membru@dev.test");
    // Taking back what was never given is not an error — and not «left» either: nothing was taken back.
    expect(await redirectedTo(leaveAsMemberAction(press(eventId)))).toBe(`/ro/zona-membri#vin-${eventId}`);
    expect(await answers()).toHaveLength(1);
  });

  it("takes the answer back even after the notice stopped describing «Vin!» (a person may always), and a malformed event is nothing", async () => {
    const eventId = await seed("Alergarea de joi");
    state.cookie = member.id;
    await redirectedTo(answerAsMemberAction(press(eventId)));
    await approveNotice(false, 2);
    expect(await redirectedTo(leaveAsMemberAction(press("not-a-uuid")))).toBe("/ro/zona-membri");
    expect(await answers()).toHaveLength(1);
    expect(await redirectedTo(leaveAsMemberAction(press(eventId)))).toMatch(/vin=left#vin-/);
    expect(await answers()).toHaveLength(0);
  });

  it("answers a forged post where this deployment has no sign-in with the page's own 404, not a sign-in", async () => {
    const eventId = await seed("Alergarea de joi");
    state.cookie = member.id;
    spied.noSignIn = true;
    for (const action of [answerAsMemberAction, leaveAsMemberAction]) {
      const digest = await action(press(eventId)).then(
        () => "",
        (error: { digest?: string }) => error.digest ?? "",
      );
      expect(digest).toMatch(/NEXT_HTTP_ERROR_FALLBACK;404|NEXT_NOT_FOUND/);
    }
    expect(await answers()).toHaveLength(0);
  });
});

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

describe("§822 «Alergări» draws the row only under a run that takes answers", () => {
  it("draws «Vin!» with the tick off and the account's name under it, and the count of those who come", async () => {
    const eventId = await seed("Alergarea de joi");
    await answerRsvp(db, eventId, identityOf("account", { email: other.email, displayName: other.displayName, showName: false, locale: "ro" }), new Date());
    state.cookie = member.id;
    const html = await runs();
    const row = rowOf(html, eventId);
    expect(row).not.toBeNull();
    expect(row).toContain('data-going="false"');
    expect(row).toContain("1 vine");
    expect(row).toContain("Vin!");
    expect(row).toContain('name="showName"');
    expect(row).not.toMatch(/name="showName"[^>]*checked/);
    expect(row).toContain("Dacă bifezi, apari ca „Ana Membru” pe pagina alergării și la „Cine vine”.");
    // Never the other member's name or address: the row says a number.
    expect(html).not.toContain("alt.membru");
    expect(html).not.toContain("Dan Altul");
  });

  it("says «Tu vii ✓» and «Nu mai vin» for the account that answered — live, per account — and the new count", async () => {
    const eventId = await seed("Alergarea de joi");
    state.cookie = member.id;
    await redirectedTo(answerAsMemberAction(press(eventId)));
    const mine = rowOf(await runs(), eventId)!;
    expect(mine).toContain('data-going="true"');
    expect(mine).toContain("Tu vii ✓");
    expect(mine).toContain("Nu mai vin");
    expect(mine).toContain("1 vine");
    // The name tick stays on the answered row (§827), unticked: the press carried none.
    expect(mine).toContain('data-testid="zone-rsvp-name"');
    expect(mine).not.toMatch(/<input[^>]*name="showName"[^>]*checked|<input[^>]*checked[^>]*name="showName"/);

    // Another account on the same page sees the same count and its own state: not going.
    state.cookie = other.id;
    const theirs = rowOf(await runs(), eventId)!;
    expect(theirs).toContain('data-going="false"');
    expect(theirs).toContain("1 vine");
    expect(theirs).toContain("Dan Altul");
  });

  it("draws no row under a run that is not ticked, has a registration, or is a members' event — and none at all before the notice describes «Vin!»", async () => {
    const ticked = await seed("Alergarea de joi");
    const notTicked = await seed("Netickuit", { rsvpEnabled: false }, 3);
    const registration = await seed("Cu înscriere", { registrationMode: "INTERNAL" }, 4);
    const membersOnly = await seed("Doar membri", { membersOnly: true }, 5);
    state.cookie = member.id;
    const html = await runs();
    expect(rowOf(html, ticked)).not.toBeNull();
    for (const id of [notTicked, registration, membersOnly]) expect(html).not.toContain(`id="vin-${id}"`);
    // The members' event's card is drawn (it is theirs) and carries no row: its page draws no «Vii?» and the service refuses an answer to it.
    expect(html).toContain("Doar membri");
    expect(html.match(/data-testid="zone-rsvp"/g)).toHaveLength(1);

    await approveNotice(false, 2);
    fakeNextCache.reset();
    expect(await runs()).not.toContain(`id="vin-${ticked}"`);
  });

  it("reads the account's own answers in ONE query for all the shown runs, and draws nothing while the database is away", async () => {
    const ids = [await seed("Prima", {}, 2), await seed("A doua", {}, 3), await seed("A treia", {}, 4)];
    state.cookie = member.id;
    const html = await runs();
    expect(spied.answered).toHaveLength(1);
    expect([...spied.answered[0]].sort()).toEqual([...ids].sort());
    for (const id of ids) expect(rowOf(html, id)).not.toBeNull();

    // A «Vin!» that cannot be told from «Tu vii» is worse than none: with the counts' read down, no row at all.
    spied.away = true;
    fakeNextCache.reset();
    const away = await runs();
    expect(away).not.toContain('data-testid="zone-rsvp"');
    expect(away).toContain("Prima");
  });

  it("draws no tick for an account whose name is empty, in English too", async () => {
    await db.update(staffUsers).set({ displayName: "   " }).where(eq(staffUsers.id, member.id));
    const eventId = await seed("Alergarea de joi");
    state.cookie = member.id;
    const row = rowOf(await runs({}, "en"), eventId)!;
    expect(row).toContain("I&#x27;m coming!");
    expect(row).not.toContain('name="showName"');
  });

  it("says what a press did, once, at the top of the list, in both languages — and nothing for a code it does not know", async () => {
    await seed("Alergarea de joi");
    state.cookie = member.id;
    expect(await runs({ vin: "went" })).toContain("Am notat că vii.");
    expect(await runs({ vin: "left" })).toContain("Am șters răspunsul: nu mai vii.");
    expect(await runs({ vin: "closed" })).toContain("Alergarea nu mai primește răspunsuri „Vin!”.");
    expect(await runs({ vin: "went" }, "en")).toContain("Noted: you&#x27;re coming.");
    const unknown = await runs({ vin: "<b>x</b>" });
    expect(unknown).not.toContain("zone-rsvp-outcome");
    expect(unknown).not.toContain("<b>x</b>");
  });
});

/**
 * §827 (amends §812) — «Numele meu apare la „Cine vine"» on the zone's «Tu vii ✓» row: the account flips its own tick any time. The account is read
 * from the session; the form carries the event, the tick and, only when neither the row nor the account has a name, the one typed in the box.
 */
describe("§827 the zone's name tick", () => {
  const publicRead = async (eventId: string) => readPublicRsvps(db, eventId, { firstRsvpNoticeVersion: await findFirstRsvpNoticeVersion(db) });
  const tick = (eventId: string, on: boolean, extra: Record<string, string> = {}) => press(eventId, { ...(on ? { showName: "on" } : {}), ...extra });

  async function answered() {
    const eventId = await seed("Alergarea de joi");
    state.cookie = member.id;
    await redirectedTo(answerAsMemberAction(press(eventId)));
    return eventId;
  }

  it("sends a stranger to the sign-in and writes nothing", async () => {
    const eventId = await answered();
    state.cookie = undefined;
    expect(await redirectedTo(setNameAsMemberAction(tick(eventId, true)))).toBe("/ro/autentificare?to=members");
    expect((await answers())[0].showName).toBe(false);
  });

  it("shows the account's name on the tick — recorded under the notice in force — and lands on the row with «shown»", async () => {
    const eventId = await answered();
    await approveNotice(true, 2);
    expect(await redirectedTo(setNameAsMemberAction(tick(eventId, true)))).toBe(`/ro/zona-membri?vin=shown#vin-${eventId}`);
    expect((await answers())[0]).toMatchObject({ showName: true, displayName: "Ana Membru", privacyNoticeVersion: 2 });
    expect(await publicRead(eventId)).toEqual({ count: 1, names: ["Ana Membru"], others: 0 });
    // The row now draws the tick ticked, and the box «Numele tău» prefilled with the name the answer holds: the person is shown what it publishes.
    const row = rowOf(await runs(), eventId)!;
    expect(row).toMatch(/<input[^>]*name="showName"[^>]*checked|<input[^>]*checked[^>]*name="showName"/);
    expect(row).toMatch(/<input[^>]*name="name"[^>]*value="Ana Membru"|<input[^>]*value="Ana Membru"[^>]*name="name"/);
    expect(row).toContain("Cu bifa apari ca „Ana Membru”");
  });

  it("hides it on the untick, keeps the name stored and says «hidden» — and the next tick shows it again", async () => {
    const eventId = await answered();
    await redirectedTo(setNameAsMemberAction(tick(eventId, true)));
    expect(await redirectedTo(setNameAsMemberAction(tick(eventId, false)))).toBe(`/ro/zona-membri?vin=hidden#vin-${eventId}`);
    expect((await answers())[0]).toMatchObject({ showName: false, displayName: "Ana Membru" });
    expect(await publicRead(eventId)).toEqual({ count: 1, names: [], others: 1 });
    const row = rowOf(await runs(), eventId)!;
    expect(row).not.toMatch(/<input[^>]*name="showName"[^>]*checked/);
    expect(row).toContain("numele rămâne păstrat");
    // The next tick posts what the prefilled box holds; a bare one would publish a name not shown (§812), and is refused.
    expect(await redirectedTo(setNameAsMemberAction(tick(eventId, true)))).toBe("/ro/zona-membri?vin=name#vin-outcome");
    expect((await publicRead(eventId)).names).toEqual([]);
    await redirectedTo(setNameAsMemberAction(tick(eventId, true, { name: "Ana Membru" })));
    expect((await publicRead(eventId)).names).toEqual(["Ana Membru"]);
  });

  it("asks the box when neither the answer nor the account has a name, and refuses a tick without one at the top of the list", async () => {
    await db.update(staffUsers).set({ displayName: "   " }).where(eq(staffUsers.id, member.id));
    const eventId = await answered();
    const row = rowOf(await runs(), eventId)!;
    expect(row).toContain('name="name"');
    expect(await redirectedTo(setNameAsMemberAction(tick(eventId, true)))).toBe("/ro/zona-membri?vin=name#vin-outcome");
    expect((await answers())[0]).toMatchObject({ showName: false, displayName: null });
    expect(await runs({ vin: "name" })).toContain("Scrie numele cu care vrei să apari.");
    // With a typed name it goes through.
    expect(await redirectedTo(setNameAsMemberAction(tick(eventId, true, { name: "  Ana  M. " })))).toBe(`/ro/zona-membri?vin=shown#vin-${eventId}`);
    expect((await answers())[0]).toMatchObject({ showName: true, displayName: "Ana M." });
  });

  it("never swaps a name the person typed for the account's, and never publishes it unposted: the stored name is shown in the box and goes public only posted", async () => {
    const eventId = await seed("Alergarea de joi");
    await answerRsvp(db, eventId, identityOf("link", { email: member.email, displayName: "Ana", showName: false, locale: "ro" }), new Date());
    state.cookie = member.id;
    // The row shows the stored name, prefilled, not the account's «Ana Membru».
    const row = rowOf(await runs(), eventId)!;
    expect(row).toMatch(/<input[^>]*name="name"[^>]*value="Ana"|<input[^>]*value="Ana"[^>]*name="name"/);
    expect(row).toContain("Cu bifa apari ca „Ana”");
    // A stale tab's bare tick: refused, nothing public, the account's name not lent.
    expect(await redirectedTo(setNameAsMemberAction(tick(eventId, true)))).toBe("/ro/zona-membri?vin=name#vin-outcome");
    expect((await answers())[0]).toMatchObject({ showName: false, displayName: "Ana" });
    await redirectedTo(setNameAsMemberAction(tick(eventId, true, { name: "Ana" })));
    expect((await answers())[0]).toMatchObject({ showName: true, displayName: "Ana" });
  });

  it("draws a tick with no name unticked, with the box ready", async () => {
    const eventId = await seed("Alergarea de joi");
    await answerRsvp(db, eventId, identityOf("link", { email: member.email, displayName: null, showName: true, locale: "ro" }), new Date());
    state.cookie = member.id;
    expect((await answers())[0]).toMatchObject({ showName: true, displayName: null });
    const row = rowOf(await runs(), eventId)!;
    expect(row).not.toMatch(/<input[^>]*name="showName"[^>]*checked|<input[^>]*checked[^>]*name="showName"/);
  });

  it("touches only the signed-in account's own answer: a forged address or role changes nothing", async () => {
    const eventId = await answered();
    await answerRsvp(db, eventId, identityOf("account", { email: other.email, displayName: other.displayName, showName: false, locale: "ro" }), new Date());
    await redirectedTo(setNameAsMemberAction(tick(eventId, true, { email: other.email, displayName: "Altcineva", role: "ADMIN" })));
    const rows = await answers();
    expect(rows.find((r) => r.canonicalEmail === "membru@dev.test")).toMatchObject({ showName: true, displayName: "Ana Membru" });
    expect(rows.find((r) => r.canonicalEmail === "alt.membru@dev.test")).toMatchObject({ showName: false, displayName: "Dan Altul" });
  });

  it("says «none» for an account with no answer (a stale page) or a malformed event, and «closed» once the run stops taking answers — but never refuses an untick", async () => {
    const eventId = await seed("Alergarea de joi");
    state.cookie = member.id;
    expect(await redirectedTo(setNameAsMemberAction(tick(eventId, true)))).toBe("/ro/zona-membri?vin=none#vin-outcome");
    expect(await redirectedTo(setNameAsMemberAction(tick("not-a-uuid", true)))).toBe("/ro/zona-membri?vin=none#vin-outcome");
    await redirectedTo(answerAsMemberAction(press(eventId)));
    await redirectedTo(setNameAsMemberAction(tick(eventId, true)));
    await db.update(events).set({ rsvpEnabled: false }).where(eq(events.id, eventId));
    // An untick always works, even for a run the club has since unticked.
    expect(await redirectedTo(setNameAsMemberAction(tick(eventId, false)))).toBe(`/ro/zona-membri?vin=hidden#vin-${eventId}`);
    // Turning it on again: closed, nothing written.
    expect(await redirectedTo(setNameAsMemberAction(tick(eventId, true, { name: "Ana Membru" })))).toBe("/ro/zona-membri?vin=closed#vin-outcome");
    expect((await answers())[0].showName).toBe(false);
  });

  it("says each outcome in both languages", async () => {
    await seed("Alergarea de joi");
    state.cookie = member.id;
    expect(await runs({ vin: "shown" })).toContain("Gata: numele tău apare la „Cine vine”.");
    expect(await runs({ vin: "hidden" })).toContain("Gata: numele tău nu mai apare; ești doar numărat.");
    expect(await runs({ vin: "none" })).toContain("Nu găsim un răspuns „Vin!” de-al tău aici.");
    expect(await runs({ vin: "shown" }, "en")).toContain("Done: your name shows under “Who&#x27;s coming”.");
    expect(await runs({ vin: "name" }, "en")).toContain("Type the name you want to appear with.");
  });
});

/**
 * §715 amended (the owner, 2026-10-19: «And it should be a lot easier for BVR members to see this») — the zone opens on «Alergări», and under
 * each run that takes answers «Cine vine (N)» is open, not a fold: the names of those who ticked and «și încă N». The same disclosure as the
 * event page (§143, §812) — being a member shows no more. The next run is the first card and featured; the page reads the answers once.
 */
describe("§715 «Cine vine» open under each run, the next run first", () => {
  const come = (eventId: string, email: string, displayName: string, showName: boolean) =>
    answerRsvp(db, eventId, identityOf("account", { email, displayName, showName, locale: "ro" }), new Date());
  const cardOf = (html: string, eventId: string) => {
    const start = html.indexOf(`id="vin-title-${eventId}"`);
    if (start === -1) return null;
    const next = html.indexOf('id="vin-title-', start + 10);
    return html.slice(start, next === -1 ? undefined : next);
  };

  it("lists the names of those who ticked and «și încă N» for the rest, open under «Vin!», in Română", async () => {
    const eventId = await seed("Alergarea de joi");
    await come(eventId, other.email, "Dan Altul", true);
    await come(eventId, "ascuns@dev.test", "Persoană Secretă", false);
    state.cookie = member.id;
    await redirectedTo(answerAsMemberAction(press(eventId)));
    const card = cardOf(await runs(), eventId)!;
    // Three answered; one name is shown; the other two are counted, never named — the member's own included.
    expect(card).toContain("Cine vine (3)");
    expect(card).toContain('data-testid="rsvp-who"');
    expect(card).toContain('data-open="true"');
    expect(card).toContain("Dan Altul");
    expect(card).toContain("și încă 2");
    expect(card).not.toContain("Persoană Secretă");
    expect(card).not.toContain("ascuns@dev.test");
    // Open and always showing: a heading and a list, never a fold.
    expect(card).not.toContain("<details");
    expect(card).not.toContain("<summary");
    // One level under the run's own title (an h3), and the region named by the run's title and the heading together.
    expect(card).toMatch(/<h4[^>]*data-testid="rsvp-who-heading"/);
    expect(card).toContain(`aria-labelledby="vin-title-${eventId} cine-vine-${eventId}-title"`);
    // Under «Vin!» / «Tu vii ✓», in the same card.
    expect(card.indexOf('data-testid="zone-rsvp"')).toBeLessThan(card.indexOf('data-testid="rsvp-who"'));
    expect(card.indexOf("Tu vii ✓")).toBeLessThan(card.indexOf("Cine vine (3)"));
  });

  it("says it in English", async () => {
    const eventId = await seed("Alergarea de joi");
    await come(eventId, other.email, "Dan Altul", true);
    state.cookie = member.id;
    const card = cardOf(await runs({}, "en"), eventId)!;
    expect(card).toContain("Who&#x27;s coming (1)");
    expect(card).toContain("Dan Altul");
    expect(card).not.toContain("and 0 more");
    expect(card).not.toContain("<details");
  });

  it("names nobody who did not tick, whoever is looking: being a member widens nothing (§143)", async () => {
    const eventId = await seed("Alergarea de joi");
    await come(eventId, other.email, "Dan Altul", false);
    state.cookie = member.id;
    const html = await runs();
    expect(html).not.toContain("Dan Altul");
    expect(cardOf(html, eventId)).toContain("Cine vine (1)");
    expect(cardOf(html, eventId)).toContain("și încă 1");
    // A colleague opening the zone sees the same: the staff read the lists in the backoffice, not here.
    const [admin] = await db.insert(staffUsers).values({ email: "admin@dev.test", displayName: "Admin Test", role: "ADMIN" }).returning();
    state.cookie = admin.id;
    expect(await runs()).not.toContain("Dan Altul");
  });

  it("draws no «Cine vine» for a run nobody has answered (the row above already invites the first), and none for a run that takes no answers", async () => {
    const empty = await seed("Fără răspunsuri");
    const closed = await seed("Netickuit", { rsvpEnabled: false }, 3);
    state.cookie = member.id;
    const html = await runs();
    expect(cardOf(html, empty)).not.toContain("rsvp-who");
    expect(cardOf(html, empty)).toContain("Fii primul care spune că vine.");
    expect(cardOf(html, closed)).not.toContain("rsvp-who");
    expect(cardOf(html, closed)).not.toContain('data-testid="zone-rsvp"');
  });

  it("draws the soonest run that takes answers first and featured, and the others after it by date", async () => {
    const soonestClosed = await seed("Mai întâi fără «Vin!»", { rsvpEnabled: false }, 1);
    const next = await seed("Următoarea", {}, 2);
    const later = await seed("Mai târziu", {}, 5);
    state.cookie = member.id;
    const html = await runs();
    // One featured card, the next run's, with its label; it is drawn before every other.
    expect(html.match(/data-featured="true"/g)).toHaveLength(1);
    expect(html.match(/data-testid="members-next-run"/g)).toHaveLength(1);
    // Said to a screen reader only (no visible chip or overline, the lead card's rule): the words ride in the title's heading, before the link.
    expect(html.match(/data-testid="members-next-run-label"[^>]*>Următoarea alergare: </g)).toHaveLength(1);
    expect(html).not.toMatch(/<p[^>]*members-next-run-label/);
    const at = (id: string) => html.indexOf(`id="vin-title-${id}"`);
    expect(at(next)).toBeGreaterThan(-1);
    expect(at(next)).toBeLessThan(at(soonestClosed));
    expect(at(soonestClosed)).toBeLessThan(at(later));
    expect(html.indexOf('data-testid="members-next-run"')).toBeLessThan(at(next));
    expect(await runs({}, "en")).toContain("The next run");
  });

  it("features no card while no run takes answers: the order is the date's", async () => {
    await seed("Prima", { rsvpEnabled: false }, 1);
    await seed("A doua", { rsvpEnabled: false }, 2);
    state.cookie = member.id;
    const html = await runs();
    expect(html).not.toContain('data-featured="true"');
    expect(html).not.toContain("members-next-run");
    expect(html.indexOf("Prima")).toBeLessThan(html.indexOf("A doua"));
  });

  it("reads the answers ONCE for the whole page: one notice read and one public read per offered run, gathered in one call", async () => {
    const ids = [await seed("Prima", {}, 2), await seed("A doua", {}, 3), await seed("A treia", {}, 4), await seed("Netickuit", { rsvpEnabled: false }, 5)];
    await come(ids[0], other.email, "Dan Altul", true);
    state.cookie = member.id;
    const html = await runs();
    expect(spied.gathered).toHaveLength(1);
    expect([...spied.gathered[0]].sort()).toEqual([...ids.slice(0, 3)].sort());
    expect(spied.notice).toBe(1);
    expect([...spied.publicReads].sort()).toEqual([...ids.slice(0, 3)].sort());
    expect(cardOf(html, ids[0])).toContain("Dan Altul");
  });

  it("keeps the zone up while only the names cannot be read: the card still draws «Vin!» and the count, with no list", async () => {
    const eventId = await seed("Alergarea de joi");
    await come(eventId, other.email, "Dan Altul", true);
    state.cookie = member.id;
    // The first render fills nothing the second may use: the names' read is down from the start, the counts' read is up.
    spied.namesAway = true;
    fakeNextCache.reset();
    const html = await runs();
    expect(html).toContain('data-testid="zone-rsvp"');
    expect(rowOf(html, eventId)).toContain("1 vine");
    expect(html).not.toContain("rsvp-who");
    expect(html).not.toContain("Dan Altul");
  });

  it("features the soonest run that takes answers even when the five soonest runs take none", async () => {
    for (let index = 1; index <= 5; index += 1) await seed(`Fără răspunsuri ${index}`, { rsvpEnabled: false }, index);
    const sixth = await seed("A șasea, cu «Vin!»", {}, 8);
    state.cookie = member.id;
    const html = await runs();
    expect(html.match(/data-featured="true"/g)).toHaveLength(1);
    expect(html.indexOf('data-testid="members-next-run"')).toBeLessThan(html.indexOf("Fără răspunsuri 1"));
    expect(rowOf(html, sixth)).not.toBeNull();
    expect(html.indexOf(`id="vin-title-${sixth}"`)).toBeLessThan(html.indexOf("Fără răspunsuri 1"));
  });

  it("draws no list before the notice describes «Vin!»", async () => {
    const eventId = await seed("Alergarea de joi");
    await come(eventId, other.email, "Dan Altul", true);
    state.cookie = member.id;
    await approveNotice(false, 2);
    fakeNextCache.reset();
    expect(await runs()).not.toContain("Dan Altul");
    expect(spied.gathered).toHaveLength(0);
  });
});
