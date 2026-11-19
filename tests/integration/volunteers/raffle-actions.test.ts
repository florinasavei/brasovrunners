import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eventRaffleEntries } from "@/db/schema/event-raffle-entries";
import { events, eventTranslations } from "@/db/schema/events";
import { participants } from "@/db/schema/participants";
import { registrations } from "@/db/schema/registrations";
import { issueActionToken } from "@/modules/action-tokens/repository";
import { computeContentHash, type LegalDocumentTranslationInput } from "@/modules/legal-documents/domain/content-hash";
import { insertLegalDocumentVersion } from "@/modules/legal-documents/repository";
import { LEGAL_TEMPLATES } from "@/modules/legal-documents/templates/catalogue";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * §NNN, BR-REQ-050-02, BR-REQ-036-02 — the raffle's three public presses as their actions answer them (the review: no test called
 * them): the event's raffle form (`events/[slug]/tombola/actions.ts`) and the two of «Gestionează înscrierea»
 * (`registrations/manage/[token]/actions.ts`). Every refusal's address — `?tombola=captcha`, `?tombola=invalid&fields=…`,
 * `?tombola=nomatch`, `?tombola=limited`, a shut gate on the event's page, `?raffle=a|0|1|w`, `?invalid=1` — and that no address
 * carries what the person typed: the name and the number come back sealed (the form's draft), never in the address (§14.5).
 */
const state = vi.hoisted(() => ({
  db: undefined as unknown,
  redirected: [] as string[],
  botCheck: false,
  turnstile: "passed" as "passed" | "failed",
  drafts: [] as Array<Readonly<Record<string, string>>>,
  flashed: [] as string[],
}));

vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  redirect: (url: string) => {
    state.redirected.push(url);
    throw new Error("NEXT_REDIRECT");
  },
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-forwarded-for": "203.0.113.7", "user-agent": "Mozilla/5.0 (test)" }),
  cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }),
}));
vi.mock("next/cache", async () => (await import("../../helpers/next-cache")).fakeNextCache.module);
vi.mock("@/db/client", () => ({ getDb: () => state.db }));
vi.mock("@/i18n/navigation", () => {
  type Href = string | { pathname: string; params?: Record<string, string> };
  return {
    getPathname: ({ locale, href }: { locale: string; href: Href }) => {
      if (typeof href === "string") return `/${locale}${href}`;
      let path = href.pathname;
      for (const [key, value] of Object.entries(href.params ?? {})) path = path.replace(`[${key}]`, value);
      return `/${locale}${path}`;
    },
  };
});
vi.mock("@/modules/registrations/bot-check", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/modules/registrations/bot-check")>()),
  botCheckIsOn: async () => state.botCheck,
}));
vi.mock("@/modules/registrations/turnstile", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/modules/registrations/turnstile")>()),
  verifyTurnstile: async () => state.turnstile,
}));
vi.mock("@/modules/registrations/form-draft", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/modules/registrations/form-draft")>()),
  stashDraftValues: async (values: Readonly<Record<string, string>>) => void state.drafts.push(values),
  clearFormDraft: async () => {},
}));
vi.mock("@/shared/feedback/flash", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/shared/feedback/flash")>()),
  flashPublic: async (key: string) => void state.flashed.push(key),
}));

const { raffleFormAction } = await import("@/app/[locale]/events/[slug]/tombola/actions");
const { raffleSignUpFromManageAction, raffleWithdrawFromManageAction } = await import("@/app/[locale]/registrations/manage/[token]/actions");

const DAY = 24 * 60 * 60_000;
const SLUG = "crosul-tombolei";

let db: TestDatabase;
let close: () => Promise<void>;
let eventId: string;
let serial = 0;

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
  state.db = db;
});
afterAll(async () => close());
beforeEach(async () => {
  await resetTables(db);
  state.redirected.length = 0;
  state.drafts.length = 0;
  state.flashed.length = 0;
  state.botCheck = false;
  state.turnstile = "passed";
  await approveTexts();
  eventId = await race();
});

