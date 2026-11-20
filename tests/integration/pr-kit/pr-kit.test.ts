import { readFileSync } from "node:fs";
import path from "node:path";
import PDFDocument from "pdfkit";
import { createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { LOGO_FORMATS, logoFileName, logoVariants, posterFileName, STICKER_SHEET_KEYS, stickerFileName } from "@/modules/pr-kit/domain/kit";
import type { StaffRole } from "@/modules/staff-identity/domain/roles";
import type { AdminTab } from "@/modules/staff-identity/ui/AdminTabs";
import { CLUB_HASHTAGS, CLUB_SLUG } from "@/theme/brand";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * BR-REQ-060-01, §NNN — «PR Kit» (the owner, 2026-11-20: «also put them in the backoffice website and call it "PR Kit" so we
 * can download it at any time, even the volunteers can do that»), through the real page, the real shell and the real routes:
 *
 * - «PR Kit» stands in the top bar of every backoffice role — the «Voluntar» too — just before «Ghid», wearing its glyph;
 * - the page lists the kit for a «Voluntar» and for an Administrator alike: six logo tiles with an SVG, a PNG and a PDF each,
 *   the six sticker sheets, the YouTube poster — or, with no `CLUB_YOUTUBE_URL`, the one line saying where it is set — and
 *   the club's colour as hex and RGB; a club member (no staff role) is not found;
 * - every route refuses on the server: no session is `UNAUTHENTICATED` (401), a role that may not or a colleague who owes the
 *   team's undertaking (§1006) `FORBIDDEN` (403) — never a hidden button alone;
 * - every file is an attachment named from the club's slug, `private, no-store`; each PDF is a pdfkit file of one page; the
 *   SVGs and PNGs are the kit's committed files byte for byte; the code stickers print the site's address from
 *   `APP_BASE_URL` without its scheme; the poster's words are the catalogue's in the asked language, and there is no poster
 *   while the club's YouTube address is not set.
 */
const state = vi.hoisted(() => ({
  db: undefined as unknown,
  actor: undefined as unknown,
  refusal: null as null | "UNAUTHENTICATED" | "FORBIDDEN",
  youtube: undefined as string | undefined,
  /** The request's language, as `setRequestLocale` leaves it for a page's `getTranslations("Admin")`. */
  locale: "ro" as "ro" | "en",
}));

vi.mock("@/db/client", () => ({ getDb: () => state.db }));
vi.mock("next-intl/server", async () => {
  const { intlServerMock } = await import("../../helpers/intl-server");
  return {
    ...intlServerMock,
    setRequestLocale: (locale: "ro" | "en") => {
      state.locale = locale;
    },
    getTranslations: (arg: string | { locale?: string; namespace: string }) =>
      intlServerMock.getTranslations(typeof arg === "string" ? { locale: state.locale, namespace: arg } : arg),
  };
});
vi.mock("@/i18n/navigation", () => ({
  getPathname: ({ locale, href }: { locale: string; href: string | { pathname: string } }) => `/${locale}${typeof href === "string" ? href : href.pathname}`,
}));
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  usePathname: () => "/ro/admin/pr-kit",
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
  redirect: (to: string) => {
    throw new Error(`REDIRECT ${to}`);
  },
}));
vi.mock("@/modules/staff-identity/session", async () => {
  const { DomainError: Refusal } = await import("@/shared/errors/domain-error");
  return {
    DEV_STAFF_COOKIE: "dev-staff",
    requireStaff: async () => {
      if (state.refusal) throw new Refusal(state.refusal, "refused by the test");
      if (!state.actor) throw new Refusal("UNAUTHENTICATED", "no staff session");
      return state.actor;
    },
  };
});
// The deployment's own values: this site's address, and the club's channel only when a test sets it.
vi.mock("@/shared/config/env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/shared/config/env")>();
  const env = new Proxy(actual.env, {
    get: (target, key) => (key === "CLUB_YOUTUBE_URL" ? state.youtube : key === "APP_BASE_URL" ? "https://club.example.org" : Reflect.get(target, key)),
  });
  return { ...actual, env };
});

const logoRoute = await import("@/app/api/admin/pr-kit/logo/[file]/route");
const stickersRoute = await import("@/app/api/admin/pr-kit/stickers/[sheet]/route");
const posterRoute = await import("@/app/api/admin/pr-kit/poster/route");
const { default: PrKitPage } = await import("@/app/[locale]/admin/pr-kit/page");
const { default: BackofficeShell } = await import("@/modules/staff-identity/ui/BackofficeShell");
const { default: AdminTabs } = await import("@/modules/staff-identity/ui/AdminTabs");

