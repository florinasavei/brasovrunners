import { type ComponentProps, createElement, type ReactElement } from "react";
import { renderToReadableStream } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import type { EditableEvent } from "@/modules/content/events/repository";
import { PANEL_GLYPHS } from "@/shared/ui/panel-glyphs";

/**
 * §811 («Vin!» part 1) — what the page and the editor draw: the box «Confirmă prezența (opțional)» (the typed form, its outcomes, the small fold «Nu mai vin»,
 * the anti-bot widget only when the club switched it on), the fold «Cine vine (N)» under it (§NNN) with the names that may be shown and none of the addresses,
 * the club's tick in the registration card (a real tick box, never a toggle), and the read-only fold of answers by role. The service
 * and the gate are proved in `tests/integration/rsvp/` and `domain.test.ts`; the whole journey in `tests/e2e/rsvp.spec.ts`.
 */
const state = vi.hoisted(() => ({
  language: "ro" as "ro" | "en",
  siteKey: null as string | null,
  rsvps: { count: 0, names: [] as string[], others: 0 } as { count: number; names: string[]; others: number } | null,
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
vi.mock("@/modules/rsvp/remembered-actions", () => ({ rsvpStateAction: async () => ({ remembered: false }), rsvpGoAction: async () => ({ remembered: false }), rsvpLeaveAction: async () => ({ remembered: false }), rsvpForgetAction: async () => {}, rsvpShowNameAction: async () => ({ state: { remembered: false }, refused: null }) }));
vi.mock("@/modules/registrations/turnstile", () => ({ turnstileSiteKey: () => state.siteKey }));
vi.mock("@/modules/registrations/ui/BotCheck", async () => {
  const { createElement: h } = await import("react");
  return { default: () => h("div", { "data-testid": "bot-check" }) };
});
vi.mock("@/modules/registrations/ui/link-wait-words", () => ({ spamHintWords: async () => "Uită-te și în Spam." }));
vi.mock("@/modules/public-cache/reads", () => ({
  cachedFirstRsvpNoticeVersion: async () => 1,
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
vi.mock("@/modules/content/events/ui/BibDesignPanel", () => ({ default: () => null }));

const { default: RsvpBox } = await import("@/modules/rsvp/ui/RsvpBox");
const { default: RsvpCount } = await import("@/modules/rsvp/ui/RsvpCount");
const { default: RegistrationBox } = await import("@/modules/content/events/ui/boxes/RegistrationBox");
const { default: RsvpAnswersCard } = await import("@/modules/content/events/ui/boxes/RsvpAnswersCard");

async function html(element: ReactElement): Promise<string> {
  const { NextIntlClientProvider } = await import("next-intl");
  const stream = await renderToReadableStream(createElement(NextIntlClientProvider, { locale: state.language, messages: messages[state.language] } as unknown as ComponentProps<typeof NextIntlClientProvider>, element));
  await stream.allReady;
  return (await new Response(stream).text()).replace(/<style[^>]*>[\s\S]*?<\/style>/g, "").replace(/<script[^>]*>[\s\S]*?<\/script>/g, "");
}

const RENDERED_AT = new Date("2026-10-20T10:00:00.000Z");
const box = async (outcome: ComponentProps<typeof RsvpBox>["outcome"] = null, locale: "ro" | "en" = "ro") => {
  state.language = locale;
  return html(await RsvpBox({ locale, slug: "alergarea-de-joi", eventId: "11111111-1111-4111-8111-111111111111", renderedAt: RENDERED_AT, outcome }));
};
const count = async (locale: "ro" | "en" = "ro") => {
  state.language = locale;
  const element = await RsvpCount({ eventId: "11111111-1111-4111-8111-111111111111" });
  return element === null ? "" : html(element);
};

beforeEach(() => {
  state.language = "ro";
  state.siteKey = null;
  state.rsvps = { count: 0, names: [], others: 0 };
});

describe("§811 the box «Confirmă prezența (opțional)» — the typed form", () => {
  it("is a named fold at #vin: the heading, the one line, the address, the optional name, the tick, the button — in Română", async () => {
    const markup = await box();
    expect(markup).toContain('id="vin"');
    expect(markup).toContain('data-testid="rsvp-box"');
    expect(markup).toMatch(/<h2[^>]*>(?:<svg[\s\S]*?<\/svg>)?Confirmă prezența \(opțional\)/);
    // §NNN: said in words that it is not a registration, and no longer promising the list it does not hold.
    expect(markup).toContain("Nu e o înscriere: ne ajută să știm câți venim.");
    expect(markup).not.toContain("vezi cine mai vine");
    expect(markup).toMatch(/<input[^>]*name="email"[^>]*type="email"|<input[^>]*type="email"[^>]*name="email"/);
    expect(markup).toContain("Adresa ta de email");
    expect(markup).toContain("Numele tău (opțional)");
    expect(markup).toContain("Vreau să apar cu numele");
    expect(markup).toContain("Vin!");
    expect(markup).toContain("Îți trimitem un email cu un buton de confirmare");
    expect(markup).toContain("Detalii în nota de confidențialitate.");
  });

  it("says it in English too", async () => {
    const markup = await box(null, "en");
    expect(markup).toContain("Confirm you&#x27;re coming (optional)");
    expect(markup).toContain("This is not a registration: it helps us know how many of us are coming.");
    expect(markup).toContain("I want my name to show");
    expect(markup).toContain("I&#x27;m coming!");
  });

  it("names the tick as a real checkbox (never a toggle), unticked, and posts nothing hidden for it", async () => {
    const markup = await box();
    const tick = /<input\b[^>]*name="showName"[^>]*>/.exec(markup)?.[0] ?? "";
    expect(tick).toContain('type="checkbox"');
    expect(tick).not.toMatch(/\schecked/);
    expect(markup).not.toMatch(/role="switch"/);
  });

  it("carries the honeypot, the rendering time and the page's identity, as the interest box does", async () => {
    const markup = await box();
    expect(markup).toMatch(/<input[^>]*name="honeypot"[^>]*tabindex="-1"[^>]*aria-hidden="true"|<input[^>]*tabindex="-1"[^>]*name="honeypot"/);
    expect(markup).toContain(`name="renderedAt" value="${RENDERED_AT.toISOString()}"`);
    expect(markup).toContain('name="slug" value="alergarea-de-joi"');
    expect(markup).toContain('name="locale" value="ro"');
    // The browser's own limit on an address and a name.
    expect(markup).toContain('maxLength="320"');
  });

  it("draws the anti-bot widget only when the club switched it on", async () => {
    expect(await box()).not.toContain('data-testid="bot-check"');
    state.siteKey = "site-key";
    expect(await box()).toContain('data-testid="bot-check"');
  });

  it("has the small fold «Nu mai vin»: an address, a button, closed — and the fold asks no widget and no name", async () => {
    state.siteKey = "site-key";
    const markup = await box();
    const fold = markup.slice(markup.indexOf('data-testid="rsvp-withdraw"'));
    expect(fold).toContain("<summary");
    expect(fold).not.toMatch(/^[^>]*\sopen[\s>=]/);
    expect(fold).toContain("Nu mai vin");
    expect(fold).toContain('name="withdrawEmail"');
    expect(fold).toContain("Trimite linkul");
    expect(fold).not.toContain('data-testid="bot-check"');
    expect(fold).not.toContain('name="showName"');
    // …and says nothing about whether an address answered.
    expect(markup).not.toMatch(/nu ai răspuns|nu e pe listă|not on the list/i);
  });

  it("answers the same sentence after a typed address, and the form gives way to it", async () => {
    const markup = await box("sent");
    expect(markup).toContain('data-testid="rsvp-sent"');
    expect(markup).toContain("Ți-am trimis un email: apasă „Da, vin” ca să te numărăm.");
    expect(markup).toContain('data-testid="spam-hint"');
    expect(markup).not.toContain('name="email"');
  });

  it("keeps the form under an address it could not use, a widget that timed out, and a withdraw link sent", async () => {
    const invalid = await box("invalid");
    expect(invalid).toContain('role="alert"');
    expect(invalid).toContain("Adresa de email nu pare validă");
    expect(invalid).toContain('name="email"');
    const captcha = await box("captcha");
    expect(captcha).toContain("Verificarea anti-bot nu a reușit");
    const withdrawn = await box("withdrawSent");
    expect(withdrawn).toContain('data-testid="rsvp-withdraw-sent"');
    expect(withdrawn).toContain("Dacă adresa ta e printre cei care vin, ți-am trimis pe email un link.");
    expect(withdrawn).toContain('name="email"');
  });

  it("wraps the typed form in the one island, which draws it as it stands without a hint cookie", async () => {
    const markup = await box();
    // Server-rendered for everybody: the form, not the one-tap state.
    expect(markup).toContain('name="email"');
    expect(markup).not.toContain('data-testid="rsvp-remembered"');
    expect(markup).not.toContain("Răspunzi ca");
  });

  it("no longer holds who comes: the names are the fold under it (§NNN), so the box draws no count card and no names", async () => {
    state.rsvps = { count: 2, names: ["Ana Popescu"], others: 1 };
    const markup = await box();
    expect(markup).not.toContain('data-testid="rsvp-who"');
    expect(markup).not.toContain('data-testid="rsvp-name"');
    expect(markup).not.toContain("Ana Popescu");
    expect(markup).not.toContain("și încă");
    // …but the bar's line still says how many.
    expect(markup).toContain(" · 2 vin");
  });
});

/**
 * §812 — the card is a closed fold, like «Condiții de participare» (the owner, 2026-10-19: «Asta ar trebui să fie collapsed»): one
 * `<details>` at `#vin`, a real h2 in its summary, the count on its line, open only when the address carries an answer to read.
 */
describe("§812 the card «Confirmă prezența (opțional)» is a closed fold with its count on the line", () => {
  const detailsTag = (markup: string) => /<details\b[^>]*>/.exec(markup)?.[0] ?? "";
  const lineOf = (markup: string) => /data-testid="rsvp-summary-line"[^>]*>([^<]*)</.exec(markup)?.[1] ?? "";
  const summaryOf = (markup: string) => /<summary\b[\s\S]*?<\/summary>/.exec(markup)?.[0] ?? "";

  it("is one native <details id=vin>, closed on arrival, the id on the fold itself so a link to #vin opens it", async () => {
    const markup = await box();
    const tag = detailsTag(markup);
    expect(tag).toContain('id="vin"');
    expect(tag).toContain('data-testid="rsvp-box"');
    expect(tag).not.toMatch(/\sopen[\s=>]/);
    // The fold, and the small «Nu mai vin» fold inside it.
    expect(markup.match(/<details\b/g)).toHaveLength(2);
    expect(summaryOf(markup)).toMatch(/<h2[^>]*id="vin-heading"/);
    // The bar's glyph is a picture beside the words, never the words.
    expect(summaryOf(markup)).toContain("<svg");
  });

  it("says «Fii primul care confirmă» on its line while nobody has answered — no «0 vin»", async () => {
    const summary = summaryOf(await box());
    expect(summary).toContain("Confirmă prezența (opțional)");
    expect(summary).toContain(" · Fii primul care confirmă");
    expect(summary).not.toContain("Vii?");
    expect(summary).not.toMatch(/\b0 vin/);
  });

  it("says how many come, in the house's count form, in both languages", async () => {
    state.rsvps = { count: 1, names: [], others: 1 };
    expect(lineOf(await box())).toBe(" · 1 vine");
    state.rsvps = { count: 3, names: ["Ana"], others: 2 };
    expect(lineOf(await box())).toBe(" · 3 vin");
    state.rsvps = { count: 25, names: [], others: 25 };
    expect(lineOf(await box())).toBe(" · 25 vin");
    expect(lineOf(await box(null, "en"))).toBe(" · 25 coming");
    expect(summaryOf(await box(null, "en"))).toContain("Confirm you&#x27;re coming (optional)");
    expect(summaryOf(await box(null, "en"))).toContain("coming");
    // The names, when ticked, are in the fold under the card (§NNN) — never on the bar, never in the card.
    state.rsvps = { count: 3, names: ["Ana Popescu"], others: 2 };
    const markup = await box();
    expect(summaryOf(markup)).not.toContain("Ana Popescu");
    expect(markup).not.toContain("Ana Popescu");
  });

  it("says it in English at zero too: «Be the first to confirm»", async () => {
    expect(summaryOf(await box(null, "en"))).toContain(" · Be the first to confirm");
  });

  it("says nothing about the count while the database is away — a count that cannot be asked is not zero", async () => {
    state.rsvps = null;
    const markup = await box();
    expect(summaryOf(markup)).toContain("Confirmă prezența (opțional)");
    expect(markup).not.toContain('data-testid="rsvp-summary-line"');
    expect(markup).not.toContain("Fii primul");
  });

  it("draws the form, the help and the small «Nu mai vin» fold inside the fold, after the bar", async () => {
    const markup = await box();
    const after = markup.slice(markup.indexOf("</summary>"));
    for (const needle of ['name="email"', "Nu e o înscriere: ne ajută să știm câți venim.", 'data-testid="rsvp-withdraw"']) expect(after).toContain(needle);
    expect(summaryOf(markup)).not.toContain('name="email"');
  });

  it("opens by itself only for an answer to read: a sent address, a refusal, a withdraw link sent", async () => {
    for (const outcome of ["sent", "invalid", "captcha", "withdrawSent"] as const) {
      expect(detailsTag(await box(outcome)), outcome).toMatch(/\sopen=""/);
    }
    expect(detailsTag(await box(null))).not.toMatch(/\sopen/);
  });
});

/**
 * §NNN — «Cine vine (N)» on a turn-up event is a closed fold of its own, the races' list's shape (`StartList`): a real h2 in the summary
 * with the people glyph and the count on it, the names inside, the anchor `#cine-vine`. The disclosure rule is unchanged (§143, §812): the
 * names are the cached read's, never an address.
 */
describe("§NNN the fold «Cine vine (N)» under the card", () => {
  const detailsTag = (markup: string) => /<details\b[^>]*>/.exec(markup)?.[0] ?? "";
  const summaryOf = (markup: string) => /<summary\b[\s\S]*?<\/summary>/.exec(markup)?.[0] ?? "";

  it("is one native <details id=cine-vine>, closed on arrival, its bar a real h2 with the people glyph — like the races' list", async () => {
    state.rsvps = { count: 5, names: ["Ana Popescu"], others: 4 };
    const markup = await count();
    const tag = detailsTag(markup);
    expect(tag).toContain('id="cine-vine"');
    expect(tag).toContain('data-testid="rsvp-who"');
    expect(tag).not.toMatch(/\sopen[\s=>]/);
    expect(markup.match(/<details\b/g)).toHaveLength(1);
    expect(summaryOf(markup)).toMatch(/<h2[^>]*id="cine-vine-title"[^>]*>(?:<svg[\s\S]*?<\/svg>)?Cine vine \(5\)<\/h2>/);
    // A glyph beside the words, never instead of them.
    expect(summaryOf(markup)).toContain("<svg");
    // A disclosure keeps names out of search snippets, as the start list's does: the section wrapper carries it.
    expect(markup).toMatch(/<section[^>]*data-nosnippet=""/);
    expect(detailsTag(markup)).not.toContain("data-nosnippet");
  });

  it("says «Încă nu a confirmat nimeni.» inside while nobody has answered, and the bar without a number — no «(0)»", async () => {
    const markup = await count();
    expect(summaryOf(markup)).toMatch(/Cine vine<\/h2>/);
    expect(summaryOf(markup)).not.toContain("(0)");
    expect(markup.slice(markup.indexOf("</summary>"))).toContain("Încă nu a confirmat nimeni.");
    expect(markup).toContain('data-testid="rsvp-who-empty"');
    expect(markup).not.toContain('data-testid="rsvp-name"');
  });

  it("shows the names that may be shown in the start list's rows, and «și încă N» for the rest — all inside the fold, none on the bar", async () => {
    state.rsvps = { count: 5, names: ["Ana Popescu", "Ion Vasile", "Maria Ene"], others: 2 };
    const markup = await count();
    expect(markup.match(/data-testid="rsvp-name"/g)).toHaveLength(3);
    expect(markup).toContain("Ana Popescu");
    expect(markup).toContain('data-testid="rsvp-others"');
    expect(markup).toContain("și încă 2");
    expect(summaryOf(markup)).not.toContain("Ana Popescu");
    expect(markup.indexOf("Ana Popescu")).toBeGreaterThan(markup.indexOf("</summary>"));
  });

  it("shows the count alone when nobody ticked a name — no list, no names, only «și încă N»", async () => {
    state.rsvps = { count: 4, names: [], others: 4 };
    const markup = await count();
    expect(summaryOf(markup)).toContain("Cine vine (4)");
    expect(markup).toContain("și încă 4");
    expect(markup).not.toContain('data-testid="rsvp-name"');
    state.rsvps = { count: 3, names: ["Ana", "Ion", "Maria"], others: 0 };
    expect(await count()).not.toContain('data-testid="rsvp-others"');
  });

  it("never carries an address, and reads in English", async () => {
    state.rsvps = { count: 2, names: ["Ana"], others: 1 };
    const markup = await count("en");
    expect(summaryOf(markup)).toContain("Who&#x27;s coming (2)");
    expect(markup).toContain("and 1 more");
    expect(markup).not.toContain("@");
    state.rsvps = { count: 0, names: [], others: 0 };
    const empty = await count("en");
    expect(empty).toContain("Nobody has confirmed yet.");
    expect(summaryOf(empty)).not.toContain("(0)");
  });

  it("draws nothing while the database is away, rather than a count of zero", async () => {
    state.rsvps = null;
    expect((await count()).trim()).toBe("");
  });
});

describe("§811 the editor's tick «Acceptă răspunsuri „Vin!” din pagină, calendar și email»", () => {
  const event = (over: Record<string, unknown> = {}) =>
    ({
      id: "11111111-1111-1111-1111-111111111111",
      type: "GROUP_RUN",
      eventStatus: "SCHEDULED",
      registrationMode: "NONE",
      timezone: "Europe/Bucharest",
      startsAt: new Date("2026-11-21T08:00:00Z"),
      confirmationOpensDaysBefore: 7,
      confirmationDeadlineDaysBefore: 2,
      bibStartNumber: 1,
      bibColour: null,
      bibDesign: null,
      declarationDocumentId: null,
      reminderHoursBefore: null,
      kitShirt: false,
      rsvpEnabled: false,
      ...over,
    }) as unknown as EditableEvent;

  async function registrationCard(row: EditableEvent | null, locale: "ro" | "en" = "ro", extra: Record<string, unknown> = {}, mayEditSettings = true) {
    state.language = locale;
    const element = await RegistrationBox({
      event: row,
      mayEditSettings,
      declarations: [],
      languages: [],
      bibCounts: null,
      locale,
      now: new Date("2026-10-01T08:00:00Z"),
      clubDeadlines: { reminderHours: 48, holdMinutes: 30, offerHours: 24, raceWeekDays: 7 },
      ...extra,
    } as Parameters<typeof RegistrationBox>[0]);
    return html(element as ReactElement);
  }
  const tickOf = (markup: string) => /<input\b[^>]*name="event\.rsvpEnabled"[^>]*>/.exec(markup)?.[0] ?? "";

  it("is a real tick box posted with its marker, unticked for an event that says nothing, with its one help line — in Română", async () => {
    const markup = await registrationCard(event());
    const tick = tickOf(markup);
    expect(tick).toContain('type="checkbox"');
    expect(tick).not.toMatch(/\schecked/);
    expect(markup).toMatch(/<input[^>]*type="hidden"[^>]*name="event\.rsvpEnabled\.present"[^>]*value="1"/);
    expect(markup).toContain("Acceptă răspunsuri „Vin!” din pagină, calendar și email");
    expect(markup).toContain("Oricine își poate lăsa adresa și spune că vine; vezi câți vin aici și pe pagină.");
    expect(markup).toContain("Nota de confidențialitate trebuie să descrie răspunsurile „Vin!” — vezi Sarcini.");
    expect(markup).not.toMatch(/role="switch"/);
  });

  it("comes back ticked when the club ticked it, says the same in English, and is on the create form unticked", async () => {
    expect(tickOf(await registrationCard(event({ rsvpEnabled: true })))).toMatch(/\schecked/);
    const english = await registrationCard(event(), "en");
    expect(english).toContain("Accept “I&#x27;m coming!” answers from the page, calendar and email");
    expect(english).toContain("Anyone can leave their address and say they&#x27;re coming");
    expect(tickOf(await registrationCard(null))).not.toMatch(/\schecked/);
  });

  it("sits after the type's and the mode's blocks, for a type turned up to and for a type with «Fără înscrieri» alike (one tick, shown by the form)", async () => {
    const run = await registrationCard(event());
    const hike = await registrationCard(event({ type: "HIKE" }));
    for (const markup of [run, hike]) {
      expect(markup.match(/name="event\.rsvpEnabled"/g)).toHaveLength(1);
      expect(markup.indexOf('name="event.rsvpEnabled"')).toBeGreaterThan(markup.indexOf('data-testid="group-run-no-registration"'));
    }
  });

  it("has the read-only fold of answers right under it, for the roles that read addresses and for the rest alike — and none while there are no answers", async () => {
    const rows = [{ email: "ana@example.test", displayName: "Ana", showName: true, confirmedAt: new Date("2026-10-20T10:00:00Z"), createdAt: new Date("2026-10-20T09:00:00Z") }];
    const withRows = await registrationCard(event({ rsvpEnabled: true }), "ro", { rsvp: { counts: { confirmed: 1, unconfirmed: 0 }, rows } });
    expect(withRows.indexOf('data-testid="rsvp-answers-card"')).toBeGreaterThan(withRows.indexOf('name="event.rsvpEnabled"'));
    expect(withRows).toContain("ana@example.test");
    // The count alone for a role that does not read the registrations: the address is not in the page.
    const countOnly = await registrationCard(event({ rsvpEnabled: true }), "ro", { rsvp: { counts: { confirmed: 1, unconfirmed: 0 }, rows: null } });
    expect(countOnly).toContain('data-testid="rsvp-answers-count-only"');
    expect(countOnly).not.toContain("ana@example.test");
    // …and a reader who may not change the settings still sees the fold (it is not a setting).
    expect(await registrationCard(event(), "ro", { rsvp: { counts: { confirmed: 2, unconfirmed: 1 }, rows: null } }, false)).toContain('data-testid="rsvp-answers-card"');
    expect(await registrationCard(event(), "ro", { rsvp: { counts: { confirmed: 0, unconfirmed: 0 }, rows: [] } })).not.toContain('data-testid="rsvp-answers-card"');
    expect(await registrationCard(null)).not.toContain('data-testid="rsvp-answers-card"');
  });

  it("is not drawn for a reader who may only read the settings", async () => {
    expect(await registrationCard(event(), "ro", {}, false)).not.toContain('name="event.rsvpEnabled"');
  });

  it("has a panel glyph of its own for the answers' fold", () => {
    expect(PANEL_GLYPHS.rsvp).toBeDefined();
  });
});

describe("§811 the fold «Răspunsuri „Vin!” (N)» — read-only, addresses by role", () => {
  const rows = [
    { email: "ana@example.test", displayName: "Ana", showName: true, confirmedAt: new Date("2026-10-20T10:00:00Z"), createdAt: new Date("2026-10-20T09:00:00Z") },
    { email: "ion@example.test", displayName: null, showName: false, confirmedAt: null, createdAt: new Date("2026-10-20T11:00:00Z") },
  ];
  const fold = async (props: Partial<ComponentProps<typeof RsvpAnswersCard>> = {}, locale: "ro" | "en" = "ro") => {
    state.language = locale;
    const element = await RsvpAnswersCard({ counts: { confirmed: 1, unconfirmed: 1 }, rows, locale, timeZone: "Europe/Bucharest", ...props });
    return element === null ? "" : html(element as ReactElement);
  };

  it("lists email, name, «cu numele», state and when — for the roles that read the registrations — with no verb, no form and no file", async () => {
    const markup = await fold();
    expect(markup).toContain('data-testid="rsvp-answers-card"');
    expect(markup).toContain("Răspunsuri „Vin!” (2)");
    expect(markup).toContain("1 confirmate, 1 neconfirmate");
    expect(markup).toContain("ana@example.test");
    expect(markup).toContain("ion@example.test");
    expect(markup.match(/data-testid="rsvp-answer-row"/g)).toHaveLength(2);
    expect(markup).toContain("Confirmat");
    expect(markup).toContain("Neconfirmat");
    expect(markup).not.toMatch(/<form|<button|download|\.csv|<input/i);
    // A closed fold.
    expect(markup).not.toMatch(/<details[^>]*\sopen/);
  });

  it("gives every other role the count alone — the addresses are not in the page", async () => {
    const markup = await fold({ rows: null });
    expect(markup).toContain('data-testid="rsvp-answers-count-only"');
    expect(markup).toContain("1 confirmate, 1 neconfirmate.");
    expect(markup).not.toContain("example.test");
    expect(markup).not.toContain("<table");
  });

  it("is not drawn while the event has no answers", async () => {
    expect(await fold({ counts: { confirmed: 0, unconfirmed: 0 }, rows: [] })).toBe("");
  });

  it("says it in English", async () => {
    const markup = await fold({}, "en");
    expect(markup).toContain("“I&#x27;m coming!” answers (2)");
    expect(markup).toContain("1 confirmed, 1 unconfirmed");
  });
});

/**
 * §NNN — the name tick's words and what the island is handed. The island is a client component the page renders from the server: what
 * it receives is the page's strings and the server's actions as props — never an address, never a name.
 */
describe("§NNN the island's props for the name tick", () => {
  type Node = { type?: unknown; props?: Record<string, unknown> } | null | undefined;
  /** The element of the one client island, found in the tree the server component returns. */
  function findIsland(node: unknown): { labels: Record<string, string>; actions: Record<string, unknown> } | null {
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
    if (props && typeof props.labels === "object" && typeof props.actions === "object") return { labels: props.labels as never, actions: props.actions as never };
    return props ? findIsland(props.children) : null;
  }
  const island = async (locale: "ro" | "en") => {
    state.language = locale;
    const element = await RsvpBox({ locale, slug: "alergarea-de-joi", eventId: "11111111-1111-4111-8111-111111111111", renderedAt: RENDERED_AT, outcome: null });
    return findIsland(element)!;
  };

  it("hands over the five words of the tick and the fifth action, in Română", async () => {
    const { labels, actions } = await island("ro");
    expect(labels).toMatchObject({
      nameSwitch: "Numele meu apare la „Cine vine”",
      nameBox: "Numele tău",
      nameSave: "Salvează",
      nameShown: "Gata: numele tău apare la „Cine vine”.",
      nameHidden: "Gata: numele tău nu mai apare; ești doar numărat.",
      nameNeeded: "Scrie numele cu care vrei să apari.",
    });
    // The help carries `{name}` for the island to fill with the answer's own name; a second sentence says what to do when it holds none.
    expect(labels.nameHelp).toContain("Cu bifa apari ca „{name}”");
    expect(labels.nameHelp).toContain("numele rămâne păstrat");
    expect(labels.nameAsk).toBe("Bifează și scrie numele cu care vrei să apari.");
    expect(typeof actions.showName).toBe("function");
  });

  it("hands over the same words in English", async () => {
    const { labels } = await island("en");
    expect(labels.nameSwitch).toBe("My name shows under “Who's coming”");
    expect(labels.nameSave).toBe("Save");
    expect(labels.nameHelp).toContain("Ticked, you show as “{name}”");
    expect(labels.nameAsk).toBe("Tick it and type the name you want to show.");
    // «Closed» has no sentence in the island: the state turns it to the typed form, which cannot show one.
    expect(labels).not.toHaveProperty("nameClosed");
  });

  it("holds no address and no person's name in anything it is handed", async () => {
    for (const locale of ["ro", "en"] as const) {
      const { labels } = await island(locale);
      for (const value of Object.values(labels)) expect(value).not.toMatch(/@|example\.test/);
    }
  });

  it("has every sentence in both catalogues, one plain sentence each (≤ 200 characters)", () => {
    for (const catalogue of [ro, en]) {
      const rsvp = catalogue.Event.rsvp;
      for (const sentence of [rsvp.nameSwitch, rsvp.nameKept, rsvp.nameAsk, rsvp.nameBox, rsvp.nameSave, ...Object.values(rsvp.nameOutcome)]) {
        expect(sentence.length).toBeGreaterThan(0);
        expect(sentence.length).toBeLessThanOrEqual(200);
        // Only the help that names the name has a placeholder.
        if (sentence !== rsvp.nameKept) expect(sentence).not.toContain("{");
      }
      expect(rsvp.nameKept).toContain("{name}");
    }
  });
});