/** «Regulamentul tombolei» from the platform's template and a privacy notice naming `{{raffle}}`, both in force in both languages. */
async function approveTexts() {
  const notice: LegalDocumentTranslationInput[] = (["ro", "en"] as const).map((locale) => ({
    locale,
    title: locale === "ro" ? "Confidențialitate" : "Privacy",
    body: { sections: [{ paragraphs: ["Tombola ({{raffle}}): păstrăm înscrierea."] }] },
  }));
  await insertLegalDocumentVersion(db, { key: "PRIVACY_NOTICE", version: 1, effectiveAt: new Date(Date.now() - 30 * DAY), isApproved: true, contentSha256: computeContentHash(notice), translations: notice, now: new Date() });
  const rules: LegalDocumentTranslationInput[] = (["ro", "en"] as const).map((locale) => ({ locale, ...LEGAL_TEMPLATES.RAFFLE_RULES[locale] }));
  await insertLegalDocumentVersion(db, { key: "RAFFLE_RULES", version: 1, effectiveAt: new Date(Date.now() - 30 * DAY), isApproved: true, contentSha256: computeContentHash(rules), translations: rules, now: new Date() });
}

/** A published race tomorrow whose raffle asks a sign-up of its own, open, every group ticked. */
async function race(): Promise<string> {
  const [event] = await db
    .insert(events)
    .values({
      type: "RACE",
      startsAt: new Date(Date.now() + DAY),
      timezone: "Europe/Bucharest",
      registrationMode: "INTERNAL",
      editorialStatus: "PUBLISHED",
      publishedAt: new Date(Date.now() - 10 * DAY),
      locationName: "Parcul Noua",
      bibStartNumber: 1,
      hasRaffle: true,
      raffleSignUp: true,
      raffleSignUpOpen: true,
    })
    .returning({ id: events.id });
  await db.insert(eventTranslations).values([
    { eventId: event.id, locale: "ro", slug: SLUG, title: "Crosul tombolei" },
    { eventId: event.id, locale: "en", slug: "raffle-cross", title: "The raffle cross" },
  ]);
  return event.id;
}

/** A confirmed real registration wearing `bibNumber` (or one of another state), of its own participant unless one is given. */
async function runner(name: string, bibNumber: number | null, more: { participantId?: string; status?: "CONFIRMED" | "WAITLISTED"; birthDate?: string } = {}) {
  serial += 1;
  const email = `raffle-${serial}@example.test`;
  const participantId =
    more.participantId ??
    (await db.insert(participants).values({ deliveryEmail: email, normalizedEmail: email, canonicalEmail: email, canonicalizationVersion: 2, defaultName: name, preferredLocale: "ro" }).returning({ id: participants.id }))[0].id;
  const status = more.status ?? "CONFIRMED";
  const [row] = await db
    .insert(registrations)
    .values({
      eventId,
      participantId,
      kind: "REAL",
      locale: "ro",
      registeredName: name,
      displayName: name,
      privacyNoticeVersion: 1,
      privacyAcknowledgedAt: new Date(Date.now() - 5 * DAY),
      resultsNameConsent: false,
      resultsConsentVersion: 1,
      status,
      bibNumber,
      ...(more.birthDate ? { birthDate: more.birthDate } : {}),
      ...(status === "CONFIRMED" ? { confirmedAt: new Date(Date.now() - 5 * DAY) } : { waitlistedAt: new Date(Date.now() - 5 * DAY) }),
    })
    .returning({ id: registrations.id });
  return { id: row.id, participantId };
}

const entries = () => db.select().from(eventRaffleEntries);

/** The address an action sent the browser to — the one thing a redirect is, here. */
async function landing(press: () => Promise<void>): Promise<string> {
  await press().catch((error: unknown) => {
    if (!(error instanceof Error) || error.message !== "NEXT_REDIRECT") throw error;
  });
  const to = state.redirected.at(-1);
  if (to === undefined) throw new Error("no redirect");
  return to;
}

/**
 * None of what the person typed is in the address's query or its anchor — the name's words, folded or not, and the number. (Its path is
 * the page's own: the event's slug, or the link's token, which is random and may hold any letters.)
 */
function carriesNothingTyped(address: string, typed: { name: string; number: string }) {
  const url = new URL(address, "https://site.test");
  const said = decodeURIComponent(`${url.search}${url.hash}`).toLowerCase();
  for (const word of typed.name.toLowerCase().split(/\s+/).filter(Boolean)) expect(said, `«${word}» in ${address}`).not.toContain(word);
  expect(url.searchParams.get("number"), address).toBeNull();
  expect(url.search, address).not.toMatch(new RegExp(`=${typed.number}(&|$)`));
}