const ROOT = path.resolve(__dirname, "../../..");
const BACKOFFICE_ROLES: StaffRole[] = ["CONTRIBUTOR", "COPYWRITER", "MODERATOR", "DEV", "ADMIN", "SUPERADMIN"];
const CHANNEL = "https://www.youtube.com/@example-club";

let db: TestDatabase;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
  state.db = db;
});
afterAll(async () => close());
beforeEach(async () => {
  await resetTables(db);
  state.actor = actor("CONTRIBUTOR");
  state.refusal = null;
  state.youtube = undefined;
  state.locale = "ro";
});

function actor(role: StaffRole) {
  return { id: "00000000-0000-4000-8000-000000000001", email: `${role.toLowerCase()}@example.test`, displayName: "Vlad", role, permissions: new Set<string>() };
}

const logo = (file: string) => logoRoute.GET(new Request(`http://localhost/api/admin/pr-kit/logo/${file}`), { params: Promise.resolve({ file }) });
const stickers = (sheet: string) => stickersRoute.GET(new Request(`http://localhost/api/admin/pr-kit/stickers/${sheet}`), { params: Promise.resolve({ sheet }) });
const poster = (locale = "ro") => posterRoute.GET(new Request(`http://localhost/api/admin/pr-kit/poster?locale=${locale}`));

/** A pdfkit file, read as far as a test needs: it starts as a PDF, and its pages are counted by their dictionaries. */
async function pdfOf(response: Response): Promise<{ pages: number; mediaBox: number[]; text: string }> {
  const bytes = Buffer.from(await response.arrayBuffer());
  const text = bytes.toString("latin1");
  expect(text.startsWith("%PDF-")).toBe(true);
  expect(text.trimEnd().endsWith("%%EOF")).toBe(true);
  const mediaBox = (/\/MediaBox \[([^\]]+)\]/.exec(text)?.[1] ?? "").trim().split(/\s+/).map(Number);
  return { pages: text.match(/\/Type \/Page\b(?!s)/g)?.length ?? 0, mediaBox, text };
}

function expectDownload(response: Response, contentType: string, fileName: string) {
  expect(response.status).toBe(200);
  expect(response.headers.get("Content-Type")).toBe(contentType);
  expect(response.headers.get("Content-Disposition")).toBe(`attachment; filename="${fileName}"; filename*=UTF-8''${fileName}`);
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  expect(fileName.startsWith(`${CLUB_SLUG}-`)).toBe(true);
}

