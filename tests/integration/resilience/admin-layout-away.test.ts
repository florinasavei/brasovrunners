import { isValidElement, type ReactElement } from "react";
import { createTranslator } from "next-intl";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ro from "../../../messages/ro.json";

/**
 * §NNN, finding (3) of the fix round on `feat/neon-budget-governor`: the backoffice layout reads
 * the signed-in staff member from the database on every page, and an error thrown in a layout is
 * not caught by the same segment's `error.tsx` — staff met the framework's error page. The layout
 * now catches the away-error itself and renders the resting notice with the sign-out button; any
 * other error still throws.
 */
const state = vi.hoisted(() => ({ failure: null as Error | null }));
const signOutAction = vi.hoisted(() => async () => {});

vi.mock("@/modules/staff-identity/session", () => ({
  getCurrentStaffUser: async () => {
    if (state.failure) throw state.failure;
    return null;
  },
}));
vi.mock("@/app/[locale]/admin/actions", () => ({ signOutAction }));
vi.mock("@/modules/staff-identity/ui/BackofficeShell", () => ({ default: () => null }));
vi.mock("@/shared/feedback/ToastProvider", () => ({ default: () => null }));
vi.mock("@/shared/forms/pickers/PickerProvider", () => ({ default: () => null }));
vi.mock("@/shared/feedback/flash", () => ({ readFlash: async () => null }));
vi.mock("next-intl/server", () => ({
  setRequestLocale: () => {},
  getMessages: async () => ro,
  getTranslations: async (namespace: string) =>
    createTranslator({ locale: "ro", messages: (ro as Record<string, object>)[namespace] as Record<string, string>, namespace: undefined }),
}));

const { default: AdminLayout } = await import("@/app/[locale]/admin/layout");
const { default: AdminRestingNotice } = await import("@/modules/resilience/ui/AdminRestingNotice");

const layout = () => AdminLayout({ children: null, params: Promise.resolve({ locale: "ro" }) });

beforeEach(() => {
  state.failure = null;
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("§NNN the backoffice layout while the database is away", () => {
  it("renders the resting notice with the sign-out button instead of the framework's error page", async () => {
    state.failure = Object.assign(new Error("Failed query: select … from staff_users"), {
      cause: new Error("Your project has exceeded the compute time quota. Upgrade your plan to increase limits."),
    });
    const element = (await layout()) as ReactElement<{ locale: "ro"; signOut: typeof signOutAction }>;
    expect(isValidElement(element)).toBe(true);
    expect(element.type).toBe(AdminRestingNotice);
    expect(element.props.signOut).toBe(signOutAction);

    const html = renderToStaticMarkup(await AdminRestingNotice(element.props));
    expect(html).toContain('data-testid="admin-resting"');
    expect(html).toContain(ro.Error.staffTitle);
    expect(html).toContain(ro.Admin.signOut);
    expect(html).toContain('name="uiLocale" value="ro"');
  });

  it("still throws an error that is not the database being away", async () => {
    state.failure = new Error('column "nope" does not exist');
    await expect(layout()).rejects.toThrow("does not exist");
  });
});
