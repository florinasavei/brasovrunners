import { type ComponentProps, createElement, type ReactElement } from "react";
import { renderToReadableStream } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import type { PublicRsvps } from "@/modules/rsvp/rsvp";
import { CLUB_NAME } from "@/theme/brand";

/**
 * §NNN (BR-REQ-039-01; amends §812 and §796) — what the pieces draw for the member mark, without a database: the tick on the page's form and what the one-tap
 * island is handed for it, the small «BVR» chip beside a shown name and the line «Dintre ei: M membri», the editor's chips in the registrations' own words and
 * the count of confirmed members, the zone's fact. The page as a whole, over a real database, is `tests/integration/rsvp/member-page.test.ts`.
 */
const state = vi.hoisted(() => ({
  language: "ro" as "ro" | "en",
  memberOffered: true,
  rsvps: { count: 0, names: [] as string[], others: 0 } as PublicRsvps | null,
}));
const messages = { ro, en };

vi.mock("next-intl/server", async () => {
  const { createTranslator } = await import("next-intl");
  return {
    getTranslations: async (namespace: string | { namespace: string }) =>
      createTranslator({ locale: state.language, messages: messages[state.language] as never, namespace: (typeof namespace === "string" ? namespace : namespace.namespace) as never }),
    getLocale: async () => state.language,
  };
});
vi.mock("@/i18n/navigation", async () => {
  const { createElement: h } = await import("react");
  return { Link: ({ href, children }: { href: string; children: unknown }) => h("a", { href: typeof href === "string" ? href : "/" }, children as string), getPathname: () => "/" };
});
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }), headers: async () => new Headers() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }), notFound: () => {}, redirect: () => {} }));
vi.mock("@/app/[locale]/events/[slug]/actions", () => ({ answerRsvpAction: async () => {}, requestRsvpWithdrawAction: async () => {} }));
vi.mock("@/app/[locale]/members-area/runs/actions", () => ({ answerAsMemberAction: async () => {}, leaveAsMemberAction: async () => {}, setNameAsMemberAction: async () => {} }));
vi.mock("@/modules/rsvp/remembered-actions", () => ({
  rsvpStateAction: async () => ({ remembered: false }),
  rsvpGoAction: async () => ({ remembered: false }),
  rsvpLeaveAction: async () => ({ remembered: false }),
  rsvpForgetAction: async () => {},
  rsvpShowNameAction: async () => ({ state: { remembered: false }, refused: null }),
  rsvpMemberAction: async () => ({ state: { remembered: false }, refused: null }),
}));
vi.mock("@/modules/registrations/turnstile", () => ({ turnstileSiteKey: () => null }));
vi.mock("@/modules/registrations/ui/link-wait-words", () => ({ spamHintWords: async () => "Uită-te și în Spam." }));
vi.mock("@/modules/public-cache/reads", () => ({
  cachedFirstRsvpNoticeVersion: async () => 1,
  cachedFirstRsvpMemberNoticeVersion: async () => 1,
  cachedRsvpMemberDescribed: async () => state.memberOffered,
  // The club's own sentence for what «membru» means (§789) is not written: the platform's words stand.
  cachedMemberDefinition: async () => null,
  cachedPublicRsvps: async () => {
    if (state.rsvps === null) throw new Error("away");
    return state.rsvps;
  },
}));
vi.mock("@/modules/resilience/optional-read", () => ({
  readOrWhileAway: async <T>(read: () => Promise<T>, whileAway: T) => {
    try {
      return await read();
    } catch {
      return whileAway;
    }
  },
}));

const { default: RsvpBox } = await import("@/modules/rsvp/ui/RsvpBox");
const { default: RsvpCount } = await import("@/modules/rsvp/ui/RsvpCount");
const { default: RsvpAnswersCard } = await import("@/modules/content/events/ui/boxes/RsvpAnswersCard");
const { default: ZoneRsvp } = await import("@/modules/rsvp/ui/ZoneRsvp");

async function html(element: ReactElement): Promise<string> {
  const { NextIntlClientProvider } = await import("next-intl");
  const stream = await renderToReadableStream(createElement(NextIntlClientProvider, { locale: state.language, messages: messages[state.language] } as unknown as ComponentProps<typeof NextIntlClientProvider>, element));
  await stream.allReady;
  return (await new Response(stream).text()).replace(/<style[^>]*>[\s\S]*?<\/style>/g, "").replace(/<script[^>]*>[\s\S]*?<\/script>/g, "");
}

