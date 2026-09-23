import { describe, expect, it } from "vitest";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import {
  annualCostToday,
  DOMAIN_PRICE_USD_PER_YEAR,
  freeTierVerdict,
  moneyDecisions,
  nextSpend,
  oldestCheckDate,
  OPERATIONAL_LIMITS,
  type PlatformFacts,
  platformServices,
  PRICE_AGEING_AFTER_DAYS,
  PRICE_STALE_AFTER_DAYS,
  priceFreshness,
  registrationsLeftToday,
} from "@/modules/diagnostics/platform-plans";
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
    ];

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
            // Both sentences the page can print for a usage row: with a measured pace, and without.
            expect(messageAt(messages, wording("close")), `${locale} ${wording("close")}`).toBeTruthy();
            expect(messageAt(messages, wording("closeUnknown")), `${locale} ${wording("closeUnknown")}`).toBeTruthy();
          }

          if (row.bump) {
            expect(messageAt(messages, wording("bumpBack")), `${locale} ${wording("bumpBack")}`)
              .toBeTruthy();
            expect(messageAt(messages, `bump.${row.bump}`), `${locale} ${row.bump}`).toBeTruthy();
          }
          expect(
            messageAt(messages, `costToday.${row.costToday.kind === "usage" ? (row.costToday.estimatedPerMonth === null ? "usageUnknown" : "usage") : row.costToday.kind === "paid" ? "amount" : row.costToday.kind}`),
            `${locale} ${row.id} costToday`,
          ).toBeTruthy();
          expect(messageAt(messages, `severity.${row.severity}`), `${locale} ${row.severity}`)
            .toBeTruthy();
        }
      }
    }
  });

  it("translates the next-spend sentence for every service that can be next", () => {
    for (const facts of [BASE, { ...BASE, clubDomainBound: true }]) {
      const next = nextSpend(platformServices(facts));
      for (const [locale, messages] of LOCALES) {
        expect(messageAt(messages, `nextSpend.${next?.id}`), `${locale} ${next?.id}`).toBeTruthy();
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
