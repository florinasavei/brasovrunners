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
import { type ConfirmSpec, pickConfirm, resolveAlso, resolveEmailCount } from "@/shared/feedback/notice";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";
import { confirmed } from "../../helpers/typed-count";

/**
 * §NNN — «Include programul evenimentului» on the page of «Trimite un mesaj participanților» (BR-REQ-080-01): the tick
 * beside the composer's other ticks, off by default; offered when the event has at least one timed programme row, and
 * drawn disabled — with the sentence that says why, and where the programme is written — when it has none, a free-text
 * programme alone included; the one line the question before «Trimite» says only for a press that posts the tick; and,
 * back from a trial to the people ticked, the tick as that trial left it. The page is a Server Component: it is called,
 * its tree walked for what it hands the composer, and the composer it built rendered to markup, in both languages.
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

/** The timed rows of a race day (§117), on a day the calendar is far from. */
const ROWS = [
  { startsAt: "2099-11-21T06:30:00.000Z", endsAt: "2099-11-21T07:30:00.000Z", label: { ro: "Ridicarea kiturilor", en: "Kit pickup" }, place: "Sala Sporturilor" },
  { startsAt: "2099-11-21T08:00:00.000Z", endsAt: null, label: { ro: "Startul", en: "The start" }, place: null },
];
/** A programme written as free text on the page (`event_translations.schedule_json`): words, no timed row. */
const FREE_TEXT = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Kiturile se ridică de la ora 8." }] }] };
const WORDS = { subject: { ro: "Probă: {eventTitle}", en: "Trial: {eventTitle}" }, body: { ro: "Ne vedem la start.", en: "See you at the start." } };

let db: TestDatabase;
let close: () => Promise<void>;
let serial = 0;

