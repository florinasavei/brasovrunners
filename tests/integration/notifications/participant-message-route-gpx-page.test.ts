import { randomUUID } from "node:crypto";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createTranslator } from "next-intl";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { events, eventTranslations } from "@/db/schema/events";
import { participants } from "@/db/schema/participants";
import { registrations } from "@/db/schema/registrations";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import type { RouteGpx } from "@/modules/events/domain/route-gpx";
import { type ConfirmSpec, pickConfirm, resolveAlso, resolveEmailCount } from "@/shared/feedback/notice";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";
import { confirmed } from "../../helpers/typed-count";

/**
 * §987 — «Atașează traseul (GPX)» on the page of «Trimite un mesaj participanților» (BR-REQ-080-01): the tick beside the
 * composer's other ticks, off by default, drawn only when the event has a GPX its page offers (the file of «Traseul»,
 * §718) and not at all without one; the one line the question before «Trimite» says only for a press that posts the
 * tick; and, back from a trial to the people ticked, the tick as that trial left it. The page is a Server Component: it
 * is called, its tree walked for what it hands the composer, and the composer it built rendered to markup, in both
 * languages.
 */
const state = vi.hoisted(() => ({ db: undefined as unknown, actor: undefined as unknown, locale: "ro" as "ro" | "en" }));