describe("§NNN the event's raffle form: every answer comes back to the form, the typed words never in the address", () => {
  const RENDERED = () => new Date(Date.now() - 60_000).toISOString();
  const post = (fields: { number?: string; name?: string; accept?: boolean; volunteer?: boolean; slug?: string; locale?: string }) => {
    const form = new FormData();
    form.set("locale", fields.locale ?? "ro");
    form.set("slug", fields.slug ?? SLUG);
    form.set("renderedAt", RENDERED());
    form.set("number", fields.number ?? "");
    form.set("name", fields.name ?? "");
    if (fields.accept !== false) form.set("accept", "on");
    if (fields.volunteer) form.set("volunteer", "on");
    return () => raffleFormAction(form);
  };
  const tombola = (address: string) => new URL(address, "https://site.test").searchParams.get("tombola");

  it("signs a matching runner up — `?tombola=done` and the toast — the name typed in another order and case", async () => {
    await runner("Ana Popescu", 7);
    const to = await landing(post({ number: "7", name: "popescu ana" }));
    expect(to).toBe(`/ro/events/${SLUG}/tombola?tombola=done#raffle-form`);
    expect(state.flashed).toEqual(["raffleEntered"]);
    expect((await entries()).map((entry) => entry.method)).toEqual(["FORM"]);
    carriesNothingTyped(to, { name: "popescu ana", number: "7" });
  });

  it("answers Turnstile's refusal with `?tombola=captcha`, keeping the typed words sealed, writing nothing", async () => {
    await runner("Ana Popescu", 7);
    state.botCheck = true;
    state.turnstile = "failed";
    const to = await landing(post({ number: "7", name: "Ana Popescu" }));
    expect(tombola(to)).toBe("captcha");
    expect(to).toMatch(new RegExp(`^/ro/events/${SLUG}/tombola\\?tombola=captcha&since=[^#]+#raffle-form$`));
    expect(state.drafts).toEqual([{ number: "7", name: "Ana Popescu", volunteer: "" }]);
    expect(await entries()).toEqual([]);
    carriesNothingTyped(to, { name: "Ana Popescu", number: "7" });
  });

  it("answers a box the person must fix with `?tombola=invalid&fields=…` naming the boxes, never their words", async () => {
    await runner("Ana Popescu", 7);
    const unticked = await landing(post({ number: "7", name: "Ana Popescu", accept: false }));
    expect(tombola(unticked)).toBe("invalid");
    expect(new URL(unticked, "https://site.test").searchParams.get("fields")).toBe("accept");
    carriesNothingTyped(unticked, { name: "Ana Popescu", number: "7" });
    const malformed = await landing(post({ number: "sapte", name: "" }));
    expect(new URL(malformed, "https://site.test").searchParams.get("fields")).toBe("number,name");
    expect(decodeURIComponent(malformed)).not.toContain("sapte");
    expect(await entries()).toEqual([]);
  });

  it("answers a name or a number that matches nobody with the one neutral `?tombola=nomatch`, and the throttle with `?tombola=limited`", async () => {
    await runner("Ana Popescu", 7);
    const wrong = await landing(post({ number: "7", name: "Ioana Ionescu" }));
    expect(tombola(wrong)).toBe("nomatch");
    carriesNothingTyped(wrong, { name: "Ioana Ionescu", number: "7" });
    // Five tries an hour for one number at the event: the sixth is told to wait, whatever it types.
    for (let tries = 2; tries <= 5; tries += 1) expect(tombola(await landing(post({ number: "7", name: `Nume Gresit${tries}` })))).toBe("nomatch");
    const limited = await landing(post({ number: "7", name: "Ana Popescu" }));
    expect(tombola(limited)).toBe("limited");
    carriesNothingTyped(limited, { name: "Ana Popescu", number: "7" });
    expect(await entries()).toEqual([]);
  });

  it("sends a press the gate no longer takes to the event's page, and one for no event to the listing — nothing written", async () => {
    await runner("Ana Popescu", 7);
    await db.update(events).set({ raffleSignUpOpen: false }).where(eq(events.id, eventId));
    const shut = await landing(post({ number: "7", name: "Ana Popescu" }));
    expect(shut).toBe(`/ro/events/${SLUG}`);
    expect(await landing(post({ number: "7", name: "Ana Popescu", slug: "no-such-race" }))).toBe("/ro/events");
    expect(await entries()).toEqual([]);
  });
});

