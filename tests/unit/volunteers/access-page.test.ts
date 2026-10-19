import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTranslator } from "next-intl";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import type { VolunteersAccess } from "@/modules/volunteers/domain/access";
import type { PublicVolunteerRole } from "@/modules/volunteers/volunteers";

/**
 * §NNN — the volunteers' own page meets «Cine se poate oferi» with the request (BR-REQ-060-01): «Oricine» is the page it always
 * was; «Doar membrii» shows the form to a signed-in member — name and address from the account, locked — and a sentence with the
 * members' sign-in to a stranger, never the form; «Doar cu invitație» answers 404 without a link, and with a live link shows the
 * form with the invited address locked and the secret posted back, while a spent, withdrawn, run-out or unknown link says which
 * in one sentence. The thank-you after a send is shown to whoever the redirect brought back. The session is read for the members'
 * choice alone and the link's row only when the address holds one. The reads are stood in for with a state a case sets.
 */
const state = vi.hoisted(() => ({
  access: undefined as undefined | "ANYONE" | "MEMBERS" | "INVITED",
  roles: [] as unknown[],
  viewer: null as null | { email: string; displayName: string },
  viewerReads: 0,
  link: { reading: null, invitation: null } as { reading: null | { standing: string }; invitation: null | { deliveryEmail: string } },
  linkReads: 0,
  locale: "ro" as "ro" | "en",
  authMode: "provider" as "provider" | "disabled",
  /** What the send's sealed cookie holds for the thank-you (null: this browser sent nothing). */
  sent: null as null | { email: string; firstName: string },
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
const SECRET = "A".repeat(43);

const role = (id: string, free: number): PublicVolunteerRole => ({
  id,
  nameRo: "Punct de apă",
  nameEn: "Water point",
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
  unstable_rethrow: () => {},
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
vi.mock("@/db/client", () => ({ getDb: () => undefined }));
vi.mock("@/shared/config/env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/shared/config/env")>();
  return { ...actual, env: new Proxy(actual.env, { get: (target, key) => (key === "STAFF_AUTH_MODE" ? state.authMode : Reflect.get(target, key)) }) };
});
vi.mock("@/modules/resilience/event-copy", () => ({ formEventBySlug: async () => EVENT }));
vi.mock("@/modules/registrations/form-draft", () => ({ readSubmittedFacts: async () => state.sent, readFormDraft: async () => null }));
vi.mock("@/modules/events/members-only", () => ({
  membersViewer: async () => {
    state.viewerReads += 1;
    return state.viewer;
  },
}));
vi.mock("@/modules/volunteers/invitation-link", () => ({
  readVolunteerInvitationLink: async () => {
    state.linkReads += 1;
    return state.link;
  },
}));
vi.mock("@/modules/public-cache/reads", () => ({
  cachedVolunteerRoles: async () => ({ acceptsVolunteers: true, access: state.access, shirts: false, showCounts: false, roles: state.roles }),
  cachedVolunteersDescribed: async () => true,
  cachedVolunteerAgreementInForce: async () => true,
  cachedVolunteerAgreementDescribed: async () => true,
  cachedVolunteerProfileDescribed: async () => true,
  cachedVolunteerMinorsOpen: async () => false,
}));
vi.mock("@/shared/ui/ButtonLink", async () => {
  const { createElement: element } = await import("react");
  return { default: ({ children, ...props }: Record<string, unknown>) => element("a", { "data-testid": props["data-testid"], "data-href": JSON.stringify(props.href) }, children as never) };
});
// The form is its own test's (`access-render.test.ts`): here it only reports what the page handed it.
vi.mock("@/modules/volunteers/ui/VolunteerBox", () => ({
  default: (props: Record<string, unknown>) =>
    createElement("div", { "data-testid": "volunteer-box", "data-props": JSON.stringify({ outcome: props.outcome, lock: props.lock ?? null, roles: (props.roles as PublicVolunteerRole[]).map((one) => one.id) }) }),
}));

const { default: Page } = await import("@/app/[locale]/events/[slug]/volunteers/page");

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-19T10:00:00.000Z"));
  state.access = undefined;
  state.roles = [role("r1", 2)];
  state.viewer = null;
  state.viewerReads = 0;
  state.link = { reading: null, invitation: null };
  state.linkReads = 0;
  state.locale = "ro";
  state.authMode = "provider";
  state.sent = null;
});

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
const choose = (access: VolunteersAccess) => {
  state.access = access;
};

describe("§NNN «Oricine»", () => {
  it("is the page it always was — the form, no lock, and neither the session nor the link's row touched", async () => {
    const page = await visit();
    expect(boxOf(page ?? "")).toMatchObject({ lock: null, roles: ["r1"] });
    expect(state.viewerReads).toBe(0);
    expect(state.linkReads).toBe(0);
    choose("ANYONE");
    expect(boxOf((await visit()) ?? "")).toMatchObject({ lock: null });
    expect(state.viewerReads).toBe(0);
  });
});

describe("§NNN «Doar membrii clubului»", () => {
  it("shows a stranger one sentence and the way into the members' zone, in the members' words, and no form — and its title, so the page is still the event's", async () => {
    choose("MEMBERS");
    const page = (await visit()) ?? "";
    expect(page).not.toContain('data-testid="volunteer-box"');
    expect(page).toContain("Voluntarii pentru acest eveniment sunt membrii clubului — intră în zona membrilor.");
    expect(page).toContain("Vreau să fiu voluntar la Crosul de toamnă");
    expect(page).toContain('data-testid="volunteers-sign-in"');
    expect(page).toContain("Intră în zona membrilor");
    expect(JSON.parse(/data-href="([^"]*)"/.exec(page)?.[1]?.replace(/&quot;/g, '"') ?? "null")).toEqual({ pathname: "/sign-in", query: { to: "members", back: "volunteers", slug: "crosul" } });
    expect(state.viewerReads).toBe(1);
    const english = (await visit({}, "en")) ?? "";
    expect(english).toContain("The volunteers for this event are the club&#x27;s members — sign in to the members&#x27; zone.");
    expect(english).toContain("Sign in to the members&#x27; zone");
  });

  it("offers no sign-in where this deployment has none, and still draws the sentence", async () => {
    choose("MEMBERS");
    state.authMode = "disabled";
    const page = (await visit()) ?? "";
    expect(page).toContain("sunt membrii clubului");
    expect(page).not.toContain('data-testid="volunteers-sign-in"');
  });

  it("gives a signed-in member the form with the name and the address of the account locked", async () => {
    choose("MEMBERS");
    state.viewer = { email: "membru@example.test", displayName: "Maria Membra" };
    const page = (await visit()) ?? "";
    expect(boxOf(page)).toMatchObject({ lock: { kind: "member", email: "membru@example.test", name: "Maria Membra" }, roles: ["r1"] });
    expect(page).not.toContain("volunteers-members-only");
  });
});

describe("§NNN «Doar cu invitație de la club»", () => {
  it("answers 404 without a link, to a stranger and to a member alike — the page does not exist for them", async () => {
    choose("INVITED");
    expect(await visit()).toBeNull();
    state.viewer = { email: "membru@example.test", displayName: "Maria Membra" };
    expect(await visit()).toBeNull();
    expect(await visit({}, "en")).toBeNull();
    // No link in the address: the row is not read, and the session is not asked.
    expect(state.linkReads).toBe(0);
    expect(state.viewerReads).toBe(0);
  });

  it("opens the form with the invited address locked and the secret handed to it, for a live link", async () => {
    choose("INVITED");
    state.link = { reading: { standing: "open" }, invitation: { deliveryEmail: "ioana@example.test" } };
    const page = (await visit({ invite: SECRET })) ?? "";
    expect(boxOf(page)).toMatchObject({ lock: { kind: "invite", email: "ioana@example.test", secret: SECRET }, roles: ["r1"] });
    expect(state.linkReads).toBe(1);
  });

  it.each([
    ["used", "Invitația asta a fost deja folosită.", "This invitation has already been used."],
    ["withdrawn", "Clubul a retras invitația.", "The club withdrew this invitation."],
    ["expired", "Invitația a expirat.", "This invitation has expired."],
  ])("says in a sentence, and draws no form, when the link is %s", async (standing, romanian, english) => {
    choose("INVITED");
    state.link = { reading: { standing }, invitation: null };
    const page = (await visit({ invite: SECRET })) ?? "";
    expect(page).toContain(romanian);
    expect(page).toContain(`data-reason="${standing}"`);
    expect(page).not.toContain('data-testid="volunteer-box"');
    expect(page).not.toContain(SECRET);
    expect((await visit({ invite: SECRET }, "en")) ?? "").toContain(english);
  });

  it("answers 404, as no link does, to a link that names no invitation — the page does not confirm that a made-up secret is wrong", async () => {
    choose("INVITED");
    state.link = { reading: { standing: "invalid" }, invitation: null };
    expect(await visit({ invite: SECRET })).toBeNull();
    expect(await visit({ invite: SECRET }, "en")).toBeNull();
  });

  it("says a spent link was spent under any choice, and does not shut the door the choice opens: the form (or the sign-in) is drawn under the sentence", async () => {
    state.link = { reading: { standing: "used" }, invitation: null };
    choose("ANYONE");
    const open = (await visit({ invite: SECRET })) ?? "";
    expect(open).toContain("Invitația asta a fost deja folosită.");
    expect(open).toContain(`data-reason="used"`);
    expect(boxOf(open)).toMatchObject({ lock: null, roles: ["r1"] });
    choose("MEMBERS");
    const stranger = (await visit({ invite: SECRET })) ?? "";
    expect(stranger).toContain("Invitația asta a fost deja folosită.");
    expect(stranger).toContain('data-testid="volunteers-sign-in"');
    expect(stranger).not.toContain('data-testid="volunteer-box"');
    state.viewer = { email: "membru@example.test", displayName: "Maria Membra" };
    const member = (await visit({ invite: SECRET })) ?? "";
    expect(member).toContain("Invitația asta a fost deja folosită.");
    expect(boxOf(member)).toMatchObject({ lock: { kind: "member", email: "membru@example.test" } });
    // A link that names nothing says nothing where the form needed none.
    state.link = { reading: { standing: "invalid" }, invitation: null };
    expect((await visit({ invite: SECRET })) ?? "").not.toContain("volunteers-invite-refused");
  });

  it("shows the thank-you after a send only to the browser that sent: the link is spent and the address carries none, and a bare `?volunteer=1` is a 404", async () => {
    choose("INVITED");
    // Nobody sent anything from this browser: a typed-in `?volunteer=1` is no thank-you, and does not show that the event exists.
    expect(await visit({ volunteer: "1" })).toBeNull();
    state.sent = { email: "ioana@example.test", firstName: "Ioana" };
    const page = (await visit({ volunteer: "1" })) ?? "";
    expect(boxOf(page)).toMatchObject({ outcome: "done", lock: null });
    expect(state.linkReads).toBe(0);
    state.sent = null;
    // …and the form is drawn again after a refusal only with its link in the address.
    expect(await visit({ volunteer: "invalid" })).toBeNull();
    state.link = { reading: { standing: "open" }, invitation: { deliveryEmail: "ioana@example.test" } };
    expect(boxOf((await visit({ volunteer: "invalid", invite: SECRET })) ?? "")).toMatchObject({ outcome: "invalid", lock: { kind: "invite" } });
  });
});
