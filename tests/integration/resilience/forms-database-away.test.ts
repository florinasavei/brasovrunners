import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * §NNN — the public forms when the database is away: Neon refusing on the month's quota, or a
 * compute that cannot start. Each form goes back to itself with what was typed (the sealed draft
 * cookie, §142) and one polite sentence, instead of the error page eating the answers; nothing is
 * registered, signed or sent. A query that is merely wrong is still a bug and still throws.
 *
 * The database is a stand-in whose every method throws the error a case names, as Neon's proxy
 * refuses every query of a suspended project.
 */
const QUOTA = new Error("Your project has exceeded the compute time quota. Upgrade your plan to increase limits.");

const state = vi.hoisted(() => ({ refusal: null as Error | null }));
type SetCookie = { name: string; value: string };
const jar: SetCookie[] = [];

vi.mock("@/db/client", () => ({
  getDb: () =>
    new Proxy(
      {},
      {
        get: () => () => {
          throw state.refusal;
        },
      },
    ),
}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({
    get: () => undefined,
    set: (name: string, value: string) => {
      jar.push({ name, value });
    },
  }),
}));
vi.mock("next-intl/server", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getTranslations: async () => (key: string) => key,
}));
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  redirect: (url: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { redirectTo: url });
  },
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));

const { submitRegistrationAction } = await import("@/app/[locale]/events/[slug]/register/actions");
const { submitContactAction } = await import("@/app/[locale]/contact/actions");
const { signGroupRunDeclarationAction } = await import("@/app/[locale]/events/[slug]/declaration/actions");
const { openFormDraft } = await import("@/modules/registrations/form-draft");

function formOf(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
}

async function redirectOf(press: Promise<void>): Promise<string> {
  const thrown = await press.then(
    () => null,
    (error: unknown) => error,
  );
  const to = (thrown as { redirectTo?: unknown } | null)?.redirectTo;
  if (typeof to !== "string") throw thrown ?? new Error("the action did not redirect");
  return to;
}

function draft(): Record<string, string> | null {
  const sealed = jar.at(-1)?.value;
  return sealed ? openFormDraft(sealed) : null;
}

beforeEach(() => {
  jar.length = 0;
  state.refusal = QUOTA;
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("§NNN the forms while the database is away", () => {
  it("the registration form goes back with its answers and the database-away notice", async () => {
    const to = await redirectOf(submitRegistrationAction(formOf({ locale: "ro", slug: "crosul-de-toamna", firstName: "Ana", lastName: "Pop" })));
    expect(to).toMatch(/\?error=DATABASE_AWAY&fields=databaseAway#registration-errors$/);
    expect(draft()).toMatchObject({ firstName: "Ana", lastName: "Pop" });
  });

  it("carries no family link back — the form has none since the emailed confirmation replaced it", async () => {
    // A stale `another` field (a page drawn before the flow changed) is not put back in the address.
    const to = await redirectOf(submitRegistrationAction(formOf({ locale: "en", slug: "autumn-cross", another: "tok123", firstName: "Ion" })));
    expect(to).toMatch(/\?error=DATABASE_AWAY&fields=databaseAway#registration-errors$/);
    expect(to).not.toContain("another=");
    expect(draft()).toMatchObject({ firstName: "Ion" });
  });

  it("an ordinary outage is answered the same way", async () => {
    state.refusal = Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" });
    const to = await redirectOf(submitRegistrationAction(formOf({ locale: "ro", slug: "crosul-de-toamna", firstName: "Ana" })));
    expect(to).toContain("error=DATABASE_AWAY");
  });

  it("a query that is wrong is still a bug, and throws", async () => {
    state.refusal = Object.assign(new Error('column "nope" does not exist'), { code: "42703" });
    await expect(submitRegistrationAction(formOf({ locale: "ro", slug: "crosul-de-toamna" }))).rejects.toThrow(/does not exist/);
  });

  it("the contact form keeps the message and says it did not leave", async () => {
    const to = await redirectOf(submitContactAction(formOf({ locale: "ro", name: "Ana", email: "ana@example.ro", message: "Salut" })));
    expect(to).toMatch(/\?error=UNAVAILABLE#/);
    expect(draft()).toMatchObject({ name: "Ana", message: "Salut" });
  });

  it("the group run's declaration goes back to its page, nothing signed", async () => {
    const to = await redirectOf(signGroupRunDeclarationAction(formOf({ locale: "ro", slug: "alergare-de-grup", eventId: "00000000-0000-4000-8000-000000000001", documentId: "00000000-0000-4000-8000-000000000002", typedName: "Ana Pop" })));
    expect(to).toMatch(/\?away=1$/);
  });
});