const EVENT = "11111111-1111-4111-8111-111111111111";
const box = async (locale: "ro" | "en" = "ro") => {
  state.language = locale;
  return html(await RsvpBox({ locale, slug: "alergarea-de-joi", eventId: EVENT, renderedAt: new Date("2026-10-20T10:00:00.000Z"), outcome: null }));
};
const count = async (locale: "ro" | "en" = "ro") => {
  state.language = locale;
  const element = await RsvpCount({ eventId: EVENT });
  return element === null ? "" : html(element);
};

beforeEach(() => {
  state.language = "ro";
  state.memberOffered = true;
  state.rsvps = { count: 0, names: [], others: 0 };
});

describe("§NNN the tick on the page's form", () => {
  it("is a real checkbox, off by default, with the club's name from the constant and the sentence for what «membru» means behind a «?»", async () => {
    const markup = await box();
    const tick = /<input\b[^>]*name="clubMember"[^>]*>/.exec(markup)?.[0] ?? "";
    expect(tick).toContain('type="checkbox"');
    expect(tick).not.toMatch(/\schecked/);
    expect(markup).not.toMatch(/role="switch"/);
    expect(markup).toContain(`Sunt membru al grupului ${CLUB_NAME}`);
    // The «?» is the registration form's own island (`Hint`): its text is the platform's sentence until the club writes its own.
    expect(markup).toContain(ro.Registration.clubMemberDefinition);
    expect(markup).toContain(ro.Event.rsvp.memberHelp.replace("{mark}", ro.Event.rsvp.memberMark));
    // Beside the name's tick, not instead of it.
    expect(markup).toContain('name="showName"');
    expect(markup.indexOf('name="showName"')).toBeLessThan(markup.indexOf('name="clubMember"'));
  });

  it("says it in English with the same sentence", async () => {
    const markup = await box("en");
    expect(markup).toContain(`I am a member of the ${CLUB_NAME} group`);
    expect(markup).toContain(en.Registration.clubMemberDefinition);
    expect(markup).toContain(en.Event.rsvp.memberHelp.replace("{mark}", en.Event.rsvp.memberMark));
  });

  it("is not drawn while the notice in force does not describe the mark", async () => {
    state.memberOffered = false;
    const markup = await box();
    expect(markup).not.toContain('name="clubMember"');
    expect(markup).not.toContain("Sunt membru al grupului");
    expect(markup).toContain('name="showName"');
  });

  it("says «N vin · M membri» on the closed line when some of them are members, and only «N vin» when none is", async () => {
    state.rsvps = { count: 3, names: [], others: 3, members: 2 };
    expect(await box()).toContain(" · 3 vin · 2 membri");
    state.rsvps = { count: 3, names: [], others: 3 };
    const plain = await box();
    expect(plain).toContain(" · 3 vin");
    expect(plain).not.toContain("2 membri");
    state.rsvps = { count: 1, names: [], others: 1, members: 1 };
    expect(await box()).toContain(" · 1 vine · 1 membru");
    state.rsvps = { count: 21, names: [], others: 21, members: 20 };
    expect(await box()).toContain(" · 21 vin · 20 de membri");
    expect(await box("en")).toContain(" · 21 coming · 20 members");
  });
});

