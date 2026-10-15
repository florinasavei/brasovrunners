import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTranslator } from "next-intl";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import type { PublicVolunteerRole } from "@/modules/volunteers/volunteers";

/**
 * §768 — the volunteers' own page, `/evenimente/<slug>/voluntari` (the owner, 2026-10-14: «formularul trebuie să fie pagină
 * separată, nu embedded în pagina evenimentului»): the title, the event's date and place, the form with what the offer says,
 * and — the point of the page — its 404 while the form could not be sent (the switch off, no role needing people, the notice or
 * the agreement not in force, the event over or gone), never a form that cannot work. The reads are stood in for with a state a
 * case sets; `readVolunteerOffer` is the real one, so the page and the event page's box share the rule under test.
 */
const state = vi.hoisted(() => ({
  event: null as null | Record<string, unknown>,
  accepts: true,
  shirts: false,
  showCounts: false,
  roles: [] as unknown[],
  noticeDescribes: true,
  agreementInForce: true,
  agreementDescribed: true,
  profile: true,
  minors: true,
  draft: null as null | Record<string, string>,
  draftReads: 0,
  locale: "ro" as "ro" | "en",
}));

const EVENT = {
  id: "00000000-0000-4000-8000-000000000001",
  title: "Crosul de toamnă",
  eventStatus: "SCHEDULED",
  startsAt: new Date("2026-11-21T08:00:00.000Z"),
  endsAt: null as Date | null,
  timezone: "Europe/Bucharest",
  locationName: "Parcul Tractorul",
  dateToBeAnnounced: false,
  timeToBeAnnounced: false,
};

const role = (id: string, nameRo: string, nameEn: string, free: number): PublicVolunteerRole => ({
  id,
  nameRo,
  nameEn,
  descriptionRo: null,
  descriptionEn: null,
  descriptionRoJson: null,
  descriptionEnJson: null,
  needed: 3,
  taken: 3 - free,
  free,
  categoryId: null,
});

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw Object.assign(new Error("NEXT_NOT_FOUND"), { digest: "NEXT_NOT_FOUND" });
  },
}));
vi.mock("next-intl/server", () => ({
  getLocale: async () => state.locale,
  setRequestLocale: () => {},
  getTranslations: async (arg: string | { locale: "ro" | "en"; namespace: string }) => {
    const language = typeof arg === "object" ? arg.locale : state.locale;
    const namespace = typeof arg === "object" ? arg.namespace : arg;
    return createTranslator({ locale: language, messages: ({ ro, en } as Record<string, Record<string, unknown>>)[language] as never, namespace: namespace as never });
  },
}));
vi.mock("@/i18n/navigation", () => ({
  getPathname: ({ locale, href }: { locale: string; href: string | { pathname: string; params?: { slug?: string } } }) =>
    typeof href === "string" ? `/${locale}${href}` : `/${locale}/events/${href.params?.slug ?? ""}`,
}));
vi.mock("@/modules/resilience/event-copy", () => ({ formEventBySlug: async () => state.event }));
vi.mock("@/modules/registrations/form-draft", () => ({
  readFormDraft: async () => {
    state.draftReads += 1;
    return state.draft;
  },
}));
vi.mock("@/modules/public-cache/reads", () => ({
  cachedVolunteerRoles: async () => ({ acceptsVolunteers: state.accepts, shirts: state.shirts, showCounts: state.showCounts, roles: state.roles }),
  cachedVolunteersDescribed: async () => state.noticeDescribes,
  cachedVolunteerAgreementInForce: async () => state.agreementInForce,
  cachedVolunteerAgreementDescribed: async () => state.agreementDescribed,
  cachedVolunteerProfileDescribed: async () => state.profile,
  cachedVolunteerMinorsOpen: async () => state.minors,
}));
// The form is its own test's (`profile-render.test.ts`): here it only reports what the page handed it.
vi.mock("@/modules/volunteers/ui/VolunteerBox", () => ({
  default: (props: Record<string, unknown>) =>
    createElement("div", {
      "data-testid": "volunteer-box",
      "data-props": JSON.stringify({
        roles: (props.roles as PublicVolunteerRole[]).map((candidate) => candidate.id),
        shirts: props.shirts,
        showCounts: props.showCounts,
        eventDay: props.eventDay,
        profile: props.profile,
        minors: props.minors,
        outcome: props.outcome,
        refused: props.refused,
        typed: props.typed,
      }),
    }),
}));

const { default: Page, generateMetadata } = await import("@/app/[locale]/events/[slug]/volunteers/page");
const { readVolunteerOffer } = await import("@/modules/volunteers/offer");

const NOW_EVENT_AHEAD = "2026-10-14T10:00:00.000Z";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(NOW_EVENT_AHEAD));
  state.event = { ...EVENT };
  state.accepts = true;
  state.shirts = false;
  state.showCounts = false;
  state.roles = [role("r1", "Punct de apă", "Water point", 2), role("r2", "Sosire", "Finish", 1)];
  state.noticeDescribes = true;
  state.agreementInForce = true;
  state.agreementDescribed = true;
  state.profile = true;
  state.minors = true;
  state.draft = null;
  state.draftReads = 0;
  state.locale = "ro";
});

