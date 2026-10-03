import { describe, expect, it } from "vitest";
import { emailMessageType } from "@/db/schema/email-outbox";
import { DEADLINE_RULES, DEFAULT_DEADLINES } from "@/modules/deadlines/domain/deadlines";
import {
  doorShutMaxMs,
  doorShutState,
  findPingGaps,
  movedDeadline,
  planDoor,
  stoppedMs,
} from "@/modules/jobs/domain/door-shut";
import { jobStalenessThresholdMs } from "@/modules/jobs/quiet-hours";
import { EMAIL_GROUP_OF } from "@/modules/notifications/domain/email-transport";
import { isWaitedFor } from "@/modules/notifications/domain/email-delay";
import { isParticipantMessage } from "@/modules/notifications/domain/club-notices";
import { NEVER_QUEUED_MESSAGE_TYPES } from "@/modules/notifications/domain/never-queued";
import { doorShutBody, doorShutFactsLine, doorShutMovedBody, doorShutMovedFactsLine, readDoorShutFacts } from "@/modules/notifications/door-shut-words";
import { emailSampleFor } from "@/modules/notifications/email-copy-fields";
import { renderBilingual } from "@/modules/notifications/templates";
import { probedHost, probeStatusOf } from "@/modules/resilience/domain/name-probe";
import { probePublicName } from "@/modules/resilience/name-probe";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";

/**
 * §NNN — the clock stops while the door is shut: the rules, without a database. Which silences of
 * the pinger are a shut door (the pinger's own threshold, never a second one), what a run does with
 * the name's answer, where a deadline moves, and what the name probe makes of a resolver's answer.
 */
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
// 14:00 and 01:00 in Brașov (UTC+3 on 2026-10-03).
const NOON = new Date("2026-10-03T11:00:00.000Z");
const NIGHT = new Date("2026-10-02T22:00:00.000Z");
const at = (base: Date, minutes: number) => new Date(base.getTime() + minutes * MINUTE);

describe("§NNN the pinger's silences", () => {
  it("reuses the health check's threshold: 35 minutes by day, 125 at night", () => {
    expect(jobStalenessThresholdMs(NOON, 15)).toBe(35 * MINUTE);
    expect(jobStalenessThresholdMs(NIGHT, 15)).toBe(125 * MINUTE);
  });

  it("is no window while the calls come on time, by day and by night", () => {
    expect(findPingGaps([NOON, at(NOON, 15), at(NOON, 30), at(NOON, 45)], 15)).toEqual([]);
    // At night the pinger calls hourly, and two hours without a call is still inside the threshold.
    expect(findPingGaps([NIGHT, at(NIGHT, 60), at(NIGHT, 180)], 15)).toEqual([]);
  });

  it("is the silence less the call not yet due: gap − cadence", () => {
    expect(findPingGaps([NOON, at(NOON, 120)], 15)).toEqual([{ startedAt: at(NOON, 15), endedAt: at(NOON, 120) }]);
    // At night the cadence is the hour: a silence of 130 minutes is a window of 70.
    expect(findPingGaps([NIGHT, at(NIGHT, 130)], 15)).toEqual([{ startedAt: at(NIGHT, 60), endedAt: at(NIGHT, 130) }]);
  });

  it("judges a silence across the quiet hours' start as the night would", () => {
    // 22:30 to 23:40 Brașov: seventy minutes, over the day's 35 but under the night's 125.
    const evening = new Date("2026-10-03T19:30:00.000Z");
    expect(findPingGaps([evening, at(evening, 70)], 15)).toEqual([]);
  });

  it("orders and dedupes what it is given", () => {
    expect(findPingGaps([at(NOON, 120), NOON, NOON], 15)).toHaveLength(1);
  });
});

