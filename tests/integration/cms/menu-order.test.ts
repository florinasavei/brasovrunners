import { eq } from "drizzle-orm";
import { type ComponentProps, createElement, type ReactNode } from "react";
import { renderToReadableStream } from "react-dom/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { pages } from "@/db/schema/pages";
import { platformSettings } from "@/db/schema/platform-settings";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import {
  MENU_ORDER_SETTING_ENTITY_ID,
  MENU_ORDER_SETTING_KEY,
  readMenuOrder,
  resolvedMenuOrder,
  saveMenuOrder,
} from "@/modules/content/menu/menu-order";
import { MENU_SECTION_KEYS } from "@/modules/content/menu/order";
import { isDomainError } from "@/shared/errors/domain-error";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/** The public cache's expiry, watched: a save must expire what the header and the footer read (§333, §549). */
const cache = vi.hoisted(() => ({ revalidatePublicContent: vi.fn() }));
vi.mock("@/modules/public-cache/cache", () => cache);

// SiteNav, rendered with the order the database holds: its router and links stubbed, as in `nav-order.test.ts`.
vi.mock("next/navigation", () => ({ useSelectedLayoutSegments: () => [], usePathname: () => "/ro" }));
vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, ...rest }: { href: string | { pathname: string; params?: { slug: string } }; children: ReactNode }) =>
    createElement(
      "a",
      { href: typeof href === "string" ? `/ro${href}` : `/ro${href.params ? href.pathname.replace("[slug]", href.params.slug) : href.pathname}`, ...rest },
      children,
    ),
  getPathname: ({ href }: { href: string }) => `/ro${href}`,
}));

/**
 * §571 (amending §406) — «Ordinea meniului»: one `platform_settings` row holding the site menu's
 * order, every entry's key first to last. The Administrator's (§450), audited, and the public
 * pages' `settings` expired on every save; read back by the header in the saved order.
 */
const NOW = new Date("2026-09-30T09:00:00.000Z");

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return "NO_ERROR";
  } catch (error) {
    return isDomainError(error) ? error.code : "UNKNOWN";
  }
}

