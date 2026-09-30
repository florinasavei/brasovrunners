import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ALIGN_STRETCH_MINUTES, DAILY_WINDOW_LABEL } from "@/modules/jobs/schedule";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";

/**
 * §334 (jobs sleep when nothing is due) × §221 — what the throttle card says about email is true
 * whichever way the club's email leaves.
 *
 * The card said "emails go out right after the request that queued them" as a consequence nothing
 * changes. That holds for `immediate`, the default; with `scheduled` the outbox job is the only
 * sender, so the interval chosen on this very card delays every email by up to that many minutes.
 * The sentence is now picked by the setting in force, and the unconditional "what does not change"
 * line no longer mentions email at all.
 */
vi.mock("next-intl/server", async () => {
  const { createTranslator } = await import("next-intl");
  const messages = (await import("../../../messages/ro.json")).default;
  return {
    getTranslations: async (namespace: string) => createTranslator({ locale: "ro", messages, namespace: namespace as "Admin" }),
    // The confirmation's words (`confirmWords`, §384) count in the page's language.
    getLocale: async () => "ro",
  };
});
vi.mock("@/app/[locale]/admin/settings/costs/actions", () => ({ updateJobCadenceAction: async () => null }));

const { default: JobCadencePanel } = await import("@/modules/jobs/ui/JobCadencePanel");

async function render(emailTiming: "immediate" | "scheduled"): Promise<string> {
  const html = renderToStaticMarkup(
    (await JobCadencePanel({ locale: "ro", cadence: { minutes: 60, updatedAt: null }, jobs: [], mayEdit: false, emailTiming })) as ReactElement,
  );
  return html.replace(/<style[^>]*>[\s\S]*?<\/style>/g, "");
}

describe("§334, §221 the throttle card's sentence about email", () => {
  it("says email leaves after the request, whatever the interval, when that is how it leaves", async () => {
    const html = await render("immediate");
    expect(html).toContain(ro.Admin.tasks.jobCadence.emails.immediate);
    expect(html).not.toContain(ro.Admin.tasks.jobCadence.emails.scheduled);
  });

  it("says the interval delays email too when the outbox job is the only sender", async () => {
    const html = await render("scheduled");
    expect(html).toContain(ro.Admin.tasks.jobCadence.emails.scheduled);
    expect(html).not.toContain(ro.Admin.tasks.jobCadence.emails.immediate);
  });

  /*
    §350 weekday on every date: the card's times are platform timestamps, so they are read in the
    club's zone, with the weekday, and inside the line after a colon the weekday keeps Romanian's
    lower case — the helper's words, not a bare "24 sept. 2026, 10:15".
  */
  it("says each time with its weekday, in the club's zone, through the one date helper", async () => {
    const html = renderToStaticMarkup(
      (await JobCadencePanel({
        locale: "ro",
        cadence: { minutes: 60, updatedAt: new Date("2026-09-24T07:00:00Z") },
        jobs: [
          {
            job: "registration-maintenance",
            lastRealRunAt: new Date("2026-09-24T07:15:00Z"),
            nextCheckAt: new Date("2026-09-24T08:15:00Z"),
            waitingFor: "cadence",
            source: "cache",
            lastPingAt: new Date("2026-09-24T07:30:00Z"),
            lastPingRan: false,
          },
        ],
        mayEdit: false,
        emailTiming: "immediate",
      })) as ReactElement,
    ).replace(/<style[^>]*>[\s\S]*?<\/style>/g, "");
    expect(html).toContain("ultima rulare reală: joi, 24 sept. 2026, la 10:15");
    expect(html).toContain("următoarea, cel târziu: joi, 24 sept. 2026, la 11:15 (intervalul tău)");
    expect(html).toContain("ultimul ping: joi, 24 sept. 2026, la 10:30, sărit fără bază de date");
    expect(html).toContain("Setat joi, 24 sept. 2026, la 10:00.");
  });

  it("keeps email out of the line that holds in every case, in both languages", () => {
    for (const messages of [ro, en]) {
      expect(messages.Admin.tasks.jobCadence.safe).not.toMatch(/email/i);
      expect(messages.Admin.tasks.jobCadence.emails.immediate).toBeTruthy();
      expect(messages.Admin.tasks.jobCadence.emails.scheduled).toBeTruthy();
    }
  });
});

/*
  BR-REQ-090-03 criterion 14, as §NNN amends §355: the card says why an idle day costs one wake —
  the safety look is the daily window at 04:00, with the monitor's full check — to a reader who
  may not change it too.
*/
describe("§NNN the throttle card says the safety look is once a day, at the window", () => {
  it("says it on the card with the window's time, whether or not the reader may change the interval", async () => {
    const html = await render("immediate");
    expect(html).toContain('data-testid="job-cadence-on-the-hour"');
    expect(html).toContain(ro.Admin.tasks.jobCadence.onTheHour.replace("{time}", DAILY_WINDOW_LABEL));
    expect(DAILY_WINDOW_LABEL).toBe("04:00");
  });

  // The line on the card and its «?» (§511): one sentence visible, the reasons in the tooltip.
  const onTheHour = (messages: typeof ro) => `${messages.Admin.tasks.jobCadence.onTheHour} ${messages.Admin.tasks.jobCadence.onTheHourMore}`;

  it("names the day, the window, the deep health check and the one wake of an idle day in both languages", () => {
    expect(onTheHour(ro)).toMatch(/o dată pe zi, la \{time\}.*\/api\/health\?deep=1.*O zi fără nimic de făcut costă o singură trezire/);
    expect(onTheHour(en)).toMatch(/once a day, at \{time\}.*\/api\/health\?deep=1.*A day with nothing to do costs one wake/);
    // A deadline keeps its own time: the sentence must not suggest a hold waits for 04:00.
    expect(onTheHour(ro)).toMatch(/își păstrează ora lui/);
    expect(onTheHour(en)).toMatch(/keeps its own time/);
  });

  it("puts the reasons behind the card's «?», with the window's time filled in", async () => {
    const html = await render("immediate");
    expect(html).toContain(`aria-label="${ro.Admin.tasks.jobCadence.onTheHourMore.replace("{time}", DAILY_WINDOW_LABEL)}"`);
  });

  it("promises no more lateness than the scheduler keeps: some runs, each at most the stretch late", () => {
    expect(ALIGN_STRETCH_MINUTES).toBe(15);
    expect(onTheHour(ro)).toMatch(/unele pot întârzia cu până la un sfert de oră/);
    expect(onTheHour(en)).toMatch(/some may be up to a quarter of an hour late/);
    expect(onTheHour(ro)).not.toMatch(/jumătate/);
    expect(onTheHour(en)).not.toMatch(/half an hour/);
  });
});
