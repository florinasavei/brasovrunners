import { describe, expect, it } from "vitest";
import { emailMessageType } from "@/db/schema/email-outbox";
import { DEADLINE_RULES, DEFAULT_DEADLINES } from "@/modules/deadlines/domain/deadlines";
import {
  DNS_CONFIRM_MS,
  findPingGaps,
  grantedMsFor,
  type KnownWindow,
  movedDeadline,
  outageGraceMaxMs,
  PENDING_HOLD_MS,
  planOutage,
  unreachableWindowState,
} from "@/modules/registrations/domain/outage-grace";
import { jobStalenessThresholdMs } from "@/modules/jobs/quiet-hours";
import { EMAIL_GROUP_OF } from "@/modules/notifications/domain/email-transport";
import { isWaitedFor } from "@/modules/notifications/domain/email-delay";
import { isParticipantMessage } from "@/modules/notifications/domain/club-notices";
import { NEVER_QUEUED_MESSAGE_TYPES } from "@/modules/notifications/domain/never-queued";
import {
  readUnreachableWindowFacts,
  windowClosedBody,
  windowClosedFactsLine,
  windowOpenedBody,
  windowOpenedFactsLine,
} from "@/modules/notifications/outage-grace-words";
import { emailSampleFor } from "@/modules/notifications/email-copy-fields";
import { renderBilingual } from "@/modules/notifications/templates";
import { probedHost, probeStatusOf } from "@/modules/resilience/domain/name-probe";
import { probePublicName } from "@/modules/resilience/name-probe";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";

