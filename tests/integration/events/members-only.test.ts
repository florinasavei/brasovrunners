import { eq } from "drizzle-orm";
import { createTranslator } from "next-intl";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { events, eventTranslations } from "@/db/schema/events";
import { newsletterSends, newsletterSubscribers } from "@/db/schema/newsletter";
import { registrations } from "@/db/schema/registrations";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { computeContentHash, type LegalDocumentTranslationInput } from "@/modules/legal-documents/domain/content-hash";
import { insertLegalDocumentVersion } from "@/modules/legal-documents/repository";
import { canonicalizeEmail } from "@/modules/participants/domain/canonical-email";
import { ANOTHER_LINK_INVALID } from "@/modules/registrations/domain/family";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * §552 — «Doar pentru membrii BVR»: an event for the club's members alone, withheld in SQL from every
 * public read, and opened — its page, its `.ics`, its registration — only for a members' session.
 *
 * The session is the real one (`session.ts`, the development switcher's cookie in tests), over a real
 * database. Each public read is asked for the event by its own function, the way §533's test asks for
 * the undated one; the members' reads are asked with and without a session.
 *
 * Since §549 the event page is static for a stranger and the proxy sends a signed-in visitor to its
 * live twin: the static page and its `force-static` `.ics` never ask the account (a members' event
 * is a 404 there, whoever asks), and the twin and the twin's `.ics` are the members' door.
 */
const state = vi.hoisted(() => ({ db: undefined as unknown, cookie: undefined as string | undefined }));

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => (state.cookie ? { value: state.cookie } : undefined), set: () => {}, delete: () => {} }),
  headers: async () => new Headers(),
}));
vi.mock("@/auth", () => ({ auth: async () => null, signIn: async () => {}, signOut: async () => {} }));
vi.mock("@/db/client", () => ({ getDb: () => state.db }));
vi.mock("@/app/[locale]/admin/actions", () => ({ signOutAction: async () => {} }));
vi.mock("next-intl/server", () => {
  const catalogue = (locale: string) => (locale === "en" ? en : ro) as Record<string, object>;
  const translator = (locale: string, namespace: string) =>
    createTranslator({ locale, messages: catalogue(locale)[namespace] as Record<string, string>, namespace: undefined });
  return {
    setRequestLocale: () => {},
    getLocale: async () => "ro",
    getMessages: async () => ro,
    getTranslations: async (arg: string | { locale: string; namespace: string }) =>
      typeof arg === "string" ? translator("ro", arg) : translator(arg.locale, arg.namespace),
  };
});

const { createEventAndPublish, saveEventAndTranslations } = await import("@/modules/content/events/service");
const repository = await import("@/modules/events/repository");
const { membersEventBySlug, membersOnlyEventsFor } = await import("@/modules/events/members-only");
const { queueNewEventAlerts } = await import("@/modules/newsletter/service");
const { submitRegistration } = await import("@/modules/registrations/service");
const { GET: eventIcs } = await import("@/app/[locale]/events/[slug]/calendar.ics/route");
const { GET: membersIcs } = await import("@/app/[locale]/live/events/[slug]/calendar.ics/route");
const { generateMetadata, default: EventDetailPage } = await import("@/app/[locale]/events/[slug]/page");
const { generateMetadata: twinMetadata, default: LiveEventDetailPage } = await import("@/app/[locale]/live/events/[slug]/page");
const { submitRegistrationAction } = await import("@/app/[locale]/events/[slug]/register/actions");
const { default: RegisterPage } = await import("@/app/[locale]/events/[slug]/register/page");
const { default: GroupRunDeclarationPage } = await import("@/app/[locale]/events/[slug]/declaration/page");
const { default: MembersAreaPage } = await import("@/app/[locale]/members-area/page");
const { default: EventCard } = await import("@/modules/events/ui/EventCard");
const { default: StartList } = await import("@/modules/events/ui/StartList");
const { default: EventFeedbackButton } = await import("@/modules/feedback/ui/EventFeedbackButton");
const { default: EventPageView } = await import("@/modules/events/ui/EventPageView");
const { signGroupRunDeclaration } = await import("@/modules/group-run-declarations/service");

const NOW = new Date("2026-10-01T09:00:00.000Z");

