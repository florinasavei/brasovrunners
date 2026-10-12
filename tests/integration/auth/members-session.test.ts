import { eq } from "drizzle-orm";
import type { ReactNode } from "react";
import { renderToReadableStream, renderToStaticMarkup } from "react-dom/server";
import { createTranslator } from "next-intl";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import ro from "../../../messages/ro.json";
import { shopProductVariants } from "@/db/schema/shop";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { getPathname } from "@/i18n/navigation";
import { computeContentHash } from "@/modules/legal-documents/domain/content-hash";
import { privacyNoticeEn, privacyNoticeRo } from "@/modules/legal-documents/templates/privacy-notice";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * BR-REQ-060-01, §524 — a club member signs in through the staff door and is no staff.
 *
 * The session is read the one way it is everywhere (`session.ts`, the development switcher's
 * cookie in tests), from a real database: a member is an account (`getCurrentAccount`) and not a
 * staff session (`getCurrentStaffUser`), so every backoffice door that asks `requireStaff` or
 * `requireStaffCapability` refuses one as it refuses a stranger. The backoffice's layout sends a
 * member on to the members' zone; the zone sends a stranger to the sign-in in the members' words
 * and shows a member the club's words for members.
 */
const state = vi.hoisted(() => ({ db: undefined as unknown, cookie: undefined as string | undefined }));

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => (state.cookie ? { value: state.cookie } : undefined), set: () => {}, delete: () => {} }),
}));
vi.mock("@/auth", () => ({ auth: async () => null, signIn: async () => {}, signOut: async () => {} }));
vi.mock("@/db/client", () => ({ getDb: () => state.db }));
vi.mock("@/app/[locale]/admin/actions", () => ({ signOutAction: async () => {} }));
vi.mock("next-intl/server", () => ({
  setRequestLocale: () => {},
  getMessages: async () => ro,
  getTranslations: async (namespace: string) =>
    createTranslator({ locale: "ro", messages: (ro as Record<string, object>)[namespace] as Record<string, string>, namespace: undefined }),
}));

const { getCurrentAccount, getCurrentStaffUser, requireStaff, requireStaffCapability } = await import("@/modules/staff-identity/session");
const { canOpenMembersZone, canWorkTheDesk } = await import("@/modules/staff-identity/domain/roles");
const { saveMembersText } = await import("@/modules/content/members/page-settings");
const { insertLegalDocumentVersion } = await import("@/modules/legal-documents/repository");
const { createProduct } = await import("@/modules/content/shop/service");
const { placeOrder } = await import("@/modules/content/shop/orders");
const { placeShopOrderAction } = await import("@/app/[locale]/members-area/actions");
const { default: MembersAreaPage } = await import("@/app/[locale]/members-area/page");

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

/** A page's markup with its async server components resolved (the shop's section is one, which the synchronous static renderer cannot draw). */
async function markup(node: ReactNode): Promise<string> {
  const stream = await renderToReadableStream(node);
  await stream.allReady;
  return new Response(stream).text();
}

