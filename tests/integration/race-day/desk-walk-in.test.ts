import { isValidElement, type ReactElement, type ReactNode } from "react";
import { createTranslator } from "next-intl";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { events, eventTranslations } from "@/db/schema/events";
import { participants } from "@/db/schema/participants";
import { registrations } from "@/db/schema/registrations";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { computeContentHash, type LegalDocumentTranslationInput } from "@/modules/legal-documents/domain/content-hash";
import { insertLegalDocumentVersion } from "@/modules/legal-documents/repository";
import { STAFF_ROLES, type StaffRole } from "@/modules/staff-identity/domain/roles";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * §NNN (amending §67 for the desk's walk-ins), BR-REQ-037-07, BR-REQ-037-08, BR-REQ-060-01 — the owner, 2026-11-20: «Si voluntarii
 * nu pot adauga pe cineva, doar organizatorii si administratorii pot», and of the desk's free spares: «scrie aici și ceva tooltip
 * cum se dau aceste numere de rezervă libere».
 *
 * - «Adaugă pe cineva» is drawn for the Organizer, the Administrator and the Superadministrator; the Voluntar, the Redactor and
 *   Tehnic read, in its place, that an organizer adds somebody not on the list — and the rest of the desk is theirs as before;
 * - the entry page is the 404 an unknown page gets for those three, and works for the Organizer;
 * - the entry's action refuses them FORBIDDEN, the boxes kept and nothing written, and enters the Organizer's walk-in on the
 *   lowest free spare, back to the desk;
 * - beside «Numere de rezervă libere (N): …», an «i» says how a spare is given, in each role's own words, in both languages.
 *
 * Server Components: each page is called and its element tree walked; the async «i» is called with the props the page gave it.
 * The race is in 2099; the people are made up.
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
  getMessages: async () => (state.locale === "ro" ? ro : en),
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
vi.mock("@/modules/staff-identity/session", () => ({
  DEV_STAFF_COOKIE: "dev-staff",
  requireStaff: async () => state.actor,
  // The door as the session asks it: the predicate the action names, against the signed-in role.
  requireStaffCapability: async (allowed: (role: string) => boolean) => {
    const { DomainError: Refusal } = await import("@/shared/errors/domain-error");
    if (!allowed((state.actor as StaffUser).role)) throw new Refusal("FORBIDDEN", "not this role");
    return state.actor;
  },
}));
vi.mock("@/modules/notifications/drain", () => ({ drainOutboxAfterResponse: () => undefined, drainOutboxRowsAfterResponse: () => undefined }));
vi.mock("@/modules/notifications/send-now-choice", () => ({ sendNowChoiceFor: async () => null }));

const { default: DeskPage } = await import("@/app/[locale]/admin/checkin/page");
const { default: NewRegistrationPage } = await import("@/app/[locale]/admin/registrations/new/page");
const { createRegistrationAction } = await import("@/app/[locale]/admin/registrations/actions");
const { default: SparesTip } = await import("@/modules/registrations/ui/SparesTip");
const { default: PaperConfirmationTip } = await import("@/modules/registrations/ui/PaperConfirmationTip");

type Props = Record<string, unknown> & { children?: ReactNode };

/** Every element under `node`, depth first, through `children` — what the page itself wrote. */
function elements(node: ReactNode, acc: ReactElement<Props>[] = []): ReactElement<Props>[] {
  if (Array.isArray(node)) {
    for (const child of node) elements(child as ReactNode, acc);
    return acc;
  }
  if (!isValidElement<Props>(node)) return acc;
  acc.push(node);
  elements(node.props.children, acc);
  return acc;
}

/** Every string child under `node`: the sentences a page writes as text. */
function sentences(node: ReactNode, acc: string[] = []): string[] {
  if (typeof node === "string") acc.push(node);
  else if (Array.isArray(node)) for (const child of node) sentences(child as ReactNode, acc);
  else if (isValidElement<Props>(node)) sentences(node.props.children, acc);
  return acc;
}

const catalogues = { ro, en } as const;
const deskWords = (locale: "ro" | "en") => catalogues[locale].Admin.desk;
const ENTERS = ["MODERATOR", "ADMIN", "SUPERADMIN"] as const;
const CALLS = ["CONTRIBUTOR", "COPYWRITER", "DEV"] as const;

let db: TestDatabase;
let close: () => Promise<void>;
let serial = 0;
const staff: Partial<Record<StaffRole, StaffUser>> = {};
let eventId: string;

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
  state.db = db;
});
afterAll(async () => close());
beforeEach(async () => {
  await resetTables(db);
  state.locale = "ro";
  const pair: LegalDocumentTranslationInput[] = [
    { locale: "ro", title: "Document", body: { sections: [{ paragraphs: ["p"] }] } },
    { locale: "en", title: "Document", body: { sections: [{ paragraphs: ["p"] }] } },
  ];
  for (const key of ["PRIVACY_NOTICE", "TERMS", "EVENT_DECLARATION"] as const) {
    await insertLegalDocumentVersion(db, { key, version: 1, effectiveAt: new Date("2026-01-01T00:00:00Z"), isApproved: true, contentSha256: computeContentHash(pair), translations: pair, now: new Date() });
  }
  for (const role of STAFF_ROLES) {
    [staff[role]] = await db.insert(staffUsers).values({ email: `${role.toLowerCase()}@example.test`, displayName: `Coleg ${role}`, role }).returning();
  }
  serial += 1;
  // A race far ahead, its sheet of spares printed: 154–156.
  const [event] = await db
    .insert(events)
    .values({
      type: "RACE",
      startsAt: new Date("2099-11-21T08:00:00.000Z"),
      timezone: "Europe/Bucharest",
      registrationMode: "INTERNAL",
      capacity: 50,
      editorialStatus: "PUBLISHED",
      publishedAt: new Date("2026-09-01T10:00:00.000Z"),
      locationName: "Start",
      walkInBibStart: 154,
      walkInBibCount: 3,
    })
    .returning({ id: events.id });
  eventId = event.id;
  await db.insert(eventTranslations).values([
    { eventId, locale: "ro", slug: `crosul-${serial}`, title: `Crosul ${serial}` },
    { eventId, locale: "en", slug: `cross-${serial}`, title: `The cross ${serial}` },
  ]);
});

