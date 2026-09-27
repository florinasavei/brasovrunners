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
    // The confirmation's words (`confirmWords`, §384) count in the page's language.
    getLocale: async () => "ro",
  };
});
vi.mock("@/app/[locale]/admin/settings/costs/actions", () => ({ updateNeonLimitsAction: async () => null }));

const { default: NeonLimitsPanel, moneySentence } = await import("@/modules/diagnostics/ui/NeonLimitsPanel");

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
    // No file name or §-number on a screen (§NNN): where the variables go is the «?».
    expect(text(html)).not.toMatch(/SETUP\.md|§/);
    expect(html).toContain("proiectul Vercel al mediului");
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

  it("shows what Neon holds in words above the form, and the limit as the owner asked for it (§NNN)", async () => {
    const html = await render({ locale: "ro", reading: { ok: true, limits: LIMITS }, appEnv: "qa", mayEdit: true });
    const words = text(html);
    expect(words).toContain("Mărimea maximă: 1 CU (≈ 4 GB RAM) · Limită lunară: fără");
    expect(words).toContain("12,3 ore-CU consumate, 40 ore trează");
    expect(words).toContain("1 oct. 2026");
    // The form: six ceilings on Launch, each with its worst hour and month; the current one chosen, no limit chosen.
    expect(html).toContain("<form");
    expect(html.match(/<option value="(0\.25|0\.5|1|2|4|8)"/g)).toHaveLength(12);
    expect(html).toMatch(/<option value="1" selected="">/);
    expect(words).toContain("cel mult 0,106 $/oră, 76,32 $/lună");
    expect(html).toMatch(/<option value="none" selected="">/);
    // The limit: the label, «Fără limită / Cu limită», the box and ONE sentence with QA's own figure.
    expect(words).toContain("Limită lunară (ore-CU)");
    expect(html).toMatch(/<option value="none"[^>]*>Fără limită<\/option>/);
    expect(html).toMatch(/<option value="limit"[^>]*>Cu limită<\/option>/);
    expect(words).toContain("Când se atinge, Neon oprește baza până la începutul perioadei următoare. Recomandat: 30.");
    // The smallest limit is the «?», not a line; the old paragraphs are gone.
    expect(html).toContain("Cel puțin 17,4: cele 12,3 ore-CU consumate deja, plus o marjă.");
    for (const gone of ["neon-limits-warning", "neon-limits-recommendation", "neon-limits-floor", "neon-limits-price", "neon-limits-quota-active"]) {
      expect(html).not.toContain(`data-testid="${gone}"`);
    }
    expect(words).not.toContain("SUSPENDĂ");
    // QA: no confirmation box — that guard is production's.
    expect(html).not.toContain('name="confirmSuspension"');
  });

  it("on production, recommends production's figure and carries the confirmation box as a guard", async () => {
    const html = await render({ locale: "ro", reading: { ok: true, limits: { ...LIMITS, quotaCuHours: 50 } }, appEnv: "production", mayEdit: true });
    const words = text(html);
    expect(words).toContain("Recomandat: 100.");
    // Setting, changing and removing production's limit all ask for the one box (§327: never left uncapped by a click).
    expect(html).toContain('name="confirmSuspension"');
    expect(words).toContain("Înțeleg că baza se oprește când limita e atinsă.");
    // A limit in force is said above the form, and chosen in it.
    expect(words).toContain("Limită lunară: 50 ore-CU pe perioadă");
    // The period's end with its weekday, in the club's zone, inside the sentence (§350 weekday
    // on every date): 1 October at midnight UTC is Thursday morning in Bucharest.
    expect(words).toContain("perioada se încheie joi, 1 oct. 2026");
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
    expect(free.match(/<option value="(0\.25|0\.5|1|2|4|8)"/g)).toHaveLength(8);
    expect(text(free)).toContain("Planul contului permite cel mult 2 CU");

    const odd = await render({ locale: "ro", reading: { ok: true, limits: { ...LIMITS, computes: [{ id: "ep-rw-main", minCu: 0.25, maxCu: 3 }] } }, appEnv: "qa", mayEdit: true });
    expect(odd).toMatch(/<option value="" selected="">/);
  });

  it("is read-only below the Superadministrator (§450)", async () => {
    const html = await render({ locale: "ro", reading: { ok: true, limits: LIMITS }, appEnv: "qa", mayEdit: false });
    expect(html).not.toContain("<form");
    expect(text(html)).toContain("Limitele le schimbă Superadministratorul");
  });
});