vi.mock("next-intl/server", () => ({
  getTranslations: async (arg: string | { locale?: "ro" | "en"; namespace: string }) => {
    const namespace = typeof arg === "string" ? arg : arg.namespace;
    const locale = typeof arg === "string" ? state.locale : (arg.locale ?? state.locale);
    const catalogue = (locale === "ro" ? ro : en) as unknown as Record<string, Record<string, unknown>>;
    return createTranslator({ locale, messages: catalogue[namespace] as never });
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
vi.mock("@/app/[locale]/admin/events/[id]/mesaje/actions", () => ({
  sendParticipantMessageAction: vi.fn(),
  previewParticipantMessageAction: vi.fn(),
}));
vi.mock("@/modules/notifications/send-now-choice", () => ({ sendNowChoiceFor: async () => null }));

const { default: ParticipantMessagesPage } = await import("@/app/[locale]/admin/events/[id]/mesaje/page");
const { default: ParticipantMessageComposer } = await import("@/modules/notifications/ui/ParticipantMessageComposer");
const { default: ActionForm } = await import("@/shared/forms/ActionForm");
const { sendParticipantMessage } = await import("@/modules/notifications/participant-messages");

type Props = Record<string, unknown> & { children?: ReactNode };

/** Every element under `node`, depth first. */
function elements(node: ReactNode, acc: ReactElement<Props>[] = []): ReactElement<Props>[] {
  if (Array.isArray(node)) {
    for (const child of node) elements(child as ReactNode, acc);
    return acc;
  }
  if (!isValidElement<Props>(node)) return acc;
  acc.push(node);
  for (const value of Object.values(node.props)) {
    if (value !== node.props.children && (isValidElement(value) || Array.isArray(value))) elements(value as ReactNode, acc);
  }
  elements(node.props.children, acc);
  return acc;
}

/** A GPX as the editor's upload stores it (§718): the page reads the row, never the file. */
const GPX: RouteGpx = { key: "test/route-gpx/0123abcd-0123-4abc-8def-0123456789ab/traseu-tampa.gpx", name: "Traseu Tâmpa.gpx", size: 2048, uploadedAt: "2026-11-18T10:00:00.000Z" };
const WORDS = { subject: { ro: "Probă: {eventTitle}", en: "Trial: {eventTitle}" }, body: { ro: "Ne vedem la start.", en: "See you at the start." } };

let db: TestDatabase;
let close: () => Promise<void>;
let serial = 0;

async function createRace(routeGpx: RouteGpx | null) {
  const [event] = await db
    .insert(events)
    .values({
      type: "RACE",
      startsAt: new Date("2099-11-21T08:00:00.000Z"),
      timezone: "Europe/Bucharest",
      capacity: 150,
      registrationMode: "INTERNAL",
      editorialStatus: "PUBLISHED",
      publishedAt: new Date("2026-09-01T10:00:00.000Z"),
      routeGpx,
    })
    .returning();
  await db.insert(eventTranslations).values([
    { eventId: event.id, locale: "ro", slug: `crosul-${event.id.slice(0, 8)}`, title: "Crosul" },
    { eventId: event.id, locale: "en", slug: `cross-${event.id.slice(0, 8)}`, title: "The cross" },
  ]);
  return event;
}

async function register(eventId: string) {
  serial += 1;
  const email = `runner${serial}@example.org`;
  const [participant] = await db
    .insert(participants)
    .values({ deliveryEmail: email, normalizedEmail: email, canonicalEmail: email, canonicalizationVersion: 2, defaultName: `Runner ${serial}`, preferredLocale: "ro" })
    .returning();
  const [created] = await db
    .insert(registrations)
    .values({
      eventId,
      participantId: participant.id,
      kind: "REAL",
      locale: "ro",
      registeredName: `Runner ${serial}`,
      displayName: `Runner ${serial}`,
      privacyNoticeVersion: 1,
      privacyAcknowledgedAt: new Date(),
      resultsNameConsent: false,
      resultsConsentVersion: 1,
      status: "CONFIRMED",
    })
    .returning({ id: registrations.id });
  return created;
}

async function organizer(): Promise<StaffUser> {
  serial += 1;
  const [user] = await db.insert(staffUsers).values({ email: `organizer-${serial}@dev.test`, displayName: "Organizator", role: "MODERATOR" }).returning();
  return user;
}

const messagesPage = (id: string, searchParams: Record<string, string> = {}) =>
  ParticipantMessagesPage({ params: Promise.resolve({ locale: state.locale, id }), searchParams: Promise.resolve(searchParams) } as never);
const composerOf = (tree: ReactNode) => elements(tree).find((element) => element.type === ParticipantMessageComposer)!;
const specsOf = (tree: ReactNode) => elements(tree).find((element) => element.type === ActionForm)?.props.confirm as ConfirmSpec[];

/** The composer the page built, as the browser first receives it. */
const drawn = (tree: ReactNode) => renderToStaticMarkup(composerOf(tree));
/** One box of the form, as its `<input>` tag. */
const boxOf = (markup: string, name: string) => markup.match(new RegExp(`<input[^>]*name="${name}"[^>]*>`))?.[0] ?? "";
/** What a reader sees of a piece of markup: its words, tags gone and entities read. */
const wordsOf = (markup: string) =>
  markup
    .replace(/<[^>]+>/g, "")
    .replaceAll("&#x27;", "'")
    .replaceAll("&quot;", '"')
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
/** The tick's own box on the page: the label and the line under it. */
const tickOf = (markup: string) => markup.match(/<div[^>]*data-testid="participant-message-route-gpx"[^>]*>[^]*?<\/p><\/div>/)?.[0] ?? "";
const helpOf = (markup: string) => wordsOf(markup.match(/<p[^>]*id="participant-message-route-gpx-help"[^>]*>[^]*?<\/p>/)?.[0] ?? "");
const wordsIn = (locale: "ro" | "en") => (locale === "ro" ? ro : en).Admin.participantMessages;

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
  state.db = db;
});
afterAll(async () => close());
beforeEach(async () => {
  await resetTables(db);
  state.locale = "ro";
  state.actor = await organizer();
});

describe("§987 «Atașează traseul (GPX)» on the composer's page", () => {
  it("an event with a GPX: the tick is offered after the other ticks, off by default, with its help line — in Romanian and in English", async () => {
    const race = await createRace(GPX);
    await register(race.id);
    for (const locale of ["ro", "en"] as const) {
      state.locale = locale;
      const tree = await messagesPage(race.id);
      const words = wordsIn(locale);
      expect(composerOf(tree).props.hasRouteGpx, locale).toBe(true);
      const labels = composerOf(tree).props.labels as Record<string, unknown>;
      expect(labels.includeRouteGpx, locale).toBe(words.includeRouteGpx);
      expect(labels.includeRouteGpxHelp, locale).toBe(words.includeRouteGpxHelp);
      expect(composerOf(tree).props.kept, locale).toBeUndefined();

      const markup = drawn(tree);
      const box = boxOf(markup, "includeRouteGpx");
      // A real box of the form, posting `1` when ticked — enabled, and not ticked.
      expect(box, locale).toContain('type="checkbox"');
      expect(box, locale).toContain('value="1"');
      expect(box, locale).not.toContain("disabled");
      expect(box, locale).not.toContain("checked");
      expect(box, locale).toContain('aria-describedby="participant-message-route-gpx-help"');
      expect(wordsOf(tickOf(markup)), locale).toBe(`${words.includeRouteGpx}${words.includeRouteGpxHelp}`);
      expect(helpOf(markup), locale).toBe(words.includeRouteGpxHelp);
      // Beside the others: after «Include programul evenimentului», before the preview.
      const at = (needle: string) => markup.indexOf(needle);
      expect(at('name="includeRouteGpx"'), locale).toBeGreaterThan(at('name="includeProgramme"'));
      expect(at('name="includeProgramme"'), locale).toBeGreaterThan(at('name="signLink"'));
      expect(at('data-testid="participant-message-preview"'), locale).toBeGreaterThan(at('name="includeRouteGpx"'));
      // The other four are as they were: unticked.
      for (const name of ["askReconfirm", "sendQr", "signLink", "includeProgramme"]) expect(boxOf(markup, name), `${locale} ${name}`).not.toContain("checked");
    }
  });

  it("an event without a GPX: no tick at all — no box, no label, no help — and the other ticks as they were", async () => {
    const race = await createRace(null);
    await register(race.id);
    for (const locale of ["ro", "en"] as const) {
      state.locale = locale;
      const words = wordsIn(locale);
      const tree = await messagesPage(race.id);
      expect(composerOf(tree).props.hasRouteGpx, locale).toBe(false);
      const markup = drawn(tree);
      expect(boxOf(markup, "includeRouteGpx"), locale).toBe("");
      expect(markup, locale).not.toContain('data-testid="participant-message-route-gpx"');
      expect(wordsOf(markup), locale).not.toContain(words.includeRouteGpx);
      expect(wordsOf(markup), locale).not.toContain(words.includeRouteGpxHelp);
      for (const name of ["askReconfirm", "sendQr", "signLink", "includeProgramme"]) expect(boxOf(markup, name), `${locale} ${name}`).toContain('type="checkbox"');
    }
  });

  it("the question before «Trimite» says the email has the route attached — one line, only for a press that posts the tick — for each group and for the people ticked", async () => {
    const race = await createRace(GPX);
    const one = await register(race.id);
    await register(race.id);
    for (const locale of ["ro", "en"] as const) {
      state.locale = locale;
      const words = wordsIn(locale);
      const specs = specsOf(await messagesPage(race.id));
      // The six groups and the people ticked (§1055 added «Prezenți» and «N-au ajuns»).
      expect(specs.length, locale).toBe(7);
      for (const spec of specs) {
        const found = (spec.also ?? []).filter((line) => line.text === words.confirmRouteGpx);
        expect(found, `${locale} ${JSON.stringify(spec.when)}`).toEqual([{ text: words.confirmRouteGpx, when: [{ field: "includeRouteGpx", equals: "1" }] }]);
        expect(spec.body, locale).not.toContain(words.confirmRouteGpx);
      }
      /** The dialog as the form's island resolves it for one press: the question picked, counted, its lines kept by the posted form. */
      const asked = (posted: Record<string, string | string[]>) => {
        const valueOf = (field: string) => {
          const value = posted[field];
          return value === undefined ? null : Array.isArray(value) ? (value[0] ?? null) : value;
        };
        const valuesOf = (field: string) => {
          const value = posted[field];
          return value === undefined ? [] : Array.isArray(value) ? value : [value];
        };
        const spec = pickConfirm(specs, valueOf)!;
        return (resolveAlso(resolveEmailCount(spec, valuesOf), valueOf).also ?? []).map((line) => line.text);
      };
      for (const audience of ["ALL_ACTIVE", "CONFIRMED", "WAITLIST", "PENDING_DECLARATION"]) {
        expect(asked({ audience, includeRouteGpx: "1" }), `${locale} ${audience}`).toContain(words.confirmRouteGpx);
        expect(asked({ audience }), `${locale} ${audience}`).not.toContain(words.confirmRouteGpx);
        // The programme's tick says its own line, and only its own.
        expect(asked({ audience, includeProgramme: "1" }), `${locale} ${audience}`).not.toContain(words.confirmRouteGpx);
        expect(asked({ audience, includeProgramme: "1", includeRouteGpx: "1" }), `${locale} ${audience}`).toEqual(expect.arrayContaining([words.confirmProgramme, words.confirmRouteGpx]));
      }
      expect(asked({ audience: "CHOSEN", registrationIds: [one.id], includeRouteGpx: "1" }), locale).toContain(words.confirmRouteGpx);
      expect(asked({ audience: "CHOSEN", registrationIds: [one.id] }), locale).not.toContain(words.confirmRouteGpx);
      expect(asked({ audience: "ALL_ACTIVE", includeRouteGpx: "1" }).filter((text) => text === words.confirmRouteGpx), locale).toHaveLength(1);
    }
  });

  it("back from a trial to the people ticked, the tick is as the trial left it; off after a trial without it; gone once the event has no GPX", async () => {
    const race = await createRace(GPX);
    const actor = state.actor as StaffUser;
    const one = await register(race.id);
    await register(race.id);
    const trial = randomUUID();
    await sendParticipantMessage(db, actor, await confirmed(db, { eventId: race.id, audience: "CHOSEN", registrationIds: [one.id], sendId: trial, includeRouteGpx: true, ...WORDS }), new Date(Date.now() - 60_000));
    const plain = randomUUID();
    await sendParticipantMessage(db, actor, await confirmed(db, { eventId: race.id, audience: "CHOSEN", registrationIds: [one.id], sendId: plain, ...WORDS }), new Date(Date.now() - 30_000));

    const back = await messagesPage(race.id, { sent: "1", test: "0", kept: trial });
    expect(composerOf(back).props.kept).toEqual({
      subjectRo: WORDS.subject.ro,
      subjectEn: WORDS.subject.en,
      bodyRo: WORDS.body.ro,
      bodyEn: WORDS.body.en,
      askReconfirm: false,
      sendQr: false,
      signLink: false,
      includeRouteGpx: true,
    });
    expect(boxOf(drawn(back), "includeRouteGpx")).toContain("checked");
    expect(boxOf(drawn(back), "includeProgramme")).not.toContain("checked");

    const untouched = await messagesPage(race.id, { sent: "1", test: "0", kept: plain });
    const kept = composerOf(untouched).props.kept as Record<string, unknown>;
    expect("includeRouteGpx" in kept).toBe(false);
    expect(boxOf(drawn(untouched), "includeRouteGpx")).not.toContain("checked");

    // The GPX was removed since the trial: there is no file to attach, so there is no box, ticked or not.
    await db.update(events).set({ routeGpx: null }).where(eq(events.id, race.id));
    const gone = drawn(await messagesPage(race.id, { sent: "1", test: "0", kept: trial }));
    expect(boxOf(gone, "includeRouteGpx")).toBe("");
  });
});
