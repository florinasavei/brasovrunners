import { describe, expect, it } from "vitest";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import {
  BUMP_LINES,
  freeTierVerdict,
  PLAN_LINES,
  PLANS_CHECKED_ON,
  platformLimits,
  type PlatformLimitInputs,
  registrationsLeftToday,
} from "@/modules/diagnostics/platform-plans";
import {
  MAILGUN_FREE_DAILY_MESSAGES,
  MESSAGES_PER_COMPLETED_REGISTRATION,
} from "@/modules/notifications/volume";

/**
 * BR-REQ-090-05 — the plan, limit and upgrade surface on `/admin/tasks`.
 *
 * Two kinds of assertion here, and the second matters more. The first is arithmetic: how many
 * more people can register today. The second is about *honesty* — every price is a quotation
 * with a date on it, an undecided cost says so rather than showing a plausible number, and the
 * verdict on "is this free" cannot come back cheerful while the club is charging entry.
 */
const BASE: PlatformLimitInputs = {
  emailAllowance: MAILGUN_FREE_DAILY_MESSAGES,
  emailSentToday: 0,
  messagesPerRegistration: MESSAGES_PER_COMPLETED_REGISTRATION,
  hasPaidEvent: false,
  clubDomainBound: false,
  jobsHealthy: true,
};

describe("BR-REQ-090-05 how much of today's allowance is left", () => {
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

describe("BR-REQ-090-05 the free-tier verdict", () => {
  it("says free except the domain when nothing is pressing", () => {
    expect(freeTierVerdict(BASE)).toBe("freeExceptDomain");
  });

  it("says free but at a limit when today's allowance is spent", () => {
    expect(freeTierVerdict({ ...BASE, emailSentToday: 100 })).toBe("freeButAtALimit");
  });

  it("says not free the moment a published event charges entry", () => {
    // Vercel's fair-use terms, not a load question: the deployment is outside them rather than
    // near a cap, so this outranks a spent allowance.
    expect(freeTierVerdict({ ...BASE, hasPaidEvent: true })).toBe("notFree");
    expect(freeTierVerdict({ ...BASE, hasPaidEvent: true, emailSentToday: 100 })).toBe("notFree");
  });
});

describe("BR-REQ-090-05 the limits reflect this deployment, not a generic one", () => {
  it("marks the email cap reached only when there is no room left today", () => {
    const before = platformLimits(BASE).find((limit) => limit.id === "mailgunDaily");
    const after = platformLimits({ ...BASE, emailSentToday: 100 }).find(
      (limit) => limit.id === "mailgunDaily",
    );
    expect(before?.reached).toBe(false);
    expect(after?.reached).toBe(true);
  });

  it("marks the scheduler reached when the jobs are not healthy", () => {
    const limits = platformLimits({ ...BASE, jobsHealthy: false });
    expect(limits.find((limit) => limit.id === "schedulerFloor")?.reached).toBe(true);
  });

  it("marks the identity limit reached once the club's own domain is bound", () => {
    // Zitadel Free includes no custom domain, so binding the domain is the moment it starts to
    // matter rather than the moment it stops.
    const onProvider = platformLimits(BASE);
    const onOwnDomain = platformLimits({ ...BASE, clubDomainBound: true });
    expect(onProvider.find((l) => l.id === "identityDomain")?.reached).toBe(false);
    expect(onOwnDomain.find((l) => l.id === "identityDomain")?.reached).toBe(true);
  });

  it("has a translated title and body for every limit, in both locales", () => {
    for (const limit of platformLimits(BASE)) {
      for (const [locale, messages] of [["ro", ro], ["en", en]] as const) {
        const entry = (messages.Admin.tasks.limits as Record<string, { title: string; body: string }>)[
          limit.id
        ];
        expect(entry?.title, `${locale} title for ${limit.id}`).toBeTruthy();
        expect(entry?.body, `${locale} body for ${limit.id}`).toBeTruthy();
      }
    }
  });
});

describe("BR-REQ-090-05 no price is invented, and none is undated", () => {
  it("carries the date PLATFORM.md last checked the vendors", () => {
    // A price with no date is a claim. This is rendered beside the table for that reason, and
    // asserted here so it cannot quietly disappear in a redesign.
    expect(PLANS_CHECKED_ON).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("quotes every current cost as a dollar figure or says plainly it is undecided", () => {
    // AGENTS.md §1.2. A line the club must fill in reads "?" and renders as "to be decided",
    // never as a plausible number nobody checked.
    for (const line of PLAN_LINES) {
      expect(line.currentCost, line.id).toMatch(/^(\$\d+|\?)$/);
    }
  });

  it("names the domain as the one undecided cost", () => {
    const undecided = PLAN_LINES.filter((line) => line.currentCost === "?").map((line) => line.id);
    expect(undecided).toEqual(["domain"]);
  });

  it("gives a price with every named paid plan, and no price without one", () => {
    for (const line of PLAN_LINES) {
      expect(Boolean(line.firstPaidPlan), `${line.id} plan/price pairing`).toBe(
        Boolean(line.firstPaidCost),
      );
    }
  });

  it("has a translated name and free-tier description for every service, in both locales", () => {
    for (const line of PLAN_LINES) {
      for (const [locale, messages] of [["ro", ro], ["en", en]] as const) {
        const entry = (
          messages.Admin.tasks.plans as Record<string, { name: string; freeGives: string }>
        )[line.id];
        expect(entry?.name, `${locale} name for ${line.id}`).toBeTruthy();
        expect(entry?.freeGives, `${locale} free tier for ${line.id}`).toBeTruthy();
      }
    }
  });
});

describe("BR-REQ-090-05 every bump says how to come back down", () => {
  it("names when, what and how to reverse it, in both locales", () => {
    // The reversal is the whole point of the section: a temporary upgrade nobody drops is the
    // expensive failure, and nothing in any dashboard will remind the club.
    for (const line of BUMP_LINES) {
      for (const [locale, messages] of [["ro", ro], ["en", en]] as const) {
        const entry = (
          messages.Admin.tasks.bumps as Record<string, { when: string; what: string; back: string }>
        )[line.id];
        expect(entry?.when, `${locale} when for ${line.id}`).toBeTruthy();
        expect(entry?.what, `${locale} what for ${line.id}`).toBeTruthy();
        expect(entry?.back, `${locale} back for ${line.id}`).toBeTruthy();
      }
    }
  });

  it("has at least one bump that is not temporary, and says so", () => {
    // Charging entry is not a spike to ride out. A table where everything is temporary would
    // teach the club that every upgrade can be reversed, and one of them cannot.
    expect(BUMP_LINES.some((line) => line.temporary)).toBe(true);
    expect(BUMP_LINES.some((line) => !line.temporary)).toBe(true);
  });
});