describe("§479 the compute's floor and scale to zero, and the money the confirmation names", () => {
  it("offers the floor and scale to zero beside the ceiling, with what Neon holds now", async () => {
    const html = await render({ locale: "ro", reading: { ok: true, limits: LIMITS }, appEnv: "qa", mayEdit: true });
    expect(html).toContain('name="minCu"');
    expect(html).toContain('name="suspendMode"');
    expect(html).toContain('value="never"');
    expect(text(html)).toContain("Mărimea minimă: 0,25 CU · Oprirea când nu e folosită: după 5 minute fără cereri (implicit la Neon)");
  });

  it("on Free, offers no «never»: Neon keeps its five minutes there", async () => {
    const html = await render({ locale: "ro", reading: { ok: true, limits: { ...LIMITS, reportedPlan: "FREE" } }, appEnv: "qa", mayEdit: true });
    expect(html).toContain('name="suspendMode"');
    expect(html).not.toContain('value="never"');
  });

  it("reads an always-on compute as such", async () => {
    const limits = { ...LIMITS, computes: [{ id: "ep-rw-main", minCu: 0.5, maxCu: 1, suspendTimeoutSeconds: -1 }] };
    const html = await render({ locale: "ro", reading: { ok: true, limits }, appEnv: "qa", mayEdit: true });
    expect(text(html)).toContain("Mărimea minimă: 0,5 CU · Oprirea când nu e folosită: niciodată — baza e mereu pornită");
  });

  it("names the month's money for the chosen settings, in the owner's words, on Launch", async () => {
    const { createFormatter, createTranslator } = await import("next-intl");
    const messages = (await import("../../../messages/ro.json")).default;
    const translator = createTranslator({ locale: "ro", messages, namespace: "Admin" });
    const t = (key: string, values?: Record<string, string>) => translator(key as "tasks.neonLimits.save", values);
    const format = createFormatter({ locale: "ro" });
    const numbers = { number: (value: number, options?: { minimumFractionDigits?: number; maximumFractionDigits?: number }) => format.number(value, options) };
    const now = { minCu: 0.25, maxCu: 1, suspendMode: "auto" as const };

    // 0.5 CU more at the ceiling: 0.5 × 0.106 × 720 = 38.16 USD a month at 100 % utilisation.
    expect(moneySentence(t, numbers, now, { ...now, maxCu: 1.5 }, "LAUNCH")).toBe("0,5 CU în plus la mărimea maximă ≈ 38,16 USD în plus pe lună la 100 % utilizare.");
    expect(moneySentence(t, numbers, now, { ...now, maxCu: 0.5 }, "LAUNCH")).toBe("0,5 CU mai puțin la mărimea maximă ≈ 38,16 USD mai puțin pe lună la 100 % utilizare.");
    expect(moneySentence(t, numbers, now, { ...now, minCu: 0.5 }, "LAUNCH")).toBe("0,25 CU în plus la mărimea minimă ≈ 19,08 USD în plus pe lună la 100 % utilizare.");
    // Always on bills the floor every hour: 0.25 × 0.106 × 720 = 19.08.
    expect(moneySentence(t, numbers, now, { ...now, suspendMode: "never" }, "LAUNCH")).toBe(
      "Fără oprire, baza nu mai doarme: cel puțin 19,08 USD pe lună la mărimea minimă de 0,25 CU, chiar fără niciun vizitator.",
    );
    expect(moneySentence(t, numbers, { ...now, suspendMode: "never" }, now, "LAUNCH")).toBe(
      "Cu oprirea înapoi, o lună fără vizitatori nu mai costă cei 19,08 USD ai bazei mereu pornite.",
    );
    expect(moneySentence(t, numbers, now, now, "LAUNCH")).toBe("Costul lunii nu se schimbă.");
  });

  it("says a change costs nothing on Free until the included hours are spent, and prices an unknown plan at Launch", async () => {
    const { createFormatter, createTranslator } = await import("next-intl");
    const messages = (await import("../../../messages/ro.json")).default;
    const translator = createTranslator({ locale: "ro", messages, namespace: "Admin" });
    const t = (key: string, values?: Record<string, string>) => translator(key as "tasks.neonLimits.save", values);
    const format = createFormatter({ locale: "ro" });
    const numbers = { number: (value: number, options?: { minimumFractionDigits?: number; maximumFractionDigits?: number }) => format.number(value, options) };
    const now = { minCu: 0.25, maxCu: 1, suspendMode: "auto" as const };
    const free = "Pe planul Free schimbarea nu costă nimic până se consumă cele 100 ore-CU ale lunii, apoi Neon oprește baza; o mărime mai mare le consumă mai repede.";

    // Free: no USD figure at all, whatever the change.
    expect(moneySentence(t, numbers, now, { ...now, maxCu: 2 }, "FREE")).toBe(free);
    expect(moneySentence(t, numbers, now, { ...now, minCu: 0.5 }, "FREE")).toBe(free);
    expect(moneySentence(t, numbers, now, now, "FREE")).toBe("Costul lunii nu se schimbă.");
    // Unknown plan: Launch's rate, the one plan that bills.
    expect(moneySentence(t, numbers, now, { ...now, maxCu: 1.5 }, null)).toBe(moneySentence(t, numbers, now, { ...now, maxCu: 1.5 }, "LAUNCH"));
  });

  it("prices the dialog at the plan Neon reports", async () => {
    // The dialogs open on the client; their bodies are the form's `confirm` prop in the tree the card returns.
    const bodies = async (limits: NeonLimitsReading): Promise<string> => {
      const found: string[] = [];
      const walk = (node: unknown): void => {
        if (Array.isArray(node)) return node.forEach(walk);
        if (!node || typeof node !== "object" || !("props" in node)) return;
        const props = (node as { props: Record<string, unknown> }).props;
        if (Array.isArray(props.confirm)) for (const spec of props.confirm as Array<{ body: string }>) found.push(spec.body);
        walk(props.children);
      };
      walk(await NeonLimitsPanel({ locale: "ro", reading: { ok: true, limits }, appEnv: "qa", mayEdit: true }));
      return found.join("\n");
    };
    const launch = await bodies(LIMITS);
    expect(launch).toContain("USD în plus pe lună la 100 % utilizare");
    // The owner's confirm sentence (§NNN), the number filled from the box at the press.
    expect(launch).toContain("Limita nouă: {quotaCuHours} ore-CU.");
    expect(launch).toContain("Fără limită lunară.");
    expect(launch).not.toContain("Pe planul Free");
    const onFree = await bodies({ ...LIMITS, reportedPlan: "FREE" });
    expect(onFree).toContain("Pe planul Free schimbarea nu costă nimic");
    expect(onFree).not.toContain("USD în plus pe lună");
  });
});