describe("§NNN what the one-tap island is handed for the tick", () => {
  type Node = { type?: unknown; props?: Record<string, unknown> } | null | undefined;
  function findIsland(node: unknown): { labels: Record<string, string>; memberOffered?: boolean; actions: Record<string, unknown> } | null {
    if (!node || typeof node !== "object") return null;
    if (Array.isArray(node)) {
      for (const child of node) {
        const found = findIsland(child);
        if (found) return found;
      }
      return null;
    }
    const element = node as Node;
    const props = element?.props;
    if (props && typeof props.labels === "object" && typeof props.actions === "object") return { labels: props.labels as never, memberOffered: props.memberOffered as boolean, actions: props.actions as never };
    return props ? findIsland(props.children) : null;
  }
  const island = async (locale: "ro" | "en") => {
    state.language = locale;
    return findIsland(await RsvpBox({ locale, slug: "alergarea-de-joi", eventId: EVENT, renderedAt: new Date("2026-10-20T10:00:00.000Z"), outcome: null }))!;
  };

  it("gets the words, the sixth action and whether to offer the tick — strings and booleans, never an address", async () => {
    const { labels, memberOffered, actions } = await island("ro");
    expect(memberOffered).toBe(true);
    expect(typeof actions.member).toBe("function");
    expect(labels.memberTick).toBe(`Sunt membru al grupului ${CLUB_NAME}`);
    expect(labels.memberHint).toBe(ro.Registration.clubMemberDefinition);
    expect(labels.memberOn).toBe(ro.Event.rsvp.memberOutcome.on.replace("{mark}", ro.Event.rsvp.memberMark));
    expect(labels.memberFactHelp).toBe(ro.Event.rsvp.memberFactHelp.replace("{mark}", ro.Event.rsvp.memberMark));
    expect(labels.memberOff).toBe(ro.Event.rsvp.memberOutcome.off);
    expect(labels.memberClosed).toBe(ro.Event.rsvp.memberOutcome.closed);
    expect(labels.memberFact).toBe("Membru");
    for (const value of Object.values(labels)) expect(value).not.toMatch(/@|example\.test/);
  });

  it("is told not to offer it while the notice does not describe the mark, and keeps the words ready for a tick already given", async () => {
    state.memberOffered = false;
    const { labels, memberOffered } = await island("en");
    expect(memberOffered).toBe(false);
    expect(labels.memberTick).toBe(`I am a member of the ${CLUB_NAME} group`);
    expect(labels.memberHint).toBe(en.Registration.clubMemberDefinition);
  });
});

describe("§NNN «Cine vine» — the mark beside a shown name, the line of members", () => {
  it("draws a small «BVR» chip beside the names marked, and none beside the others or «și încă N»", async () => {
    state.rsvps = { count: 4, names: ["Ana Popescu", "Bia Ionescu", "Cora Dima"], others: 1, members: 3, memberMarks: [true, false, true] };
    const markup = await count();
    const rows = [...markup.matchAll(/<li[^>]*data-testid="(rsvp-name|rsvp-others)"[^>]*>([\s\S]*?)<\/li>/g)].map((match) => match[2]);
    expect(rows.map((row) => row.includes('data-testid="rsvp-member-mark"'))).toEqual([true, false, true, false]);
    expect(markup).toContain("Dintre ei: 3 membri.");
    // The chip says «BVR» and, to a screen reader, «Membru {club}» in place of it.
    const chip = /<div[^>]*data-testid="rsvp-member-mark"[^>]*>[\s\S]*?<\/div>/.exec(markup)?.[0] ?? "";
    expect(chip).toContain("BVR");
    expect(chip).toContain(`Membru ${CLUB_NAME}`);
    expect(chip).toContain("<svg");
  });

  it("says nothing of members when none is, and keeps the fold's rows as they were", async () => {
    state.rsvps = { count: 2, names: ["Ana Popescu"], others: 1 };
    const markup = await count();
    expect(markup).not.toContain('data-testid="rsvp-member-mark"');
    expect(markup).not.toContain("Dintre ei");
    expect(markup).toContain('data-testid="rsvp-others"');
  });

  it("counts the members even when no name is shown: the line stands with «și încă N» alone", async () => {
    state.rsvps = { count: 2, names: [], others: 2, members: 2 };
    const markup = await count();
    expect(markup).toContain("Dintre ei: 2 membri.");
    expect(markup).toContain("și încă 2");
    expect(markup).not.toContain('data-testid="rsvp-member-mark"');
  });

  it("says it in English", async () => {
    state.rsvps = { count: 2, names: ["Ana"], others: 1, members: 2, memberMarks: [true] };
    const markup = await count("en");
    expect(markup).toContain("Members among them: 2 members.");
    expect(markup).toContain(`${CLUB_NAME} member`);
  });
});

