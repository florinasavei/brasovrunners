import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `DECISIONS.md` §351 — "Publică automat de acum" on the events list's draft line posts to the
 * same Server Action as the Recurență box (`setRepeatPublishAction`), aimed at the series' source,
 * and lands back on the list rather than in the editor.
 *
 * The action itself, called with the form the line posts: the session, the service and Next's
 * `redirect` are stood in for, so what is proven is the action's own two decisions — which event
 * the service is asked to switch, and where the browser is sent. `returnTo` is read as one word
 * and never as an address: whatever else is posted there, the answer is the editor, so no form
 * can make this an open redirect.
 */
const setRepeatPublish = vi.fn<(...args: unknown[]) => Promise<void>>(async () => {});
const redirected: string[] = [];

vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  redirect: (url: string) => {
    redirected.push(url);
    throw new Error("NEXT_REDIRECT");
  },
}));
vi.mock("next/headers", () => ({ cookies: async () => ({ set: () => {}, delete: () => {} }) }));
vi.mock("@/auth", () => ({ signOut: async () => {} }));
vi.mock("@/db/client", () => ({ getDb: () => ({}) }));
vi.mock("@/modules/staff-identity/session", () => ({
  DEV_STAFF_COOKIE: "dev-staff",
  requireStaff: async () => ({ id: "staff-1", role: "ADMIN" }),
  requireStaffRole: async () => ({ id: "staff-1", role: "ADMIN" }),
}));
vi.mock("@/modules/content/events/service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/modules/content/events/service")>()),
  setRepeatPublish: (...args: unknown[]) => setRepeatPublish(...args),
}));

const { setRepeatPublishAction } = await import("@/app/[locale]/admin/actions");

async function post(fields: Record<string, string>): Promise<string> {
  const form = new FormData();
  for (const [name, value] of Object.entries(fields)) form.set(name, value);
  // `useActionState`'s two arguments since §384: the previous state, then the form.
  await expect(setRepeatPublishAction(null, form)).rejects.toThrow("NEXT_REDIRECT");
  return redirected.at(-1) as string;
}

beforeEach(() => {
  setRepeatPublish.mockClear();
  redirected.length = 0;
});

describe("§351 setRepeatPublishAction from the list's draft line", () => {
  it("switches the posted event — the line posts the series' source — on, and returns to the list with its banner", async () => {
    const to = await post({ uiLocale: "ro", eventId: "source-id", publish: "on", returnTo: "list" });
    expect(setRepeatPublish).toHaveBeenCalledTimes(1);
    expect(setRepeatPublish.mock.calls[0][1]).toMatchObject({ eventId: "source-id", publish: true, actor: { id: "staff-1" } });
    expect(to).toBe("/ro/admin?saved=repeatPublishOn#admin-alert");
  });

  it("returns to the English list for an English backoffice", async () => {
    expect(await post({ uiLocale: "en", eventId: "source-id", publish: "on", returnTo: "list" })).toBe("/en/admin?saved=repeatPublishOn#admin-alert");
  });

  it("still lands on the editor from the Recurență box, which posts no returnTo", async () => {
    const to = await post({ uiLocale: "ro", eventId: "date-id", publish: "on" });
    expect(to).toBe("/ro/admin/events/date-id?saved=repeatPublishOn#admin-alert");
  });

  it("never follows an address posted as returnTo — anything but the word 'list' is the editor", async () => {
    for (const returnTo of ["https://evil.example/", "//evil.example", "/ro/admin", "LIST", "list "]) {
      const to = await post({ uiLocale: "ro", eventId: "date-id", publish: "on", returnTo });
      expect(to, returnTo).toBe("/ro/admin/events/date-id?saved=repeatPublishOn#admin-alert");
    }
  });

  it("brings a refusal back to the list it came from, as the list's error banner", async () => {
    const { DomainError } = await import("@/shared/errors/domain-error");
    setRepeatPublish.mockRejectedValueOnce(new DomainError("FORBIDDEN", "role may not publish"));
    expect(await post({ uiLocale: "ro", eventId: "source-id", publish: "on", returnTo: "list" })).toBe("/ro/admin?error=FORBIDDEN#admin-alert");
  });
});
