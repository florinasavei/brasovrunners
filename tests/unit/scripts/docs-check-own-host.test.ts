import { describe, expect, it } from "vitest";
import { ownCloneUrlPattern, ownHostPattern, readClub, readInfra } from "../../../scripts/club-files.mjs";
import { todayIn } from "../../../scripts/land-tree.mjs";

/**
 * BR-REQ-101-01 «Hosting portability» (§886): the scripts and the workflow no longer write the club's names; they read
 * `club/infra.json` and `club/club.json`. The hostname is assembled here from the labels and a TLD, never written out:
 * the club's domain may appear in no file but SETUP.md §26.
 */
const matches = (pattern: RegExp, text: string) => [...text.matchAll(pattern)].map((m) => m[0]);

describe("BR-REQ-101-01: docs:check's own-host pattern is built from club/infra.json's domainLabels (§886)", () => {
  const infra = readInfra() as { domainLabels: string[]; vercelProjects: Record<string, string>; releaseAuthor: string };
  const [first, second] = infra.domainLabels;

  it("matches this club's hostname, with any subdomain and either label", () => {
    const pattern = ownHostPattern(infra.domainLabels);
    const tld = ["c", "o", "m"].join("");
    expect(matches(pattern, `see ${first}.${tld} now`)).toEqual([`${first}.${tld}`]);
    expect(matches(pattern, `see qa.${second}.${tld}`)).toEqual([`qa.${second}.${tld}`]);
    expect(matches(pattern, `${first.toUpperCase()}.${tld}`)).toHaveLength(1);
  });

  it("matches a fork's label set, and no longer this club's", () => {
    const fork = ownHostPattern(["fork-club"]);
    expect(matches(fork, "www.fork-club.example")).toEqual(["www.fork-club.example"]);
    expect(matches(fork, `${first}.${["c", "o", "m"].join("")}`)).toEqual([]);
  });

  it("does not match a bare label without a dot, nor a clone URL", () => {
    const pattern = ownHostPattern(infra.domainLabels);
    expect(matches(pattern, `the ${first} repository and ${second}-qa`)).toEqual([]);
    expect(ownCloneUrlPattern(infra.domainLabels).test(`${first}.git`)).toBe(true);
    expect(ownCloneUrlPattern(infra.domainLabels).test(`x${first}.git`)).toBe(false);
  });

  it("keeps the values the scripts wrote before: the two Vercel projects and the release author", () => {
    expect(Object.keys(infra.vercelProjects).sort()).toEqual(["production", "qa"]);
    expect(infra.vercelProjects.qa).toBe("brasov-runners-qa");
    expect(infra.vercelProjects.production).toBe("brasov-runners-production");
    expect(infra.releaseAuthor).toBe("Brașov Runners release");
  });

  it("names the release archive and the ship times file by the slug, as before", () => {
    expect(readClub().slug).toBe("brasovrunners");
  });

  it("dates a landing in the club's zone read from club.json: 23:30 UTC on the 1st is already the 2nd", () => {
    expect(readClub().place.timeZone).toBe("Europe/Bucharest");
    expect(todayIn(undefined, new Date("2031-01-01T23:30:00Z"))).toBe("2031-01-02");
    expect(todayIn(undefined, new Date("2031-01-01T12:00:00Z"))).toBe("2031-01-01");
  });
});