/**
 * §NNN — the clock stops while the door is shut (the outage grace): the rules, without a database.
 * Which silences of the pinger are a window (the pinger's own threshold, never a second one), what a
 * run does with the name's answer — two «no such name» ten minutes apart before anything opens — where
 * a deadline moves, what «Sarcini» says, and what the name probe makes of a resolver's answer.
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
  const maxMs = outageGraceMaxMs(DEFAULT_DEADLINES);
  const suspicion = (startedAt: Date): KnownWindow => ({ id: "s", source: "dns", startedAt, endedAt: null, confirmedAt: null });
  const open = (startedAt: Date): KnownWindow => ({ id: "w", source: "dns", startedAt, endedAt: null, confirmedAt: startedAt });

  it("opens nothing on a first «no such name»: it is a suspicion, and nothing is held", () => {
    expect(planOutage({ now: NOON, probe: "unresolved", windows: [], gaps: [], maxMs })).toEqual({
      suspect: { startedAt: NOON },
      confirm: null,
      clear: null,
      close: null,
      record: [],
      holding: false,
    });
  });

  it("opens the window on a second «no such name» at least ten minutes later, from the first probe's instant", () => {
    expect(DNS_CONFIRM_MS).toBe(10 * MINUTE);
    const first = at(NOON, -10);
    expect(planOutage({ now: NOON, probe: "unresolved", windows: [suspicion(first)], gaps: [], maxMs })).toMatchObject({
      suspect: null,
      confirm: { id: "s", startedAt: first },
      holding: true,
    });
    // Nine minutes is not ten: still only a suspicion.
    expect(planOutage({ now: NOON, probe: "unresolved", windows: [suspicion(at(NOON, -9))], gaps: [], maxMs })).toMatchObject({ confirm: null, suspect: null, holding: false });
  });

  it("drops the suspicion on an answer in between, and keeps it through a resolver that says nothing", () => {
    expect(planOutage({ now: NOON, probe: "resolves", windows: [suspicion(at(NOON, -5))], gaps: [], maxMs })).toMatchObject({ clear: { id: "s" }, confirm: null, holding: false });
    expect(planOutage({ now: NOON, probe: "skipped", windows: [suspicion(at(NOON, -5))], gaps: [], maxMs })).toMatchObject({ clear: { id: "s" } });
    expect(planOutage({ now: NOON, probe: "unknown", windows: [suspicion(at(NOON, -15))], gaps: [], maxMs })).toMatchObject({ clear: null, confirm: null, holding: false });
  });

  it("starts the window after a silence already recorded inside the suspicion, so no stretch is given back twice", () => {
    const recorded: KnownWindow = { id: "p", source: "pings", startedAt: at(NOON, -50), endedAt: at(NOON, -20), confirmedAt: at(NOON, -20) };
    expect(planOutage({ now: NOON, probe: "unresolved", windows: [suspicion(at(NOON, -60)), recorded], gaps: [], maxMs }).confirm).toEqual({ id: "s", startedAt: at(NOON, -20) });
  });

  it("keeps an open window open while the name is gone or the resolver says nothing, and closes it on an answer", () => {
    const window = open(at(NOON, -60));
    expect(planOutage({ now: NOON, probe: "unresolved", windows: [window], gaps: [], maxMs })).toMatchObject({ suspect: null, close: null, holding: true });
    expect(planOutage({ now: NOON, probe: "unknown", windows: [window], gaps: [], maxMs })).toMatchObject({ close: null, holding: true });
    expect(planOutage({ now: NOON, probe: "resolves", windows: [window], gaps: [], maxMs })).toMatchObject({ close: { id: "w", endedAt: NOON }, holding: false });
    expect(planOutage({ now: NOON, probe: "skipped", windows: [window], gaps: [], maxMs })).toMatchObject({ close: { id: "w", endedAt: NOON }, holding: false });
  });

  it("opens nothing on a resolver that does not answer", () => {
    expect(planOutage({ now: NOON, probe: "unknown", windows: [], gaps: [], maxMs })).toMatchObject({ suspect: null, confirm: null, close: null, record: [], holding: false });
  });

  it("stops holding the sweeps once a window is open longer than the club's cap", () => {
    expect(planOutage({ now: NOON, probe: "unresolved", windows: [open(at(NOON, -(maxMs / MINUTE) - 1))], gaps: [], maxMs }).holding).toBe(false);
  });

  it("records a past silence once: never over a window already written, and a silence beside a suspicion still", () => {
    const gap = { startedAt: at(NOON, -300), endedAt: at(NOON, -200) };
    expect(planOutage({ now: NOON, probe: "resolves", windows: [], gaps: [gap], maxMs }).record).toEqual([gap]);
    const known: KnownWindow = { id: "k", source: "pings", startedAt: at(NOON, -320), endedAt: at(NOON, -190), confirmedAt: at(NOON, -190) };
    expect(planOutage({ now: NOON, probe: "resolves", windows: [known], gaps: [gap], maxMs }).record).toEqual([]);
    // A silence that ends at this run, beside a first «no such name»: the silence is recorded, the name only suspected.
    const endingNow = { startedAt: at(NOON, -100), endedAt: NOON };
    expect(planOutage({ now: NOON, probe: "unresolved", windows: [], gaps: [endingNow], maxMs })).toMatchObject({ record: [endingNow], suspect: { startedAt: NOON } });
  });

  it("at 0 still sees, records, opens and closes windows — it only stops moving and holding", () => {
    expect(planOutage({ now: NOON, probe: "unresolved", windows: [suspicion(at(NOON, -15))], gaps: [], maxMs: 0 })).toMatchObject({ confirm: { id: "s" }, holding: false });
    expect(planOutage({ now: NOON, probe: "unresolved", windows: [open(at(NOON, -60))], gaps: [], maxMs: 0 }).holding).toBe(false);
    expect(planOutage({ now: NOON, probe: "resolves", windows: [open(at(NOON, -60))], gaps: [], maxMs: 0 }).close).toEqual({ id: "w", endedAt: NOON });
    const gap = { startedAt: at(NOON, -300), endedAt: at(NOON, -200) };
    expect(planOutage({ now: NOON, probe: "resolves", windows: [], gaps: [gap], maxMs: 0 }).record).toEqual([gap]);
  });
});

describe("§NNN where a deadline moves", () => {
  const windowStartedAt = at(NOON, -420);
  const grantedMs = 420 * MINUTE;

  it("moves a deadline running at the window's start by the stop, and never one that passed before it", () => {
    expect(movedDeadline({ stored: at(NOON, -300), windowStartedAt, grantedMs, now: NOON })).toEqual(at(NOON, 120));
    expect(movedDeadline({ stored: at(NOON, -421), windowStartedAt, grantedMs, now: NOON })).toBeNull();
    expect(movedDeadline({ stored: windowStartedAt, windowStartedAt, grantedMs, now: NOON })).toBeNull();
  });

  it("caps a hold by the close and the start, and writes nothing that would still be behind now", () => {
    const cap = { registrationClosesAt: at(NOON, 60), startsAt: at(NOON, 600) };
    expect(movedDeadline({ stored: at(NOON, -300), windowStartedAt, grantedMs, now: NOON, cap })).toEqual(at(NOON, 60));
    // An invitation is capped by the start alone.
    expect(movedDeadline({ stored: at(NOON, -300), windowStartedAt, grantedMs, now: NOON, cap: { registrationClosesAt: null, startsAt: at(NOON, 600) } })).toEqual(at(NOON, 120));
    // A close already behind: the cap would move it earlier, so it stays.
    expect(movedDeadline({ stored: at(NOON, -300), windowStartedAt, grantedMs, now: NOON, cap: { registrationClosesAt: at(NOON, -310), startsAt: at(NOON, 600) } })).toBeNull();
    expect(movedDeadline({ stored: at(NOON, -400), windowStartedAt, grantedMs: 60 * MINUTE, now: NOON })).toBeNull();
  });

  it("stops the clock for the window's length, capped by the club's number", () => {
    expect(grantedMsFor({ startedAt: at(NOON, -420), endedAt: NOON }, 48 * HOUR)).toBe(420 * MINUTE);
    expect(grantedMsFor({ startedAt: at(NOON, -420), endedAt: NOON }, 2 * HOUR)).toBe(2 * HOUR);
    expect(grantedMsFor({ startedAt: at(NOON, -420), endedAt: NOON }, 0)).toBe(0);
  });

  it("is a «Termene» number in hours, 0 to a week, 48 by default", () => {
    expect(DEADLINE_RULES.outageGraceMaxHours).toEqual({ unit: "hours", min: 0, max: 168, default: 48 });
    expect(outageGraceMaxMs({ outageGraceMaxHours: 48 })).toBe(48 * HOUR);
  });
});

describe("§NNN what «Sarcini» says of the windows", () => {
  const closed = (overrides: Partial<{ endedAt: Date | null; confirmedAt: Date | null; appliedAt: Date | null; placesOutside: number }> = {}) => ({
    endedAt: at(NOON, -300),
    confirmedAt: at(NOON, -300),
    appliedAt: at(NOON, -300),
    placesOutside: 0,
    ...overrides,
  });

  it("is open while a window is open, and a suspicion is no window", () => {
    expect(unreachableWindowState([closed({ endedAt: null })], NOON)).toBe("open");
    expect(unreachableWindowState([closed({ endedAt: null, confirmedAt: null })], NOON)).toBe("clear");
  });

  it("is outside while the newest window over seated anybody outside the places, however long ago", () => {
    expect(unreachableWindowState([closed({ placesOutside: 2, endedAt: at(NOON, -30 * 24 * 60) })], NOON)).toBe("outside");
    // A newer window that seated nobody: clear.
    expect(unreachableWindowState([closed({ placesOutside: 2, endedAt: at(NOON, -900) }), closed({ endedAt: at(NOON, -60) })], NOON)).toBe("clear");
  });

  it("is stuck while a window over for longer than the hold still has deadlines it could not move", () => {
    expect(unreachableWindowState([closed({ endedAt: at(NOON, -(PENDING_HOLD_MS / MINUTE) - 1), appliedAt: null })], NOON)).toBe("stuck");
    expect(unreachableWindowState([closed({ endedAt: at(NOON, -10), appliedAt: null })], NOON)).toBe("clear");
  });

  it("is clear with no window at all, or one that seated nobody", () => {
    expect(unreachableWindowState([], NOON)).toBe("clear");
    expect(unreachableWindowState([closed()], NOON)).toBe("clear");
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
    expect(await probePublicName({ ...base, now: NOON, resolve: async () => [{ address: "192.0.2.1" }] })).toEqual({ status: "resolves", host: "club.example.com", checkedAt: NOON.toISOString() });
    expect((await probePublicName({ ...base, resolve: async () => Promise.reject(Object.assign(new Error("x"), { code: "ENOTFOUND" })) })).status).toBe("unresolved");
    expect((await probePublicName({ ...base, timeoutMs: 20, resolve: () => new Promise(() => {}) })).status).toBe("unknown");
    expect((await probePublicName({ ...base, resolve: () => { throw new Error("sync"); } })).status).toBe("unknown");
    expect(await probePublicName({ baseUrl: "http://localhost:3000", appEnv: "local", now: NOON })).toEqual({ status: "skipped", host: null, checkedAt: NOON.toISOString() });
  });
});

describe("§NNN the Administrators' two emails", () => {
  const TYPES = ["UNREACHABLE_WINDOW_OPENED", "UNREACHABLE_WINDOW_CLOSED"] as const;
  const facts = (overrides: Record<string, unknown> = {}) =>
    readUnreachableWindowFacts({ startedAt: "2026-10-03T07:00:00.000Z", endedAt: "2026-10-04T07:00:00.000Z", source: "pings", grantedMinutes: 2880, maxHours: 48, moved: 21, outside: 2, ...overrides });

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
      expect(catalogue.Admin.emails.deadlines.help.outageGraceMaxHours.length).toBeLessThan(200);
    }
  });

  it("says in «Termene» what moves, that 0 switches the moving off, and that the windows are still recorded", () => {
    expect(en.Admin.emails.deadlines.help.outageGraceMaxHours).toContain("0 = no moving");
    expect(en.Admin.emails.deadlines.help.outageGraceMaxHours).toContain("still recorded");
    expect(ro.Admin.emails.deadlines.help.outageGraceMaxHours).toContain("0 = fără mutare");
    expect(ro.Admin.emails.deadlines.help.outageGraceMaxHours).toContain("tot se înregistrează");
  });

  it("say every paragraph and the bold line in under 200 characters, in every case, the counts on the bold line only", () => {
    for (const locale of ["ro", "en"] as const) {
      for (const source of ["pings", "dns"]) {
        for (const outside of [0, 2]) {
          for (const maxHours of [0, 48]) {
            const each = facts({ source, outside, maxHours, grantedMinutes: maxHours === 0 ? 0 : 2880 });
            const lines = [...windowOpenedBody(locale, each), ...windowClosedBody(locale, each), windowOpenedFactsLine(locale, each), windowClosedFactsLine(locale, each)];
            for (const line of lines) expect(line.length, line).toBeLessThan(200);
            for (const line of [...windowOpenedBody(locale, each), ...windowClosedBody(locale, each)]) expect(line, line).not.toMatch(/\d/);
          }
        }
      }
    }
    expect(windowClosedFactsLine("ro", facts())).toContain("21 de termene mutate");
    expect(windowClosedFactsLine("ro", facts())).toContain("2 înscrieri pe «Lista de invitați speciali»");
    expect(windowClosedFactsLine("en", facts())).toContain("2 registrations on «Special guests list»");
    expect(windowClosedFactsLine("ro", facts({ outside: 0 }))).not.toContain("Lista de invitați speciali");
    expect(windowClosedFactsLine("ro", facts())).toContain("nicio verificare programată");
  });

  it("names the special guests list in the paragraphs only when somebody was seated there, and says what to do in each case", () => {
    const outsideLine = (locale: "ro" | "en", overrides: Record<string, unknown>) => windowClosedBody(locale, facts(overrides)).filter((line) => line.includes(locale === "en" ? "Special guests list" : "Lista de invitați speciali"));
    expect(outsideLine("en", { outside: 0 })).toEqual([]);
    expect(outsideLine("ro", { outside: 0 })).toEqual([]);
    expect(outsideLine("en", { outside: 1 }).length).toBeGreaterThan(0);
    const last = (overrides: Record<string, unknown>) => windowClosedBody("en", facts(overrides)).at(-1);
    expect(last({ source: "pings", outside: 0 })).toContain("unless the hours above look wrong");
    expect(last({ source: "dns", outside: 0 })).toContain("registrar");
    expect(last({ source: "pings", outside: 2 })).toContain("Special guests list");
    expect(last({ source: "dns", outside: 2 })).toContain("Special guests list");
    // The moving switched off: the email says so instead of a move that did not happen.
    expect(windowClosedBody("en", facts({ maxHours: 0, grantedMinutes: 0, moved: 0, outside: 0 })).join(" ")).toContain("switched off");
    expect(windowOpenedBody("ro", facts({ maxHours: 0 })).join(" ")).toContain("mutarea oprită");
  });

  it("reads a payload it cannot read as empty, never throwing", () => {
    expect(readUnreachableWindowFacts(null)).toMatchObject({ startedAt: "", endedAt: null, moved: 0, outside: 0 });
    expect(readUnreachableWindowFacts({ moved: "x", outside: 1.5 })).toMatchObject({ moved: 0, outside: 0 });
  });

  it("previews in both halves: the window, what it gave back, the counts, and no participant's privacy line", () => {
    const closed = renderBilingual("UNREACHABLE_WINDOW_CLOSED", "ro", emailSampleFor("UNREACHABLE_WINDOW_CLOSED", "ro"), "https://example.test/ro/admin/tasks", null);
    expect(closed.text).toContain("dat înapoi 7 ore");
    expect(closed.text).toContain("12 termene mutate");
    expect(closed.text).toContain("o înscriere pe «Lista de invitați speciali»");
    expect(closed.text).toContain("given back 7 hours");
    expect(closed.text).not.toContain("Nota de confidențialitate");
    const opened = renderBilingual("UNREACHABLE_WINDOW_OPENED", "en", emailSampleFor("UNREACHABLE_WINDOW_OPENED", "en"), undefined, null);
    expect(opened.text).toContain("48 hours");
    expect(opened.text).toContain("48 de ore");
  });
});
