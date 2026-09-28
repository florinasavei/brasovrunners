import type { ReactElement, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * §513 — the screen after the registration form says the wait the club's delivery timing makes:
 * "within a minute" only when the request itself sends, and the scheduled round's own wait — the
 * one `cachedEmailWaitMinutes` computes — in words otherwise (§224: not knowing the wait is what
 * makes somebody fill the form in again).
 */
const wait = vi.hoisted(() => ({ minutes: 15 as number | null, leavesAt: new Date("2026-09-28T10:15:00.000Z") as Date | null }));

vi.mock("next-intl/server", async () => {
  const { createTranslator } = await import("next-intl");
  const messages = (await import("../../../messages/ro.json")).default;
  return {
    getLocale: async () => "ro",
    getTranslations: async (namespace: string) => createTranslator({ locale: "ro", messages, namespace: namespace as "Registration" }),
  };
});
vi.mock("@/i18n/navigation", async () => {
  const { createElement } = await import("react");
  return {
    Link: ({ href, children }: { href: unknown; children: ReactNode }) => createElement("a", { href: typeof href === "string" ? href : "#" }, children),
  };
});
vi.mock("@/modules/public-cache/reads", () => ({
  cachedDeadlines: async () => ({ confirmationHours: 48 }),
  cachedEmailWaitMinutes: async () => wait.minutes,
  cachedEmailLeavesAt: async () => wait.leavesAt,
}));

const { default: CheckYourEmail } = await import("@/modules/registrations/ui/CheckYourEmail");

async function render(offer?: ReactNode): Promise<string> {
  const element = (await CheckYourEmail({
    eventTitle: "Crosul Tâmpei",
    whenLabel: "sâmbătă, 21 noiembrie 2026, la 10:00",
    eventHref: "/ro/evenimente/crosul-tampei",
    slug: "crosul-tampei",
    facts: null,
    window: null,
    offer,
  })) as ReactElement;
  return renderToStaticMarkup(element).replace(/<style[^>]*>[\s\S]*?<\/style>/g, "");
}

describe("§513 the screen after the form says the scheduled round's wait", () => {
  beforeEach(() => {
    wait.minutes = 15;
    wait.leavesAt = new Date("2026-09-28T10:15:00.000Z");
  });

  it("says fifteen minutes by day on the scheduled round", async () => {
    const html = await render();
    expect(html).toContain("Emailurile pleacă la trecerea programată a platformei, așa că ajunge în cel mult 15 minute.");
    expect(html).not.toContain("De obicei ajunge într-un minut");
  });

  it("says an hour at night, or whatever the interval makes it", async () => {
    wait.minutes = 60;
    expect(await render()).toContain("ajunge în cel mult o oră.");
    wait.minutes = 120;
    expect(await render()).toContain("ajunge în cel mult 2 ore.");
  });

  it("keeps the minute when the request itself sends", async () => {
    wait.minutes = null;
    const html = await render();
    expect(html).toContain("De obicei ajunge într-un minut, cel târziu în cinci.");
    expect(html).not.toContain("trecerea programată");
  });
});

/**
 * §NNN (the owner, 2026-09-28: «sa inteleg ca nu primesc mailu daca nu apas pe „Nu, gata, trimite
 * mailul”?») — the screen says when the email leaves, in bold, before it asks anything: nothing on it
 * has to be pressed for the email to leave.
 */
describe("§NNN the screen after the form says when the email leaves, above the question", () => {
  beforeEach(() => {
    wait.minutes = 15;
    wait.leavesAt = new Date("2026-09-28T10:15:00.000Z");
  });

  it("names the next scheduled pass on the club's clock, before the question", async () => {
    const { createElement } = await import("react");
    const html = await render(createElement("section", { "data-testid": "offer" }, "Mai înscrii pe cineva cu aceeași adresă?"));
    expect(html).toContain("Emailul pleacă la 13:15 (următoarea trecere programată).");
    expect(html.indexOf("Emailul pleacă la 13:15")).toBeLessThan(html.indexOf('data-testid="offer"'));
  });

  it("says it leaves now when the request itself sends", async () => {
    wait.minutes = null;
    wait.leavesAt = null;
    const html = await render();
    expect(html).toContain("Emailul pleacă acum.");
    expect(html).not.toContain("următoarea trecere programată");
  });
});
