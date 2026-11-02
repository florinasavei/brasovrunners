import { describe, expect, it, vi } from "vitest";
import { utcMonth } from "@/modules/diagnostics/domain/month-costs";
import { type MonthCostInputs, type MonthCostReaders, readMonthCosts } from "@/modules/diagnostics/month-costs-read";
import { DOMAIN_PRICE_USD_PER_YEAR } from "@/modules/diagnostics/platform-plans";
import { VERCEL_HOBBY_ACTIVE_CPU_HOURS_PER_MONTH } from "@/modules/diagnostics/vercel";
import { translationCredit } from "@/modules/translate/domain/credit";

/**
 * BR-REQ-090-07 criterion 19 (§479) — how Costuri puts «Luna aceasta» together from what each
 * provider answered: a fake for every reader, and each one failing in turn, so the mapping the page
 * relies on (the typed plan's unknown price, Neon's reason carried through, a Vercel refusal, an
 * outbox or audit query that throws) is held here rather than trusted to a page no test renders.
 */
const NOW = new Date("2026-10-11T00:00:00.000Z");
const OCTOBER = utcMonth(NOW);
const GB = 1024 * 1024 * 1024;

const USAGE = (activeCpuHours: number | null, activeCpuUnit: string | null = null) => ({
  ok: true as const,
  usage: {
    lines: [],
    usageUsd: 0,
    subscriptionUsd: 0,
    buildsByProject: [],
    activeCpuHours,
    activeCpuUnit,
    periodStart: new Date("2026-10-01T00:00:00.000Z"),
    periodEnd: new Date("2026-10-11T00:00:00.000Z"),
  },
});

function inputs(patch: Partial<MonthCostInputs> = {}): MonthCostInputs {
  return {
    now: NOW,
    neonPlan: "LAUNCH",
    neon: { ok: true, meter: { usedCuHours: 10, periodStart: OCTOBER.start, periodEnd: OCTOBER.end, quotaCuHours: 100 } },
    databaseBytes: GB,
    mailgun: { planName: "Free", planId: "FREE", usdPerMonth: 0, sentThisMonth: 100, monthlyAllowance: null, dailyAllowance: 100 },
    vercelActiveCpuHoursPerMonth: VERCEL_HOBBY_ACTIVE_CPU_HOURS_PER_MONTH,
    vercelPlan: { plan: "HOBBY", seats: 1 },
    domain: { planName: ".com", usdPerYear: DOMAIN_PRICE_USD_PER_YEAR, expiresOn: "2027-09-16" },
    ...patch,
  };
}

function readers(patch: Partial<MonthCostReaders> = {}): MonthCostReaders {
  return {
    vercelMonth: vi.fn(async () => ({ ok: true as const, month: { buildMinutes: 42, deployments: 9 } })),
    vercelUsage: vi.fn(async () => USAGE(1.5)),
    charactersSince: vi.fn(async () => 1_000),
    mailgunSentBetween: vi.fn(async () => 321),
    neonPreviousPeriod: vi.fn(async () => ({ ok: true as const, cuHours: 20 })),
    mediaBytes: vi.fn(async () => 3 * GB),
    deeplCredit: vi.fn(async () => ({ ok: false as const, reason: "unconfigured" as const })),
    ...patch,
  };
}

const line = (reading: Awaited<ReturnType<typeof readMonthCosts>>, id: string) => {
  const found = reading.lines.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`no ${id} line`);
  return found;
};

