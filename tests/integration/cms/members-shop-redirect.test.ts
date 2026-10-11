import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * §715, §683 — the members' shop verbs answer back to «Magazin», the zone's shop tab, whatever the
 * outcome: `/ro/zona-membri/magazin?shop=…` (and `&shopAt=orders#members-orders` for an order's own
 * answers), the English twin under `/en/members-area/shop`. The action asserts the door itself; a
 * signed-out press goes to the sign-in, not to the tab.
 */
const state = vi.hoisted(() => ({ db: undefined as unknown, cookie: undefined as string | undefined }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => (state.cookie ? { value: state.cookie } : undefined), set: () => {}, delete: () => {} }),
}));
vi.mock("@/auth", () => ({ auth: async () => null, signIn: async () => {}, signOut: async () => {} }));
vi.mock("@/db/client", () => ({ getDb: () => state.db }));

const { placeShopOrderAction, cancelShopOrderAction } = await import("@/app/[locale]/members-area/actions");

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

function form(entries: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) data.set(key, value);
  return data;
}

describe("§715 the shop's verbs answer on «Magazin»", () => {
  let db: TestDatabase;
  let close: () => Promise<void>;
  let member: StaffUser;

  beforeAll(async () => {
    ({ db, close } = await createTestDatabase());
    state.db = db;
  });
  afterAll(async () => close());
  beforeEach(async () => {
    await resetTables(db);
    [member] = await db.insert(staffUsers).values({ email: "membru@dev.test", displayName: "Ana Membru", role: "MEMBER" }).returning();
    state.cookie = member.id;
  });

  it("answers an order's refusal on the tab, at the shop's own anchor", async () => {
    const ro = await redirectedTo(placeShopOrderAction(form({ uiLocale: "ro", productId: "", variantId: "", quantity: "1", note: "" })));
    expect(ro).toMatch(/^\/ro\/zona-membri\/magazin\?shop=[A-Z_]+#members-shop$/);
    const en = await redirectedTo(placeShopOrderAction(form({ uiLocale: "en", productId: "", variantId: "", quantity: "1", note: "" })));
    expect(en).toMatch(/^\/en\/members-area\/shop\?shop=[A-Z_a-z]+#members-shop$/);
  });

  it("answers a cancellation in «Comenzile mele» on the tab", async () => {
    const orderId = "00000000-0000-4000-8000-000000000000";
    const ro = await redirectedTo(cancelShopOrderAction(form({ uiLocale: "ro", orderId })));
    expect(ro).toMatch(/^\/ro\/zona-membri\/magazin\?shop=[A-Za-z_]+&shopAt=orders#members-orders$/);
    const en = await redirectedTo(cancelShopOrderAction(form({ uiLocale: "en", orderId })));
    expect(en).toMatch(/^\/en\/members-area\/shop\?shop=[A-Za-z_]+&shopAt=orders#members-orders$/);
  });

  it("sends a signed-out press to the sign-in, not to the tab", async () => {
    state.cookie = undefined;
    expect(await redirectedTo(cancelShopOrderAction(form({ uiLocale: "ro", orderId: "x" })))).toBe("/ro/autentificare?to=members");
  });
});