async function createRace(scheduleItems: unknown) {
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
      scheduleItems: scheduleItems as never,
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
const tickOf = (markup: string) => markup.match(/<div[^>]*data-testid="participant-message-programme"[^>]*>[^]*?<\/p><\/div>/)?.[0] ?? "";
const helpOf = (markup: string) => wordsOf(markup.match(/<p[^>]*id="participant-message-programme-help"[^>]*>[^]*?<\/p>/)?.[0] ?? "");

const cataloguesOf = (locale: "ro" | "en") => {
  const catalogue = locale === "ro" ? ro : en;
  const words = catalogue.Admin.participantMessages;
  return { words, none: words.includeProgrammeNone.replace("{card}", catalogue.Admin.editor.boxes.programme.title) };
};

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

describe("§NNN «Include programul evenimentului» on the composer's page", () => {
  it("an event with a timed programme: the tick is offered beside the other ticks, off by default, with its help line — in Romanian and in English", async () => {
    const race = await createRace(ROWS);
    await register(race.id);
    for (const locale of ["ro", "en"] as const) {
      state.locale = locale;
      const tree = await messagesPage(race.id);
      const { words, none } = cataloguesOf(locale);
      // What the page hands the composer: that there is a programme to include, and the tick's three sentences.
      expect(composerOf(tree).props.hasProgramme, locale).toBe(true);
      const labels = composerOf(tree).props.labels as Record<string, unknown>;
      expect(labels.includeProgramme, locale).toBe(words.includeProgramme);
      expect(labels.includeProgrammeHelp, locale).toBe(words.includeProgrammeHelp);
      expect(labels.includeProgrammeNone, locale).toBe(none);
      // Nothing is kept on a page that was not returned to from a trial.
      expect(composerOf(tree).props.kept, locale).toBeUndefined();

      const markup = drawn(tree);
      const box = boxOf(markup, "includeProgramme");
      // A real box of the form, posting `1` when ticked — enabled, and not ticked.
      expect(box, locale).toContain('type="checkbox"');
      expect(box, locale).toContain('value="1"');
      expect(box, locale).not.toContain("disabled");
      expect(box, locale).not.toContain("checked");
      expect(box, locale).toContain('aria-describedby="participant-message-programme-help"');
      // Its label and its help line; the sentence for an event without a programme is not said.
      expect(wordsOf(tickOf(markup)), locale).toBe(`${words.includeProgramme}${words.includeProgrammeHelp}`);
      expect(helpOf(markup), locale).toBe(words.includeProgrammeHelp);
      expect(wordsOf(markup), locale).not.toContain(none);
      // Beside the others: after «Trimite și linkul pentru semnarea declarației», before the preview.
      const at = (needle: string) => markup.indexOf(needle);
      expect(at('name="askReconfirm"'), locale).toBeGreaterThan(-1);
      expect(at('name="sendQr"'), locale).toBeGreaterThan(at('name="askReconfirm"'));
      expect(at('name="signLink"'), locale).toBeGreaterThan(at('name="sendQr"'));
      expect(at('name="includeProgramme"'), locale).toBeGreaterThan(at('name="signLink"'));
      expect(at('data-testid="participant-message-preview"'), locale).toBeGreaterThan(at('name="includeProgramme"'));
      // The other three are as they were: enabled, unticked.
      for (const name of ["askReconfirm", "sendQr", "signLink"]) {
        expect(boxOf(markup, name), `${locale} ${name}`).not.toContain("disabled");
        expect(boxOf(markup, name), `${locale} ${name}`).not.toContain("checked");
      }
    }
    expect(ro.Admin.participantMessages.includeProgramme).toBe("Include programul evenimentului");
  });

  it("an event without a timed programme: the tick is drawn disabled, with the sentence that says why and where the programme is written — a free-text programme alone does not enable it", async () => {
    const none = await createRace(null);
    const empty = await createRace([]);
    const freeTextOnly = await createRace(null);
    await db.update(eventTranslations).set({ scheduleJson: FREE_TEXT }).where(eq(eventTranslations.eventId, freeTextOnly.id));
    for (const race of [none, empty, freeTextOnly]) await register(race.id);
    for (const locale of ["ro", "en"] as const) {
      state.locale = locale;
      const { words, none: sentence } = cataloguesOf(locale);
      for (const [name, race] of [
        ["no rows", none],
        ["an empty list", empty],
        ["free text alone", freeTextOnly],
      ] as const) {
        const where = `${locale}: ${name}`;
        const tree = await messagesPage(race.id);
        expect(composerOf(tree).props.hasProgramme, where).toBe(false);
        const markup = drawn(tree);
        const box = boxOf(markup, "includeProgramme");
        // Disabled — a disabled box posts nothing — and not ticked.
        expect(box, where).toContain("disabled");
        expect(box, where).not.toContain("checked");
        // The label is still there, and under it the one sentence: why, and where the programme is written.
        expect(wordsOf(tickOf(markup)), where).toBe(`${words.includeProgramme}${sentence}`);
        expect(helpOf(markup), where).toBe(sentence);
        expect(wordsOf(markup), where).not.toContain(words.includeProgrammeHelp);
        // The other three ticks are untouched by it.
        for (const other of ["askReconfirm", "sendQr", "signLink"]) expect(boxOf(markup, other), `${where} ${other}`).not.toContain("disabled");
      }
    }
    // The sentence names the editor's card by the card's own title, in each language.
    expect(cataloguesOf("ro").none).toBe("Evenimentul nu are încă un program cu ore. Îl adaugi în editorul evenimentului, la „Programul zilei și ce să aduci”.");
    expect(cataloguesOf("en").none).toBe("The event has no timed programme yet. You add it in the event's editor, under “The day's programme and what to bring”.");
  });

  it("the question before «Trimite» says the email includes the programme — one line, only for a press that posts the tick — for each group and for the people ticked", async () => {
    const race = await createRace(ROWS);
    const one = await register(race.id);
    await register(race.id);
    for (const locale of ["ro", "en"] as const) {
      state.locale = locale;
      const { words } = cataloguesOf(locale);
      const specs = specsOf(await messagesPage(race.id));
      // Every question of the form carries the line, on the one condition: the box posted `1`.
      expect(specs.length, locale).toBe(5);
      for (const spec of specs) {
        const lines = (spec.also ?? []).filter((line) => line.text === words.confirmProgramme);
        expect(lines, `${locale} ${JSON.stringify(spec.when)}`).toEqual([{ text: words.confirmProgramme, when: [{ field: "includeProgramme", equals: "1" }] }]);
        // Never in the body or the title: the body is the send's own sentence, as it was.
        expect(spec.body, locale).not.toContain(words.confirmProgramme);
      }
      /** The dialog as the form's island resolves it for one press (`ActionFormIsland`): the question picked, counted, its lines kept by the posted form. */
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
        expect(asked({ audience, includeProgramme: "1" }), `${locale} ${audience}`).toContain(words.confirmProgramme);
        // An unticked box posts nothing, and so does a disabled one: the line is not said.
        expect(asked({ audience }), `${locale} ${audience}`).not.toContain(words.confirmProgramme);
        expect(asked({ audience, sendQr: "1", askReconfirm: "1" }), `${locale} ${audience}`).not.toContain(words.confirmProgramme);
      }
      expect(asked({ audience: "CHOSEN", registrationIds: [one.id], includeProgramme: "1" }), locale).toContain(words.confirmProgramme);
      expect(asked({ audience: "CHOSEN", registrationIds: [one.id] }), locale).not.toContain(words.confirmProgramme);
      // Said once, and after the email's own line about the club's mailboxes when there is one.
      expect(asked({ audience: "ALL_ACTIVE", includeProgramme: "1" }).filter((text) => text === words.confirmProgramme), locale).toHaveLength(1);
    }
    expect(ro.Admin.participantMessages.confirmProgramme).toBe("Emailul include programul evenimentului.");
    expect(en.Admin.participantMessages.confirmProgramme).toBe("The email includes the event's programme.");
  });

  it("back from a trial to the people ticked, the tick is as the trial left it — ticked with the words, so the same message goes to everybody; off after a trial without it, and off when the programme is gone since", async () => {
    const race = await createRace(ROWS);
    const actor = state.actor as StaffUser;
    const one = await register(race.id);
    await register(race.id);
    const trial = randomUUID();
    await sendParticipantMessage(db, actor, await confirmed(db, { eventId: race.id, audience: "CHOSEN", registrationIds: [one.id], sendId: trial, includeProgramme: true, ...WORDS }), new Date(Date.now() - 60_000));
    const plain = randomUUID();
    await sendParticipantMessage(db, actor, await confirmed(db, { eventId: race.id, audience: "CHOSEN", registrationIds: [one.id], sendId: plain, sendQr: true, ...WORDS }), new Date(Date.now() - 30_000));

    const back = await messagesPage(race.id, { sent: "1", test: "0", kept: trial });
    expect(composerOf(back).props.kept).toEqual({
      subjectRo: WORDS.subject.ro,
      subjectEn: WORDS.subject.en,
      bodyRo: WORDS.body.ro,
      bodyEn: WORDS.body.en,
      askReconfirm: false,
      sendQr: false,
      signLink: false,
      includeProgramme: true,
    });
    const markup = drawn(back);
    expect(boxOf(markup, "includeProgramme")).toContain("checked");
    expect(boxOf(markup, "includeProgramme")).not.toContain("disabled");
    // The trial's other ticks were off, and stay off.
    for (const name of ["askReconfirm", "sendQr", "signLink"]) expect(boxOf(markup, name), name).not.toContain("checked");

    // A trial that did not tick it: no such key is handed back, and the box is off — as on every new message.
    const untouched = await messagesPage(race.id, { sent: "1", test: "0", kept: plain });
    const kept = composerOf(untouched).props.kept as Record<string, unknown>;
    expect(kept).toEqual({ subjectRo: WORDS.subject.ro, subjectEn: WORDS.subject.en, bodyRo: WORDS.body.ro, bodyEn: WORDS.body.en, askReconfirm: false, sendQr: true, signLink: false });
    expect("includeProgramme" in kept).toBe(false);
    expect(boxOf(drawn(untouched), "includeProgramme")).not.toContain("checked");
    expect(boxOf(drawn(untouched), "sendQr")).toContain("checked");

    // The programme was removed since the trial: there is nothing to include, so the box is disabled and not ticked.
    await db.update(events).set({ scheduleItems: null }).where(eq(events.id, race.id));
    const gone = drawn(await messagesPage(race.id, { sent: "1", test: "0", kept: trial }));
    expect(boxOf(gone, "includeProgramme")).toContain("disabled");
    expect(boxOf(gone, "includeProgramme")).not.toContain("checked");
    expect(helpOf(gone)).toBe(cataloguesOf("ro").none);
  });
});
