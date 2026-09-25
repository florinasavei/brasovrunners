import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { NeonLimitsReading } from "@/modules/diagnostics/domain/neon-limits";

/**
 * BR-REQ-090-07 criteria 8 and 9 (§335) — the card's three states, rendered to HTML on the server
 * the way the page sends them: no key (what is missing, no form), a read that failed (a sentence,
 * no form), and the values Neon holds above the form that changes them.
 *
 * The catalogue is the real Romanian one, through next-intl's own translator; the Server Action
 * is a stub, because the card only hands it to the form and a test must not reach a database or
 * Neon through it.
 */
vi.mock("next-intl/server", async () => {
  const { createFormatter, createTranslator } = await import("next-intl");
  const messages = (await import("../../../messages/ro.json")).default;
  return {
    getTranslations: async (namespace: string) => createTranslator({ locale: "ro", messages, namespace: namespace as "Admin" }),
    getFormatter: async () => createFormatter({ locale: "ro" }),
    // The confirmation's words (`confirmWords`, §NNN) count in the page's language.
    getLocale: async () => "ro",
  };
});
vi.mock("@/app/[locale]/admin/tasks/actions", () => ({ updateNeonLimitsAction: async () => null }));

const { default: NeonLimitsPanel } = await import("@/modules/diagnostics/ui/NeonLimitsPanel");

const LIMITS: NeonLimitsReading = {
  computes: [{ id: "ep-rw-main", minCu: 0.25, maxCu: 1 }],
  defaults: { minCu: 0.25, maxCu: 1 },
  quotaCuHours: null,
  usedCuHours: 12.34,
  activeHours: 40,
  periodEnd: new Date("2026-10-01T00:00:00Z"),
  reportedPlan: "LAUNCH",
};

async function render(props: Parameters<typeof NeonLimitsPanel>[0]): Promise<string> {
  return renderToStaticMarkup((await NeonLimitsPanel(props)) as ReactElement);
}

/** The visible words, without the markup and the spacing MUI puts between them. */
function text(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ");
}

