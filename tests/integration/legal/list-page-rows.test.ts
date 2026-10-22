import { type ComponentProps, createElement, type ReactElement, type ReactNode } from "react";
import { renderToReadableStream } from "react-dom/server";
import { createTranslator, NextIntlClientProvider } from "next-intl";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { LEGAL_DOCUMENT_KEYS } from "@/modules/legal-documents/domain/keys";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * §847 — «Documente legale» as the server draws it, from a real database: one list with one row per
 * text (the house's row fold, `shared/ui/row-fold.ts`) — the name, the state in a sentence, a
 * `StatusChip` for each state, the pencil — its boxes behind the line; the notices in one panel, the
 * page's help after them; the one press and «Toate textele odată» as cards. A row opens by itself
 * only for a reason (§336): a draft waiting, nothing in force, a filter keeping its rows or naming it.
 */
const state = vi.hoisted(() => ({ db: undefined as unknown, actor: undefined as unknown }));

vi.mock("next-intl/server", () => ({
  getTranslations: async (arg: string | { locale?: "ro" | "en"; namespace: string }) => {
    const namespace = typeof arg === "string" ? arg : arg.namespace;
    const locale = typeof arg === "string" ? "ro" : (arg.locale ?? "ro");
    const catalogue = (locale === "ro" ? ro : en) as unknown as Record<string, Record<string, unknown>>;
    const [head, ...rest] = namespace.split(".");
    let messages: unknown = catalogue[head];
    for (const part of rest) messages = (messages as Record<string, unknown>)[part];
    return createTranslator({ locale, messages: messages as never });
  },
  getLocale: async () => "ro",
  setRequestLocale: () => undefined,
}));
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }), headers: async () => new Headers() }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {}, unstable_cache: (fn: unknown) => fn }));
vi.mock("@/auth", () => ({ auth: async () => null, signIn: async () => {}, signOut: async () => {} }));
vi.mock("@/db/client", () => ({ getDb: () => state.db }));
// The dialogs' road line (§841) reads the club's roads once per request.
vi.mock("@/shared/feedback/email-roads-request", () => ({ emailRoadsForThisRequest: async () => ({ groups: { links: "mailgun", confirmations: "mailgun", reminders: "mailgun", announcements: "mailgun", club: "gmail", newsletter: "mailgun" }, gmail: false }) }));
vi.mock("@/i18n/navigation", () => {
  type Href = string | { pathname: string; params?: Record<string, string>; query?: Record<string, string> };
  const hrefOf = (locale: string, href: Href) => {
    if (typeof href === "string") return `/${locale}${href}`;
    let path = href.pathname;
    for (const [key, value] of Object.entries(href.params ?? {})) path = path.replace(`[${key}]`, value);
    const query = href.query && Object.keys(href.query).length > 0 ? `?${new URLSearchParams(href.query).toString()}` : "";
    return `/${locale}${path}${query}`;
  };
  return {
    getPathname: ({ locale, href }: { locale: string; href: Href }) => hrefOf(locale, href),
    Link: ({ href, children, ...rest }: { href: Href; children?: ReactNode } & Record<string, unknown>) => createElement("a", { href: hrefOf("ro", href), ...rest }, children),
    useRouter: () => ({ refresh() {}, push() {}, replace() {} }),
    usePathname: () => "/admin/legal",
  };
});
vi.mock("@/modules/staff-identity/session", () => ({
  DEV_STAFF_COOKIE: "dev-staff",
  requireStaff: async () => state.actor,
  requireStaffCapability: async () => state.actor,
}));

const { default: LegalDocumentsPage } = await import("@/app/[locale]/admin/legal/(list)/page");
const { seedSampleLegalDocuments } = await import("@/db/seeds/sample-legal-documents");

let db: TestDatabase;
let close: () => Promise<void>;
let admin: StaffUser;
let organizer: StaffUser;

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
  state.db = db;
});
afterAll(async () => close());
beforeEach(async () => {
  await resetTables(db);
  // The seed says what it inserted; nothing here reads it.
  vi.spyOn(console, "log").mockImplementation(() => {});
  [admin] = await db.insert(staffUsers).values({ email: "admin@example.test", displayName: "Admin", role: "ADMIN" }).returning();
  [organizer] = await db.insert(staffUsers).values({ email: "org@example.test", displayName: "Org", role: "MODERATOR" }).returning();
  state.actor = admin;
});