describe("§NNN «Gestionează înscrierea»: the raffle's two presses, the link read and never spent", () => {
  const manageToken = async (participantId: string, registrationId: string) =>
    (await issueActionToken(db, { participantId, registrationId, purpose: "MANAGE_REGISTRATION", expiresAt: new Date(Date.now() + 2 * DAY), now: new Date() })).secret;
  const press = (action: (form: FormData) => Promise<void>, token: string, fields: { accept?: boolean; registrationId?: string } = {}) => {
    const form = new FormData();
    form.set("locale", "ro");
    form.set("token", token);
    if (fields.accept) form.set("accept", "on");
    if (fields.registrationId) form.set("registrationId", fields.registrationId);
    return () => action(form);
  };
  const raffle = (address: string) => new URL(address, "https://site.test").searchParams.get("raffle");

  it("answers `?raffle=a` without the rules' tick, `?raffle=1` signed up, `?raffle=w` withdrawn — the person's id the one thing beside it", async () => {
    const ana = await runner("Ana Popescu", 7);
    const token = await manageToken(ana.participantId, ana.id);
    const page = `/ro/registrations/manage/${token}`;
    expect(await landing(press(raffleSignUpFromManageAction, token))).toBe(`${page}?raffle=a#raffle`);
    expect(await entries()).toEqual([]);
    expect(await landing(press(raffleSignUpFromManageAction, token, { accept: true, registrationId: ana.id }))).toBe(`${page}?raffle=1&person=${ana.id}#raffle`);
    expect(await entries()).toHaveLength(1);
    expect(await landing(press(raffleWithdrawFromManageAction, token))).toBe(`${page}?raffle=w#raffle`);
    expect(await entries()).toEqual([]);
    for (const to of state.redirected) carriesNothingTyped(to, { name: "Ana Popescu", number: "7" });
  });

  it("answers `?raffle=0` for a person the raffle does not take and for a shut gate — on both presses — writing nothing", async () => {
    const elena = await runner("Elena Asteapta", null, { status: "WAITLISTED" });
    const waiting = await manageToken(elena.participantId, elena.id);
    expect(raffle(await landing(press(raffleSignUpFromManageAction, waiting, { accept: true })))).toBe("0");
    const ana = await runner("Ana Popescu", 7);
    const token = await manageToken(ana.participantId, ana.id);
    await db.update(events).set({ raffleSignUpOpen: false }).where(eq(events.id, eventId));
    expect(raffle(await landing(press(raffleSignUpFromManageAction, token, { accept: true })))).toBe("0");
    expect(raffle(await landing(press(raffleWithdrawFromManageAction, token)))).toBe("0");
    expect(await entries()).toEqual([]);
  });

  it("answers `?invalid=1` for a link it cannot read and for another adult on the address, whose acceptance is their own", async () => {
    const ana = await runner("Ana Popescu", 7);
    const dan = await runner("Dan Popescu", 8, { participantId: ana.participantId, birthDate: "1990-01-01" });
    const token = await manageToken(ana.participantId, ana.id);
    expect(await landing(press(raffleSignUpFromManageAction, "not-a-link-anybody-holds", { accept: true }))).toBe("/ro/registrations/manage/not-a-link-anybody-holds?invalid=1");
    expect(await landing(press(raffleWithdrawFromManageAction, "not-a-link-anybody-holds"))).toBe("/ro/registrations/manage/not-a-link-anybody-holds?invalid=1");
    expect(await landing(press(raffleSignUpFromManageAction, token, { accept: true, registrationId: dan.id }))).toBe(`/ro/registrations/manage/${token}?invalid=1`);
    expect(await entries()).toEqual([]);
    for (const to of state.redirected) carriesNothingTyped(to, { name: "Dan Popescu", number: "8" });
  });
});