describe("§NNN what a run does with the name's answer", () => {
  const maxMs = doorShutMaxMs(DEFAULT_DEADLINES);

  it("opens a window when the name does not resolve, from the silence that ends now if there is one", () => {
    expect(planDoor({ now: NOON, probe: "unresolved", windows: [], gaps: [], maxMs })).toEqual({
      open: { startedAt: NOON, source: "name" },
      close: null,
      record: [],
      shut: true,
    });
    const gap = { startedAt: at(NOON, -100), endedAt: NOON };
    expect(planDoor({ now: NOON, probe: "unresolved", windows: [], gaps: [gap], maxMs }).open?.startedAt).toEqual(gap.startedAt);
    expect(planDoor({ now: NOON, probe: "unresolved", windows: [], gaps: [gap], maxMs }).record).toEqual([]);
  });

  it("keeps an open window open while the name is gone or the resolver says nothing, and closes it on an answer", () => {
    const open = { id: "w", startedAt: at(NOON, -60), endedAt: null };
    expect(planDoor({ now: NOON, probe: "unresolved", windows: [open], gaps: [], maxMs })).toMatchObject({ open: null, close: null, shut: true });
    expect(planDoor({ now: NOON, probe: "unknown", windows: [open], gaps: [], maxMs })).toMatchObject({ open: null, close: null, shut: true });
    expect(planDoor({ now: NOON, probe: "resolves", windows: [open], gaps: [], maxMs })).toMatchObject({ close: { id: "w", endedAt: NOON }, shut: false });
    expect(planDoor({ now: NOON, probe: "skipped", windows: [open], gaps: [], maxMs })).toMatchObject({ close: { id: "w", endedAt: NOON }, shut: false });
  });

  it("opens nothing on a resolver that does not answer", () => {
    expect(planDoor({ now: NOON, probe: "unknown", windows: [], gaps: [], maxMs })).toEqual({ open: null, close: null, record: [], shut: false });
  });

  it("stops holding the sweeps once a window is open longer than the club's cap", () => {
    const open = { id: "w", startedAt: at(NOON, -(maxMs / MINUTE) - 1), endedAt: null };
    expect(planDoor({ now: NOON, probe: "unresolved", windows: [open], gaps: [], maxMs }).shut).toBe(false);
  });

  it("records a past silence once: never over a window already written", () => {
    const gap = { startedAt: at(NOON, -300), endedAt: at(NOON, -200) };
    expect(planDoor({ now: NOON, probe: "resolves", windows: [], gaps: [gap], maxMs }).record).toEqual([gap]);
    const known = { id: "k", startedAt: at(NOON, -320), endedAt: at(NOON, -190) };
    expect(planDoor({ now: NOON, probe: "resolves", windows: [known], gaps: [gap], maxMs }).record).toEqual([]);
  });

  it("does nothing when switched off, and closes a window left open", () => {
    const open = { id: "w", startedAt: at(NOON, -60), endedAt: null };
    expect(planDoor({ now: NOON, probe: "unresolved", windows: [open], gaps: [{ startedAt: at(NOON, -100), endedAt: NOON }], maxMs: 0 })).toEqual({
      open: null,
      close: { id: "w", endedAt: NOON },
      record: [],
      shut: false,
    });
  });
});