/** The page as a visitor's browser gets it, or `null` when it answered 404. */
async function visit(search: Record<string, string> = {}, locale: "ro" | "en" = "ro"): Promise<string | null> {
  state.locale = locale;
  try {
    const element = await Page({ params: Promise.resolve({ locale, slug: "crosul" }), searchParams: Promise.resolve(search) });
    return renderToStaticMarkup(element as ReactNode as never);
  } catch (error) {
    if ((error as { digest?: string }).digest === "NEXT_NOT_FOUND") return null;
    throw error;
  }
}

const boxOf = (page: string) => JSON.parse(/data-props="([^"]*)"/.exec(page)?.[1]?.replace(/&quot;/g, '"') ?? "{}");

describe("§768 the volunteers' page answers 404 while the form could not be sent", () => {
  it("is a page when every gate is open, in both languages, with its title and the event's date and place in one line", async () => {
    const page = await visit();
    expect(page).not.toBeNull();
    expect(page).toContain("Vreau să fiu voluntar la Crosul de toamnă");
    expect(page).toContain('data-testid="volunteers-when-where"');
    // The date in the event's own zone and the page's language, then the place: «sâmbătă, 21 nov. 2026, 10:00 · Parcul Tractorul».
    expect(page).toMatch(/21 nov\. 2026[^<]*10:00 · Parcul Tractorul/);
    expect(page).toContain("Înapoi la Crosul de toamnă");
    expect(page).toContain('href="/ro/events/crosul"');
    const english = await visit({}, "en");
    expect(english).toContain("I want to volunteer at Crosul de toamnă");
    expect(english).toContain("Back to Crosul de toamnă");
    expect(english).toContain("Parcul Tractorul");
  });

  it("hands the form the roles that still need people, in the club's order, and the three switches of what it asks", async () => {
    state.roles = [role("r1", "Punct de apă", "Water point", 2), role("full", "Plin", "Full", 0), role("r2", "Sosire", "Finish", 1)];
    state.shirts = true;
    const props = boxOf((await visit()) ?? "");
    expect(props).toMatchObject({ roles: ["r1", "r2"], shirts: true, profile: true, minors: true, outcome: null, refused: [] });
  });

  it("asks the guardian's boxes only while the profile's form is asked AND the minors' texts are in force", async () => {
    state.minors = false;
    expect(boxOf((await visit()) ?? "")).toMatchObject({ profile: true, minors: false });
    state.profile = false;
    state.minors = true;
    // §758's form asks no age: no minors on it, whatever the minors' texts say.
    expect(boxOf((await visit()) ?? "")).toMatchObject({ profile: false, minors: false });
  });

  it.each([
    ["the event is gone", () => (state.event = null)],
    ["the event takes no volunteers", () => (state.accepts = false)],
    ["every role is full", () => (state.roles = [role("r1", "Punct de apă", "Water point", 0)])],
    ["there is no role at all", () => (state.roles = [])],
    ["the privacy notice in force does not describe volunteers", () => (state.noticeDescribes = false)],
    ["no volunteer agreement is in force", () => (state.agreementInForce = false)],
    ["the notice does not describe the agreement's acceptance", () => (state.agreementDescribed = false)],
    ["the event is cancelled", () => (state.event = { ...EVENT, eventStatus: "CANCELLED" })],
    ["the event is over", () => (state.event = { ...EVENT, startsAt: new Date("2026-10-01T08:00:00.000Z"), endsAt: new Date("2026-10-01T12:00:00.000Z") })],
  ])("is a 404, never a form that cannot be sent, when %s", async (_why, close) => {
    close();
    expect(await visit()).toBeNull();
    expect(await visit({}, "en")).toBeNull();
  });

  it("stays for a person reading the answer to their own post when the last place was given meanwhile: «am primit», no roles, no form", async () => {
    state.roles = [role("r1", "Punct de apă", "Water point", 0)];
    expect(await visit()).toBeNull();
    for (const answer of ["1", "full", "invalid", "captcha", "limited"]) {
      const page = await visit({ volunteer: answer });
      expect(page, answer).not.toBeNull();
      expect(boxOf(page ?? "").roles, answer).toEqual([]);
    }
    // Any other word in the address is no answer, and the page is the 404 it was.
    expect(await visit({ volunteer: "hello" })).toBeNull();
    // The answer holds no other gate open: with the switch off there is no page for anybody.
    state.accepts = false;
    expect(await visit({ volunteer: "1" })).toBeNull();
  });

  it("reads the sealed draft only when the page is the answer to a refusal — never on a plain visit or after a send", async () => {
    state.draft = { name: "Dan", birthDate: "21.11.2011", guardianName: "Maria Popescu" };
    await visit();
    await visit({ volunteer: "1" });
    expect(state.draftReads).toBe(0);
    const page = (await visit({ volunteer: "invalid", vfields: "guardianEmail,birthDate,<b>", since: "x" })) ?? "";
    expect(state.draftReads).toBe(1);
    expect(boxOf(page)).toMatchObject({ outcome: "invalid", refused: ["birthDate", "guardianEmail"], typed: { name: "Dan", birthDate: "21.11.2011", guardianName: "Maria Popescu" } });
  });

  it("is never indexed, and its head names the event", async () => {
    const head = await generateMetadata({ params: Promise.resolve({ locale: "ro", slug: "crosul" }), searchParams: Promise.resolve({}) });
    expect(head.robots).toEqual({ index: false, follow: false });
    expect(head.title).toBe("Vreau să fiu voluntar la Crosul de toamnă");
    state.event = null;
    expect(await generateMetadata({ params: Promise.resolve({ locale: "ro", slug: "nope" }), searchParams: Promise.resolve({}) })).toEqual({ robots: { index: false, follow: false } });
    expect(await generateMetadata({ params: Promise.resolve({ locale: "de", slug: "crosul" }), searchParams: Promise.resolve({}) })).toEqual({ robots: { index: false, follow: false } });
  });

  it("is a 404 for a language the site does not have", async () => {
    await expect(Page({ params: Promise.resolve({ locale: "de", slug: "crosul" }), searchParams: Promise.resolve({}) })).rejects.toMatchObject({ digest: "NEXT_NOT_FOUND" });
  });
});

