import type { ReactElement, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
  // The emails are on time (§623): the late notice draws nothing.
  cachedEmailDelay: async () => null,
  cachedDeadlines: async () => ({ confirmationHours: 48, familySittingMinutes: 10 }),
  cachedEmailWaitMinutes: async () => wait.minutes,
  cachedEmailLeavesAt: async () => wait.leavesAt,
}));

const { default: CheckYourEmail } = await import("@/modules/registrations/ui/CheckYourEmail");

type Offer = { atOnce: boolean; email: string; windowMinutes?: number; leavesAt?: Date | null; submittedAt?: Date; continueAction: (form: FormData) => Promise<void> };

async function render(offer?: Offer, firstName: string | null = null): Promise<string> {
  const element = (await CheckYourEmail({
    eventTitle: "Crosul Tâmpei",
    whenLabel: "sâmbătă, 21 noiembrie 2026, la 10:00",
    eventHref: "/ro/evenimente/crosul-tampei",
    slug: "crosul-tampei",
    facts: firstName ? { email: "familia.pop@example.ro", firstName } : null,
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
    expect(html).toContain("Ajunge în cel mult 15 minute.");
    expect(html).not.toContain("cinci minute");
  });

  it("says an hour at night, or whatever the interval makes it", async () => {
    wait.minutes = 60;
    expect(await render()).toContain("Ajunge în cel mult o oră.");
    wait.minutes = 120;
    expect(await render()).toContain("Ajunge în cel mult 2 ore.");
  });

  it("keeps the minute when the request itself sends", async () => {
    wait.minutes = null;
    const html = await render();
    expect(html).toContain("Ajunge în cel mult cinci minute.");
    expect(html).not.toContain("trecerea programată");
  });
});

/**
 * §536 (the owner, 2026-09-28: «sa inteleg ca nu primesc mailu daca nu apas pe „Nu, gata, trimite
 * mailul”?», then: the screen must be clearer; the review's nits F0 and F2) — after the first form the
 * screen is the short one: the heading, whose form is in, when its email leaves, the one question with
 * its button, and one true sentence under it. No steps, no wait box: the time is said once.
 */
