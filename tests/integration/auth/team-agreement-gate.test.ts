import { and, eq } from "drizzle-orm";
import { createTranslator } from "next-intl";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { auditLogs } from "@/db/schema/audit-logs";
import { legalDocuments } from "@/db/schema/legal-documents";
import { staffTeamAgreementAcceptances, staffTeamAgreementSignInAcceptances } from "@/db/schema/staff-team-agreement-acceptances";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { computeContentHash, type LegalDocumentTranslationInput } from "@/modules/legal-documents/domain/content-hash";
import { signedTextHash } from "@/modules/legal-documents/domain/signed-text";
import { insertLegalDocumentVersion, listVersionsForBackoffice } from "@/modules/legal-documents/repository";
import { LEGAL_TEMPLATES } from "@/modules/legal-documents/templates/catalogue";
import { STAFF_ROLES, type StaffRole } from "@/modules/staff-identity/domain/roles";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * §1006, §NNN, BR-REQ-060-01, BR-REQ-053-01 — the team's undertaking at sign-in (the owner, 2026-11-19: «Voluntarii trebuie să
 * semneze acordul GDPR când intră în platformă»), owed at every sign-in since §NNN, read through the real session (`session.ts`,
 * the development switcher's two cookies: the account's id and the moment the development sign-in wrote) over a real database:
 *
 * - no approved version in force, no gate: a draft, a version withdrawn or one dated tomorrow asks nobody anything;
 * - with one in force, a colleague below the Administrator whose session has not accepted it is sent from every backoffice page —
 *   a scanned number, the guide, `/devs`, a staff preview — to `/admin/acord`, the page they asked for kept as `returnTo`, the
 *   layouts meanwhile drawing the shell bare and never redirecting themselves; refused with FORBIDDEN, its reason saying to
 *   accept the undertaking, by a Server Action and an admin route, nothing written; the Administrators and the
 *   Superadministrators never; a member stays no staff at all;
 * - **at every sign-in (§NNN)**: accepted at one sign-in, the same session is let through and the next sign-in is asked again;
 *   every acceptance is kept with the sign-in it answers; a session from before §NNN, which carries no moment, is asked once; an
 *   acceptance made once per account under §1006 answers no sign-in; the development sign-in writes the moment, sign-out drops it;
 * - `/admin/acord`: the text in force, its version line, saying it is asked at every sign-in in both languages, «Numele tău
 *   complet» empty, the tick unticked and «Accept și intru»; the acceptance with the declarations' proof and an audit row that
 *   names no name; a second press for the same sign-in is nothing; then back where they were going — and a new version is asked
 *   again.
 */
const state = vi.hoisted(() => ({
  db: undefined as unknown,
  cookie: undefined as string | undefined,
  signedInAt: undefined as string | undefined,
  locale: "ro" as "ro" | "en",
  headers: new Headers(),
  cookiesSet: [] as Array<[string, string]>,
  cookiesDeleted: [] as string[],
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => {
      if (name === "br_dev_staff" && state.cookie) return { value: state.cookie };
      if (name === "br_dev_staff_at" && state.signedInAt) return { value: state.signedInAt };
      return undefined;
    },
    set: (name: string, value: string) => void state.cookiesSet.push([name, value]),
    delete: (name: string) => void state.cookiesDeleted.push(name),
  }),
  headers: async () => state.headers,
}));
vi.mock("@/auth", () => ({ auth: async () => null, signIn: async () => {}, signOut: async () => {} }));
vi.mock("@/db/client", () => ({ getDb: () => state.db }));
vi.mock("@/modules/staff-identity/ui/BackofficeShell", () => ({ default: function BackofficeShell() { return null; } }));
vi.mock("@/shared/feedback/ToastProvider", () => ({ default: () => null }));
vi.mock("@/shared/forms/pickers/PickerProvider", () => ({ default: () => null }));
vi.mock("next-intl/server", () => ({
  // The page's language, as `setRequestLocale` sets it for the request.
  setRequestLocale: (locale: "ro" | "en") => {
    state.locale = locale;
  },
  getMessages: async () => ro,
  getTranslations: async (arg: string | { locale?: "ro" | "en"; namespace: string }) => {
    const namespace = typeof arg === "string" ? arg : arg.namespace;
    const locale = typeof arg === "string" ? state.locale : (arg.locale ?? state.locale);
    const catalogue = (locale === "ro" ? ro : en) as unknown as Record<string, object>;
    return createTranslator({ locale, messages: catalogue[namespace] as Record<string, string>, namespace: undefined });
  },
}));