describe("§768 the one read the event page's box and this page share", () => {
  const event = { id: EVENT.id, eventStatus: "SCHEDULED", startsAt: EVENT.startsAt, endsAt: null as Date | null };

  it("answers the roles still needing people and the form's switches, or null — the same call the box makes with no answer", async () => {
    const offer = await readVolunteerOffer(event, new Date(NOW_EVENT_AHEAD));
    expect(offer?.roles.map((candidate) => candidate.id)).toEqual(["r1", "r2"]);
    expect(offer).toMatchObject({ shirts: false, showCounts: false, profile: true, minors: true });
    state.accepts = false;
    expect(await readVolunteerOffer(event, new Date(NOW_EVENT_AHEAD))).toBeNull();
  });

  it("holds an event whose date is to be announced as ahead — nobody is refused for a date not yet given", async () => {
    expect(await readVolunteerOffer({ ...event, startsAt: null }, new Date(NOW_EVENT_AHEAD))).not.toBeNull();
  });
});

describe("§NNN the public count of volunteers is the club's tick, and the date of birth is counted on the event's day", () => {
  const event = { id: EVENT.id, eventStatus: "SCHEDULED", startsAt: EVENT.startsAt, endsAt: null as Date | null };

  it("hands the form the tick: off by default, on when the club ticked it — one flag for every public number", async () => {
    expect((await readVolunteerOffer(event, new Date(NOW_EVENT_AHEAD)))?.showCounts).toBe(false);
    state.showCounts = true;
    expect((await readVolunteerOffer(event, new Date(NOW_EVENT_AHEAD)))?.showCounts).toBe(true);
    const page = (await visit()) ?? "";
    expect(boxOf(page)).toMatchObject({ showCounts: true });
    state.showCounts = false;
    expect(boxOf((await visit()) ?? "")).toMatchObject({ showCounts: false });
  });

  it("never opens a role that is full because the counts are hidden: the roles handed over are the ones still needing people either way", async () => {
    state.roles = [role("r1", "Punct de apă", "Water point", 0), role("r2", "Sosire", "Finish", 1)];
    for (const showCounts of [false, true]) {
      state.showCounts = showCounts;
      expect(boxOf((await visit()) ?? "").roles, String(showCounts)).toEqual(["r2"]);
    }
  });

  it("counts the age on the event's day in its own zone: the gun's day when the race has one, else the event's", async () => {
    // 21 November 2026 at 10:00 in Brașov (08:00 UTC): the day is the 21st.
    expect(boxOf((await visit()) ?? "")).toMatchObject({ eventDay: "2026-11-21" });
    // A gun after midnight in the event's zone is that day's, not the UTC day's: 00:30 on the 22nd in Brașov is 22:30 UTC on the 21st.
    state.event = { ...EVENT, startsAt: new Date("2026-11-21T20:00:00.000Z"), raceStartsAt: new Date("2026-11-21T22:30:00.000Z") };
    expect(boxOf((await visit()) ?? "")).toMatchObject({ eventDay: "2026-11-22" });
    // No gun: the event's own start.
    state.event = { ...EVENT, startsAt: new Date("2026-11-21T22:30:00.000Z"), raceStartsAt: null };
    expect(boxOf((await visit()) ?? "")).toMatchObject({ eventDay: "2026-11-22" });
  });
});

describe("§768 the paths", () => {
  it("are the event's own with a word added, per language, in the routing's map", async () => {
    const { routing } = await import("@/i18n/routing");
    expect(routing.pathnames["/events/[slug]/volunteers"]).toEqual({ ro: "/evenimente/[slug]/voluntari", en: "/events/[slug]/volunteers" });
    expect(routing.pathnames["/volunteers/guardian/[token]"]).toEqual({ ro: "/voluntari/parinte/[token]", en: "/volunteers/guardian/[token]" });
  });
});