describe("§NNN the editor's fold — the registrations' chips, and the count of confirmed members", () => {
  const rows = [
    { email: "ana@example.test", displayName: "Ana", showName: true, clubMember: "DECLARED" as const, confirmedAt: new Date("2026-10-20T10:00:00Z"), createdAt: new Date("2026-10-20T09:00:00Z") },
    { email: "cont@example.test", displayName: "Cont", showName: false, clubMember: "ACCOUNT" as const, confirmedAt: new Date("2026-10-20T10:30:00Z"), createdAt: new Date("2026-10-20T09:30:00Z") },
    { email: "ion@example.test", displayName: null, showName: false, clubMember: null, confirmedAt: null, createdAt: new Date("2026-10-20T11:00:00Z") },
  ];
  const fold = async (props: Partial<ComponentProps<typeof RsvpAnswersCard>> = {}, locale: "ro" | "en" = "ro") => {
    state.language = locale;
    const element = await RsvpAnswersCard({ counts: { confirmed: 2, unconfirmed: 1, members: 2 }, rows, locale, timeZone: "Europe/Bucharest", ...props });
    return element === null ? "" : html(element as ReactElement);
  };

  it("says «Membru (declarat)» for the person's tick and «Membru (verificat)» for an account's — never «verificat» for a tick — and a dash for none", async () => {
    const markup = await fold();
    const chips = [...markup.matchAll(/<div[^>]*data-testid="member-chip"[^>]*data-membership="(\w+)"[^>]*>([\s\S]*?)<\/div>/g)].map((match) => [match[1], match[2].replace(/<[^>]+>/g, "")]);
    expect(chips).toEqual([
      ["declared", "Membru (declarat)"],
      ["verified", "Membru (verificat)"],
    ]);
    const cells = [...markup.matchAll(/<tr[^>]*data-testid="rsvp-answer-row"[^>]*>([\s\S]*?)<\/tr>/g)].map((match) => match[1]);
    expect(cells[2]).toContain("—");
    expect(cells[2]).not.toContain("member-chip");
  });

  it("has a column of its own, and the line says how many of the confirmed answers are a member's", async () => {
    const markup = await fold();
    expect(markup).toContain(">Membru</th>");
    expect(markup).toContain("2 confirmate, 1 neconfirmate · 2 membri confirmați");
    expect(markup).toContain("Răspunsuri „Vin!” (3)");
  });

  it("gives the roles that see no addresses the count and the members, and still no address", async () => {
    const markup = await fold({ rows: null });
    expect(markup).toContain("2 confirmate, 1 neconfirmate · 2 membri confirmați.");
    expect(markup).not.toContain("example.test");
    expect(markup).not.toContain("member-chip");
  });

  it("says nothing of members when none is, and uses the Romanian forms", async () => {
    expect(await fold({ counts: { confirmed: 2, unconfirmed: 1 } })).not.toContain("membri confirmați");
    expect(await fold({ counts: { confirmed: 2, unconfirmed: 1, members: 1 } })).toContain("· 1 membru confirmat");
    expect(await fold({ counts: { confirmed: 2, unconfirmed: 1, members: 20 } })).toContain("· 20 de membri confirmați");
  });

  it("says it in English, with the registrations' English words", async () => {
    const markup = await fold({}, "en");
    expect(markup).toContain(en.Admin.registrations.member.declared);
    expect(markup).toContain(en.Admin.registrations.member.verified);
    expect(markup).toContain("2 confirmed, 1 unconfirmed · 2 members confirmed");
  });
});

describe("§NNN the zone's fact", () => {
  const row = (props: Partial<ComponentProps<typeof ZoneRsvp>> = {}) =>
    ZoneRsvp({ locale: "ro", eventId: EVENT, titleId: "t", going: true, count: 1, publicName: "Ana", showName: false, name: null, ...props }).then((element) => html(element as ReactElement));

  it("says «Membru» beside «Tu vii ✓» for an answer an account made — a fact, no box", async () => {
    const markup = await row({ clubMember: "ACCOUNT" });
    expect(markup).toContain('data-testid="zone-rsvp-member"');
    expect(markup).toContain("Membru");
    expect(markup).not.toContain('name="clubMember"');
    state.language = "en";
    expect(await row({ clubMember: "ACCOUNT", locale: "en" })).toContain("Member");
  });

  it("says nothing for an answer with no mark, a tick's kind, or a row not yet answered", async () => {
    for (const props of [{ clubMember: null }, { clubMember: "DECLARED" as const }, {}, { going: false, clubMember: "ACCOUNT" as const }]) {
      state.language = "ro";
      expect(await row(props)).not.toContain('data-testid="zone-rsvp-member"');
    }
  });
});
