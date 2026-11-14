import { isValidElement, type ReactElement, type ReactNode } from "react";
import { createTranslator } from "next-intl";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { auditLogs } from "@/db/schema/audit-logs";
import { events, eventTranslations } from "@/db/schema/events";
import { participants } from "@/db/schema/participants";
import { registrations } from "@/db/schema/registrations";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { computeContentHash, type LegalDocumentTranslationInput } from "@/modules/legal-documents/domain/content-hash";
import { insertLegalDocumentVersion } from "@/modules/legal-documents/repository";
import { canonicalizeEmail } from "@/modules/participants/domain/canonical-email";
import type { SponsorRegister } from "@/modules/registrations/sponsor-register";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * «Liste date sponsorilor» (§929) on its two screens — BR-REQ-071-01 and, for who gets it, BR-REQ-060-01: what an
 * event's registrations page and «Newsletter» hand the block. The read and the drawing are
 * `sponsor-list.test.ts`; this is the step between them, which a review by mutation found no test reached: the
 * event's own door (never another event's lists), the three roles that may take the list, the reader's language
 * and the page's clock. And, since §NNN, the fold the registrations page draws around the block: «Lista pentru
 * sponsori», closed, its line saying how many people and how many lists.
 *
 * The pages are Server Components, so each is called and its element tree walked, as `results-door.test.ts` does.
 */
const state = vi.hoisted(() => ({ db: undefined as unknown, actor: undefined as unknown, locale: "ro" as "ro" | "en" }));