describe("§NNN where a deadline moves", () => {
  const windowStartedAt = at(NOON, -420);
  const stopMs = 420 * MINUTE;

  it("moves a deadline running at the window's start by the stop, and never one that passed before it", () => {
    expect(movedDeadline({ stored: at(NOON, -300), windowStartedAt, stopMs, now: NOON })).toEqual(at(NOON, 120));
    expect(movedDeadline({ stored: at(NOON, -421), windowStartedAt, stopMs, now: NOON })).toBeNull();
    expect(movedDeadline({ stored: windowStartedAt, windowStartedAt, stopMs, now: NOON })).toBeNull();
  });

  it("caps a hold by the close and the start, and writes nothing that would still be behind now", () => {
    const cap = { registrationClosesAt: at(NOON, 60), startsAt: at(NOON, 600) };
    expect(movedDeadline({ stored: at(NOON, -300), windowStartedAt, stopMs, now: NOON, cap })).toEqual(at(NOON, 60));
    // An invitation is capped by the start alone.
    expect(movedDeadline({ stored: at(NOON, -300), windowStartedAt, stopMs, now: NOON, cap: { registrationClosesAt: null, startsAt: at(NOON, 600) } })).toEqual(at(NOON, 120));
    // A close already behind: the cap would move it earlier, so it stays.
    expect(movedDeadline({ stored: at(NOON, -300), windowStartedAt, stopMs, now: NOON, cap: { registrationClosesAt: at(NOON, -310), startsAt: at(NOON, 600) } })).toBeNull();
    expect(movedDeadline({ stored: at(NOON, -400), windowStartedAt, stopMs: 60 * MINUTE, now: NOON })).toBeNull();
  });

  it("stops the clock for the window's length, capped by the club's number", () => {
    expect(stoppedMs({ startedAt: at(NOON, -420), endedAt: NOON }, 48 * HOUR)).toBe(420 * MINUTE);
    expect(stoppedMs({ startedAt: at(NOON, -420), endedAt: NOON }, 2 * HOUR)).toBe(2 * HOUR);
    expect(stoppedMs({ startedAt: at(NOON, -420), endedAt: NOON }, 0)).toBe(0);
  });

  it("is a «Termene» number in hours, 0 to a week, 48 by default", () => {
    expect(DEADLINE_RULES.doorShutMaxHours).toEqual({ unit: "hours", min: 0, max: 168, default: 48 });
    expect(doorShutMaxMs({ doorShutMaxHours: 48 })).toBe(48 * HOUR);
  });
});

describe("§NNN what «Sarcini» and /devs say of the door", () => {
  it("is shut while a window is open, recent for a week after the latest, clear otherwise", () => {
    expect(doorShutState([{ startedAt: NOON, endedAt: null }], NOON)).toBe("shut");
    expect(doorShutState([{ startedAt: at(NOON, -600), endedAt: at(NOON, -300) }], NOON)).toBe("recent");
    expect(doorShutState([{ startedAt: at(NOON, -9 * 24 * 60), endedAt: at(NOON, -8 * 24 * 60) }], NOON)).toBe("clear");
    expect(doorShutState([], NOON)).toBe("clear");
  });
});

describe("§NNN the name probe", () => {
  it("asks only a public name: never a laptop, a test, a number or a private suffix", () => {
    expect(probedHost("https://club.example.com", "production")).toBe("club.example.com");
    expect(probedHost("https://qa.club.example.com/", "qa")).toBe("qa.club.example.com");
    expect(probedHost("http://localhost:3000", "production")).toBeNull();
    expect(probedHost("http://127.0.0.1:3000", "production")).toBeNull();
    expect(probedHost("http://[::1]:3000", "production")).toBeNull();
    expect(probedHost("https://club.test", "production")).toBeNull();
    expect(probedHost("https://club.example.com", "local")).toBeNull();
    expect(probedHost("https://club.example.com", "test")).toBeNull();
    expect(probedHost("not a url", "production")).toBeNull();
  });

  it("reads only «no such name» as unresolved; a timeout or a failed server says nothing", () => {
    expect(probeStatusOf({ code: "ENOTFOUND" })).toBe("unresolved");
    expect(probeStatusOf({ code: "ENODATA" })).toBe("unresolved");
    expect(probeStatusOf({ code: "EAI_AGAIN" })).toBe("unknown");
    expect(probeStatusOf({ code: "ESERVFAIL" })).toBe("unknown");
    expect(probeStatusOf(new Error("boom"))).toBe("unknown");
    expect(probeStatusOf(null)).toBe("unknown");
  });

  it("never throws, and never waits past its time", async () => {
    const base = { baseUrl: "https://club.example.com", appEnv: "production" };
    expect((await probePublicName({ ...base, resolve: async () => [{ address: "192.0.2.1" }] })).status).toBe("resolves");
    expect((await probePublicName({ ...base, resolve: async () => Promise.reject(Object.assign(new Error("x"), { code: "ENOTFOUND" })) })).status).toBe("unresolved");
    expect((await probePublicName({ ...base, timeoutMs: 20, resolve: () => new Promise(() => {}) })).status).toBe("unknown");
    expect((await probePublicName({ ...base, resolve: () => { throw new Error("sync"); } })).status).toBe("unknown");
    expect((await probePublicName({ baseUrl: "http://localhost:3000", appEnv: "local" })).status).toBe("skipped");
  });
});