describe("BR-REQ-090-07 the database's limits card", () => {
  it("without a key, says which variables are missing and shows no form", async () => {
    const html = await render({
      locale: "ro",
      reading: { ok: false, failure: { kind: "unconfigured", missing: ["NEON_API_KEY", "NEON_PROJECT_ID"] } },
      appEnv: "qa",
      mayEdit: true,
    });
    expect(html).toContain('data-testid="neon-limits-unconfigured"');
    expect(text(html)).toContain("Lipsește NEON_API_KEY, NEON_PROJECT_ID pe acest mediu");
    expect(text(html)).toContain("SETUP.md §33");
    expect(html).not.toContain("<form");
    expect(html).not.toContain('name="maxCu"');
  });

  it("when Neon did not answer, says so in a sentence and shows no form", async () => {
    const timeout = await render({ locale: "ro", reading: { ok: false, failure: { kind: "timeout" } }, appEnv: "qa", mayEdit: true });
    expect(timeout).toContain('data-testid="neon-limits-failed"');
    expect(text(timeout)).toContain("Neon nu a răspuns în 5 secunde");
    expect(timeout).not.toContain("<form");

    const forbidden = await render({ locale: "ro", reading: { ok: false, failure: { kind: "forbidden", status: 403 } }, appEnv: "qa", mayEdit: true });
    expect(text(forbidden)).toContain("HTTP 403");
    // Which key would do, in the card itself: no hostname, no secret, the console's own words.
    expect(text(forbidden)).toContain("Project-scoped");
  });

  it("shows what Neon holds in words, with the worst hour at Launch's rate, above the form", async () => {
    const html = await render({ locale: "ro", reading: { ok: true, limits: LIMITS }, appEnv: "qa", mayEdit: true });
    const words = text(html);
    expect(words).toContain("Mărimea maximă: 1 CU (≈ 4 GB RAM) · Limită lunară: fără");
    expect(words).toContain("La tariful Launch (0,106 $/oră-CU), la mărimea maximă: cel mult 0,106 $ pe oră");
    expect(words).toContain("76,32 $ pe lună");
    expect(words).toContain("12,3 ore-CU consumate, 40 ore trează");
    expect(words).toContain("1 oct. 2026");
    // The form: six ceilings on Launch, the current one chosen, no limit chosen, the floor stated.
    expect(html).toContain("<form");
    expect(html.match(/<option value="(0\.25|0\.5|1|2|4|8)"/g)).toHaveLength(6);
    expect(html).toMatch(/<option value="1" selected="">/);
    expect(html).toMatch(/<option value="none" selected="">/);
    expect(words).toContain("O limită nouă trebuie să fie de cel puțin 17,4 ore-CU (consumul plus 5 de marjă)");
    // The warning is on the page, not folded, and says the site stops.
    expect(html).toContain('data-testid="neon-limits-warning"');
    expect(words).toContain("Neon SUSPENDĂ baza de date");
    // QA: the recommendation is a limit with room, QA's own figure (SETUP.md §40), and no
    // confirmation box — that guard is production's.
    expect(html).toContain('data-testid="neon-limits-recommendation"');
    expect(words).toContain("Recomandat: o limită lunară cu rezervă — 30 ore-CU pe acest mediu");
    expect(words).toContain("notificarea de cheltuieli de pe pagina Billing din Neon");
    expect(words).not.toContain("Pe producție, o limită nouă, schimbată sau scoasă cere bifa");
    expect(html).not.toContain('name="confirmSuspension"');
  });

  it("on production, recommends a limit with room, never none, and carries the confirmation box as a guard", async () => {
    const html = await render({ locale: "ro", reading: { ok: true, limits: { ...LIMITS, quotaCuHours: 50 } }, appEnv: "production", mayEdit: true });
    const words = text(html);
    // The owner capped production (2026-09-23): the advice is production's own 100 CU-hours plus
    // Neon's spending notification, and nothing on the card advises against a limit.
    expect(words).toContain("Recomandat: o limită lunară cu rezervă — 100 ore-CU pe acest mediu");
    // Setting, changing and removing production's limit all ask for the one box (§327: never left uncapped by a click).
    expect(words).toContain("Pe producție, o limită nouă, schimbată sau scoasă cere bifa de confirmare de mai jos");
    expect(words).toContain("„Fără limită” lasă producția fără niciun plafon de cheltuieli");
    expect(words).not.toContain("fără limită pe producție");
    expect(html).toContain('name="confirmSuspension"');
    // A limit in force is said above the form, and chosen in it.
    expect(words).toContain("Limită lunară: 50 ore-CU pe perioadă");
    // The period's end with its weekday, in the club's zone, inside the sentence (§350 weekday
    // on every date): 1 October at midnight UTC is Thursday morning in Bucharest.
    expect(words).toContain("perioada se încheie pe joi, 1 oct. 2026");
    expect(html).toContain('data-testid="neon-limits-quota-active"');
    expect(html).toMatch(/<option value="limit" selected="">/);
    expect(html).toMatch(/name="quotaCuHours"[^>]*value="50"|value="50"[^>]*name="quotaCuHours"/);
  });

  it("fills the quota box to the second Neon holds, so a save that only changes the size leaves the limit alone", async () => {
    // 100000 seconds is 27.777… CU-hours: a box rounded to a tenth would post 27.8, which is
    // 100080 seconds — a quota rewritten by a save that never touched it.
    const html = await render({ locale: "ro", reading: { ok: true, limits: { ...LIMITS, quotaCuHours: 100_000 / 3600 } }, appEnv: "qa", mayEdit: true });
    expect(html).toMatch(/name="quotaCuHours"[^>]*value="27.7778"|value="27.7778"[^>]*name="quotaCuHours"/);
  });

  it("on Free, offers no ceiling above the plan's, and keeps an unlisted ceiling from being replaced silently", async () => {
    const free = await render({ locale: "ro", reading: { ok: true, limits: { ...LIMITS, reportedPlan: "FREE" } }, appEnv: "qa", mayEdit: true });
    expect(free.match(/<option value="(0\.25|0\.5|1|2|4|8)"/g)).toHaveLength(4);
    expect(text(free)).toContain("Planul contului permite cel mult 2 CU");

    const odd = await render({ locale: "ro", reading: { ok: true, limits: { ...LIMITS, computes: [{ id: "ep-rw-main", minCu: 0.25, maxCu: 3 }] } }, appEnv: "qa", mayEdit: true });
    expect(odd).toMatch(/<option value="" selected="">/);
  });

  it("is read-only below the Administrator", async () => {
    const html = await render({ locale: "ro", reading: { ok: true, limits: LIMITS }, appEnv: "qa", mayEdit: false });
    expect(html).not.toContain("<form");
    expect(text(html)).toContain("Limitele le schimbă Administratorul.");
  });
});