/** The page as the server streams it, Suspense settled; Emotion's styles and React's separators out of the way. */
async function render(query: Record<string, string> = {}): Promise<string> {
  const page = (await LegalDocumentsPage({ params: Promise.resolve({ locale: "ro" }), searchParams: Promise.resolve(query) })) as ReactElement;
  const intl = { locale: "ro", timeZone: "Europe/Bucharest", messages: ro } as unknown as ComponentProps<typeof NextIntlClientProvider>;
  const stream = await renderToReadableStream(createElement(NextIntlClientProvider, intl, page), { onError: () => {} });
  await stream.allReady;
  return (await new Response(stream).text()).replace(/<style[\s\S]*?<\/style>/g, "").replace(/<!-- -->/g, "");
}

/** A text's row: its `<li>` up to its line's end. */
const lineOf = (html: string, key: string) => {
  const start = html.indexOf(`data-testid="legal-kind-${key}"`);
  expect(start, key).toBeGreaterThan(-1);
  return html.slice(html.lastIndexOf("<li", start), html.indexOf("</summary>", start) + 10);
};

describe("§847 «Documente legale»: one row per text, one panel of notices", () => {
  it("draws one row per text in the catalogue's order, each line its name, its state in words, its chips and the pencil, closed when nothing asks", async () => {
    await seedSampleLegalDocuments(new Date("2026-10-01T10:00:00.000Z"));
    const html = await render();
    const positions = LEGAL_DOCUMENT_KEYS.map((key) => html.indexOf(`data-testid="legal-kind-${key}"`));
    expect(positions.every((position) => position > -1)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    // Inside the one card of texts, as a list: no card per text any more.
    const texts = html.slice(html.indexOf('data-testid="legal-texts"'));
    expect(texts).toMatch(/<ul[^>]*aria-label="Textele legale"/);
    for (const key of LEGAL_DOCUMENT_KEYS) expect(texts, key).toContain(`data-testid="legal-kind-${key}"`);

    const terms = lineOf(html, "TERMS");
    expect(terms).toContain("Termeni de concurs");
    expect(terms).toMatch(/data-testid="legal-kind-state">În vigoare: versiunea 1 din /);
    expect(terms).toContain(">În vigoare<");
    expect(terms).toContain('title="Lucrează la text"');
    // In force and no draft: the row waits closed.
    expect(terms).not.toMatch(/<details[^>]*\sopen/);
    // Its boxes are behind the line: the text in force one press away, its versions folded.
    const row = html.slice(html.indexOf('data-testid="legal-kind-TERMS"'), html.indexOf('data-testid="legal-kind-EVENT_DECLARATION"'));
    expect(row).toContain('data-testid="legal-kind-read"');
    expect(row).toContain('data-testid="legal-versions-TERMS"');
  });

  it("opens a row whose text has nothing in force, says so on its chip, and opens the rows a filter keeps", async () => {
    // Nothing approved yet: no text is in force, so every row opens by itself and says so.
    const html = await render();
    const road = lineOf(html, "EVENT_DECLARATION_ROAD");
    expect(road).toMatch(/<details[^>]*\sopen/);
    expect(road).toContain(">Nimic în vigoare<");
    expect(road).toContain("Nicio versiune în vigoare");

    await seedSampleLegalDocuments(new Date("2026-10-01T10:00:00.000Z"));
    expect(lineOf(await render(), "TERMS")).not.toMatch(/<details[^>]*\sopen/);
    const filtered = await render({ kind: "TERMS" });
    expect(lineOf(filtered, "TERMS")).toMatch(/<details[^>]*\sopen/);
    expect(filtered).not.toContain('data-testid="legal-kind-PRIVACY_NOTICE"');
  });

  it("gathers the notices into one panel, the page's help after them, and the one press as a card while texts are missing", async () => {
    const html = await render();
    const notices = html.slice(html.indexOf('data-testid="legal-notices"'), html.indexOf('data-testid="legal-texts"'));
    expect(notices).toContain("Înainte să aprobi");
    expect(notices).toContain('data-testid="legal-steps"');
    expect(notices).toContain('id="legal-versions"');
    // Nothing in force at all: the one press is the thing to do, a card of its own.
    expect(html).toMatch(/<section[^>]*data-testid="platform-approve"/);
    expect(html).toMatch(/<section[^>]*data-testid="legal-batch-tools"/);
  });

  it("gives a reader the eye at the end of each line, and no press", async () => {
    await seedSampleLegalDocuments(new Date("2026-10-01T10:00:00.000Z"));
    state.actor = organizer;
    const html = await render();
    expect(lineOf(html, "TERMS")).toContain('title="Vezi versiunile"');
    expect(html).not.toContain('data-testid="legal-batch-tools"');
    expect(html).not.toContain('data-testid="legal-kind-regenerate"');
  });
});