describe("§536 the short screen after the first form", () => {
  const offer: Offer = { atOnce: false, email: "familia.pop@example.ro", windowMinutes: 15, continueAction: async () => {} };

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-28T10:00:00.000Z"));
    wait.minutes = 15;
    wait.leavesAt = new Date("2026-09-28T10:15:00.000Z");
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("says the form is in and when the email leaves on the club's clock, then the question, and nothing else", async () => {
    const html = await render(offer, "Ana");
    // The name once (the review of 2026-09-28): the plain heading, then whose form is in.
    expect(html).toContain("Aproape gata!");
    expect(html).not.toContain("Aproape gata, Ana!");
    expect(html).toContain("Formularul pentru Ana a ajuns.");
    expect(html).toContain("Emailul către familia.pop@example.ro pleacă la 13:15.");
    expect(html.indexOf("Emailul către familia.pop@example.ro pleacă la 13:15.")).toBeLessThan(html.indexOf('data-testid="family-sitting-offer"'));
    // §547: no bold question and no primary button any more — one quiet line after the main content.
    expect(html).not.toContain("Mai înscrii pe cineva cu aceeași adresă?");
    expect(html).toContain("Înscriu încă o persoană cu această adresă");
    expect(html).not.toContain("Da, încă o persoană");
    // While the email still waits, «Da» holds it — at most the club's window — and one email covers everybody.
    expect(html).toContain("Dacă înscrii încă o persoană până la 13:15, emailul îi așteaptă formularul, cel mult 15 minute, și primiți unul singur pentru toți.");
    // Said once, in one shape: no steps, no wait box, no second telling of the time (F2).
    expect(html).not.toContain("Ce urmează");
    expect(html).not.toContain("trecerea programată");
    expect(html).not.toContain("Ajunge în cel mult");
    expect(html).not.toContain("Ți-am trimis un email");
  });

  it("under «imediat» says it leaves now, and the sentence under «Da» does not promise to hold it (F0)", async () => {
    wait.minutes = null;
    wait.leavesAt = null;
    const html = await render(offer);
    expect(html).toContain("Formularul a ajuns.");
    expect(html).toContain("Emailul către familia.pop@example.ro pleacă acum.");
    expect(html).toContain("Dacă înscrii încă o persoană, următorul email așteaptă cel mult 15 minute după ultimul formular și îi cuprinde pe toți.");
    expect(html).not.toContain("emailul așteaptă");
    expect(html).not.toContain("Ajunge în cel mult");
  });

  it("on another day says the weekday-led date with its own «la», never a second one (§452)", async () => {
    wait.leavesAt = new Date("2026-09-29T07:00:00.000Z");
    const html = await render(offer, "Ana");
    expect(html).toContain("Emailul către familia.pop@example.ro pleacă marți, 29 septembrie, la 10:00.");
    expect(html).not.toContain("pleacă la mar");
    expect(html).toContain("Dacă înscrii încă o persoană până marți, 29 septembrie, la 10:00, emailul îi așteaptă formularul");
  });

  it("reads the pass the form stored, never one recomputed at render (the review of 2026-09-28)", async () => {
    // The page recomputing now would name the next pass; the stored one is what the email waits for.
    wait.leavesAt = new Date("2026-09-28T10:30:00.000Z");
    const html = await render({ ...offer, leavesAt: new Date("2026-09-28T10:15:00.000Z") });
    expect(html).toContain("Emailul către familia.pop@example.ro pleacă la 13:15.");
    expect(html).not.toContain("13:30");
  });

  it("after the stored pass says the email left and promises no hold (a reload at 13:16)", async () => {
    vi.setSystemTime(new Date("2026-09-28T10:16:00.000Z"));
    wait.leavesAt = new Date("2026-09-28T10:30:00.000Z");
    const html = await render({ ...offer, leavesAt: new Date("2026-09-28T10:15:00.000Z") }, "Ana");
    expect(html).toContain("Emailul către familia.pop@example.ro a plecat.");
    expect(html).not.toContain("pleacă la");
    expect(html).toContain("Dacă înscrii încă o persoană, următorul email așteaptă cel mult 15 minute după ultimul formular și îi cuprinde pe toți.");
    expect(html).not.toContain("emailul așteaptă formularul următor");
    expect(html).not.toContain("unul singur pentru toți");
  });

  it("under «imediat» says «pleacă acum» on the redirect and «a plecat» on a reload an hour later (§540)", async () => {
    wait.minutes = null;
    wait.leavesAt = null;
    const submittedAt = new Date("2026-09-28T10:00:00.000Z");
    // The redirect from the submit, a few seconds after it.
    vi.setSystemTime(new Date("2026-09-28T10:00:03.000Z"));
    expect(await render({ ...offer, leavesAt: null, submittedAt })).toContain("Emailul către familia.pop@example.ro pleacă acum.");
    // A reload an hour later: the request sent it long ago.
    vi.setSystemTime(new Date("2026-09-28T11:00:00.000Z"));
    const later = await render({ ...offer, leavesAt: null, submittedAt });
    expect(later).toContain("Emailul către familia.pop@example.ro a plecat.");
    expect(later).not.toContain("pleacă acum");
    // A half sealed before the submit instant was kept: the old sentence, never a guess.
    expect(await render({ ...offer, leavesAt: null })).toContain("pleacă acum.");
  });

  it("names the club's current window when the browser's half predates it", async () => {
    const html = await render({ ...offer, windowMinutes: undefined });
    expect(html).toContain("cel mult 10 minute,");
  });

  it("at a window of 0 says each person gets their own email, under either timing", async () => {
    const html = await render({ ...offer, atOnce: true });
    expect(html).toContain("Fiecare persoană primește emailul ei.");
    wait.leavesAt = null;
    expect(await render({ ...offer, atOnce: true })).toContain("Fiecare persoană primește emailul ei.");
  });

  it("keeps the full inbox screen, with the steps and the wait box, wherever no question is asked", async () => {
    const html = await render();
    expect(html).toContain("Ce urmează");
    expect(html).toContain("Ajunge în cel mult 15 minute.");
    expect(html).not.toContain('data-testid="check-email-leaves"');
    expect(html).not.toContain('data-testid="family-sitting-offer"');
  });
});