const desk = async () => DeskPage({ params: Promise.resolve({ locale: state.locale }), searchParams: Promise.resolve({ eventId }) } as never);
const entryPage = async (back = "desk") =>
  NewRegistrationPage({ params: Promise.resolve({ locale: state.locale }), searchParams: Promise.resolve({ eventId, back }) } as never);
const walkInButtons = (tree: ReactNode) => elements(tree).filter((element) => typeof element.props.href === "string" && /\/admin\/registrations\/new\?eventId=.+&back=desk$/.test(element.props.href as string));
const byTestId = (tree: ReactNode, id: string) => elements(tree).filter((element) => element.props["data-testid"] === id);

/** The «i»'s words for a role, as the catalogue says them, line by line. */
function tipLines(locale: "ro" | "en", role: StaffRole): string[] {
  const tip = deskWords(locale).sparesTip;
  const walkIn = (ENTERS as readonly StaffRole[]).includes(role);
  const lines = [tip.what, tip.desk, walkIn ? tip.walkIn : tip.callOrganizer];
  if (role === "MODERATOR") lines.push(tip.blankBib, tip.invitation);
  if (role === "ADMIN" || role === "SUPERADMIN") lines.push(tip.blankBibReplace, tip.invitation);
  lines.push(tip.given);
  return lines;
}

function form(fields: Record<string, string>): FormData {
  const posted = new FormData();
  for (const [name, value] of Object.entries(fields)) posted.set(name, value);
  return posted;
}
/** The walk-in as the desk's form posts it: the fast track ticked, the lowest free spare chosen, back to the desk. */
const walkInForm = (extra: Record<string, string> = {}) =>
  form({
    uiLocale: "ro",
    back: "desk",
    eventId,
    firstName: "Mara",
    lastName: "Pop",
    email: "mara.walkin@example.org",
    participantLocale: "ro",
    relayedByParticipantRequest: "on",
    fastTrack: "on",
    bibNumber: "154",
    ...extra,
  });

/** Where a press that succeeded sends the browser: Next's redirect, thrown with the address in its digest. */
async function redirectOf(run: Promise<unknown>): Promise<string> {
  try {
    await run;
  } catch (error) {
    const digest = String((error as { digest?: unknown } | null)?.digest ?? "");
    if (digest.startsWith("NEXT_REDIRECT")) return digest;
    throw error;
  }
  throw new Error("expected a redirect");
}

describe("§NNN BR-REQ-037-08 «Adaugă pe cineva» on the desk", () => {
  for (const locale of ["ro", "en"] as const) {
    it(`${locale}: is drawn for the Organizer, the Administrator and the Superadministrator, and no line in its place`, async () => {
      state.locale = locale;
      for (const role of ENTERS) {
        state.actor = staff[role];
        const tree = await desk();
        const buttons = walkInButtons(tree);
        expect(buttons, role).toHaveLength(1);
        expect(sentences(buttons[0]).join(""), role).toBe(deskWords(locale).walkIn);
        expect(byTestId(tree, "desk-walk-in-call"), role).toHaveLength(0);
      }
    });

    it(`${locale}: is not drawn for the Voluntar, the Redactor and Tehnic, who read in its place that an organizer adds them`, async () => {
      state.locale = locale;
      for (const role of CALLS) {
        state.actor = staff[role];
        const tree = await desk();
        expect(walkInButtons(tree), role).toHaveLength(0);
        // No press named «Adaugă pe cineva» anywhere on the page (the folded steps name it as the organizers' inside a sentence).
        expect(elements(tree).filter((element) => sentences(element).join("") === deskWords(locale).walkIn), role).toHaveLength(0);
        const line = byTestId(tree, "desk-walk-in-call");
        expect(line, role).toHaveLength(1);
        expect(sentences(line[0]).join(""), role).toBe(deskWords(locale).walkInCall);
      }
    });
  }

  it("leaves the rest of the desk as it was for every desk role: the counts, the spares, the row help and its «i»", async () => {
    for (const role of [...CALLS, ...ENTERS]) {
      state.actor = staff[role];
      const tree = await desk();
      const written = sentences(tree).join("\n");
      expect(written, role).toContain(ro.Admin.desk.rowHelp);
      expect(elements(tree).filter((element) => element.type === PaperConfirmationTip), role).toHaveLength(1);
      expect(byTestId(tree, "desk-spares"), role).toHaveLength(1);
      expect(elements(tree).some((element) => element.props.label === "Confirmați: 0"), role).toBe(true);
    }
  });
});