const { assertTeamAgreementAccepted, currentSignInMoment, requireStaff, requireStaffBeforeTeamAgreement, requireStaffCapability } = await import(
  "@/modules/staff-identity/session"
);
const { canWorkTheDesk } = await import("@/modules/staff-identity/domain/roles");
const { acceptTeamAgreement, teamAgreementInForce, teamAgreementStates } = await import("@/modules/staff-identity/team-agreement");
const { default: AdminLayout } = await import("@/app/[locale]/admin/layout");
const { default: DevsLayout } = await import("@/app/[locale]/devs/layout");
const { default: ScannedCodePage } = await import("@/app/[locale]/admin/checkin/[code]/page");
const { default: GuidePage } = await import("@/app/[locale]/admin/guide/page");
const { default: TeamAgreementPage } = await import("@/app/[locale]/admin/acord/page");
const { acceptTeamAgreementAction } = await import("@/app/[locale]/admin/acord/actions");
const { checkInAction } = await import("@/app/[locale]/admin/registrations/actions");
const { signInAsDevIdentityAction, signOutAction } = await import("@/app/[locale]/admin/actions");
const { GET: exportRegistrations } = await import("@/app/api/admin/registrations/export/route");

const EFFECTIVE = new Date("2026-01-01T00:00:00.000Z");
/** A sign-in of the day before, the session every test signs in with unless it says otherwise. */
const SIGNED_IN = new Date(Date.now() - 86_400_000);

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

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
}

type Props = Record<string, unknown> & { children?: ReactNode };
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
const text = (node: ReactNode): string =>
  Array.isArray(node) ? node.map(text).join("") : typeof node === "string" || typeof node === "number" ? String(node) : isValidElement<Props>(node) ? text(node.props.children) : "";

/** A page being drawn: the proxy wrote its path. */
const page = (path: string) => {
  state.headers = new Headers({ "x-br-path": path });
};
/** A Server Action posted from a page. */
const action = (path: string, more: Record<string, string> = {}) => {
  state.headers = new Headers({ "x-br-path": path, "next-action": "7f00", ...more });
};
/** A route handler: the proxy does not run on /api. */
const route = () => {
  state.headers = new Headers();
};