const EVENT_FIELDS = {
  type: "RACE",
  eventStatus: "SCHEDULED",
  timezone: "Europe/Bucharest",
  startsAtWallTime: "2027-03-14T10:00",
  endsAtWallTime: "",
  raceStartsAtWallTime: "",
  locationName: "Parcul Titulescu",
  locationNameEn: "Titulescu Park",
  locationAddress: "",
  surface: null,
  difficulty: null,
  costType: null,
  mapUrl: "",
  routeUrl: "",
  distanceMeters: "",
  elevationGainMeters: "",
  featured: false,
  registrationMode: "INTERNAL",
  participantListVisibility: "HIDDEN" as const,
  capacity: "50",
  registrationOpensAtWallTime: "",
  registrationClosesAtWallTime: "",
  declarationDocumentId: "",
  externalProvider: "",
  externalRegistrationUrl: "",
};

const MEMBERS = {
  ro: { slug: "crosul-membrilor", title: "Crosul membrilor", excerpt: "Doar pentru membri." },
  en: { slug: "members-cross", title: "Members' cross", excerpt: "Members only." },
};
const PUBLIC = {
  ro: { slug: "crosul-public", title: "Crosul public", excerpt: "Pentru toți." },
  en: { slug: "public-cross", title: "Public cross", excerpt: "For everybody." },
};