describe("§NNN the Administrators' two emails", () => {
  const TYPES = ["DOOR_SHUT", "DOOR_SHUT_DEADLINES_MOVED"] as const;

  it("are values of the enum, queued, on the club's road, waited for by nobody, to no participant", () => {
    for (const type of TYPES) {
      expect(emailMessageType.enumValues).toContain(type);
      expect(NEVER_QUEUED_MESSAGE_TYPES.has(type)).toBe(false);
      expect(EMAIL_GROUP_OF[type]).toBe("club");
      expect(isWaitedFor(type, false)).toBe(false);
      expect(isParticipantMessage(type)).toBe(false);
    }
  });

  it("have their name and «când» lines on /admin/emails, in both languages, each under 200 characters", () => {
    for (const catalogue of [ro, en]) {
      for (const type of TYPES) {
        for (const line of [catalogue.Admin.emails.types[type], catalogue.Admin.emails.when[type], catalogue.Admin.emails.whenShort[type], catalogue.Admin.emails.whenMore[type]]) {
          expect(line).toBeTruthy();
          expect(line.length).toBeLessThan(200);
        }
      }
      expect(catalogue.Admin.emails.deadlines.help.doorShutMaxHours.length).toBeLessThan(200);
    }
  });

  it("say every paragraph and the bold line in under 200 characters, the counts in words on the bold line", () => {
    const facts = readDoorShutFacts({ startedAt: "2026-10-03T07:00:00.000Z", endedAt: "2026-10-04T07:00:00.000Z", source: "pings", stoppedMinutes: 2880, maxHours: 48, moved: 21, outside: 2 });
    for (const locale of ["ro", "en"] as const) {
      for (const line of [...doorShutBody(locale), ...doorShutMovedBody(locale), doorShutFactsLine(locale, facts), doorShutMovedFactsLine(locale, facts)]) {
        expect(line.length, line).toBeLessThan(200);
      }
    }
    expect(doorShutMovedFactsLine("ro", facts)).toContain("21 de termene mutate");
    expect(doorShutMovedFactsLine("ro", facts)).toContain("2 înscrieri pe «Lista de invitați speciali»");
    expect(doorShutMovedFactsLine("en", facts)).toContain("2 registrations on «Special guests list»");
    expect(doorShutMovedFactsLine("ro", { ...facts, outside: 0 })).not.toContain("Lista de invitați speciali");
    expect(doorShutMovedFactsLine("ro", facts)).toContain("nicio verificare programată");
  });

  it("reads a payload it cannot read as empty, never throwing", () => {
    expect(readDoorShutFacts(null)).toMatchObject({ startedAt: "", endedAt: null, moved: 0, outside: 0 });
    expect(readDoorShutFacts({ moved: "x", outside: 1.5 })).toMatchObject({ moved: 0, outside: 0 });
  });

  it("previews in both halves: the window, the stop, the counts, and no participant's privacy line", () => {
    const moved = renderBilingual("DOOR_SHUT_DEADLINES_MOVED", "ro", emailSampleFor("DOOR_SHUT_DEADLINES_MOVED", "ro"), "https://example.test/ro/admin/tasks", null);
    expect(moved.text).toContain("oprit 7 ore");
    expect(moved.text).toContain("12 termene mutate");
    expect(moved.text).toContain("o înscriere pe «Lista de invitați speciali»");
    expect(moved.text).toContain("stopped 7 hours");
    expect(moved.text).not.toContain("Nota de confidențialitate");
    const shut = renderBilingual("DOOR_SHUT", "en", emailSampleFor("DOOR_SHUT", "en"), undefined, null);
    expect(shut.text).toContain("48 hours");
    expect(shut.text).toContain("48 de ore");
  });
});
