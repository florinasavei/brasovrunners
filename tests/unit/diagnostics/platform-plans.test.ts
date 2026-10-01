import { describe, expect, it } from "vitest";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import {
  annualCostToday,
  DOMAIN_PRICE_USD_PER_YEAR,
  freeTierVerdict,
  moneyDecisions,
  monthlyCostToday,
  nextSpend,
  oldestCheckDate,
  OPERATIONAL_LIMITS,
  payingRows,
  perMonth,
  perYear,
  type PlanCost,
  type PlatformFacts,
  platformServices,
  PRICE_AGEING_AFTER_DAYS,
  PRICE_STALE_AFTER_DAYS,
  priceFreshness,
  registrationsLeftToday,
  type ServiceRow,
} from "@/modules/diagnostics/platform-plans";
import { VERCEL_PLANS } from "@/modules/diagnostics/domain/vercel-plan";
import {
  MAILGUN_FREE_DAILY_MESSAGES,
  MESSAGES_PER_COMPLETED_REGISTRATION,
} from "@/modules/notifications/volume";

/**
 * BR-REQ-090-05 — what the club pays, what the free plans refuse, and what the options are.
 *
 * Three kinds of assertion, and the last two matter more than the first. The first is
 * arithmetic: how many more people can register today, and what a year costs. The second is
 * *honesty* — every price is a quotation with its own date, a ceiling nothing measures says so
 * rather than rendering healthy, and the verdict cannot come back cheerful while an event
 * charges entry. The third is that a reader is never shown an untranslated key, in either
 * language, for a row this deployment can actually produce.
 */
const BASE: PlatformFacts = {
  emailAllowance: MAILGUN_FREE_DAILY_MESSAGES,
  emailSentToday: 0,
  messagesPerRegistration: MESSAGES_PER_COMPLETED_REGISTRATION,
  hasPaidEvent: false,
  clubDomainBound: false,
  jobsHealthy: true,
};

const LOCALES = [
  ["ro", ro],
  ["en", en],
] as const;

/** The `Admin.tasks` subtree, as a bag of strings — the catalogues are typed per key. */
function tasksMessages(messages: (typeof ro) | (typeof en)): Record<string, unknown> {
  return messages.Admin.tasks as unknown as Record<string, unknown>;
}

function messageAt(messages: (typeof ro) | (typeof en), path: string): unknown {
  return path
    .split(".")
    .reduce<unknown>(
      (node, key) => (node as Record<string, unknown> | undefined)?.[key],
      tasksMessages(messages),
    );
}

describe("BR-REQ-090-05 criterion 3 how much of today's allowance is left", () => {
  it("does the arithmetic PLATFORM.md states in prose: 100 a day is 16 registrations", () => {
    // Six messages each since the club is told when somebody confirms (§245); five made it 20,
    // and four, before the declaration went out on its own (§95), made it 25.
    expect(registrationsLeftToday(BASE)).toBe(16);
  });

  it("counts down as the day is spent", () => {
    expect(registrationsLeftToday({ ...BASE, emailSentToday: 90 })).toBe(1);
    expect(registrationsLeftToday({ ...BASE, emailSentToday: 99 })).toBe(0);
  });

  it("never goes below zero, however far over the allowance the day went", () => {
    // The provider is the authority on what was actually sent, and it can report more than the
    // allowance. A negative "registrations left" would render as a promise.
    expect(registrationsLeftToday({ ...BASE, emailSentToday: 500 })).toBe(0);
  });

  it("refuses to divide by a zero cost rather than returning Infinity", () => {
    expect(registrationsLeftToday({ ...BASE, messagesPerRegistration: 0 })).toBe(0);
  });
});

describe("BR-REQ-090-05 criterion 1 the free-tier verdict", () => {
  it("says free except the domain when nothing is pressing", () => {
    expect(freeTierVerdict(BASE)).toBe("freeExceptDomain");
  });

  it("says free but at a limit when today's allowance is spent", () => {
    expect(freeTierVerdict({ ...BASE, emailSentToday: 100 })).toBe("freeButAtALimit");
  });

  it("says not free the moment a published event charges entry", () => {
    // Vercel's fair-use terms, not a load question: the deployment is outside them rather than
    // near a cap, so this outranks a spent allowance (criterion 2).
    expect(freeTierVerdict({ ...BASE, hasPaidEvent: true })).toBe("notFree");
    expect(freeTierVerdict({ ...BASE, hasPaidEvent: true, emailSentToday: 100 })).toBe("notFree");
  });
});

