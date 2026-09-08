import { describe, expect, it } from "vitest";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import {
  annualCostToday,
  DOMAIN_PRICE_EUR_PER_YEAR,
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
  PROVIDER_OPTIONS,
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
  it("does the arithmetic PLATFORM.md states in prose: 100 a day is about 33 registrations", () => {
    expect(registrationsLeftToday(BASE)).toBe(33);
  });

  it("counts down as the day is spent", () => {
    expect(registrationsLeftToday({ ...BASE, emailSentToday: 90 })).toBe(3);
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
  it("pays nothing at all while the domain has not been bought", () => {
    // The complaint this answers was that the one line which is not free carried no figure. The
    // honest figure today is zero: nothing has been bought, the domain included.
    expect(annualCostToday(platformServices(BASE))).toEqual([]);
  });

  it("totals the domain in the registry's own currency once it is bound", () => {
    const total = annualCostToday(platformServices({ ...BASE, clubDomainBound: true }));
    expect(total).toEqual([
      { currency: "EUR", amount: DOMAIN_PRICE_EUR_PER_YEAR, plusVat: true },
    ]);
  });

  it("names the domain as the next spend, and email once the domain is paid for", () => {
    // `docs/PLATFORM.md`'s own expected order, walked against what the deployment reports
    // rather than restated as prose.
    expect(nextSpend(platformServices(BASE))?.id).toBe("domain");
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

  it("does not shout at the club for having bought its own domain", () => {
    // Both rows are `reached` once the domain is bound and they mean opposite things: the
    // domain is good news, Zitadel's zero custom domains is a bill. Colour follows meaning.
    const bound = platformServices({ ...BASE, clubDomainBound: true });
    expect(bound.find((row) => row.id === "domain")?.severity).toBe("ok");
    expect(bound.find((row) => row.id === "zitadel")?.severity).toBe("watch");
  });

  it("marks the scheduler as something to fix when a job is late", () => {
    const late = platformServices({ ...BASE, jobsHealthy: false });
    expect(late.find((row) => row.id === "githubActions")?.severity).toBe("act");
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
  it("asks what the domain actually cost until somebody has bought it", () => {
    const open = moneyDecisions(BASE).find((decision) => decision.id === "domainRegistrar");
    const closed = moneyDecisions({ ...BASE, clubDomainBound: true }).find(
      (decision) => decision.id === "domainRegistrar",
    );
    expect(open?.state).toBe("open");
    expect(open?.owner).toBe("club");
    expect(closed?.state).toBe("answered");
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
    ];

    for (const rows of variants) {
      for (const row of rows) {
        for (const [locale, messages] of LOCALES) {
          for (const key of ["name", "freeGives", "ceiling", "whenCrossed"]) {
            expect(messageAt(messages, `services.${row.id}.${key}`), `${locale} ${row.id}.${key}`)
              .toBeTruthy();
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

          if (row.bump) {
            expect(messageAt(messages, `services.${row.id}.bumpBack`), `${locale} ${row.id}`)
              .toBeTruthy();
            expect(messageAt(messages, `bump.${row.bump}`), `${locale} ${row.bump}`).toBeTruthy();
          }
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

  it("translates every decision, both when it is open and when it is answered", () => {
    for (const decision of moneyDecisions(BASE)) {
      for (const [locale, messages] of LOCALES) {
        for (const key of ["question", "open", "answered"]) {
          expect(
            messageAt(messages, `decisions.${decision.id}.${key}`),
            `${locale} ${decision.id}.${key}`,
          ).toBeTruthy();
        }
      }
    }
  });

  it("translates every option, and the Cloudflare answer that keeps being asked for", () => {
    for (const option of PROVIDER_OPTIONS) {
      for (const [locale, messages] of LOCALES) {
        expect(messageAt(messages, `options.${option.id}.title`), `${locale} ${option.id}`)
          .toBeTruthy();
        expect(messageAt(messages, `options.${option.id}.why`), `${locale} ${option.id}`)
          .toBeTruthy();
      }
    }

    // Recorded in three files nobody reads together — the proxy, the DNS and Workers — plus the
    // two places Cloudflare is genuinely a good option, both contingent on something else.
    for (const [locale, messages] of LOCALES) {
      for (const key of ["title", "proxy", "dns", "workers", "r2", "turnstile"]) {
        expect(messageAt(messages, `cloudflare.${key}`), `${locale} cloudflare.${key}`)
          .toBeTruthy();
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