describe("§1006 §NNN the team's undertaking, at every sign-in", () => {
  let db: TestDatabase;
  let close: () => Promise<void>;
  const staff = {} as Record<StaffRole, StaffUser>;

  beforeAll(async () => {
    ({ db, close } = await createTestDatabase());
    state.db = db;
  });
  afterAll(async () => close());
  beforeEach(async () => {
    await resetTables(db);
    state.cookie = undefined;
    state.signedInAt = undefined;
    state.locale = "ro";
    state.cookiesSet.length = 0;
    state.cookiesDeleted.length = 0;
    page("/ro/admin");
    for (const role of STAFF_ROLES) {
      [staff[role]] = await db.insert(staffUsers).values({ email: `${role.toLowerCase()}@dev.test`, displayName: `Coleg ${role}`, role }).returning();
    }
  });

  /** A version of the undertaking from the template, approved (or not), in force from `effectiveAt`. */
  async function undertaking(version: number, options: { approved?: boolean; effectiveAt?: Date } = {}): Promise<string> {
    const translations: LegalDocumentTranslationInput[] = (["ro", "en"] as const).map((locale) => ({ locale, ...LEGAL_TEMPLATES.STAFF_DATA_AGREEMENT[locale] }));
    return insertLegalDocumentVersion(db, {
      key: "STAFF_DATA_AGREEMENT",
      version,
      effectiveAt: options.effectiveAt ?? EFFECTIVE,
      isApproved: options.approved ?? true,
      contentSha256: computeContentHash(translations),
      translations,
      now: EFFECTIVE,
    });
  }
  /** Signed in as `role` at `signedInAt` — the development sign-in's two cookies. */
  const as = (role: StaffRole, signedInAt: Date = SIGNED_IN) => {
    state.cookie = staff[role].id;
    state.signedInAt = String(signedInAt.getTime());
  };
  /** Signed in as `role` before §NNN: the account's cookie and no moment. */
  const asBefore = (role: StaffRole) => {
    state.cookie = staff[role].id;
    state.signedInAt = undefined;
  };
  /** The acceptance at the session's own sign-in, as «Accept și intru» writes it. */
  const accept = async (role: StaffRole, documentId: string, extra: { fullName?: string; locale?: "ro" | "en"; at?: Date } = {}) =>
    acceptTeamAgreement(
      db,
      staff[role],
      { documentId, fullName: extra.fullName ?? "Vlad", accepted: true, locale: extra.locale ?? "ro", signedInAt: await currentSignInMoment() },
      extra.at ?? new Date(),
    );
  const acceptances = () => db.select().from(staffTeamAgreementSignInAcceptances);

  it("asks nobody anything while no approved version is in force — a draft, a version withdrawn, one dated tomorrow", async () => {
    as("CONTRIBUTOR");
    page("/ro/admin/checkin");
    expect((await requireStaff()).id).toBe(staff.CONTRIBUTOR.id);
    await undertaking(1, { approved: false });
    expect((await requireStaff()).id).toBe(staff.CONTRIBUTOR.id);
    const withdrawn = await undertaking(2);
    await db.update(legalDocuments).set({ withdrawnAt: EFFECTIVE }).where(eq(legalDocuments.id, withdrawn));
    expect((await requireStaff()).id).toBe(staff.CONTRIBUTOR.id);
    await undertaking(3, { effectiveAt: new Date(Date.now() + 86_400_000) });
    expect((await requireStaff()).id).toBe(staff.CONTRIBUTOR.id);
    expect(await teamAgreementInForce(db, new Date())).toBe(false);
  });

  it("sends every colleague below the Administrator from a page to /admin/acord, the page they asked for kept", async () => {
    await undertaking(1);
    expect(await teamAgreementInForce(db, new Date())).toBe(true);
    for (const role of ["CONTRIBUTOR", "COPYWRITER", "MODERATOR", "DEV"] as const) {
      as(role);
      page("/ro/admin/checkin/ABC123");
      expect(await redirectedTo(requireStaff()), role).toBe("/ro/admin/acord?returnTo=%2Fro%2Fadmin%2Fcheckin%2FABC123");
      expect(await redirectedTo(requireStaffCapability(canWorkTheDesk)), role).toBe("/ro/admin/acord?returnTo=%2Fro%2Fadmin%2Fcheckin%2FABC123");
    }
    // In the page's own language, the router's own parameter dropped.
    as("DEV");
    page("/en/admin/guide?_rsc=x1");
    expect(await redirectedTo(requireStaff())).toBe("/en/admin/acord?returnTo=%2Fen%2Fadmin%2Fguide");
  });

  it("refuses a Server Action and a route handler with FORBIDDEN, its reason saying to accept the undertaking", async () => {
    await undertaking(1);
    as("MODERATOR");
    action("/ro/admin/checkin");
    await expect(requireStaff()).rejects.toMatchObject({ code: "FORBIDDEN", message: expect.stringMatching(/accept it on \/admin\/acord/) });
    route();
    await expect(requireStaff()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("lets the Administrators and the Superadministrators through, and keeps a member no staff at all", async () => {
    await undertaking(1);
    page("/ro/admin/checkin");
    for (const role of ["ADMIN", "SUPERADMIN"] as const) {
      as(role);
      expect((await requireStaff()).id, role).toBe(staff[role].id);
      // A new sign-in changes nothing for them either.
      as(role, new Date());
      expect((await requireStaff()).id, role).toBe(staff[role].id);
    }
    as("MEMBER");
    await expect(requireStaff()).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  });

  it("never sends from a layout — the client router would keep that redirect with the layout and replay it on /admin/acord — but draws the shell bare, no tabs and the sign-out kept, while the page under it sends the reader", async () => {
    const id = await undertaking(1);
    const isShell = (element: ReactElement<Props>) => typeof element.type === "function" && element.type.name === "BackofficeShell";
    const adminLayout = () => AdminLayout({ children: null, params: Promise.resolve({ locale: "ro" }) });
    const devsLayout = () => DevsLayout({ children: null, params: Promise.resolve({ locale: "ro" }) });
    // Signed in, on the way to the desk: the layout draws the bare shell, and the page sends the reader on.
    as("CONTRIBUTOR");
    page("/ro/admin/checkin");
    expect(elements(await adminLayout()).find(isShell)?.props.bare).toBe(true);
    expect(await redirectedTo(requireStaff())).toBe("/ro/admin/acord?returnTo=%2Fro%2Fadmin%2Fcheckin");
    // On the undertaking's own page, the same bare shell.
    page("/ro/admin/acord?returnTo=%2Fro%2Fadmin%2Fcheckin");
    expect(elements(await adminLayout()).find(isShell)?.props.bare).toBe(true);
    // /devs the same: the bare shell, never a 404, and its page sends the reader on.
    as("DEV");
    page("/ro/devs");
    expect(elements(await devsLayout()).find(isShell)?.props.bare).toBe(true);
    expect(await redirectedTo(requireStaff())).toBe("/ro/admin/acord?returnTo=%2Fro%2Fdevs");
    // Accepted at this sign-in, nothing is owed: the whole shell again.
    await accept("DEV", id, { fullName: "Ion Tehnic" });
    expect(elements(await devsLayout()).find(isShell)?.props.bare).toBe(false);
    // An Administrator's shell is the whole one.
    as("ADMIN");
    page("/ro/admin/checkin");
    expect(elements(await adminLayout()).find(isShell)?.props.bare).toBe(false);
  });

  it("asks the same of a staff member a page has read itself — the staff preview of a draft", async () => {
    await undertaking(1);
    as("MODERATOR");
    page("/ro/preview/events/e1");
    expect(await redirectedTo(assertTeamAgreementAccepted(staff.MODERATOR))).toBe("/ro/admin/acord?returnTo=%2Fro%2Fpreview%2Fevents%2Fe1");
    action("/ro/preview/events/e1");
    await expect(assertTeamAgreementAccepted(staff.MODERATOR)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(assertTeamAgreementAccepted(staff.ADMIN)).resolves.toBeUndefined();
  });

  it("sends from a scanned number and from the guide: every page asks the same one line", async () => {
    await undertaking(1);
    as("CONTRIBUTOR");
    page("/ro/admin/checkin/ABC123");
    expect(await redirectedTo(ScannedCodePage({ params: Promise.resolve({ locale: "ro", code: "ABC123" }), searchParams: Promise.resolve({}) }))).toBe(
      "/ro/admin/acord?returnTo=%2Fro%2Fadmin%2Fcheckin%2FABC123",
    );
    page("/ro/admin/guide");
    expect(await redirectedTo(GuidePage({ params: Promise.resolve({ locale: "ro" }) }))).toBe("/ro/admin/acord?returnTo=%2Fro%2Fadmin%2Fguide");
  });

  it("refuses a desk press and an admin route, writing nothing", async () => {
    await undertaking(1);
    as("CONTRIBUTOR");
    action("/ro/admin/checkin");
    const pressed = await redirectedTo(checkInAction(null, form({ uiLocale: "ro", registrationId: "00000000-0000-4000-8000-000000000000", back: "desk" })));
    expect(pressed).toMatch(/^\/ro\/admin\/checkin\?.*error=FORBIDDEN/);
    expect(await db.select().from(auditLogs)).toHaveLength(0);
    as("MODERATOR");
    route();
    const response = await exportRegistrations(new Request("http://localhost/api/admin/registrations/export"));
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(await response.json()).toEqual({ error: "FORBIDDEN" });
  });

  it("leaves the undertaking's own page and its action open: the one door a colleague who owes it may reach", async () => {
    await undertaking(1);
    as("COPYWRITER");
    action("/ro/admin/acord");
    expect((await requireStaffBeforeTeamAgreement()).id).toBe(staff.COPYWRITER.id);
    page("/ro/admin/acord");
    // On the undertaking's own page the gate refuses rather than sending the reader round in a circle.
    await expect(requireStaff()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("draws the text in force, its version line, the name, the tick and «Accept și intru», the way back kept", async () => {
    const id = await undertaking(1);
    as("CONTRIBUTOR");
    page("/ro/admin/acord?returnTo=%2Fro%2Fadmin%2Fcheckin%2FABC123");
    const tree = elements(await TeamAgreementPage({ params: Promise.resolve({ locale: "ro" }), searchParams: Promise.resolve({ returnTo: "/ro/admin/checkin/ABC123" }) }));
    const byTestId = (testId: string) => tree.find((element) => element.props["data-testid"] === testId);
    expect(text(byTestId("team-agreement-text")?.props.children)).toContain("Angajament de confidențialitate și protecția datelor pentru echipă");
    expect(text(byTestId("team-agreement-version")?.props.children)).toBe("Versiunea 1, în vigoare din 1 ianuarie 2026");
    const body = tree.find((element) => element.props.body !== undefined);
    expect(body?.props.body).toEqual(LEGAL_TEMPLATES.STAFF_DATA_AGREEMENT.ro.body);
    const hidden = Object.fromEntries(tree.filter((element) => element.props.type === "hidden").map((element) => [element.props.name, element.props.value]));
    expect(hidden).toEqual({ uiLocale: "ro", documentId: id, returnTo: "/ro/admin/checkin/ABC123" });
    const name = tree.find((element) => element.props.name === "fullName");
    expect(name?.props).toMatchObject({ label: "Numele tău complet", required: true, slotProps: { htmlInput: { maxLength: 200 } } });
    const tick = tree.find((element) => element.props.name === "accepted");
    expect(tick?.props).toMatchObject({ required: true });
    expect(text(tick?.props.children)).toBe("Am citit și accept angajamentul");
    expect(tree.find((element) => element.props.label === "Accept și intru")).toBeDefined();
    expect(text(byTestId("team-agreement-sign-out")?.props.children)).toMatch(/ieși din cont/);
  });

  it("says, in both languages, that it is accepted at every sign-in — the name typed each time, nothing ticked for them", async () => {
    await undertaking(1);
    as("CONTRIBUTOR");
    for (const [locale, intro] of [
      ["ro", "Înainte să lucrezi în backoffice, citește angajamentul de mai jos și acceptă-l. Îl accepți la fiecare intrare în cont."],
      ["en", "Before you work in the backoffice, read the undertaking below and accept it. You accept it each time you sign in."],
    ] as const) {
      page(`/${locale}/admin/acord`);
      const tree = elements(await TeamAgreementPage({ params: Promise.resolve({ locale }), searchParams: Promise.resolve({}) }));
      const shown = tree.find((element) => element.props["data-testid"] === "team-agreement-intro");
      expect(text(shown?.props.children), locale).toBe(intro);
      // The backoffice's words stay short (≤ 200 characters).
      expect(intro.length, locale).toBeLessThanOrEqual(200);
      const name = tree.find((element) => element.props.name === "fullName");
      expect(name?.props.defaultValue, locale).toBeUndefined();
      const tick = tree.find((element) => element.props.name === "accepted");
      expect(tick?.props.defaultChecked, locale).toBeUndefined();
    }
    // «în cont», never «în platformă»: the backoffice never says «platforma» / "the platform" (§522, `plain-words.test.ts`).
    expect(ro.Admin.teamAgreement.intro).toContain("Îl accepți la fiecare intrare în cont.");
    expect(en.Admin.teamAgreement.intro).toContain("You accept it each time you sign in.");
  });

  it("keeps no way back that is not a path on this site, and sends on whoever owes nothing", async () => {
    await undertaking(1);
    as("CONTRIBUTOR");
    page("/ro/admin/acord");
    const tree = elements(await TeamAgreementPage({ params: Promise.resolve({ locale: "ro" }), searchParams: Promise.resolve({ returnTo: "https://example.test/x" }) }));
    expect(tree.find((element) => element.props.name === "returnTo")?.props.value).toBe("");
    // An Administrator owes nothing: on to where they were going.
    as("ADMIN");
    expect(await redirectedTo(TeamAgreementPage({ params: Promise.resolve({ locale: "ro" }), searchParams: Promise.resolve({ returnTo: "/ro/admin/legal" }) }))).toBe("/ro/admin/legal");
    // Nor does a colleague while nothing is in force.
    await db.update(legalDocuments).set({ withdrawnAt: EFFECTIVE });
    as("CONTRIBUTOR");
    expect(await redirectedTo(TeamAgreementPage({ params: Promise.resolve({ locale: "ro" }), searchParams: Promise.resolve({}) }))).toBe("/ro/admin");
  });

  it("stores the acceptance with the declarations' proof and the sign-in it answers, audits it without the name, and goes back where they were going", async () => {
    const id = await undertaking(1);
    as("CONTRIBUTOR");
    action("/ro/admin/acord", { "x-forwarded-for": "203.0.113.9", "user-agent": "Mozilla/5.0 (Test)" });
    const press = () => acceptTeamAgreementAction(null, form({ uiLocale: "ro", documentId: id, returnTo: "/ro/admin/checkin/ABC123", fullName: "  Vlad   Popescu ", accepted: "on" }));
    expect(await redirectedTo(press())).toBe("/ro/admin/checkin/ABC123");
    const [row] = await acceptances();
    const ro = LEGAL_TEMPLATES.STAFF_DATA_AGREEMENT.ro;
    const both = (["ro", "en"] as const).map((locale) => ({ locale, ...LEGAL_TEMPLATES.STAFF_DATA_AGREEMENT[locale] }));
    expect(row).toMatchObject({
      staffUserId: staff.CONTRIBUTOR.id,
      legalDocumentId: id,
      documentVersion: 1,
      contentSha256: computeContentHash(both),
      locale: "ro",
      typedName: "Vlad Popescu",
      textHash: signedTextHash({ title: ro.title, body: ro.body, values: {} }),
      ip: "203.0.113.9",
      userAgent: "Mozilla/5.0 (Test)",
      signedInAt: SIGNED_IN,
    });
    expect(row.acceptedAt).toBeInstanceOf(Date);
    const trail = await db.select().from(auditLogs).where(eq(auditLogs.action, "staff.team_agreement_accepted"));
    expect(trail).toHaveLength(1);
    expect(trail[0]).toMatchObject({ actorStaffUserId: staff.CONTRIBUTOR.id, entityType: "staff_user", entityId: staff.CONTRIBUTOR.id });
    expect(trail[0].metadataJson).toEqual({ legalDocumentId: id, version: 1, locale: "ro", acceptanceId: row.id, signedInAt: SIGNED_IN.toISOString() });
    expect(JSON.stringify(trail[0].metadataJson)).not.toMatch(/Vlad|Popescu/);
    // The toast, through the flash cookie.
    expect(state.cookiesSet.some(([name, value]) => name === "br-flash" && decodeURIComponent(value).includes("teamAgreementAccepted"))).toBe(true);
    // A second press for the same sign-in — a double tap — is nothing: no row, no trail.
    expect(await redirectedTo(press())).toBe("/ro/admin/checkin/ABC123");
    expect(await acceptances()).toHaveLength(1);
    expect(await db.select().from(auditLogs).where(eq(auditLogs.action, "staff.team_agreement_accepted"))).toHaveLength(1);
    // And the backoffice opens. §1006's table is written no more.
    page("/ro/admin/checkin/ABC123");
    expect((await requireStaff()).id).toBe(staff.CONTRIBUTOR.id);
    expect(await db.select().from(staffTeamAgreementAcceptances)).toHaveLength(0);
  });

  it("asks again at the next sign-in: accepted at one, the same session is let through, the next one is asked and accepts too — every acceptance kept", async () => {
    const id = await undertaking(1);
    const first = new Date("2026-11-20T07:00:00.000Z");
    const second = new Date("2026-11-21T06:30:00.000Z");
    // The clock alone is set — `Date`, never the timers the database runs on —, so each press lands a minute after its sign-in.
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      // The first sign-in: asked, accepts, and that session is let through from then on.
      vi.setSystemTime(new Date(first.getTime() + 60_000));
      as("CONTRIBUTOR", first);
      page("/ro/admin/checkin");
      expect(await redirectedTo(requireStaff())).toBe("/ro/admin/acord?returnTo=%2Fro%2Fadmin%2Fcheckin");
      action("/ro/admin/acord");
      expect(
        await redirectedTo(acceptTeamAgreementAction(null, form({ uiLocale: "ro", documentId: id, returnTo: "/ro/admin/checkin", fullName: "Vlad Popescu", accepted: "on" }))),
      ).toBe("/ro/admin/checkin");
      vi.setSystemTime(new Date(first.getTime() + 3_600_000));
      page("/ro/admin/checkin");
      expect((await requireStaff()).id).toBe(staff.CONTRIBUTOR.id);
      expect((await requireStaff()).id).toBe(staff.CONTRIBUTOR.id);

      // Signed out and in again the next morning: a new moment, asked again — the acceptance of the sign-in before does not
      // answer this one, on a page or on a press.
      vi.setSystemTime(new Date(second.getTime() + 60_000));
      as("CONTRIBUTOR", second);
      expect(await redirectedTo(requireStaff())).toBe("/ro/admin/acord?returnTo=%2Fro%2Fadmin%2Fcheckin");
      action("/ro/admin/checkin");
      await expect(requireStaff()).rejects.toMatchObject({ code: "FORBIDDEN" });
      // The page asks again, the name typed again.
      page("/ro/admin/acord");
      const tree = elements(await TeamAgreementPage({ params: Promise.resolve({ locale: "ro" }), searchParams: Promise.resolve({}) }));
      expect(tree.find((element) => element.props["data-testid"] === "team-agreement-form")).toBeDefined();
      action("/ro/admin/acord");
      expect(await redirectedTo(acceptTeamAgreementAction(null, form({ uiLocale: "en", documentId: id, returnTo: "", fullName: "Vlad M. Popescu", accepted: "on" })))).toBe(
        "/en/admin",
      );
      page("/ro/admin/checkin");
      expect((await requireStaff()).id).toBe(staff.CONTRIBUTOR.id);
    } finally {
      vi.useRealTimers();
    }

    // Both kept, each with the sign-in it answers, the moment, the name typed and the language of each.
    const rows = (await acceptances()).sort((a, b) => a.acceptedAt.getTime() - b.acceptedAt.getTime());
    expect(rows.map((row) => ({ signedInAt: row.signedInAt, acceptedAt: row.acceptedAt, typedName: row.typedName, locale: row.locale, version: row.documentVersion }))).toEqual([
      { signedInAt: first, acceptedAt: new Date(first.getTime() + 60_000), typedName: "Vlad Popescu", locale: "ro", version: 1 },
      { signedInAt: second, acceptedAt: new Date(second.getTime() + 60_000), typedName: "Vlad M. Popescu", locale: "en", version: 1 },
    ]);
    const trail = await db.select().from(auditLogs).where(eq(auditLogs.action, "staff.team_agreement_accepted"));
    expect(trail.map((entry) => (entry.metadataJson as { signedInAt: string }).signedInAt).sort()).toEqual([first.toISOString(), second.toISOString()]);
    // «Echipa» says the newest; the legal list counts both as reliances on the version.
    expect((await teamAgreementStates(db, Object.values(staff), new Date())).get(staff.CONTRIBUTOR.id)).toMatchObject({ kind: "accepted", version: 1, typedName: "Vlad M. Popescu" });
    expect((await listVersionsForBackoffice(db)).find((row) => row.id === id)?.acceptanceCount).toBe(2);
  });

  it("lets a session signed in before an acceptance made on another device since through: accepted after its sign-in", async () => {
    const id = await undertaking(1);
    const laptop = new Date(Date.now() - 3_600_000);
    // The phone signs in later and accepts.
    as("MODERATOR", new Date(Date.now() - 60_000));
    expect(await accept("MODERATOR", id)).toBe("accepted");
    // The laptop's session, signed in an hour ago, is answered by it.
    as("MODERATOR", laptop);
    page("/ro/admin/registrations");
    expect((await requireStaff()).id).toBe(staff.MODERATOR.id);
  });

  it("asks a session signed in before §NNN once — it carries no moment — and §1006's acceptance answers no sign-in", async () => {
    const id = await undertaking(1);
    // Accepted once per account under §1006, before this change: that row stays and answers nothing.
    await db.insert(staffTeamAgreementAcceptances).values({
      staffUserId: staff.CONTRIBUTOR.id,
      legalDocumentId: id,
      documentVersion: 1,
      contentSha256: "a".repeat(64),
      locale: "ro",
      typedName: "Vlad Popescu",
      textHash: "b".repeat(64),
      acceptedAt: new Date(Date.now() - 86_400_000),
    });
    asBefore("CONTRIBUTOR");
    expect(await currentSignInMoment()).toBeNull();
    page("/ro/admin/checkin");
    expect(await redirectedTo(requireStaff())).toBe("/ro/admin/acord?returnTo=%2Fro%2Fadmin%2Fcheckin");
    // A session signed in since is asked too: an acceptance from before the sign-in.
    as("CONTRIBUTOR");
    expect(await redirectedTo(requireStaff())).toBe("/ro/admin/acord?returnTo=%2Fro%2Fadmin%2Fcheckin");

    // The old session accepts: recorded with no sign-in, and that session is let through from then on — no loop, no sign-out.
    asBefore("CONTRIBUTOR");
    action("/ro/admin/acord");
    expect(await redirectedTo(acceptTeamAgreementAction(null, form({ uiLocale: "ro", documentId: id, returnTo: "/ro/admin/checkin", fullName: "Vlad Popescu", accepted: "on" })))).toBe(
      "/ro/admin/checkin",
    );
    page("/ro/admin/checkin");
    expect((await requireStaff()).id).toBe(staff.CONTRIBUTOR.id);
    expect((await requireStaff()).id).toBe(staff.CONTRIBUTOR.id);
    // A second press from it writes nothing.
    expect(await accept("CONTRIBUTOR", id)).toBe("already");
    expect((await acceptances()).map((row) => row.signedInAt)).toEqual([null]);

    // Its next sign-in carries a moment — a minute after that acceptance: asked again.
    as("CONTRIBUTOR", new Date(Date.now() + 60_000));
    expect(await redirectedTo(requireStaff())).toBe("/ro/admin/acord?returnTo=%2Fro%2Fadmin%2Fcheckin");
    // §1006's row is kept as it was, and still counts on «Echipa» and on the legal list.
    expect(await db.select().from(staffTeamAgreementAcceptances)).toHaveLength(1);
    expect((await listVersionsForBackoffice(db)).find((row) => row.id === id)?.acceptanceCount).toBe(2);
  });

  it("writes the moment at the development sign-in, as the jwt callback does at a Zitadel one, and drops it at sign-out", async () => {
    const before = Date.now();
    expect(await redirectedTo(signInAsDevIdentityAction(form({ uiLocale: "ro", identity: "contributor" })))).toMatch(/^\/ro\/admin/);
    const written = Object.fromEntries(state.cookiesSet);
    expect(written.br_dev_staff).toMatch(/^[0-9a-f-]{36}$/);
    expect(written.br_dev_staff_at).toMatch(/^\d+$/);
    expect(Number(written.br_dev_staff_at)).toBeGreaterThanOrEqual(before);
    expect(Number(written.br_dev_staff_at)).toBeLessThanOrEqual(Date.now());
    // Read back by the session as this sign-in's moment.
    state.cookie = written.br_dev_staff;
    state.signedInAt = written.br_dev_staff_at;
    expect((await currentSignInMoment())?.getTime()).toBe(Number(written.br_dev_staff_at));
    // Sign-out drops both cookies.
    await redirectedTo(signOutAction(form({ uiLocale: "ro" })));
    expect(state.cookiesDeleted).toEqual(expect.arrayContaining(["br_dev_staff", "br_dev_staff_at"]));
  });

  it("refuses a missing name, a name over 200 characters, a missing tick and a version replaced, writing nothing", async () => {
    const id = await undertaking(1);
    as("MODERATOR");
    action("/ro/admin/acord");
    const refusal = async (fields: Record<string, string>) => acceptTeamAgreementAction(null, form({ uiLocale: "ro", documentId: id, returnTo: "", ...fields }));
    expect(await refusal({ fullName: "   ", accepted: "on" })).toMatchObject({ error: "VALIDATION_ERROR", fields: ["fullName"] });
    expect(await refusal({ fullName: "x".repeat(201), accepted: "on" })).toMatchObject({ error: "VALIDATION_ERROR", fields: ["fullName"] });
    expect(await refusal({ fullName: "Ioana Pop" })).toMatchObject({ error: "VALIDATION_ERROR", fields: ["accepted"], values: { fullName: ["Ioana Pop"] } });
    expect(await refusal({ fullName: "" })).toMatchObject({ error: "VALIDATION_ERROR", fields: ["fullName", "accepted"] });
    await undertaking(2);
    expect(await refusal({ fullName: "Ioana Pop", accepted: "on" })).toMatchObject({ error: "CONFLICT" });
    expect(await acceptances()).toHaveLength(0);
    expect(await db.select().from(auditLogs)).toHaveLength(0);
  });

  it("sends an unsafe way back to the backoffice's first page, and writes nothing for an Administrator", async () => {
    const id = await undertaking(1);
    as("CONTRIBUTOR");
    action("/ro/admin/acord");
    expect(await redirectedTo(acceptTeamAgreementAction(null, form({ uiLocale: "ro", documentId: id, returnTo: "//example.test/x", fullName: "Vlad", accepted: "on" })))).toBe("/ro/admin");
    as("ADMIN");
    expect(await redirectedTo(acceptTeamAgreementAction(null, form({ uiLocale: "en", documentId: id, returnTo: "", fullName: "Admin", accepted: "on" })))).toBe("/en/admin");
    expect((await acceptances()).map((row) => row.staffUserId)).toEqual([staff.CONTRIBUTOR.id]);
  });

  it("asks again, in the same session, when the club approves a new version", async () => {
    await undertaking(1);
    as("CONTRIBUTOR");
    const document = (await db.select().from(legalDocuments))[0];
    expect(await accept("CONTRIBUTOR", document.id)).toBe("accepted");
    page("/ro/admin/checkin");
    expect((await requireStaff()).id).toBe(staff.CONTRIBUTOR.id);
    const second = await undertaking(2);
    expect(await redirectedTo(requireStaff())).toBe("/ro/admin/acord?returnTo=%2Fro%2Fadmin%2Fcheckin");
    expect(await accept("CONTRIBUTOR", second, { locale: "en" })).toBe("accepted");
    expect((await requireStaff()).id).toBe(staff.CONTRIBUTOR.id);
    expect(await accept("CONTRIBUTOR", second, { locale: "en" })).toBe("already");
    expect((await acceptances()).map((row) => row.documentVersion).sort()).toEqual([1, 2]);
  });

  it("says on «Echipa» where each colleague stands — the newest acceptance, §1006's included — and counts each acceptance as a reliance on its version", async () => {
    const first = await undertaking(1);
    as("CONTRIBUTOR");
    await accept("CONTRIBUTOR", first, { fullName: "Vlad Popescu", at: new Date("2026-11-19T09:00:00.000Z") });
    // A colleague who accepted only under §1006 still reads «Acceptat» for that version.
    await db.insert(staffTeamAgreementAcceptances).values({
      staffUserId: staff.DEV.id,
      legalDocumentId: first,
      documentVersion: 1,
      contentSha256: "a".repeat(64),
      locale: "ro",
      typedName: "Ion Tehnic",
      textHash: "b".repeat(64),
      acceptedAt: new Date("2026-11-19T08:00:00.000Z"),
    });
    const team = Object.values(staff);
    let states = await teamAgreementStates(db, team, new Date());
    expect(states.get(staff.CONTRIBUTOR.id)).toMatchObject({ kind: "accepted", version: 1, typedName: "Vlad Popescu" });
    expect(states.get(staff.DEV.id)).toMatchObject({ kind: "accepted", version: 1, typedName: "Ion Tehnic" });
    expect(states.get(staff.MODERATOR.id)).toEqual({ kind: "notAccepted" });
    expect(states.get(staff.ADMIN.id)).toEqual({ kind: "notRequired" });
    expect(states.get(staff.MEMBER.id)).toEqual({ kind: "notRequired" });
    // A new version in force: the one accepted before no longer answers for it.
    await undertaking(2);
    states = await teamAgreementStates(db, team, new Date());
    expect(states.get(staff.CONTRIBUTOR.id)).toEqual({ kind: "notAccepted" });
    const rows = await listVersionsForBackoffice(db);
    expect(rows.find((row) => row.id === first)?.acceptanceCount).toBe(2);
    expect(await db.select().from(legalDocuments).where(and(eq(legalDocuments.key, "STAFF_DATA_AGREEMENT"), eq(legalDocuments.version, 1)))).toHaveLength(1);
  });
});