/** A whole, valid entry, so a refusal can only be the one the test is about. */
const SUBMISSION = {
  firstName: "Ana",
  lastName: "Membru",
  birthDate: "1990-05-17",
  sex: "FEMALE",
  nationality: "RO",
  country: "RO",
  city: "Brașov",
  phone: "+40711111111",
  emergencyContactName: "Contact Urgență",
  emergencyContactPhone: "+40722222222",
  email: "membru@dev.test",
  locale: "ro",
  privacyAcknowledged: true,
  fitnessDeclared: true,
  termsAccepted: true,
  rulesAcknowledged: true,
  resultsNameConsent: true,
  listOptOut: false,
  honeypot: "",
  renderedAt: new Date(NOW.getTime() - 10_000).toISOString(),
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

/**
 * Every element of `type` in a page's returned tree, its children walked without rendering them — the
 * zone's cards are async server components, which a static render cannot draw, and their props are
 * what the test is about.
 */
function elementsOf(node: unknown, type: unknown): { props: Record<string, unknown> }[] {
  if (Array.isArray(node)) return node.flatMap((child) => elementsOf(child, type));
  if (typeof node !== "object" || node === null || !("props" in node)) return [];
  const element = node as { type: unknown; props: Record<string, unknown> };
  return [...(element.type === type ? [element] : []), ...elementsOf(element.props.children, type)];
}

/** Every string in a page's returned tree, its children and its inputs' values, without rendering. */
function textsOf(node: unknown): string[] {
  if (typeof node === "string") return [node];
  if (Array.isArray(node)) return node.flatMap(textsOf);
  if (typeof node !== "object" || node === null || !("props" in node)) return [];
  const props = (node as { props: Record<string, unknown> }).props;
  return [...(typeof props.value === "string" ? [props.value] : []), ...textsOf(props.children)];
}

/**
 * The live twin rendered one level down: it returns the event page as an element with the props it
 * chose (the members' read, the edit flag), and the page itself is what reads the event.
 */
async function throughTwin(props: Parameters<typeof LiveEventDetailPage>[0]): Promise<unknown> {
  const element = (await LiveEventDetailPage(props)) as { type: (props: unknown) => Promise<unknown>; props: unknown };
  return element.type(element.props);
}

/** Whether a page's call threw Next's 404. */
async function isNotFound(promise: Promise<unknown>): Promise<boolean> {
  try {
    await promise;
    return false;
  } catch (error) {
    const digest = (error as { digest?: string }).digest ?? "";
    if (digest.startsWith("NEXT_HTTP_ERROR_FALLBACK;404")) return true;
    throw error;
  }
}

describe("§552 events for the members alone", () => {
  let db: TestDatabase;
  let close: () => Promise<void>;
  let admin: StaffUser;
  let member: StaffUser;
  let declarationId: string;
  let membersEventId: string;
  const fields = () => ({ ...EVENT_FIELDS, declarationDocumentId: declarationId });

  beforeAll(async () => {
    ({ db, close } = await createTestDatabase());
    state.db = db;
  });
  afterAll(async () => close());

  beforeEach(async () => {
    await resetTables(db);
    state.cookie = undefined;
    [admin] = await db.insert(staffUsers).values({ email: "admin@dev.test", displayName: "Admin", role: "ADMIN" }).returning();
    [member] = await db.insert(staffUsers).values({ email: "membru@dev.test", displayName: "Ana Membru", role: "MEMBER" }).returning();
    const notice: LegalDocumentTranslationInput[] = [
      { locale: "ro", title: "Confidențialitate", body: { sections: [{ paragraphs: ["p"] }] } },
      { locale: "en", title: "Privacy", body: { sections: [{ paragraphs: ["p"] }] } },
    ];
    for (const key of ["PRIVACY_NOTICE", "TERMS"] as const) {
      await insertLegalDocumentVersion(db, {
        key,
        version: 1,
        effectiveAt: new Date("2026-01-01T00:00:00.000Z"),
        isApproved: true,
        contentSha256: computeContentHash(notice),
        translations: notice,
        now: NOW,
      });
    }
    const declaration: LegalDocumentTranslationInput[] = [
      { locale: "ro", title: "Declarație", body: { sections: [{ paragraphs: ["Declar."] }] } },
      { locale: "en", title: "Declaration", body: { sections: [{ paragraphs: ["I declare."] }] } },
    ];
    declarationId = await insertLegalDocumentVersion(db, {
      key: "EVENT_DECLARATION",
      version: 1,
      effectiveAt: new Date("2026-01-01T00:00:00.000Z"),
      isApproved: true,
      contentSha256: computeContentHash(declaration),
      translations: declaration,
      now: NOW,
    });
    // Somebody who wants to hear of every new event (§445): the alert's audience, were it asked.
    const identity = canonicalizeEmail("abonat@example.ro");
    await db.insert(newsletterSubscribers).values({
      deliveryEmail: identity.deliveryEmail,
      canonicalEmail: identity.canonicalEmail,
      canonicalizationVersion: identity.canonicalizationVersion,
      locale: "ro",
      topics: ["ALL"],
      privacyNoticeVersion: 1,
      confirmedAt: NOW,
    });
    const created = await createEventAndPublish(db, {
      actor: admin,
      fields: { ...fields(), membersOnly: true, translations: MEMBERS },
      publish: true,
      now: NOW,
    });
    membersEventId = created.event.id;
  });

  const rowOf = async (id: string) => (await db.select().from(events).where(eq(events.id, id)))[0];
  const slugs = (rows: readonly { slug: string }[]) => rows.map((row) => row.slug);

  describe("withheld from every public read, in SQL", () => {
    it("is saved as the members' and published", async () => {
      const row = await rowOf(membersEventId);
      expect(row.membersOnly).toBe(true);
      expect(row.editorialStatus).toBe("PUBLISHED");
    });

    it("is on no list, month, feed or sitemap, and has no public page read or alternates", async () => {
      await createEventAndPublish(db, { actor: admin, fields: { ...fields(), translations: PUBLIC }, publish: true, now: NOW });
      const from = new Date("2027-03-01T00:00:00.000Z");
      const to = new Date("2027-04-01T00:00:00.000Z");
      expect(slugs(await repository.listPublishedEvents(db, "ro"))).toEqual(["crosul-public"]);
      expect(slugs(await repository.listUpcomingEvents(db, "ro", NOW))).toEqual(["crosul-public"]);
      // The calendar's month and the `.ics` feed are the same read (`listPublishedEventsBetween`).
      expect(slugs(await repository.listPublishedEventsBetween(db, "ro", from, to))).toEqual(["crosul-public"]);
      expect(slugs(await repository.listPublishedEventAddresses(db, "en"))).toEqual(["public-cross"]);
      expect(await repository.listUndatedPublishedEvents(db, "ro")).toEqual([]);
      expect(await repository.findLatestPastEvent(db, "ro", new Date("2027-06-01T00:00:00.000Z"))).toMatchObject({ slug: "crosul-public" });
      expect(await repository.findPublishedEventBySlug(db, "ro", "crosul-membrilor")).toBeUndefined();
      expect(await repository.findPublishedTranslations(db, membersEventId)).toEqual([]);
      expect(await repository.findPublishedTranslationsForEvents(db, [membersEventId])).toEqual([]);
      // The members' own read finds it, and says what it is.
      expect(await repository.findPublishedEventBySlug(db, "ro", "crosul-membrilor", "members")).toMatchObject({ membersOnly: true });
    });

    it("is withheld when its date is to be announced too", async () => {
      await createEventAndPublish(db, {
        actor: admin,
        fields: { ...fields(), membersOnly: true, dateToBeAnnounced: true, translations: { ro: { ...MEMBERS.ro, slug: "fara-data" }, en: { ...MEMBERS.en, slug: "no-date" } } },
        publish: true,
        now: NOW,
      });
      expect(await repository.listUndatedPublishedEvents(db, "ro")).toEqual([]);
      expect(slugs(await repository.listMembersOnlyEvents(db, "ro", NOW))).toEqual(["crosul-membrilor", "fara-data"]);
    });

    it("alerts no newsletter subscriber (§445), and a public event still does", async () => {
      await queueNewEventAlerts(db, NOW);
      expect(await db.select().from(newsletterSends).where(eq(newsletterSends.eventId, membersEventId))).toEqual([]);
      const open = await createEventAndPublish(db, { actor: admin, fields: { ...fields(), translations: PUBLIC }, publish: true, now: NOW });
      await queueNewEventAlerts(db, new Date(NOW.getTime() + 60_000));
      expect(await db.select().from(newsletterSends).where(eq(newsletterSends.eventId, open.event.id))).toHaveLength(1);
    });

    it("turned public, it is everywhere at once; turned back, it is withdrawn and keeps its registrations", async () => {
      const row = await rowOf(membersEventId);
      await saveEventAndTranslations(db, { actor: admin, eventId: row.id, fields: { ...fields(), membersOnly: false }, expectedVersion: row.version, translations: [], now: NOW });
      expect(slugs(await repository.listPublishedEvents(db, "ro"))).toEqual(["crosul-membrilor"]);
      expect(await repository.findPublishedTranslations(db, row.id)).toHaveLength(2);
      const after = await rowOf(row.id);
      await saveEventAndTranslations(db, { actor: admin, eventId: row.id, fields: { ...fields(), membersOnly: true }, expectedVersion: after.version, translations: [], now: NOW });
      expect(await repository.listPublishedEvents(db, "ro")).toEqual([]);
    });

    it("a save that does not post the switch keeps it; it refuses to lead the listing", async () => {
      const row = await rowOf(membersEventId);
      await saveEventAndTranslations(db, { actor: admin, eventId: row.id, fields: fields(), expectedVersion: row.version, translations: [], now: NOW });
      expect((await rowOf(row.id)).membersOnly).toBe(true);
      const again = await rowOf(row.id);
      await expect(
        saveEventAndTranslations(db, { actor: admin, eventId: row.id, fields: { ...fields(), featured: true }, expectedVersion: again.version, translations: [], now: NOW }),
      ).rejects.toMatchObject({ code: "VALIDATION_ERROR", fields: ["featured"] });
    });
  });

  describe("the page and the .ics: 404 to a stranger, open to a member and to staff", () => {
    const params = () => Promise.resolve({ locale: "ro", slug: "crosul-membrilor" });
    const staticIcs = () => eventIcs(new Request("http://localhost/ro/events/crosul-membrilor/calendar.ics"), { params: params() });
    const ics = () => membersIcs(new Request("http://localhost/ro/live/events/crosul-membrilor/calendar.ics"), { params: params() });
    const twin = () => throughTwin({ params: params(), searchParams: Promise.resolve({}) });

    it("answers a stranger 404 on the twin, its metadata and the members' .ics", async () => {
      expect(await membersEventBySlug("ro", "crosul-membrilor")).toBeUndefined();
      expect(await twinMetadata({ params: params() })).toEqual({});
      expect(await isNotFound(twin())).toBe(true);
      const response = await ics();
      expect(response.status).toBe(404);
      expect(response.headers.get("Cache-Control")).toContain("no-store");
    });

    it("the static page and its .ics answer 404 even with a member's session: they never ask the account (§549)", async () => {
      state.cookie = member.id;
      expect(await generateMetadata({ params: params() })).toEqual({});
      expect(await isNotFound(EventDetailPage({ params: params() }))).toBe(true);
      expect((await staticIcs()).status).toBe(404);
    });

    it("opens for a member on the twin: the page, noindex metadata and a private .ics", async () => {
      state.cookie = member.id;
      expect(await membersEventBySlug("ro", "crosul-membrilor")).toMatchObject({ membersOnly: true });
      const metadata = await twinMetadata({ params: params() });
      expect(metadata).toMatchObject({ title: "Crosul membrilor", robots: { index: false, follow: false } });
      expect(metadata).not.toHaveProperty("alternates");
      expect(metadata).not.toHaveProperty("openGraph");
      expect(await isNotFound(twin())).toBe(false);
      const response = await ics();
      expect(response.status).toBe(200);
      expect(response.headers.get("Cache-Control")).toBe("private, no-store, max-age=0");
      expect(response.headers.get("X-Robots-Tag")).toBe("noindex, nofollow");
    });

    it("opens for an Administrator", async () => {
      state.cookie = admin.id;
      expect(await isNotFound(twin())).toBe(false);
      expect((await ics()).status).toBe(200);
    });

    it("the members' .ics serves no public event: that file is the static one's", async () => {
      await createEventAndPublish(db, { actor: admin, fields: { ...fields(), translations: PUBLIC }, publish: true, now: NOW });
      state.cookie = member.id;
      const publicParams = Promise.resolve({ locale: "ro", slug: "crosul-public" });
      expect((await membersIcs(new Request("http://localhost/ro/live/events/crosul-public/calendar.ics"), { params: publicParams })).status).toBe(404);
    });

    it("the zone lists it for a member and for nobody else", async () => {
      expect(await membersOnlyEventsFor(null, "ro", NOW)).toEqual([]);
      expect(slugs(await membersOnlyEventsFor(member, "ro", NOW))).toEqual(["crosul-membrilor"]);
    });

    it("a repeated members' run is one card in the zone, with its dates (§113)", async () => {
      // A second date of the same run: the same type and title, a week later (§113 recognises it).
      await createEventAndPublish(db, {
        actor: admin,
        fields: { ...fields(), membersOnly: true, startsAtWallTime: "2027-03-21T10:00", translations: { ro: { ...MEMBERS.ro, slug: "crosul-membrilor-2" }, en: { ...MEMBERS.en, slug: "members-cross-2" } } },
        publish: true,
        now: NOW,
      });
      state.cookie = member.id;
      const cards = elementsOf(await MembersAreaPage({ params: Promise.resolve({ locale: "ro" }) }), EventCard);
      expect(cards).toHaveLength(1);
      expect((cards[0].props.event as { slug: string }).slug).toBe("crosul-membrilor");
      expect(slugs(cards[0].props.seriesDates as { slug: string }[])).toEqual(["crosul-membrilor", "crosul-membrilor-2"]);
    });

    it("the registration form: 404 to a stranger; for a member, the account's address, not asked", async () => {
      // The page reads the wall clock: published before it, so the window is open today.
      await db.update(events).set({ publishedAt: new Date("2026-01-01T00:00:00.000Z") }).where(eq(events.id, membersEventId));
      const page = () => RegisterPage({ params: params(), searchParams: Promise.resolve({}) });
      expect(await isNotFound(page())).toBe(true);
      state.cookie = member.id;
      const texts = textsOf(await page());
      expect(texts).toContain(member.email);
      expect(texts).toContain(ro.Registration.membersAddressLabel);
    });

    it("the participant list is not drawn for a member, and still is on a public event (§32)", async () => {
      await createEventAndPublish(db, { actor: admin, fields: { ...fields(), translations: PUBLIC }, publish: true, now: NOW });
      state.cookie = member.id;
      // The page's body is `EventPageView` since §579 (the editor's preview draws it too): one level more.
      const onPage = async (slug: string) => {
        const [view] = elementsOf(await throughTwin({ params: Promise.resolve({ locale: "ro", slug }), searchParams: Promise.resolve({}) }), EventPageView);
        return elementsOf(await EventPageView(view.props as Parameters<typeof EventPageView>[0]), StartList);
      };
      expect(await onPage("crosul-membrilor")).toHaveLength(0);
      expect(await onPage("crosul-public")).toHaveLength(1);
    });

    it("«Spune-ne cum a fost» is never offered on a members' event, and still is on a public one (§676)", async () => {
      await createEventAndPublish(db, { actor: admin, fields: { ...fields(), translations: PUBLIC }, publish: true, now: NOW });
      state.cookie = member.id;
      // The button decides for itself whether the branch is open and the event is over; the page decides
      // whether to ask it at all (§676): the form's picker is public, so a members' event would open on
      // «Altceva» and the club would lose which event the message was about.
      const onPage = async (slug: string) => {
        const [view] = elementsOf(await throughTwin({ params: Promise.resolve({ locale: "ro", slug }), searchParams: Promise.resolve({}) }), EventPageView);
        return elementsOf(await EventPageView(view.props as Parameters<typeof EventPageView>[0]), EventFeedbackButton);
      };
      expect(await onPage("crosul-membrilor")).toHaveLength(0);
      const [button] = await onPage("crosul-public");
      expect(button).toBeDefined();
      expect((button.props.event as { slug: string }).slug).toBe("crosul-public");
    });
  });

  describe("a group run for the members alone: its declaration behind the same door", () => {
    async function membersRun() {
      const [run] = await db
        .insert(events)
        .values({
          type: "GROUP_RUN",
          surface: "TRAIL",
          offersGroupRunDeclaration: true,
          membersOnly: true,
          editorialStatus: "PUBLISHED",
          publishedAt: NOW,
          startsAt: new Date("2026-10-07T16:00:00.000Z"),
          registrationMode: "NONE",
          locationName: "Stația de telecabină",
        })
        .returning();
      await db.insert(eventTranslations).values([
        { eventId: run.id, locale: "ro", title: "Tura membrilor", slug: "tura-membrilor" },
        { eventId: run.id, locale: "en", title: "The members' loop", slug: "members-loop" },
      ]);
      return run;
    }
    const page = () => GroupRunDeclarationPage({ params: Promise.resolve({ locale: "ro", slug: "tura-membrilor" }), searchParams: Promise.resolve({}) });

    it("answers a stranger 404 and opens for a member", async () => {
      await membersRun();
      expect(await isNotFound(page())).toBe(true);
      state.cookie = member.id;
      expect(await isNotFound(page())).toBe(false);
    });

    it("the service refuses a signature without a members' session, as for a run that offers none", async () => {
      const run = await membersRun();
      await expect(
        signGroupRunDeclaration(
          db,
          { eventId: run.id, documentId: declarationId, contentSha256: "x", accepted: true, typedName: "Ana Membru", birthDate: "1990-05-17", email: "membru@dev.test", locale: "ro" },
          NOW,
        ),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });
  });

  describe("the door: a members' session, the account's own address, one person per account", () => {
    it("the form's action sends a stranger away as for an event that does not exist", async () => {
      const form = new FormData();
      form.set("locale", "ro");
      form.set("slug", "crosul-membrilor");
      expect(await redirectedTo(submitRegistrationAction(form))).toBe("/ro/evenimente");
      expect(await db.select().from(registrations)).toEqual([]);
    });

    it("the service refuses a public form without a members' session", async () => {
      const row = await rowOf(membersEventId);
      await expect(submitRegistration(db, row, SUBMISSION, NOW)).rejects.toMatchObject({ code: "NOT_FOUND" });
      expect(await db.select().from(registrations)).toEqual([]);
    });

    it("refuses another address than the account's", async () => {
      const row = await rowOf(membersEventId);
      await expect(
        submitRegistration(db, row, { ...SUBMISSION, email: "altcineva@dev.test" }, NOW, "REAL", { source: "PUBLIC", member: { email: member.email } }),
      ).rejects.toMatchObject({ code: "VALIDATION_ERROR", fields: ["email"] });
    });

    it("takes the account's address, and a second name on it registers nobody else", async () => {
      const row = await rowOf(membersEventId);
      await submitRegistration(db, row, SUBMISSION, NOW, "REAL", { source: "PUBLIC", member: { email: member.email } });
      expect(await db.select().from(registrations).where(eq(registrations.eventId, row.id))).toHaveLength(1);
      await submitRegistration(
        db,
        row,
        { ...SUBMISSION, firstName: "Ioan", lastName: "Altul", birthDate: "1985-01-02", renderedAt: new Date(NOW.getTime() - 20_000).toISOString() },
        new Date(NOW.getTime() + 1_000),
        "REAL",
        { source: "PUBLIC", member: { email: member.email } },
      );
      const rows = await db.select().from(registrations).where(eq(registrations.eventId, row.id));
      expect(rows).toHaveLength(1);
      expect(rows[0]?.registeredName).toBe("Ana Membru");
    });

    it("refuses the emailed link for another person", async () => {
      const row = await rowOf(membersEventId);
      await expect(
        submitRegistration(db, row, SUBMISSION, NOW, "REAL", { source: "PUBLIC", anotherPerson: { participantId: "00000000-0000-4000-8000-000000000000" } }),
      ).rejects.toMatchObject({ code: "VALIDATION_ERROR", fields: [ANOTHER_LINK_INVALID] });
    });

    it("a staff entry is the backoffice's, as on any event", async () => {
      const row = await rowOf(membersEventId);
      await submitRegistration(db, row, { ...SUBMISSION, email: "cineva@dev.test" }, NOW, "REAL", { source: "STAFF", createdByStaffUserId: admin.id });
      expect(await db.select().from(registrations).where(eq(registrations.eventId, row.id))).toHaveLength(1);
    });
  });
});