describe("BR-REQ-090-05 criterion 1 the money question, answered with a number", () => {
  it("totals the domain in the registry's own currency, on every hostname", () => {
    // Bought on 2026-09-16 (`DECISIONS.md` §55). QA and a laptop are not on the club's domain
    // and the club still pays for it, so the figure does not depend on where this runs.
    for (const facts of [BASE, { ...BASE, clubDomainBound: true }]) {
      expect(annualCostToday(platformServices(facts))).toEqual([
        { currency: "USD", amount: DOMAIN_PRICE_USD_PER_YEAR, plusVat: true, estimated: false },
      ]);
    }
  });

  it("names email as the next spend now that the domain is paid for", () => {
    // `docs/PLATFORM.md`'s own expected order, walked against what the deployment reports
    // rather than restated as prose: the domain is bought, so Mailgun Basic is next.
    expect(nextSpend(platformServices(BASE))?.id).toBe("mailgun");
    expect(nextSpend(platformServices({ ...BASE, clubDomainBound: true }))?.id).toBe("mailgun");
  });

  it("quotes the next step up in the vendor's own units, or not at all", () => {
    // AGENTS.md §1.2. A price is a quotation, never a number this file computed: either it is
    // recorded with a plan name beside it, or the row says there is no next step.
    for (const row of platformServices(BASE)) {
      expect(Boolean(row.nextPlan), `${row.id} plan/price pairing`).toBe(Boolean(row.nextCost));
      if (row.nextCost) expect(row.nextCost, row.id).toMatch(/(\$|EUR)/);
    }
  });

  it("names no next plan for the domain: the .ro is dropped, the next step is renewing the .com (§483)", () => {
    const domain = platformServices(BASE).find((row) => row.id === "domain");
    expect(domain).toMatchObject({ nextPlan: null, nextCost: null });
  });
});

describe("BR-REQ-090-05 criterion 4 how close this deployment is, right now", () => {
  it("measures the email allowance against what this deployment has actually sent", () => {
    const ok = platformServices(BASE).find((row) => row.id === "mailgun");
    const spent = platformServices({ ...BASE, emailSentToday: 100 }).find(
      (row) => row.id === "mailgun",
    );

    expect(ok?.headroom).toEqual({ kind: "measured", used: 0, of: 100, state: "ok" });
    expect(ok?.severity).toBe("ok");
    expect(spent?.headroom).toEqual({ kind: "measured", used: 100, of: 100, state: "reached" });
    expect(spent?.severity).toBe("act");
  });

  it("says the database allowance is not measured rather than letting it read healthy", () => {
    // "We never checked" and "we are fine" must not be the same green tick: nothing here reads
    // Neon's console, so the row is grey and says so.
    const neon = platformServices(BASE).find((row) => row.id === "neon");
    expect(neon?.headroom).toEqual({ kind: "notMeasured" });
    expect(neon?.severity).toBe("unknown");
  });

  it("reads a paid published event as a caution on hosting, not as a breach", () => {
    // `DECISIONS.md` §50: the club can satisfy the rule by wording, so this is "watch", and the
    // page tells the organizer what to check rather than only that something is wrong.
    const calm = platformServices(BASE).find((row) => row.id === "vercel");
    const charging = platformServices({ ...BASE, hasPaidEvent: true }).find(
      (row) => row.id === "vercel",
    );
    expect(calm?.severity).toBe("ok");
    expect(charging?.severity).toBe("watch");
  });

  it("does not shout at the club about the domain or about sign-in, on any hostname", () => {
    // The domain row states which hostname this deployment answers on and nothing is wrong
    // either way; Zitadel's custom login domain is decided against, not pending, so binding the
    // club's domain raises no bill there (`docs/RUNBOOKS.md` § Staff sign-in).
    for (const facts of [BASE, { ...BASE, clubDomainBound: true }]) {
      const rows = platformServices(facts);
      expect(rows.find((row) => row.id === "domain")?.severity).toBe("ok");
      expect(rows.find((row) => row.id === "zitadel")?.severity).toBe("ok");
    }
    expect(
      platformServices({ ...BASE, clubDomainBound: true }).find((row) => row.id === "domain")
        ?.headroom,
    ).toEqual({ kind: "derived", reached: true });
  });

  it("marks the scheduler as something to fix when a job is late", () => {
    const late = platformServices({ ...BASE, jobsHealthy: false });
    expect(late.find((row) => row.id === "scheduler")?.severity).toBe("act");
  });
});