describe("«Ordinea meniului», the site menu's one order", () => {
  let db: TestDatabase;
  let close: () => Promise<void>;
  let admin: StaffUser;
  let organizer: StaffUser;
  let copywriter: StaffUser;
  let first: string;
  let second: string;

  beforeAll(async () => {
    ({ db, close } = await createTestDatabase());
  });
  afterAll(async () => close());
  beforeEach(async () => {
    await resetTables(db);
    cache.revalidatePublicContent.mockClear();
    [admin] = await db.insert(staffUsers).values({ email: "admin@dev.test", displayName: "Admin", role: "ADMIN" }).returning();
    [organizer] = await db.insert(staffUsers).values({ email: "org@dev.test", displayName: "Org", role: "MODERATOR" }).returning();
    [copywriter] = await db.insert(staffUsers).values({ email: "copy@dev.test", displayName: "Copy", role: "COPYWRITER" }).returning();
    // Two custom pages, the second one first by the old «Ordinea» column.
    [{ id: first }] = await db.insert(pages).values({ navOrder: 2, createdAt: NOW }).returning({ id: pages.id });
    [{ id: second }] = await db.insert(pages).values({ navOrder: 1, createdAt: NOW }).returning({ id: pages.id });
  });

  const auditRows = () => db.select().from(auditLogs).where(eq(auditLogs.action, "menu_order.changed"));

  it("needs no setting up: no row is today's menu, the pages by the old column after the sections", async () => {
    expect(await readMenuOrder(db)).toEqual({ stored: [], updatedAt: null });
    expect(await resolvedMenuOrder(db)).toEqual([...MENU_SECTION_KEYS, `page:${second}`, `page:${first}`]);
  });

  it("saves the Administrator's order whole, with an audit row and the public pages expired", async () => {
    const saved = await saveMenuOrder(db, admin, [`page:${first}`, "contact", "events"], NOW);
    const whole = [`page:${first}`, "contact", "events", "calendar", "gallery", "team", "faq", "members", `page:${second}`];
    expect(saved).toEqual({ stored: whole, updatedAt: NOW });
    expect(await readMenuOrder(db)).toEqual({ stored: whole, updatedAt: NOW });
    expect(cache.revalidatePublicContent).toHaveBeenCalledTimes(1);
    expect(cache.revalidatePublicContent).toHaveBeenCalledWith("settings");

    const [audit] = await auditRows();
    expect(audit.actorStaffUserId).toBe(admin.id);
    expect(audit.entityType).toBe("platform_setting");
    expect(audit.entityId).toBe(MENU_ORDER_SETTING_ENTITY_ID);
    expect(audit.metadataJson).toEqual({ from: [], to: whole });
  });

  it("takes the form's comma-separated field as well, and keeps one row on a second save", async () => {
    await saveMenuOrder(db, admin, "calendar, events", NOW);
    await saveMenuOrder(db, admin, `faq,page:${second}`, NOW);
    const rows = await db.select().from(platformSettings).where(eq(platformSettings.key, MENU_ORDER_SETTING_KEY));
    expect(rows).toHaveLength(1);
    expect((await readMenuOrder(db)).stored.slice(0, 3)).toEqual(["faq", `page:${second}`, "events"]);
    expect(await auditRows()).toHaveLength(2);
  });

  it("puts a page written after the save at the end, and forgets a page deleted since", async () => {
    await saveMenuOrder(db, admin, [`page:${second}`, `page:${first}`], NOW);
    const [{ id: later }] = await db.insert(pages).values({ navOrder: 0, createdAt: NOW }).returning({ id: pages.id });
    await db.delete(pages).where(eq(pages.id, first));
    const order = await resolvedMenuOrder(db);
    expect(order[0]).toBe(`page:${second}`);
    expect(order.at(-1)).toBe(`page:${later}`);
    expect(order).not.toContain(`page:${first}`);
  });

  it("refuses an Organizer and a Redactor, storing nothing and expiring nothing (§450)", async () => {
    expect(await codeOf(saveMenuOrder(db, organizer, ["contact"], NOW))).toBe("FORBIDDEN");
    expect(await codeOf(saveMenuOrder(db, copywriter, ["contact"], NOW))).toBe("FORBIDDEN");
    expect((await readMenuOrder(db)).stored).toEqual([]);
    expect(await auditRows()).toHaveLength(0);
    expect(cache.revalidatePublicContent).not.toHaveBeenCalled();
  });

  it("refuses a post that is not a list of menu entries", async () => {
    expect(await codeOf(saveMenuOrder(db, admin, [{ key: "events" }], NOW))).toBe("VALIDATION_ERROR");
    expect(await codeOf(saveMenuOrder(db, admin, ["events", "<script>"], NOW))).toBe("VALIDATION_ERROR");
    expect(await codeOf(saveMenuOrder(db, admin, 7, NOW))).toBe("VALIDATION_ERROR");
    expect((await readMenuOrder(db)).stored).toEqual([]);
  });

  it("is the order the header draws: the saved list, read back, sorts the sections and the pages together", async () => {
    await saveMenuOrder(db, admin, [`page:${first}`, "contact", "events", "calendar", `page:${second}`], NOW);
    const { stored } = await readMenuOrder(db);

    const { NextIntlClientProvider } = await import("next-intl");
    const messages = (await import("../../../messages/ro.json")).default;
    const { default: SiteNav } = await import("@/shared/ui/SiteNav");
    const nav = createElement(SiteNav, {
      showContact: true,
      pages: [
        { id: second, slug: "istoric", title: "Istoric" },
        { id: first, slug: "despre", title: "Despre" },
      ],
      order: stored,
    });
    const stream = await renderToReadableStream(
      createElement(NextIntlClientProvider, { locale: "ro", messages } as unknown as ComponentProps<typeof NextIntlClientProvider>, nav),
    );
    await stream.allReady;
    const markup = await new Response(stream).text();
    const hrefs = [...markup.matchAll(/<a[^>]*href="([^"]+)"/g)].map((match) => match[1]);
    expect(hrefs).toEqual(["/ro/pages/despre", "/ro/contact", "/ro/events", "/ro/calendar", "/ro/pages/istoric"]);
  });
});