describe("BR-REQ-090-07 «Luna aceasta» assembled from its readers", () => {
  it("asks each reader for the right period and maps every answer onto its line", async () => {
    const fakes = readers();
    const reading = await readMonthCosts(inputs(), fakes);

    expect(fakes.charactersSince).toHaveBeenCalledWith(OCTOBER.start);
    // Last month's outbox: September, first instant to October's first.
    expect(fakes.mailgunSentBetween).toHaveBeenCalledWith(new Date("2026-09-01T00:00:00.000Z"), OCTOBER.start);
    // Neon's history is asked for the period before Neon's own period start.
    expect(fakes.neonPreviousPeriod).toHaveBeenCalledWith(OCTOBER.start);

    // Hobby is read by its Active CPU against the 4 hours, from the very reading /devs shows (§880); the builds only give the deployments.
    expect(line(reading, "vercel")).toMatchObject({ usage: { unit: "cpuHours", used: 1.5, ceiling: 4, ceilingKind: "plan" }, detail: { kind: "deployments", count: 9 } });
    expect(line(reading, "deepl").usage).toMatchObject({ used: 1_000 });
    expect(line(reading, "mailgun").lastMonth).toMatchObject({ usd: 0, usage: 321 });
    expect(line(reading, "neon").lastMonth).toMatchObject({ usage: 20 });
    expect(line(reading, "r2").usage).toMatchObject({ used: 3 });
    expect(reading.totals.incomplete).toBe(false);
    expect(reading.totals.lastMonthMissing).toEqual([]);
    expect(Object.values(reading.reasons.current).every((reason) => reason === null)).toBe(true);
  });

  it("§610 prices the Vercel plan the club states from the one catalogue: Hobby free, Pro the seats' month", async () => {
    expect(line(await readMonthCosts(inputs(), readers()), "vercel")).toMatchObject({ plan: "Hobby", billing: "free", soFarUsd: 0 });
    const pro = await readMonthCosts(inputs({ vercelPlan: { plan: "PRO", seats: 3 } }), readers());
    expect(line(pro, "vercel")).toMatchObject({ plan: "Pro", billing: "monthly", soFarUsd: 60, projectedUsd: 60, plusVat: true });
    expect(line(pro, "vercel").usage).toMatchObject({ unit: "buildMinutes", used: 42, ceiling: null });
  });

  it("a typed Mailgun plan: its price is unknown, never zero, and says why", async () => {
    const reading = await readMonthCosts(
      inputs({ mailgun: { planName: "Custom", planId: "CUSTOM", usdPerMonth: 0, sentThisMonth: 5, monthlyAllowance: null, dailyAllowance: null } }),
      readers(),
    );
    expect(line(reading, "mailgun")).toMatchObject({ soFarUsd: null, projectedUsd: null, lastMonth: { usd: null } });
    expect(reading.reasons.current.mailgun).toBe("typed plan");
    expect(reading.totals).toMatchObject({ incomplete: true, lastMonthUsd: null, lastMonthMissing: ["mailgun"] });
  });

  it("Neon unread: the page's reason is carried through, and its history is not asked", async () => {
    const fakes = readers();
    const reading = await readMonthCosts(inputs({ neon: { ok: false, reason: "HTTP 401" } }), fakes);
    expect(fakes.neonPreviousPeriod).not.toHaveBeenCalled();
    expect(line(reading, "neon")).toMatchObject({ usage: null, soFarUsd: null, severity: "unknown" });
    expect(reading.reasons.current.neon).toBe("HTTP 401");
    expect(reading.reasons.lastMonth.neon).toBe("HTTP 401");
  });

  it("Neon's history refused (a project key): last month is a dash with Neon's answer, this month unaffected", async () => {
    const reading = await readMonthCosts(inputs(), readers({ neonPreviousPeriod: async () => ({ ok: false, reason: "HTTP 403" }) }));
    expect(line(reading, "neon").lastMonth.usd).toBeNull();
    expect(line(reading, "neon").soFarUsd).not.toBeNull();
    expect(reading.reasons.lastMonth.neon).toBe("HTTP 403");
    expect(reading.totals).toMatchObject({ lastMonthUsd: null, lastMonthMissing: ["neon"], incomplete: false });
  });

  it("Neon on Free: an unread history is no missing amount — Free bills nothing", async () => {
    const reading = await readMonthCosts(inputs({ neonPlan: "FREE" }), readers({ neonPreviousPeriod: async () => ({ ok: false, reason: "HTTP 403" }) }));
    expect(reading.reasons.lastMonth.neon).toBeNull();
    expect(reading.totals.lastMonthUsd).not.toBeNull();
  });

  it("Vercel refused or unreachable: the line says why, never zero hours", async () => {
    const refused = await readMonthCosts(inputs(), readers({ vercelUsage: async () => ({ ok: false, reason: "HTTP 403" }) }));
    expect(line(refused, "vercel")).toMatchObject({ usage: null, severity: "unknown" });
    expect(refused.reasons.current.vercel).toBe("HTTP 403");

    const thrown = await readMonthCosts(
      inputs(),
      readers({
        vercelUsage: async () => {
          throw new Error("socket hang up");
        },
      }),
    );
    expect(thrown.reasons.current.vercel).toBe("error");
    // The deployments' list failing takes only the deployments' fact on Hobby: the Active CPU is whole.
    const noList = await readMonthCosts(inputs(), readers({ vercelMonth: async () => ({ ok: false, reason: "HTTP 403" }), vercelUsage: async () => USAGE(0.3) }));
    expect(line(noList, "vercel")).toMatchObject({ usage: { unit: "cpuHours", used: 0.3 }, detail: null, severity: "ok" });
    expect(noList.reasons.current.vercel).toBeNull();
    // Vercel gave the line in a unit that is not an hour: nothing is compared with Hobby's four.
    const odd = await readMonthCosts(inputs(), readers({ vercelUsage: async () => USAGE(null, "GB-Hrs") }));
    expect(line(odd, "vercel")).toMatchObject({ usage: null, severity: "unknown" });
    expect(odd.reasons.current.vercel).toBe("unit GB-Hrs");
  });

  it("§880 Pro is read by its builds, and the usage billing is not asked for at all", async () => {
    const fakes = readers({ vercelUsage: vi.fn(async () => ({ ok: false as const, reason: "must not be asked" })) });
    const pro = await readMonthCosts(inputs({ vercelPlan: { plan: "PRO", seats: 1 } }), fakes);
    expect(fakes.vercelUsage).not.toHaveBeenCalled();
    expect(line(pro, "vercel").usage).toMatchObject({ unit: "buildMinutes", used: 42, ceiling: null });
    expect(pro.reasons.current.vercel).toBeNull();
  });

  it("§497: maps DeepL's credit onto its line, and a refusal onto its reason — never a green line for a key nobody could read", async () => {
    const read = await readMonthCosts(inputs(), readers({ deeplCredit: async () => ({ ok: true, credit: translationCredit({ used: 800_000, limit: 1_000_000 }) }) }));
    expect(line(read, "deepl")).toMatchObject({ severity: "watch", detail: { kind: "credit", remaining: 200_000, level: "watch" } });
    expect(read.reasons.deeplCredit).toBeNull();

    const refused = await readMonthCosts(inputs(), readers({ deeplCredit: async () => ({ ok: false, reason: "refused" }) }));
    expect(line(refused, "deepl")).toMatchObject({ severity: "unknown", detail: null });
    expect(refused.reasons.deeplCredit).toBe("refused");

    const off = await readMonthCosts(inputs(), readers());
    expect(line(off, "deepl")).toMatchObject({ severity: "ok", detail: null });
    expect(off.reasons.deeplCredit).toBe("unconfigured");

    const thrown = await readMonthCosts(inputs(), readers({ deeplCredit: async () => { throw new Error("boom"); } }));
    expect(line(thrown, "deepl").severity).toBe("unknown");
    expect(thrown.reasons.deeplCredit).toBe("unavailable");
  });

  it("the outbox or the audit trail throwing takes only its own figure", async () => {
    const boom = async () => {
      throw new Error("connection terminated");
    };
    const reading = await readMonthCosts(inputs(), readers({ mailgunSentBetween: boom, charactersSince: boom, mediaBytes: boom }));
    // Mailgun's price is still known, only last month's count is not.
    expect(line(reading, "mailgun").lastMonth).toMatchObject({ usd: 0, usage: null });
    expect(reading.reasons.lastMonth.mailgun).toBe("error");
    expect(line(reading, "deepl")).toMatchObject({ usage: null, severity: "unknown" });
    expect(reading.reasons.current.deepl).toBe("error");
    expect(line(reading, "r2")).toMatchObject({ usage: null, soFarUsd: null, severity: "unknown" });
    expect(reading.reasons.current.r2).toBe("error");
    // The other lines are whole.
    expect(line(reading, "vercel").usage).toMatchObject({ used: 1.5 });
  });
});