vi.mock("next-intl/server", () => ({
  getTranslations: async (arg: string | { namespace: string }) => {
    const namespace = typeof arg === "string" ? arg : arg.namespace;
    const catalogue = (state.locale === "ro" ? ro : en) as unknown as Record<string, Record<string, unknown>>;
    return createTranslator({ locale: state.locale, messages: catalogue[namespace] as never });
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
vi.mock("@/i18n/navigation", () => ({ getPathname: ({ href }: { href: string | { pathname: string } }) => (typeof href === "string" ? href : href.pathname), Link: () => null }));
vi.mock("@/modules/staff-identity/session", () => ({
  DEV_STAFF_COOKIE: "dev-staff",
  requireStaff: async () => state.actor,
  requireStaffCapability: async () => state.actor,
}));
// The list page's own actions: imported by it, not under test here.
vi.mock("@/app/[locale]/admin/registrations/actions", () => ({
  addToWaitlistAction: vi.fn(),
  moveReserveEntryAction: vi.fn(),
  addRegistrationNoteFromListAction: vi.fn(),
  offerPlaceAction: vi.fn(),
  bulkCancelRegistrationsAction: vi.fn(),
  bulkDeleteRegistrationsAction: vi.fn(),
  markBibsPrintedAction: vi.fn(),
  sendOutboxNowAction: vi.fn(),
  setPublicRegistrationOpenAction: vi.fn(),
  cancelRegistrationFromRowAction: vi.fn(),
  eraseRegistrationFromListAction: vi.fn(),
  setBibPrintedAction: vi.fn(),
  checkInAction: vi.fn(),
  confirmRegistrationNowAction: vi.fn(),
  promoteRegistrationAction: vi.fn(),
  setOutsideCapacityAction: vi.fn(),
  setRegistrationEliteAction: vi.fn(),
  setClubMemberDeclaredAction: vi.fn(),
  clearMemberTicksAction: vi.fn(),
}));
vi.mock("@/app/[locale]/admin/registrations/[id]/actions", () => ({
  resendFamilyEmailAction: vi.fn(),
  resendRegistrationEmailAction: vi.fn(),
}));
vi.mock("@/modules/notifications/send-now-choice", () => ({ sendNowChoiceFor: async () => null }));

const { default: AdminRegistrationsPage } = await import("@/app/[locale]/admin/registrations/(list)/page");
const { default: NewsletterPage } = await import("@/app/[locale]/admin/newsletter/page");
const { default: SponsorListButton } = await import("@/modules/registrations/ui/SponsorListButton");
const { default: PromoConsenters } = await import("@/modules/newsletter/ui/PromoConsenters");
const { default: Panel } = await import("@/shared/ui/Panel");

type Props = Record<string, unknown> & { children?: ReactNode };

/** Every element of a tree: the children, and any element handed through another prop (the «Abonați» slot). */
function elements(node: unknown, acc: ReactElement<Props>[] = []): ReactElement<Props>[] {
  if (Array.isArray(node)) {
    for (const child of node) elements(child, acc);
    return acc;
  }
  if (!isValidElement<Props>(node)) return acc;
  acc.push(node);
  for (const value of Object.values(node.props)) if (Array.isArray(value) || isValidElement(value)) elements(value, acc);
  return acc;
}

let db: TestDatabase;
let close: () => Promise<void>;

async function createEvent(title: string) {
  const [event] = await db
    .insert(events)
    .values({ type: "RACE", surface: "ASPHALT", startsAt: new Date("2099-11-21T08:00:00.000Z"), timezone: "Europe/Bucharest", capacity: 150, registrationMode: "INTERNAL", editorialStatus: "PUBLISHED", publishedAt: new Date("2026-09-01T10:00:00.000Z") })
    .returning();
  await db.insert(eventTranslations).values([
    { eventId: event.id, locale: "ro", slug: `${title}-ro`, title },
    { eventId: event.id, locale: "en", slug: `${title}-en`, title: `${title} (en)` },
  ]);
  return event;
}

let seq = 0;
async function staff(role: StaffUser["role"]): Promise<StaffUser> {
  const [user] = await db.insert(staffUsers).values({ email: `${role.toLowerCase()}-${seq++}@dev.test`, displayName: role, role }).returning();
  return user;
}

/** One list in the trail, as the download writes it. */
const list = (at: string, eventId: string | null, recipient: string) => ({
  action: "registrations.sponsor_list_exported" as const,
  entityType: "event",
  entityId: eventId,
  metadataJson: { eventId, format: "csv", count: 1, recipient, registrationIds: [] },
  createdAt: new Date(at),
});

/** Three lists: the autumn race's, the winter race's, and one made for every event — the newest. */
async function threeLists() {
  const autumn = await createEvent("toamna");
  const winter = await createEvent("iarna");
  await db.insert(auditLogs).values([
    list("2026-09-10T09:00:00.000Z", autumn.id, "Sport Shop"),
    list("2026-09-12T09:00:00.000Z", winter.id, "Intersport"),
    list("2026-09-20T09:00:00.000Z", null, "Decathlon"),
  ]);
  return { autumn, winter };
}

const facts = (register: SponsorRegister) => register.lists.map((list) => [list.recipient, list.eventTitle]);

/** The notice in force says the partners may receive the list: the button is on. */
async function sharingNoticeInForce() {
  const body = { sections: [{ paragraphs: ["Oferte și beneficii: doar dacă bifezi {{promotionalMaterials}}.", "Lista pentru parteneri: le putem da {{promotionalMaterialsShared}}."] }] } as LegalDocumentTranslationInput["body"];
  const translations: LegalDocumentTranslationInput[] = [
    { locale: "ro", title: "Notă", body },
    { locale: "en", title: "Notice", body },
  ];
  const at = new Date("2026-01-01T00:00:00.000Z");
  await insertLegalDocumentVersion(db, { key: "PRIVACY_NOTICE", version: 1, effectiveAt: at, isApproved: true, contentSha256: computeContentHash(translations), translations, now: at });
}

/** An adult, confirmed, who said yes to offers and benefits under that notice. */
async function consenter(eventId: string, firstName: string) {
  const identity = canonicalizeEmail(`${firstName.toLowerCase()}-${seq++}@example.ro`);
  const [participant] = await db
    .insert(participants)
    .values({ deliveryEmail: identity.deliveryEmail, normalizedEmail: identity.normalizedEmail, canonicalEmail: identity.canonicalEmail, canonicalizationVersion: identity.canonicalizationVersion, defaultName: firstName })
    .returning();
  const saidYesAt = new Date("2026-07-01T10:00:00.000Z");
  await db.insert(registrations).values({
    eventId,
    participantId: participant.id,
    status: "CONFIRMED",
    kind: "REAL",
    locale: "ro",
    registeredName: `${firstName} Pop`,
    firstName,
    lastName: "Pop",
    displayName: firstName,
    birthDate: "1985-03-02",
    phone: "+40711111111",
    privacyNoticeVersion: 1,
    privacyAcknowledgedAt: saidYesAt,
    resultsNameConsent: false,
    resultsConsentVersion: 1,
    promoConsent: true,
    promoConsentAt: saidYesAt,
  });
}

/** The fold the registrations page draws around the block (§NNN), as the page hands it to `Panel`. */
const foldOf = (tree: unknown) => elements(tree).find((element) => element.props["data-testid"] === "registrations-sponsors");

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
  state.db = db;
});
afterAll(async () => close());
beforeEach(async () => {
  await resetTables(db);
  state.locale = "ro";
});

describe("BR-REQ-071-01 §929 an event's registrations page hands the block its own door", () => {
  it.each([["MODERATOR"], ["ADMIN"], ["SUPERADMIN"]] as const)(
    "BR-REQ-060-01 the %s gets the event's lists and every event's — never another event's — in the reader's language, on the page's clock",
    async (role) => {
      const { autumn } = await threeLists();
      state.actor = await staff(role);
      state.locale = "en";
      const before = Date.now();
      const tree = await AdminRegistrationsPage({ params: Promise.resolve({ locale: "en" }), searchParams: Promise.resolve({ eventId: autumn.id }) } as never);
      const block = elements(tree).find((element) => element.type === SponsorListButton);
      expect(block, role).toBeDefined();
      const props = block!.props as unknown as Parameters<typeof SponsorListButton>[0];
      expect(props.eventId).toBe(autumn.id);
      expect(props.locale).toBe("en");
      // Inside the fold «Lista pentru sponsori» (§NNN): the register is a fold a level down, as on «Newsletter».
      expect(props.registerLevel).toBe(3);
      const fold = foldOf(tree);
      expect(fold, role).toBeDefined();
      expect(fold!.props.title).toBe("List for sponsors");
      // No notice in force describes the sharing here: the line says the list is off, and counts this door's two lists.
      expect(fold!.props.aside).toBe("switched off · lists given: 2");
      // The winter race's list is another event's: never on this door.
      expect(facts(props.register)).toEqual([
        ["Decathlon", null],
        ["Sport Shop", "toamna (en)"],
      ]);
      // The suggestions are every event's: one sponsor, one spelling.
      expect(props.register.recipients).toEqual(["Decathlon", "Intersport", "Sport Shop"]);
      // «termen trecut» is judged by the page's own clock.
      expect(props.now.getTime()).toBeGreaterThanOrEqual(before);
      expect(props.now.getTime()).toBeLessThanOrEqual(Date.now());
    },
  );
});

describe("BR-REQ-071-01 §NNN on an event's registrations page the block is one closed fold, «Lista pentru sponsori»", () => {
  const page = (searchParams: Record<string, string>) => AdminRegistrationsPage({ params: Promise.resolve({ locale: "ro" }), searchParams: Promise.resolve(searchParams) } as never);

  it("draws the fold closed with the whole block inside it, and no fold before an event is chosen", async () => {
    const { autumn } = await threeLists();
    state.actor = await staff("ADMIN");
    const tree = await page({ eventId: autumn.id });
    const fold = foldOf(tree);
    expect(fold).toBeDefined();
    expect(fold!.type).toBe(Panel);
    expect(fold!.props.title).toBe("Lista pentru sponsori");
    // A fold with no reason to open by itself: closed on every arrival (`shared/ui/fold.ts`).
    expect(fold!.props.collapsible).toBe(true);
    expect(fold!.props.openWhen).toBeUndefined();
    expect(fold!.props.static).toBeUndefined();
    expect(fold!.props.aside).toBe("oprită · liste date: 2");
    // The block is drawn once, and inside the fold: nothing of it stands open on the page.
    const blocks = elements(tree).filter((element) => element.type === SponsorListButton);
    expect(blocks).toHaveLength(1);
    expect(elements(fold!.props.children)).toContain(blocks[0]);

    // The list is one event's: with none chosen there is neither a block nor an empty fold.
    const every = await page({});
    expect(foldOf(every)).toBeUndefined();
    expect(elements(every).some((element) => element.type === SponsorListButton)).toBe(false);
  });

  it("says on its closed line how many people the list holds now, and counts the lists given only once there is one", async () => {
    await sharingNoticeInForce();
    const event = await createEvent("toamna");
    await consenter(event.id, "Ana");
    await consenter(event.id, "Bogdan");
    state.actor = await staff("MODERATOR");
    // Nobody was given a list yet: the people alone, the count the button's own line says inside.
    const before = await page({ eventId: event.id });
    expect(foldOf(before)!.props.aside).toBe("2 persoane");
    const block = elements(before).find((element) => element.type === SponsorListButton);
    expect((block!.props as unknown as Parameters<typeof SponsorListButton>[0]).list).toEqual({ offered: true, count: 2 });

    await db.insert(auditLogs).values(list("2026-09-10T09:00:00.000Z", event.id, "Sport Shop"));
    expect(foldOf(await page({ eventId: event.id }))!.props.aside).toBe("2 persoane · liste date: 1");
  });
});

describe("BR-REQ-071-01 §929 «Newsletter» hands the fold every list", () => {
  it.each([["MODERATOR"], ["ADMIN"], ["SUPERADMIN"]] as const)(
    "BR-REQ-060-01 the %s gets every list, in the reader's language, on the page's clock, and the fold draws the block for every event a level down",
    async (role) => {
      await threeLists();
      state.actor = await staff(role);
      state.locale = "en";
      const before = Date.now();
      const tree = await NewsletterPage({ params: Promise.resolve({ locale: "en" }), searchParams: Promise.resolve({}) } as never);
      const fold = elements(tree).find((element) => element.type === PromoConsenters);
      expect(fold, role).toBeDefined();
      const props = fold!.props as unknown as Parameters<typeof PromoConsenters>[0];
      expect(props.sponsors).toEqual({ offered: false, count: 0 });
      // Without it the fold draws neither the register nor the button.
      expect(props.sponsorRegister, "the register reaches the fold").toBeTruthy();
      expect(facts(props.sponsorRegister!)).toEqual([
        ["Decathlon", null],
        ["Intersport", "iarna (en)"],
        ["Sport Shop", "toamna (en)"],
      ]);
      expect(props.now.getTime()).toBeGreaterThanOrEqual(before);
      expect(props.now.getTime()).toBeLessThanOrEqual(Date.now());

      // The fold hands it on: the block for every event, inside the card.
      const block = elements(await PromoConsenters(props)).find((element) => element.type === SponsorListButton);
      expect(block, role).toBeDefined();
      const inner = block!.props as unknown as Parameters<typeof SponsorListButton>[0];
      expect(inner.eventId).toBeNull();
      expect(inner.registerLevel).toBe(3);
      expect(inner.register).toBe(props.sponsorRegister);
      expect(inner.now).toBe(props.now);
    },
  );
});
