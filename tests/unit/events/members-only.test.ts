import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { codeShownToMembers, isCalendarDay } from "@/modules/content/member-codes/fields";
import { mayViewEvent, mayViewMembersOnlyEvents, withheldFromPublic } from "@/modules/events/domain/members-only";
import { eventAlertWanted } from "@/modules/newsletter/domain/alerts";
import { interestAction } from "@/modules/notifications/domain/automatic-sends";
import { STAFF_ROLES } from "@/modules/staff-identity/domain/roles";

/**
 * §552 — «Doar pentru membrii BVR» and «Coduri de reducere»: the pure rules, the words, and the
 * source-walk that no public read path selects a members' row or a code — the way §328's and §533's
 * tests prove the place and the start are withheld in SQL, here by where the reads live.
 */

const SRC = join(process.cwd(), "src");

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? filesUnder(path) : /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

const SOURCES = filesUnder(SRC).map((path) => ({ path: relative(process.cwd(), path).split(sep).join("/"), text: readFileSync(path, "utf8") }));

describe("§552 who sees an event for the members alone", () => {
  it("every account the club made, and nobody without one", () => {
    for (const role of STAFF_ROLES) expect(mayViewMembersOnlyEvents(role)).toBe(true);
    expect(mayViewMembersOnlyEvents(null)).toBe(false);
    expect(mayViewMembersOnlyEvents(undefined)).toBe(false);
  });

  it("a public event is anybody's; a members' event only a members' session's", () => {
    expect(withheldFromPublic({ membersOnly: true })).toBe(true);
    expect(mayViewEvent({ membersOnly: false }, null)).toBe(true);
    expect(mayViewEvent({ membersOnly: true }, null)).toBe(false);
    expect(mayViewEvent({ membersOnly: true }, "MEMBER")).toBe(true);
    expect(mayViewEvent({ membersOnly: true }, "ADMIN")).toBe(true);
  });

  it("alerts no newsletter subscriber and announces no opening to a public page's addresses", () => {
    const base = {
      type: "RACE",
      isSpecial: false,
      editorialStatus: "PUBLISHED",
      eventStatus: "SCHEDULED",
      startsAt: new Date("2026-11-21T08:00:00.000Z"),
      publishedAt: new Date("2026-10-01T08:00:00.000Z"),
      repeatOf: null,
      partnered: false,
    };
    const now = new Date("2026-10-01T09:00:00.000Z");
    expect(eventAlertWanted(base, now)).toBe(true);
    expect(eventAlertWanted({ ...base, membersOnly: true }, now)).toBe(false);
    const window = {
      registrationMode: "INTERNAL" as const,
      eventStatus: "SCHEDULED" as const,
      editorialStatus: "PUBLISHED",
      startsAt: new Date("2026-11-21T08:00:00.000Z"),
      registrationOpensAt: null,
      registrationOpensSoon: false,
      registrationClosesAt: null,
      publishedAt: new Date("2026-09-01T08:00:00.000Z"),
    };
    expect(interestAction(window, now)).toBe("announce");
    expect(interestAction({ ...window, membersOnly: true }, now)).toBe("wait");
  });
});

describe("§552 a code is shown while it is not hidden and its last day has not passed", () => {
  it("reads the last day inclusively", () => {
    expect(codeShownToMembers({ hidden: false, validUntil: null }, "2026-10-01")).toBe(true);
    expect(codeShownToMembers({ hidden: false, validUntil: "2026-10-01" }, "2026-10-01")).toBe(true);
    expect(codeShownToMembers({ hidden: false, validUntil: "2026-09-30" }, "2026-10-01")).toBe(false);
    expect(codeShownToMembers({ hidden: true, validUntil: null }, "2026-10-01")).toBe(false);
  });

  it("takes only a day that exists", () => {
    expect(isCalendarDay("2028-02-29")).toBe(true);
    expect(isCalendarDay("2027-02-29")).toBe(false);
    expect(isCalendarDay("31.12.2026")).toBe(false);
  });
});

