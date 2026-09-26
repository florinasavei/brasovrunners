import { describe, expect, it } from "vitest";
import { envSchema } from "@/shared/config/env";
import {
  DOMAIN_RENEWAL_AMBER_DAYS,
  DOMAIN_RENEWAL_RED_DAYS,
  domainExpiresOn,
  domainRenewal,
} from "@/modules/diagnostics/domain/domain-renewal";

/**
 * §NNN — the domain's renewal reminder. The owner, 2026-09-26: the `.ro` is dropped, the `.com`
 * stays, "remember to renew it for several years". The expiry is the registration day plus the
 * years paid in total; the row is green above 90 days, amber from 90, red from 30 and past it.
 */
const REGISTERED = "2026-09-16";
// Noon in Bucharest, so the club's calendar day is the one the test names.
const at = (day: string) => new Date(`${day}T09:00:00Z`);

describe("§NNN the domain's expiry", () => {
  it("is the registration day plus the years paid", () => {
    expect(domainExpiresOn(REGISTERED, 1)).toBe("2027-09-16");
    expect(domainExpiresOn(REGISTERED, 4)).toBe("2030-09-16");
  });

  it("clamps 29 February to the 28th in a common year, as registrars do", () => {
    expect(domainExpiresOn("2028-02-29", 1)).toBe("2029-02-28");
    expect(domainExpiresOn("2028-02-29", 4)).toBe("2032-02-29");
  });

  it("is unknown while the registration day is unset", () => {
    expect(domainRenewal(undefined, 1, at("2027-09-01"))).toEqual({ status: "unknown" });
  });
});

describe("§NNN the row's state by date", () => {
  it("is ok above 90 days", () => {
    expect(domainRenewal(REGISTERED, 1, at("2027-06-17"))).toEqual({ status: "ok", expiresOn: "2027-09-16", daysLeft: 91 });
  });

  it("turns amber at exactly 90 days", () => {
    expect(DOMAIN_RENEWAL_AMBER_DAYS).toBe(90);
    expect(domainRenewal(REGISTERED, 1, at("2027-06-18"))).toMatchObject({ status: "soon", daysLeft: 90 });
    expect(domainRenewal(REGISTERED, 1, at("2027-08-16"))).toMatchObject({ status: "soon", daysLeft: 31 });
  });

  it("turns red at exactly 30 days and stays red on the day itself", () => {
    expect(DOMAIN_RENEWAL_RED_DAYS).toBe(30);
    expect(domainRenewal(REGISTERED, 1, at("2027-08-16"))).toMatchObject({ status: "soon", daysLeft: 31 });
    expect(domainRenewal(REGISTERED, 1, at("2027-08-17"))).toMatchObject({ status: "urgent", daysLeft: 30 });
    expect(domainRenewal(REGISTERED, 1, at("2027-08-18"))).toMatchObject({ status: "urgent", daysLeft: 29 });
    expect(domainRenewal(REGISTERED, 1, at("2027-09-16"))).toMatchObject({ status: "urgent", daysLeft: 0 });
  });

  it("is expired the day after", () => {
    expect(domainRenewal(REGISTERED, 1, at("2027-09-17"))).toMatchObject({ status: "expired", daysLeft: -1 });
  });

  it("goes green again once more years are paid", () => {
    expect(domainRenewal(REGISTERED, 4, at("2027-09-01"))).toMatchObject({ status: "ok", expiresOn: "2030-09-16" });
  });

  it("counts the club's calendar day, not UTC's", () => {
    // 22:30 UTC on 16 August is already 17 August in Bucharest (UTC+3 in summer): 30 days left.
    expect(domainRenewal(REGISTERED, 1, new Date("2027-08-16T22:30:00Z"))).toMatchObject({ status: "urgent", daysLeft: 30 });
  });
});

describe("§NNN the two variables", () => {
  it("default to no date and one year; empty strings read as unset", () => {
    const parsed = envSchema.parse({ DOMAIN_REGISTERED_ON: "", DOMAIN_RENEWAL_YEARS: "" });
    expect(parsed.DOMAIN_REGISTERED_ON).toBeUndefined();
    expect(parsed.DOMAIN_RENEWAL_YEARS).toBe(1);
  });

  it("read a calendar day and a whole number of years, and refuse anything else", () => {
    const parsed = envSchema.parse({ DOMAIN_REGISTERED_ON: REGISTERED, DOMAIN_RENEWAL_YEARS: "4" });
    expect(parsed.DOMAIN_REGISTERED_ON).toBe(REGISTERED);
    expect(parsed.DOMAIN_RENEWAL_YEARS).toBe(4);
    expect(() => envSchema.parse({ DOMAIN_REGISTERED_ON: "16.09.2026" })).toThrow();
    expect(() => envSchema.parse({ DOMAIN_RENEWAL_YEARS: "0" })).toThrow();
  });
});