describe("BR-REQ-090-05 criterion 5 no price is invented, and none is undated", () => {
  it("carries a check date on every row, per vendor rather than one shared date", () => {
    // A shared date would have claimed a re-check of six vendors that never happened: the
    // domain price was established two days after the rest.
    for (const row of platformServices(BASE)) {
      expect(row.checkedOn, row.id).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
    expect(oldestCheckDate(platformServices(BASE))).toBe("2026-09-05");
  });

  it("calls a fresh price fresh, an old one old, and an unreadable date the worst case", () => {
    const checked = "2026-09-05";
    const at = (days: number) => new Date(Date.UTC(2026, 8, 5) + days * 86_400_000);

    expect(priceFreshness(checked, at(1)).state).toBe("fresh");
    expect(priceFreshness(checked, at(PRICE_AGEING_AFTER_DAYS)).state).toBe("ageing");
    expect(priceFreshness(checked, at(PRICE_STALE_AFTER_DAYS)).state).toBe("stale");
    // The safe direction for a price is always older, never "we could not tell, so it is fine".
    expect(priceFreshness("not a date", at(1)).state).toBe("stale");
  });

  it("counts the days it claims, so the page states an age rather than a date alone", () => {
    expect(priceFreshness("2026-09-05", new Date("2026-09-15T00:00:00Z")).days).toBe(10);
  });
});

describe("BR-REQ-090-05 a decision is a question, not a grey fact among facts", () => {
  it("lists only questions that can still be open — nothing settled for good", () => {
    // The registrar and currency questions were answered and stayed on the page as "answered"
    // lines to scroll past; today's list carries only what somebody still owes (§61).
    const ids = moneyDecisions(BASE).map((decision) => decision.id);
    expect(ids).toEqual(["entryContribution", "mailgunBeforeRace"]);
  });

  it("treats a paid event as reopening the question the owner already answered", () => {
    // `DECISIONS.md` §50 records "the club sells nothing". A published PAID event contradicts
    // that, and a contradiction is a question for the club rather than a silent override.
    const settled = moneyDecisions(BASE).find((d) => d.id === "entryContribution");
    const contradicted = moneyDecisions({ ...BASE, hasPaidEvent: true }).find(
      (d) => d.id === "entryContribution",
    );
    expect(settled?.state).toBe("answered");
    expect(contradicted?.state).toBe("open");
  });

  it("keeps at least one question open for the club to answer before a race", () => {
    const open = moneyDecisions(BASE).filter((decision) => decision.state === "open");
    expect(open.map((decision) => decision.id)).toContain("mailgunBeforeRace");
  });
});

describe("BR-REQ-090-05 every upgrade says whether it can be reversed", () => {
  it("has temporary bumps and at least one that is not", () => {
    // Charging entry is not a spike to ride out. A page where every upgrade is temporary would
    // teach the club that all of them can be dropped again, and one of them cannot.
    const bumps = platformServices(BASE)
      .map((row) => row.bump)
      .filter(Boolean);
    expect(bumps).toContain("temporary");
    expect(bumps).toContain("permanent");
  });
});

describe("BR-REQ-090-05 nothing renders as an untranslated key, in either language", () => {
  it("translates every service row, including the wording its own headroom needs", () => {
    // Every combination this deployment can produce, not only today's: the domain is checked
    // both bound and unbound, and the allowance both spent and not.
    const variants = [
      platformServices(BASE),
      platformServices({ ...BASE, clubDomainBound: true, emailSentToday: 100, jobsHealthy: false }),
      // The Neon row under the Launch setting (§280's follow-up), measured and not: its fixed
      // sentences are read under `services.neon.launch.*`, and "how close" is the estimate.
      platformServices({ ...BASE, neonPlan: "LAUNCH", databaseBytes: 1024 ** 2, neonCuHoursThisMonth: 2, neonHoursElapsed: 24 }),
      platformServices({ ...BASE, neonPlan: "LAUNCH" }),
      // Mailgun Basic and Vercel Pro paid (§610): the Vercel row reads `services.vercel.pro.*`.
      platformServices({ ...BASE, emailPlanName: "Basic", emailPlanUsdPerMonth: 15, emailAllowance: 10_000, vercelPlan: "PRO", vercelSeats: 2 }),
      platformServices({ ...BASE, vercelPlan: "PRO", hasPaidEvent: true }),
    ];
    /** The «Cost azi» key the page prints for a row (§610): both figures, the billed one first. */
    const costKey = (cost: PlanCost): string => {
      if (cost.kind === "usage") return cost.estimatedPerMonth === null ? "usageUnknown" : "usageBoth";
      if (cost.kind === "paid") return `${cost.billed === "monthly" ? "billedMonthly" : "billedYearly"}${cost.plusVat ? "PlusVat" : ""}`;
      return cost.kind;
    };

    for (const rows of variants) {
      for (const row of rows) {
        // The page reads a row's fixed sentences under its variant where it has one.
        const wording = (key: string) => (row.variant ? `services.${row.id}.${row.variant}.${key}` : `services.${row.id}.${key}`);
        for (const [locale, messages] of LOCALES) {
          expect(messageAt(messages, `services.${row.id}.name`), `${locale} ${row.id}.name`).toBeTruthy();
          for (const key of ["freeGives", "ceiling", "whenCrossed"]) {
            expect(messageAt(messages, wording(key)), `${locale} ${wording(key)}`).toBeTruthy();
          }

          const closeKey =
            row.headroom.kind === "measured"
              ? "closeMeasured"
              : row.headroom.kind === "notMeasured"
                ? "closeUnknown"
                : row.headroom.reached
                  ? "closeYes"
                  : "closeNo";
          expect(
            messageAt(messages, `services.${row.id}.${closeKey}`),
            `${locale} ${row.id}.${closeKey}`,
          ).toBeTruthy();
          if (row.variant) {
            // The variant's own «how close»: for a usage row both sentences, with a measured pace and
            // without; for Vercel on Pro the one sentence that replaces the commercial clause.
            expect(messageAt(messages, wording("close")), `${locale} ${wording("close")}`).toBeTruthy();
            if (row.variant === "launch") {
              expect(messageAt(messages, wording("closeUnknown")), `${locale} ${wording("closeUnknown")}`).toBeTruthy();
            }
            expect(messageAt(messages, wording("more")), `${locale} ${wording("more")}`).toBeTruthy();
          }

          if (row.bump) {
            expect(messageAt(messages, wording("bumpBack")), `${locale} ${wording("bumpBack")}`)
              .toBeTruthy();
            expect(messageAt(messages, `bump.${row.bump}`), `${locale} ${row.bump}`).toBeTruthy();
          }
          expect(messageAt(messages, `costToday.${costKey(row.costToday)}`), `${locale} ${row.id} costToday ${costKey(row.costToday)}`).toBeTruthy();
          // The breakdown's short name for the row (§610).
          expect(messageAt(messages, `costTable.name.${row.id}`), `${locale} costTable.name.${row.id}`).toBeTruthy();
          expect(messageAt(messages, `severity.${row.severity}`), `${locale} ${row.severity}`)
            .toBeTruthy();
        }
      }
    }
  });

  it("translates the next-spend sentence for every service that can be next, and the one for none", () => {
    const allPaid: PlatformFacts = { ...BASE, emailPlanName: "Basic", emailPlanUsdPerMonth: 15, emailNextPlan: { name: "Foundation", usdPerMonth: 35 }, vercelPlan: "PRO" };
    for (const facts of [BASE, { ...BASE, clubDomainBound: true }, { ...BASE, emailPlanName: "Basic", emailPlanUsdPerMonth: 15 }, allPaid]) {
      const next = nextSpend(platformServices(facts));
      for (const [locale, messages] of LOCALES) {
        // Null is said in its own sentence (§610), never an empty line.
        const key = next ? `nextSpend.${next.id}` : "nextSpend.none";
        expect(messageAt(messages, key), `${locale} ${key}`).toBeTruthy();
        if (next) expect(messageAt(messages, `${key}More`), `${locale} ${key}More`).toBeTruthy();
      }
    }
  });

  it("§610 translates the verdict that names what is paid, and every name it can use", () => {
    for (const [locale, messages] of LOCALES) {
      expect(messageAt(messages, "freeVerdict.paysForPlans"), `${locale} paysForPlans`).toMatch(/\{services\}/);
      for (const id of ["domain", "mailgun", "vercel", "neon"]) {
        expect(messageAt(messages, `freeVerdict.paidName.${id}`), `${locale} paidName.${id}`).toBeTruthy();
      }
      for (const form of ["one", "few", "other"]) {
        expect(messageAt(messages, `vercelPlan.seats.${form}`), `${locale} vercelPlan.seats.${form}`).toMatch(/\{count\}/);
      }
      for (const key of ["sentence", "sentenceEstimated", "estimated", "nothing"]) {
        expect(messageAt(messages, `costToday.${key}`), `${locale} costToday.${key}`).toBeTruthy();
      }
      // The sentence says the month and the year; «(× 12)» is gone from the estimate's note.
      expect(messageAt(messages, "costToday.sentence")).toMatch(/\{month\}.*\{year\}/);
      expect(messageAt(messages, "costToday.estimated")).not.toMatch(/× ?12/);
      for (const key of ["caption", "service", "perMonth", "perYear", "total", "unmeasured", "plusVat", "help"]) {
        expect(messageAt(messages, `costTable.${key}`), `${locale} costTable.${key}`).toBeTruthy();
      }
    }
  });

  it("translates every decision the page can show, which is only the open ones", () => {
    for (const decision of moneyDecisions({ ...BASE, hasPaidEvent: true })) {
      for (const [locale, messages] of LOCALES) {
        for (const key of ["question", "open"]) {
          expect(
            messageAt(messages, `decisions.${decision.id}.${key}`),
            `${locale} ${decision.id}.${key}`,
          ).toBeTruthy();
        }
      }
    }
  });
});

/**
 * BR-REQ-090-04 — `/devs` gets the operational half, and only that half.
 *
 * The split is load-bearing: one figure rendered in two places is one figure that will disagree
 * with itself, so the money stays on `/admin/tasks` and this page says what a limit *does*.
 */
describe("BR-REQ-090-04 the operational half on /devs", () => {
  it("says who enforces each limit and names the variable where there is one", () => {
    expect(OPERATIONAL_LIMITS.some((limit) => limit.enforcedBy === "provider")).toBe(true);
    expect(OPERATIONAL_LIMITS.some((limit) => limit.enforcedBy === "application")).toBe(true);

    for (const limit of OPERATIONAL_LIMITS) {
      for (const [locale, messages] of LOCALES) {
        const devs = messages.Devs as unknown as Record<string, Record<string, unknown>>;
        const entry = devs.operational[limit.id] as { title?: string; body?: string } | undefined;
        expect(entry?.title, `${locale} ${limit.id} title`).toBeTruthy();
        expect(entry?.body, `${locale} ${limit.id} body`).toBeTruthy();
        expect(devs.enforcedBy[limit.enforcedBy], `${locale} ${limit.enforcedBy}`).toBeTruthy();
      }
    }
  });

  it("carries no price, so the two pages cannot disagree about a number", () => {
    const flatten = (node: unknown, into: string[] = []): string[] => {
      if (typeof node === "string") into.push(node);
      else if (node && typeof node === "object") {
        for (const value of Object.values(node)) flatten(value, into);
      }
      return into;
    };

    for (const [locale, messages] of LOCALES) {
      for (const message of flatten(messages.Devs)) {
        expect(message, `${locale} /devs message quotes a price`).not.toMatch(
          /\$\d|\d\s?(EUR|USD)/,
        );
      }
    }
  });
});

describe("the Neon monthly figure (§88)", () => {
  it("projects this month's pace to a full month at Launch's rates, with no base fee", async () => {
    const { projectedNeonLaunchUsdPerMonth } = await import("@/modules/diagnostics/platform-plans");
    // 50 CU-hours in 15 days is 100 in 30; 100 × $0.106 = $10.60; plus 1 GiB × $0.35.
    expect(
      projectedNeonLaunchUsdPerMonth({ neonCuHoursThisMonth: 50, neonHoursElapsed: 15 * 24, databaseBytes: 1024 ** 3 }),
    ).toBe(10.95);
    // Without the API figure there is no pace to project.
    expect(projectedNeonLaunchUsdPerMonth({ neonCuHoursThisMonth: null, neonHoursElapsed: 100 })).toBeNull();
    expect(projectedNeonLaunchUsdPerMonth({ neonCuHoursThisMonth: 10, neonHoursElapsed: 0 })).toBeNull();
  });

  it("states the daily rate it projected from, so a reader can check the arithmetic", async () => {
    const { neonCuHoursPerDay } = await import("@/modules/diagnostics/platform-plans");
    // §280 reasoned from 1.8 CU-hours a day; 54 in 30 days reads back as 1.8.
    expect(neonCuHoursPerDay({ neonCuHoursThisMonth: 54, neonHoursElapsed: 30 * 24 })).toBe(1.8);
    expect(neonCuHoursPerDay({ neonCuHoursThisMonth: null, neonHoursElapsed: 24 })).toBeNull();
    expect(neonCuHoursPerDay({ neonCuHoursThisMonth: 3, neonHoursElapsed: 0 })).toBeNull();
  });
});

/**
 * BR-REQ-090-07 criterion 2, `DECISIONS.md` §280's follow-up — the Neon row follows the plan
 * the club states. On Free the row is what it always was; on Launch nothing is a ceiling, the
 * cost is an estimate at the catalogue's rate, and the verdict stops calling the club free.
 */
describe("the Neon row follows the plan setting", () => {
  const LAUNCH: PlatformFacts = { ...BASE, neonPlan: "LAUNCH", databaseBytes: 1024 ** 2, neonCuHoursThisMonth: 1.8, neonHoursElapsed: 24 };

  it("reads as Free when nothing says otherwise — the setting's own default", () => {
    const row = platformServices(BASE).find((r) => r.id === "neon");
    expect(row).toMatchObject({ planToday: "Free", costToday: { kind: "free" }, nextPlan: "Launch", nextCost: "$0.106/CU-hour" });
    expect(row?.variant).toBeUndefined();
    // Free's ceiling is measured from the database and read from the one catalogue: 0.5 GB.
    const measured = platformServices({ ...BASE, databaseBytes: 450 * 1024 * 1024 }).find((r) => r.id === "neon");
    expect(measured?.headroom).toEqual({ kind: "measured", used: 450, of: 512, state: "close" });
    expect(measured?.severity).toBe("watch");
  });

  it("on Launch is a usage estimate with no ceiling and no next plan, and stays calm past Free's allowance", () => {
    const row = platformServices(LAUNCH).find((r) => r.id === "neon");
    // 1.8 a day is 54 a month at $0.106 = $5.72 (§280), plus a mebibyte of storage.
    expect(row).toMatchObject({ planToday: "Launch", costToday: { kind: "usage", currency: "USD", estimatedPerMonth: 5.72 }, nextPlan: null, nextCost: null, bump: "temporary", variant: "launch" });
    expect(row?.headroom).toEqual({ kind: "derived", reached: false });
    expect(row?.severity).toBe("ok");
    expect(row?.checkedOn).toBe("2026-09-22");
    // Far past a hundred hours and half a gigabyte: on Launch that is a bill, not a limit.
    const heavy = platformServices({ ...LAUNCH, databaseBytes: 3 * 1024 ** 3, neonCuHoursThisMonth: 180, neonHoursElapsed: 30 * 24 }).find((r) => r.id === "neon");
    expect(heavy?.severity).toBe("ok");
    expect(heavy?.headroom).toEqual({ kind: "derived", reached: false });
    expect(heavy?.costToday).toEqual({ kind: "usage", currency: "USD", estimatedPerMonth: 20.13 });
  });

  it("on Launch without a key says the pace is unknown rather than free or fine", () => {
    const row = platformServices({ ...BASE, neonPlan: "LAUNCH" }).find((r) => r.id === "neon");
    expect(row?.costToday).toEqual({ kind: "usage", currency: "USD", estimatedPerMonth: null });
    expect(row?.severity).toBe("unknown");
  });

  it("adds the estimate to the year's total and marks the total an estimate", () => {
    const free = annualCostToday(platformServices(BASE));
    expect(free).toEqual([{ currency: "USD", amount: DOMAIN_PRICE_USD_PER_YEAR, plusVat: true, estimated: false }]);
    const launch = annualCostToday(platformServices(LAUNCH));
    expect(launch).toEqual([{ currency: "USD", amount: Math.round((DOMAIN_PRICE_USD_PER_YEAR + 5.72 * 12) * 100) / 100, plusVat: true, estimated: true }]);
    // Unmeasured usage adds nothing and still marks the total: it is known to be incomplete.
    const unknown = annualCostToday(platformServices({ ...BASE, neonPlan: "LAUNCH" }));
    expect(unknown).toEqual([{ currency: "USD", amount: DOMAIN_PRICE_USD_PER_YEAR, plusVat: true, estimated: true }]);
  });

  it("changes the verdict to 'pays for usage' — a choice, not a limit — and never the next spend", () => {
    expect(freeTierVerdict(LAUNCH)).toBe("paysForUsage");
    expect(freeTierVerdict({ ...LAUNCH, emailSentToday: 100 })).toBe("freeButAtALimit");
    expect(freeTierVerdict({ ...LAUNCH, hasPaidEvent: true })).toBe("notFree");
    // Launch is already paid for; the next thing to cost money is still email.
    expect(nextSpend(platformServices(LAUNCH))?.id).toBe("mailgun");
    for (const [locale, messages] of LOCALES) {
      expect(messageAt(messages, "freeVerdict.paysForUsage"), `${locale} paysForUsage`).toBeTruthy();
      expect(messageAt(messages, "costToday.estimated"), `${locale} costToday.estimated`).toBeTruthy();
    }
  });
});

/**
 * BR-REQ-090-05, §610 — «Cât costă» per month and per year (the owner, 2026-10-01: «la costuri
 * vreau să văd defalcat pe lună și per serviciu!» and, of the yearly figure, «aici nu e clar ca e
 * per an»). A paid plan keeps the figure its invoice carries and says which period that is; the
 * other figure is derived, never stored, and the totals are the derived figures summed.
 */
describe("§610 each cost per month and per year", () => {
  const paid = (amount: number, billed: "monthly" | "yearly", plusVat = true): PlanCost => ({ kind: "paid", amount, billed, currency: "USD", plusVat });

  it("does the arithmetic both ways, to the cent", () => {
    // Mailgun Basic: 15 a month is 180 a year.
    expect(perMonth(paid(15, "monthly"))).toBe(15);
    expect(perYear(paid(15, "monthly"))).toBe(180);
    // The domain: 10.97 a year is 0.91 a month.
    expect(perYear(paid(10.97, "yearly"))).toBe(10.97);
    expect(perMonth(paid(10.97, "yearly"))).toBe(0.91);
    // Vercel Pro, two seats: 40 a month is 480 a year.
    expect(perMonth(paid(20 * 2, "monthly"))).toBe(40);
    expect(perYear(paid(20 * 2, "monthly"))).toBe(480);
    // A usage plan at 9.61 a month: 115.32 a year.
    expect(perMonth({ kind: "usage", currency: "USD", estimatedPerMonth: 9.61 })).toBe(9.61);
    expect(perYear({ kind: "usage", currency: "USD", estimatedPerMonth: 9.61 })).toBe(115.32);
    // Unmeasured usage is null both ways — a word on the page, never a zero.
    expect(perMonth({ kind: "usage", currency: "USD", estimatedPerMonth: null })).toBeNull();
    expect(perYear({ kind: "usage", currency: "USD", estimatedPerMonth: null })).toBeNull();
    // Free and not taken cost nothing.
    for (const cost of [{ kind: "free" }, { kind: "notTaken" }] as const) {
      expect(perMonth(cost)).toBe(0);
      expect(perYear(cost)).toBe(0);
    }
  });

  it("keeps Mailgun's month as Mailgun bills it — no longer stored × 12", () => {
    const mailgun = platformServices({ ...BASE, emailPlanName: "Basic", emailPlanUsdPerMonth: 15 }).find((row) => row.id === "mailgun");
    expect(mailgun?.costToday).toEqual({ kind: "paid", amount: 15, billed: "monthly", currency: "USD", plusVat: true });
    const domain = platformServices(BASE).find((row) => row.id === "domain");
    expect(domain?.costToday).toEqual({ kind: "paid", amount: DOMAIN_PRICE_USD_PER_YEAR, billed: "yearly", currency: "USD", plusVat: true });
  });

  it("totals the domain, Mailgun Basic, Vercel Pro on two seats and Neon Launch, per month and per year", () => {
    // Neon at 1.8 CU-hours a day and a mebibyte: 5.72 a month (§280).
    const facts: PlatformFacts = {
      ...BASE,
      emailPlanName: "Basic",
      emailPlanUsdPerMonth: 15,
      emailAllowance: 10_000,
      vercelPlan: "PRO",
      vercelSeats: 2,
      neonPlan: "LAUNCH",
      databaseBytes: 1024 ** 2,
      neonCuHoursThisMonth: 1.8,
      neonHoursElapsed: 24,
    };
    const rows = platformServices(facts);
    // 0.91 + 15 + 40 + 5.72 a month; 10.97 + 180 + 480 + 68.64 a year.
    expect(monthlyCostToday(rows)).toEqual([{ currency: "USD", amount: 61.63, plusVat: true, estimated: true }]);
    expect(annualCostToday(rows)).toEqual([{ currency: "USD", amount: 739.61, plusVat: true, estimated: true }]);
    // Without Neon's pace the estimate adds nothing and still marks the totals.
    const unmeasured = platformServices({ ...facts, neonCuHoursThisMonth: null });
    expect(monthlyCostToday(unmeasured)).toEqual([{ currency: "USD", amount: 55.91, plusVat: true, estimated: true }]);
    expect(annualCostToday(unmeasured)).toEqual([{ currency: "USD", amount: 670.97, plusVat: true, estimated: true }]);
    // Every paying row, in the table's order.
    expect(payingRows(rows).map((row) => row.id)).toEqual(["domain", "mailgun", "vercel", "neon"]);
  });

  it("on the free plans is the domain alone: its twelfth a month, its fee a year, no estimate", () => {
    const rows = platformServices(BASE);
    expect(monthlyCostToday(rows)).toEqual([{ currency: "USD", amount: 0.91, plusVat: true, estimated: false }]);
    expect(annualCostToday(rows)).toEqual([{ currency: "USD", amount: DOMAIN_PRICE_USD_PER_YEAR, plusVat: true, estimated: false }]);
    expect(monthlyCostToday([])).toEqual([]);
  });
});

/** BR-REQ-090-05, §610 — the Vercel row follows the plan the club states on «Costuri». */
describe("§610 the Vercel row follows the plan setting", () => {
  const vercel = (facts: PlatformFacts): ServiceRow | undefined => platformServices(facts).find((row) => row.id === "vercel");

  it("on Hobby — the default — reads exactly as before the setting existed", () => {
    for (const facts of [BASE, { ...BASE, vercelPlan: "HOBBY" as const, vercelSeats: 3 }]) {
      const row = vercel(facts);
      expect(row).toMatchObject({ planToday: "Hobby", costToday: { kind: "free" }, nextPlan: "Pro", nextCost: "$20/mo per seat", bump: "permanent", severity: "ok" });
      expect(row?.variant).toBeUndefined();
      expect(row?.headroom).toEqual({ kind: "derived", reached: false });
    }
    expect(vercel({ ...BASE, hasPaidEvent: true })?.severity).toBe("watch");
  });

  it("on Pro is the seats' price, billed monthly with VAT on top, no next step, a temporary bump", () => {
    const row = vercel({ ...BASE, vercelPlan: "PRO", vercelSeats: 2 });
    expect(row).toMatchObject({
      planToday: "Pro",
      costToday: { kind: "paid", amount: 2 * VERCEL_PLANS.PRO.usdPerSeatPerMonth, billed: "monthly", currency: "USD", plusVat: true },
      headroom: { kind: "derived", reached: false },
      severity: "ok",
      nextPlan: null,
      nextCost: null,
      bump: "temporary",
      variant: "pro",
      seats: 2,
    });
    // The non-commercial clause no longer applies on Pro: a paid event is no caution there.
    expect(vercel({ ...BASE, vercelPlan: "PRO", hasPaidEvent: true })).toMatchObject({ severity: "ok", headroom: { kind: "derived", reached: false } });
    // One seat when the seats are not said.
    expect(vercel({ ...BASE, vercelPlan: "PRO" })?.costToday).toMatchObject({ amount: VERCEL_PLANS.PRO.usdPerSeatPerMonth });
  });

  it("leaves nothing to spend next once the domain, Mailgun and Vercel are paid", () => {
    const facts: PlatformFacts = { ...BASE, emailPlanName: "Basic", emailPlanUsdPerMonth: 15, emailNextPlan: { name: "Foundation", usdPerMonth: 35 }, vercelPlan: "PRO" };
    expect(nextSpend(platformServices(facts))).toBeNull();
    // Vercel Pro alone: email is still next.
    expect(nextSpend(platformServices({ ...BASE, vercelPlan: "PRO" }))?.id).toBe("mailgun");
  });

  it("names what is paid once a plan besides the domain is — and keeps the earlier verdicts first", () => {
    expect(freeTierVerdict({ ...BASE, vercelPlan: "PRO" })).toBe("paysForPlans");
    expect(freeTierVerdict({ ...BASE, emailPlanName: "Basic", emailPlanUsdPerMonth: 15, emailAllowance: 10_000 })).toBe("paysForPlans");
    expect(freeTierVerdict({ ...BASE, vercelPlan: "PRO", neonPlan: "LAUNCH" })).toBe("paysForPlans");
    // Neon alone is still «pays for usage».
    expect(freeTierVerdict({ ...BASE, neonPlan: "LAUNCH" })).toBe("paysForUsage");
    // A paid event and a spent allowance still come first.
    expect(freeTierVerdict({ ...BASE, vercelPlan: "PRO", hasPaidEvent: true })).toBe("notFree");
    expect(freeTierVerdict({ ...BASE, vercelPlan: "PRO", emailSentToday: 100 })).toBe("freeButAtALimit");
  });
});