/** The words a render draws, caught on their way into pdfkit (it writes an embedded font's text as glyph ids). */
async function wordsDrawn(render: () => Promise<unknown>): Promise<string[]> {
  const words: string[] = [];
  const original = PDFDocument.prototype.text;
  const spy = vi.spyOn(PDFDocument.prototype, "text").mockImplementation(function (this: PDFKit.PDFDocument, ...args: unknown[]) {
    if (typeof args[0] === "string") words.push(args[0]);
    return (original as (...a: unknown[]) => PDFKit.PDFDocument).apply(this, args);
  });
  try {
    await render();
  } finally {
    spy.mockRestore();
  }
  return words;
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

async function tabsFor(role: StaffRole): Promise<AdminTab[]> {
  const tree = await BackofficeShell({ locale: "ro", staffUser: { displayName: "Ana", email: "ana@example.test", role }, signOut: async () => {}, children: null });
  const bar = elements(tree).find((element) => element.type === AdminTabs);
  return bar ? (bar.props.items as AdminTab[]) : [];
}

async function pageHtml(locale: "ro" | "en" = "ro"): Promise<string> {
  const tree = await PrKitPage({ params: Promise.resolve({ locale }) });
  return renderToStaticMarkup(tree).replace(/<style\b[\s\S]*?<\/style>/g, "");
}

describe("BR-REQ-060-01 §NNN «PR Kit» in the top bar, for every backoffice role", () => {
  for (const role of BACKOFFICE_ROLES) {
    it(`${role}: «PR Kit» just before «Ghid», to /admin/pr-kit`, async () => {
      const tabs = await tabsFor(role);
      const sections = tabs.map((tab) => tab.section);
      expect(sections.slice(-2)).toEqual(["prKit", "guide"]);
      expect(tabs.find((tab) => tab.section === "prKit")).toMatchObject({ label: "PR Kit", href: "/ro/admin/pr-kit" });
    });
  }

  it("a «Voluntar»'s bar is the desk, the PR Kit and the guide, and the tab wears its glyph", async () => {
    const tabs = await tabsFor("CONTRIBUTOR");
    expect(tabs.map((tab) => tab.label)).toEqual([ro.Admin.nav.checkin, ro.Admin.nav.prKit, ro.Admin.nav.guide]);
    const html = renderToStaticMarkup(createElement(AdminTabs, { items: tabs.filter((tab) => tab.section === "prKit") }));
    expect(html).toContain('href="/ro/admin/pr-kit"');
    expect(html).toContain('data-testid="StyleIcon"');
    expect(html).toContain("PR Kit");
  });

  it("a club member has no bar at all", async () => {
    expect(await tabsFor("MEMBER")).toEqual([]);
  });
});

describe("BR-REQ-060-01 §NNN the «PR Kit» page", () => {
  for (const role of ["CONTRIBUTOR", "ADMIN"] as const) {
    it(`${role}: lists the logo in two shapes and three inks, the six sheets, the poster and the colour`, async () => {
      state.actor = actor(role);
      state.youtube = CHANNEL;
      const html = await pageHtml();
      expect(html.match(/data-testid="pr-kit-logo-tile"/g)).toHaveLength(6);
      for (const { shape, ink } of logoVariants()) {
        expect(html).toContain(`src="/brand/kit/${logoFileName(shape, ink, "svg")}"`);
        for (const format of LOGO_FORMATS) expect(html).toContain(`href="/api/admin/pr-kit/logo/${logoFileName(shape, ink, format)}"`);
      }
      expect(html.match(/data-testid="pr-kit-sheet"/g)).toHaveLength(6);
      for (const sheet of STICKER_SHEET_KEYS) expect(html).toContain(`href="/api/admin/pr-kit/stickers/${sheet}"`);
      for (const words of Object.values(ro.Admin.prKit.stickers.sheet)) expect(html).toContain(words);
      expect(html).toContain(ro.Admin.prKit.stickers.codeTo.replace("{address}", "club.example.org"));
      expect(html).toContain('href="/api/admin/pr-kit/poster?locale=ro"');
      expect(html).toContain(ro.Admin.prKit.poster.codeTo.replace("{address}", "youtube.com/@example-club"));
      expect(html).not.toContain('data-testid="pr-kit-poster-unset"');
      expect(html).toContain("HEX #0000FF");
      expect(html).toContain("RGB 0, 0, 255");
      expect(html).toContain(ro.Admin.prKit.colours.paper);
      // Every download is a link a thumb can hit.
      const links = html.match(/<a\b[^>]*href="\/api\/admin\/pr-kit\/[^"]+"[^>]*>/g) ?? [];
      expect(links).toHaveLength(6 * 3 + 6 + 1);
    });
  }

  it("says where the club's YouTube address is set while it is not, and offers no poster", async () => {
    const html = await pageHtml();
    expect(html).toContain('data-testid="pr-kit-poster-unset"');
    expect(html).toContain(ro.Admin.prKit.poster.unset);
    expect(html).not.toContain("/api/admin/pr-kit/poster");
  });

  it("speaks English on the English page", async () => {
    state.youtube = CHANNEL;
    const html = await pageHtml("en");
    expect(html).toContain(en.Admin.prKit.logo.shape.mountains);
    expect(html).toContain('href="/api/admin/pr-kit/poster?locale=en"');
  });

  it("is not found for a club member, and asks for a staff session before anything", async () => {
    state.actor = actor("MEMBER");
    await expect(pageHtml()).rejects.toThrow("NOT_FOUND");
    state.actor = undefined;
    await expect(pageHtml()).rejects.toThrow("no staff session");
  });
});

describe("BR-REQ-060-01 §NNN the routes refuse on the server", () => {
  const every = () => [logo(logoFileName("lockup", "primary", "svg")), logo(logoFileName("mountains", "white", "pdf")), stickers("qr-12"), poster()];

  it("without a staff session: UNAUTHENTICATED, 401", async () => {
    state.actor = undefined;
    state.youtube = CHANNEL;
    for (const response of await Promise.all(every())) {
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: "UNAUTHENTICATED" });
    }
  });

  it("for a club member, and for a colleague who still owes the team's undertaking: FORBIDDEN, 403", async () => {
    state.youtube = CHANNEL;
    state.actor = actor("MEMBER");
    for (const response of await Promise.all(every())) {
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ error: "FORBIDDEN" });
    }
    state.actor = actor("CONTRIBUTOR");
    state.refusal = "FORBIDDEN";
    for (const response of await Promise.all(every())) expect(response.status).toBe(403);
  });

  for (const role of BACKOFFICE_ROLES) {
    it(`lets a ${role} download`, async () => {
      state.actor = actor(role);
      expect((await stickers("logo-24")).status).toBe(200);
      expect((await logo(logoFileName("lockup", "black", "png"))).status).toBe(200);
    });
  }

  it("answers only GET: none of them writes", () => {
    for (const route of [logoRoute, stickersRoute, posterRoute]) expect(Object.keys(route)).toEqual(["GET"]);
  });

  it("finds nothing under any other name", async () => {
    for (const name of ["logo.svg", "..%2F..%2Fclub%2Fclub.json", `${CLUB_SLUG}-logo-red.svg`]) expect((await logo(name)).status).toBe(404);
    for (const sheet of ["qr-99", "", "__proto__"]) expect((await stickers(sheet)).status).toBe(404);
  });
});