describe("§552 the words: both languages, plain, short", () => {
  const KEYS = [
    "Event.membersOnly",
    "Registration.membersAddressLabel",
    "Registration.membersAddressHelp",
    "Admin.editor.membersOnly",
    "Admin.editor.membersOnlyHelp",
    "Admin.editor.membersOnlyShort",
    "Admin.events.membersOnlyChip",
    "Admin.members.codes.help",
    "Admin.members.codes.hideBody",
    "Admin.members.codes.deleteBody",
    "Members.eventsTitle",
    "Members.codesTitle",
    "Members.copyCode",
    "Members.codeValidUntil",
  ];
  const at = (catalogue: unknown, key: string) =>
    key.split(".").reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], catalogue);

  it("every key in both catalogues, at most 200 characters, never «platforma» or «de obicei»", () => {
    for (const key of KEYS) {
      for (const [name, catalogue] of [["ro", ro], ["en", en]] as const) {
        const text = at(catalogue, key);
        expect(typeof text, `${name} ${key}`).toBe("string");
        expect((text as string).length, `${name} ${key}`).toBeLessThanOrEqual(200);
        expect(text as string, `${name} ${key}`).not.toMatch(/platform|de obicei|usually/i);
      }
    }
  });

  it("the help line says that switching it on cancels nothing", () => {
    expect(ro.Admin.editor.membersOnlyHelp).toMatch(/Înscrierile făcute rămân/);
    expect(en.Admin.editor.membersOnlyHelp).toMatch(/registrations stay/);
  });
});

describe("§552 no public read path meets a members' row or a code (source walk)", () => {
  it("the condition every public event read shares withholds the members' events", () => {
    const repository = SOURCES.find((file) => file.path === "src/modules/events/repository.ts")!.text;
    expect(repository).toMatch(/const publishedAnyDateIn = \(locale: Locale\) =>\s*and\(publishedForMembersIn\(locale\), NOT_MEMBERS_ONLY\)/);
    expect(repository).toMatch(/const NOT_MEMBERS_ONLY = eq\(events\.membersOnly, false\)/);
    // Every other "published" test in the file is the members' own condition, or carries the guard.
    const lines = repository.split("\n").filter((line) => line.includes('eq(events.editorialStatus, "PUBLISHED")'));
    for (const line of lines) {
      expect(line.includes("NOT_MEMBERS_ONLY") || /publishedForMembersIn|and\(eq\(events\.editorialStatus, "PUBLISHED"\), eq\(eventTranslations\.locale, locale\)\)/.test(line), line).toBe(true);
    }
  });

  it("the members' reads are called only behind the session, never from the public cache", () => {
    const callers = SOURCES.filter((file) => /findPublishedEventBySlug\([^;]*"members"\)|listMembersOnlyEvents\(/.test(file.text)).map((file) => file.path);
    expect(callers.sort()).toEqual(
      [
        "src/app/[locale]/registrations/resend/actions.ts",
        // An invitation's link (§647): the token is the door, read live, never through the public cache.
        "src/app/[locale]/registrations/invitation/[token]/page.tsx",
        "src/modules/events/members-only.ts",
        "src/modules/events/repository.ts",
        "src/modules/notifications/render.ts",
      ].sort(),
    );
    const cache = SOURCES.find((file) => file.path === "src/modules/public-cache/reads.ts")!.text;
    expect(cache).not.toMatch(/"members"|listMembersOnlyEvents|members-only|member-codes|memberDiscountCodes/);
  });

  it("the codes are read only by the members' zone and the backoffice", () => {
    const readers = SOURCES.filter((file) => /member-codes\/repository|schema\/member-discount-codes/.test(file.text)).map((file) => file.path);
    for (const path of readers) {
      expect(
        path.startsWith("src/app/[locale]/admin/") ||
          path === "src/app/[locale]/members-area/page.tsx" ||
          path.startsWith("src/modules/content/member-codes/") ||
          path === "src/db/client.ts",
        path,
      ).toBe(true);
    }
    // No email, feed, sitemap or public route handler reaches the table.
    for (const file of SOURCES.filter((candidate) => /^src\/(modules\/(notifications|newsletter|seo|public-cache)|app\/(api|sitemap|robots))/.test(candidate.path))) {
      expect(file.text, file.path).not.toMatch(/memberDiscountCodes|member-codes/);
    }
  });

  it("every page that opens a members' event asks the session first", () => {
    for (const path of [
      "src/app/[locale]/live/events/[slug]/page.tsx",
      "src/app/[locale]/live/events/[slug]/calendar.ics/route.ts",
      "src/app/[locale]/events/[slug]/register/page.tsx",
      "src/app/[locale]/events/[slug]/declaration/page.tsx",
    ]) {
      expect(SOURCES.find((file) => file.path === path)!.text, path).toMatch(/membersEventBySlug/);
    }
    // The static page and its static .ics never ask (§549): a members' event is a 404 there, and the CDN keeps that.
    for (const path of ["src/app/[locale]/events/[slug]/page.tsx", "src/app/[locale]/events/[slug]/calendar.ics/route.ts"]) {
      expect(SOURCES.find((file) => file.path === path)!.text, path).not.toMatch(/members-only"|membersEventBySlug\(|membersViewer/);
    }
    const door = SOURCES.find((file) => file.path === "src/modules/events/members-only.ts")!.text;
    expect(door).toMatch(/const viewer = await membersViewer\(\);\s*if \(!viewer\) return undefined;/);
  });
});