describe("§NNN BR-REQ-037-07 BR-REQ-060-01 the staff entry", () => {
  it("is the 404 of an unknown page for the Voluntar, the Redactor, Tehnic and a member, from the desk and from the list", async () => {
    for (const role of [...CALLS, "MEMBER"] as const) {
      state.actor = staff[role];
      await expect(entryPage("desk"), role).rejects.toThrow("NOT_FOUND");
      await expect(entryPage("list"), role).rejects.toThrow("NOT_FOUND");
    }
  });

  it("opens for the Organizer and the Administrators, the lowest free spare chosen from the desk", async () => {
    for (const role of ENTERS) {
      state.actor = staff[role];
      const tree = await entryPage("desk");
      expect(byTestId(tree, "registration-new-form"), role).toHaveLength(1);
    }
  });

  it("refuses the walk-in to the Voluntar, the Redactor and Tehnic: FORBIDDEN, the boxes kept, nothing written", async () => {
    for (const role of CALLS) {
      state.actor = staff[role];
      const outcome = await createRegistrationAction(null, walkInForm());
      expect(outcome?.error, role).toBe("FORBIDDEN");
      expect(outcome?.values, role).toMatchObject({ firstName: ["Mara"], email: ["mara.walkin@example.org"], bibNumber: ["154"] });
    }
    expect(await db.select().from(registrations)).toEqual([]);
    expect(await db.select().from(participants)).toEqual([]);
    expect((await db.select().from(auditLogs)).filter((row) => row.action.startsWith("registration."))).toEqual([]);
  });

  it("enters the Organizer's walk-in on the lowest free spare and goes back to the desk, whose line then names the rest", async () => {
    state.actor = staff.MODERATOR;
    const back = await redirectOf(createRegistrationAction(null, walkInForm()));
    expect(back).toContain("/ro/admin/checkin?");
    expect(back).toContain("saved=registrationCreated");
    const [row] = await db.select().from(registrations).where(eq(registrations.eventId, eventId));
    expect(row).toMatchObject({ status: "CONFIRMED", bibNumber: 154, registeredName: "Mara Pop" });
    expect(row.bibPrintedAt, "a spare is on paper already").not.toBeNull();
    const [created] = await db.select().from(auditLogs).where(eq(auditLogs.action, "registration.created_by_staff"));
    expect(created.actorStaffUserId).toBe(staff.MODERATOR!.id);

    const line = byTestId(await desk(), "desk-spares");
    expect(sentences(line[0]).join("")).toBe("Numere de rezervă libere (2): 155–156");
  });
});

describe("§NNN the spares' «i» beside «Numere de rezervă libere (N): …»", () => {
  for (const locale of ["ro", "en"] as const) {
    it(`${locale}: stands beside the line for every desk role and says that role's words`, async () => {
      state.locale = locale;
      for (const role of [...CALLS, ...ENTERS]) {
        state.actor = staff[role];
        const tree = await desk();
        const [holder] = byTestId(tree, "desk-spares-tip");
        expect(holder, role).toBeDefined();
        const [tip] = elements(holder).filter((element) => element.type === SparesTip);
        expect(tip?.props.role, role).toBe(role);
        // Beside the line: the two share one row.
        const row = elements(tree).find((element) => elements(element.props.children).some((child) => child === holder));
        expect(row && byTestId(row, "desk-spares"), role).toHaveLength(1);

        const info = await SparesTip({ role });
        expect((info.props as { text: string }).text.split("\n"), role).toEqual(tipLines(locale, role));
      }
    });
  }

  it("never tells a desk role that cannot press them about «Adaugă pe cineva» or «Dă-i un BIB gol»", async () => {
    for (const role of CALLS) {
      const text = ((await SparesTip({ role })).props as { text: string }).text;
      expect(text, role).not.toContain("«Adaugă pe cineva»");
      expect(text, role).not.toContain("«Dă-i un BIB gol»");
      expect(text, role).toContain(ro.Admin.desk.sparesTip.callOrganizer);
    }
  });
});