describe("§NNN the files", () => {
  for (const sheet of STICKER_SHEET_KEYS) {
    it(`«${sheet}»: a one-page A4 PDF named by its count`, async () => {
      const response = await stickers(sheet);
      expectDownload(response, "application/pdf", stickerFileName(sheet));
      const pdf = await pdfOf(response);
      expect(pdf.pages).toBe(1);
      expect(pdf.mediaBox.map((value) => Math.round(value))).toEqual([0, 0, 595, 842]);
      // The logo as paths and the codes as squares: no picture pasted in.
      expect(pdf.text).not.toContain("/Subtype /Image");
    });
  }

  it("prints this site's address under every code, from APP_BASE_URL without its scheme", async () => {
    for (const [sheet, count] of [
      ["qr-12", 12],
      ["qr-24", 24],
    ] as const) {
      const words = await wordsDrawn(() => stickers(sheet).then((response) => response.arrayBuffer()));
      expect(words).toEqual(Array.from({ length: count }, () => "club.example.org"));
    }
    // The logo sheets carry no words at all.
    expect(await wordsDrawn(() => stickers("logo-40").then((response) => response.arrayBuffer()))).toEqual([]);
  });

  for (const { shape, ink } of logoVariants()) {
    it(`the ${shape} in ${ink}: the kit's SVG and PNG as committed, and a vector PDF of the SVG's size`, async () => {
      const svgName = logoFileName(shape, ink, "svg");
      const svg = await logo(svgName);
      expectDownload(svg, "image/svg+xml", svgName);
      expect(Buffer.from(await svg.arrayBuffer()).equals(readFileSync(path.join(ROOT, "public/brand/kit", svgName)))).toBe(true);
      const pngName = logoFileName(shape, ink, "png");
      const png = await logo(pngName);
      expectDownload(png, "image/png", pngName);
      expect(Buffer.from(await png.arrayBuffer()).equals(readFileSync(path.join(ROOT, "public/brand/kit", pngName)))).toBe(true);
      const pdfName = logoFileName(shape, ink, "pdf");
      const response = await logo(pdfName);
      expectDownload(response, "application/pdf", pdfName);
      const pdf = await pdfOf(response);
      expect(pdf.pages).toBe(1);
      // The page is the SVG's own size: 200 mm wide, as tall as its frame.
      const size = /width="([\d.]+)mm" height="([\d.]+)mm"/.exec(readFileSync(path.join(ROOT, "public/brand/kit", svgName), "utf8"));
      expect(pdf.mediaBox[2]).toBeCloseTo((Number(size?.[1]) * 72) / 25.4, 2);
      expect(pdf.mediaBox[3]).toBeCloseTo((Number(size?.[2]) * 72) / 25.4, 2);
      // Drawn, not pasted: no picture in it.
      expect(pdf.text).not.toContain("/Subtype /Image");
    });
  }

  it("draws no poster while the club's YouTube address is not set", async () => {
    const response = await poster();
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "NOT_FOUND" });
  });

  for (const locale of ["ro", "en"] as const) {
    it(`draws the poster in ${locale}: one A4 page, the catalogue's words, the channel's address and the club's hashtags`, async () => {
      state.youtube = CHANNEL;
      const response = await poster(locale);
      expectDownload(response, "application/pdf", posterFileName(locale));
      const pdf = await pdfOf(response);
      expect(pdf.pages).toBe(1);
      expect(pdf.mediaBox.map((value) => Math.round(value))).toEqual([0, 0, 595, 842]);
      expect(pdf.text).not.toContain("/Subtype /Image");
      const words = (locale === "ro" ? ro : en).Admin.prKit.poster;
      const drawn = await wordsDrawn(() => poster(locale).then((again) => again.arrayBuffer()));
      for (const word of [words.kicker, words.brand, words.tab, words.scan, "youtube.com/@example-club", CLUB_HASHTAGS.join(" · ")]) expect(drawn).toContain(word);
      // The lead, in as many lines as it wraps to, says the catalogue's sentence whole.
      expect(drawn.filter((run) => words.lead.includes(run)).join(" ")).toBe(words.lead);
    });
  }

  it("refuses a language the site does not speak", async () => {
    state.youtube = CHANNEL;
    expect((await poster("fr")).status).toBe(400);
  });
});