describe("§524 a member signs in and is no staff", () => {
  let db: TestDatabase;
  let close: () => Promise<void>;
  let member: StaffUser;
  let volunteer: StaffUser;
  let admin: StaffUser;

  beforeAll(async () => {
    ({ db, close } = await createTestDatabase());
    state.db = db;
  });
  afterAll(async () => close());
  beforeEach(async () => {
    await resetTables(db);
    state.cookie = undefined;
    [member] = await db.insert(staffUsers).values({ email: "membru@dev.test", displayName: "Ana Membru", role: "MEMBER" }).returning();
    [volunteer] = await db.insert(staffUsers).values({ email: "voluntar@dev.test", displayName: "Vlad", role: "CONTRIBUTOR" }).returning();
    [admin] = await db.insert(staffUsers).values({ email: "admin@dev.test", displayName: "Ioana", role: "ADMIN" }).returning();
  });

  it("is an account and not a staff session, so every staff door refuses them", async () => {
    state.cookie = member.id;
    expect((await getCurrentAccount())?.id).toBe(member.id);
    expect(await getCurrentStaffUser()).toBeNull();
    await expect(requireStaff()).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    // Even a capability every account has is not a way through the staff door.
    await expect(requireStaffCapability(canOpenMembersZone)).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  });

  it("leaves every colleague a staff session, the volunteer included", async () => {
    state.cookie = volunteer.id;
    expect((await getCurrentStaffUser())?.id).toBe(volunteer.id);
    expect((await requireStaffCapability(canWorkTheDesk)).id).toBe(volunteer.id);
    expect((await getCurrentAccount())?.id).toBe(volunteer.id);
  });

  it("sends a stranger from the members' zone to the sign-in in the members' words", async () => {
    const to = await redirectedTo(MembersAreaPage({ params: Promise.resolve({ locale: "ro" }) }));
    expect(to).toBe("/ro/autentificare?to=members");
  });

  it("shows a member the club's words for members, their name, and no way into the backoffice", async () => {
    await saveMembersText(db, {
      actor: admin,
      text: "zone",
      fields: {
        zoneRoBody: JSON.stringify({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Codul de reducere: ALERG." }] }] }),
        zoneEnBody: JSON.stringify({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "The discount code: ALERG." }] }] }),
      },
    });
    state.cookie = member.id;
    const html = renderToStaticMarkup(await MembersAreaPage({ params: Promise.resolve({ locale: "ro" }) }));
    expect(html).toContain("Codul de reducere: ALERG.");
    expect(html).not.toContain("The discount code");
    expect(html).toContain("Ana Membru");
    expect(html).toContain('data-testid="members-sign-out"');
    expect(html).toContain('name="from" value="members"');
    expect(html).not.toContain('data-testid="members-backoffice"');
  });

  /** The privacy notice from the platform's template, approved: the one fact that lets the zone draw a shop. */
  async function approveShopNotice() {
    const translations = [
      { locale: "ro" as const, title: "Nota de confidențialitate", body: privacyNoticeRo },
      { locale: "en" as const, title: "Privacy notice", body: privacyNoticeEn },
    ];
    await insertLegalDocumentVersion(db, {
      key: "PRIVACY_NOTICE",
      version: 1,
      effectiveAt: new Date(Date.now() - 3_600_000),
      isApproved: true,
      contentSha256: computeContentHash(translations),
      translations,
      now: new Date(),
    });
  }

  /** A product on offer and one of its sizes, made as the shop's own tests make them: what a press on «Comandă» names. */
  async function onOffer() {
    const product = await createProduct(db, {
      actor: admin,
      fields: { titleRo: "Tricou exemplu", titleEn: "Sample t-shirt", descriptionRo: "Bumbac.", descriptionEn: "Cotton.", price: "45", variants: "M: 2\nL", stock: "", visible: true },
    });
    const [size] = await db.select().from(shopProductVariants).where(eq(shopProductVariants.productId, product.id)).limit(1);
    return { product, size };
  }

  const hrefsOf = (html: string) => (html.match(/<nav [^>]*>[\s\S]*?<\/nav>/)?.[0] ?? "");

  it("§715 draws the tabs in the owner's order, the shop only once the notice names it, each page asserting the door itself", async () => {
    const { default: ShopPage } = await import("@/app/[locale]/members-area/shop/page");
    const { default: RunsPage } = await import("@/app/[locale]/members-area/runs/page");
    const params = { params: Promise.resolve({ locale: "ro" }) };
    // Signed out: every tab sends the stranger to the sign-in, not just the zone's own address.
    for (const Page of [MembersAreaPage, ShopPage, RunsPage]) expect(await redirectedTo(Page(params))).toBe("/ro/autentificare?to=members");

    state.cookie = member.id;
    // No notice naming the shop in force: no «Magazin» tab, and its address is a 404 (BR-REQ-053-01).
    for (const [Page, active] of [[MembersAreaPage, "/ro/zona-membri"], [RunsPage, "/ro/zona-membri/alergari"]] as const) {
      const nav = hrefsOf(renderToStaticMarkup(await Page(params)));
      expect([...nav.matchAll(/href="([^"]+)"/g)].map((m) => m[1])).toEqual(["/ro/zona-membri", "/ro/zona-membri/alergari"]);
      expect([...nav.matchAll(/<a [^>]*aria-current="page"[^>]*>/g)].map((m) => m[0])[0]).toContain(`href="${active}"`);
    }
    await expect(ShopPage(params)).rejects.toMatchObject({ digest: expect.stringContaining("404") });

    await approveShopNotice();
    // A product on offer, so the shop's own section is drawn rather than its empty sentence.
    await onOffer();
    // Each part's own marker: the codes (or their empty sentence), the shop's section, the next runs.
    const pages = [
      [MembersAreaPage, "/ro/zona-membri", /data-testid="members-codes(-empty)?"/],
      [ShopPage, "/ro/zona-membri/magazin", /data-testid="members-shop"/],
      [RunsPage, "/ro/zona-membri/alergari", /data-testid="members-upcoming"/],
    ] as const;
    for (const [Page, active] of pages) {
      const html = await markup(await Page(params));
      const nav = hrefsOf(html);
      expect([...nav.matchAll(/href="([^"]+)"/g)].map((m) => m[1])).toEqual(["/ro/zona-membri", "/ro/zona-membri/magazin", "/ro/zona-membri/alergari"]);
      expect(nav.replace(/<style[\s\S]*?<\/style>/g, "").replace(/<[^>]+>/g, "|").split("|").filter(Boolean)).toEqual([ro.Members.tabs.codes, ro.Members.tabsShort.codes, ro.Members.tabs.shop, ro.Members.tabsShort.shop, ro.Members.tabs.runs, ro.Members.tabsShort.runs]); // the full word and the short one (§729)
      const current = [...nav.matchAll(/<a [^>]*aria-current="page"[^>]*>/g)].map((m) => m[0]);
      expect(current).toHaveLength(1);
      expect(current[0]).toContain(`href="${active}"`);
      expect(html).toContain('data-testid="members-sign-out"');
      expect(html.includes(ro.Members.upcomingTitle)).toBe(active === "/ro/zona-membri/alergari");
      // Each tab's own part is on its own page and on no other: a tab is a page, not a section of one long page.
      for (const [, tab, own] of pages) expect(own.test(html), `${tab} drawn on ${active}`).toBe(tab === active);
    }
    // The runs' address in English is its file-system name (`routing.ts`), as the Romanian one is «alergari».
    expect(getPathname({ locale: "en", href: "/members-area/runs" })).toBe("/en/members-area/runs");
  });

  it("§715 keeps «Magazin» for a member with an order while no notice names the shop: the tab, their orders and nothing to buy", async () => {
    const { default: ShopPage } = await import("@/app/[locale]/members-area/shop/page");
    const { product, size } = await onOffer();
    // The order was placed while the notice named the shop; none in force names it now.
    await placeOrder(db, { account: member, locale: "ro", noticeDescribes: true, fields: { productId: product.id, variantId: size.id, quantity: "1", note: "" } });
    state.cookie = member.id;
    const params = { params: Promise.resolve({ locale: "ro" }) };
    for (const Page of [MembersAreaPage, ShopPage]) {
      const nav = hrefsOf(await markup(await Page(params)));
      expect([...nav.matchAll(/href="([^"]+)"/g)].map((m) => m[1])).toEqual(["/ro/zona-membri", "/ro/zona-membri/magazin", "/ro/zona-membri/alergari"]);
    }
    const html = await markup(await ShopPage(params));
    expect(html).toContain('data-testid="members-orders"');
    expect(html).not.toContain('data-testid="members-shop"');
  });

  it("§715 lands a press made on a page drawn before the notice changed on its answer, inside the zone and never on a 404", async () => {
    const { default: ShopPage } = await import("@/app/[locale]/members-area/shop/page");
    const { product, size } = await onOffer();
    state.cookie = member.id;
    // The page was drawn while the notice named the shop; no notice in force names it now, and the member has no order.
    const press = new FormData();
    for (const [name, value] of Object.entries({ uiLocale: "ro", productId: product.id, variantId: size.id, quantity: "1", note: "" })) press.set(name, value);
    const to = await redirectedTo(placeShopOrderAction(press));
    expect(to).toBe("/ro/zona-membri/magazin?shop=NOT_FOUND#members-shop");
    // What the browser then asks for: the query, never the fragment.
    const answer = new URLSearchParams(to.slice(to.indexOf("?") + 1, to.indexOf("#")));
    const html = renderToStaticMarkup(await ShopPage({ params: Promise.resolve({ locale: "ro" }), searchParams: Promise.resolve({ shop: answer.get("shop") ?? undefined }) }));
    expect(html).toContain('data-testid="members-shop-outcome"');
    expect(html).toContain(ro.Members.shop.outcome.NOT_FOUND);
    // In the zone's frame, with no «Magazin» tab to lead back here and nothing of the shop itself.
    expect(html).toContain('data-testid="members-greeting"');
    expect(html).toContain('data-testid="members-sign-out"');
    expect([...hrefsOf(html).matchAll(/href="([^"]+)"/g)].map((m) => m[1])).toEqual(["/ro/zona-membri", "/ro/zona-membri/alergari"]);
    expect(html).not.toContain('data-testid="members-shop"');
    // Only for that request: with no answer in the address, or none the page knows, it is still a 404.
    const notFound = { digest: expect.stringContaining("404") };
    await expect(ShopPage({ params: Promise.resolve({ locale: "ro" }) })).rejects.toMatchObject(notFound);
    for (const search of [{}, { shop: "whatever" }, { shopAt: "orders" }]) {
      await expect(ShopPage({ params: Promise.resolve({ locale: "ro" }), searchParams: Promise.resolve(search) })).rejects.toMatchObject(notFound);
    }
  });

  it("§715 shows the club's words for members above the tabs, on every tab", async () => {
    const { default: ShopPage } = await import("@/app/[locale]/members-area/shop/page");
    const { default: RunsPage } = await import("@/app/[locale]/members-area/runs/page");
    const doc = (text: string) => JSON.stringify({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });
    await saveMembersText(db, { actor: admin, text: "zone", fields: { zoneRoBody: doc("Vorbele clubului."), zoneEnBody: doc("The club's words.") } });
    await approveShopNotice();
    state.cookie = member.id;
    for (const Page of [MembersAreaPage, ShopPage, RunsPage]) {
      const html = renderToStaticMarkup(await Page({ params: Promise.resolve({ locale: "ro" }) }));
      expect(html).toContain("Vorbele clubului.");
      expect(html.indexOf("Vorbele clubului.")).toBeLessThan(html.indexOf('data-testid="members-tabs"'));
    }
  });

  it("§715 answers an Administrator on the tabs too, and none shows the backoffice", async () => {
    const { default: ShopPage } = await import("@/app/[locale]/members-area/shop/page");
    const { default: RunsPage } = await import("@/app/[locale]/members-area/runs/page");
    state.cookie = admin.id;
    await approveShopNotice();
    for (const Page of [ShopPage, RunsPage]) {
      const html = renderToStaticMarkup(await Page({ params: Promise.resolve({ locale: "ro" }) }));
      expect(html).not.toMatch(/href="\/ro\/admin/);
    }
    expect(renderToStaticMarkup(await ShopPage({ params: Promise.resolve({ locale: "ro" }) }))).toContain(ro.Members.shopEmpty);
  });

  it("shows an Administrator no way into the backoffice either (§684)", async () => {
    state.cookie = admin.id;
    const html = renderToStaticMarkup(await MembersAreaPage({ params: Promise.resolve({ locale: "ro" }) }));
    expect(html).toContain('data-testid="members-sign-out"');
    expect(html).not.toContain('data-testid="members-backoffice"');
    expect(html).not.toMatch(/href="\/ro\/admin/);
  });

  it("says the platform's sentence when the zone is written in one language only, or not at all", async () => {
    state.cookie = member.id;
    const html = renderToStaticMarkup(await MembersAreaPage({ params: Promise.resolve({ locale: "ro" }) }));
    expect(html).toContain('data-testid="members-zone-empty"');
    expect(html).toContain(ro.Members.zoneEmpty);
  });
});
