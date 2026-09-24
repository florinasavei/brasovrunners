import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ALIGN_STRETCH_MINUTES } from "@/modules/jobs/schedule";
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
  };
});
vi.mock("@/app/[locale]/admin/tasks/actions", () => ({ updateJobCadenceAction: async () => null }));

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
    expect(html).toContain("ultima rulare reală: joi, 24 sept. 2026, 10:15");
    expect(html).toContain("următoarea, cel târziu: joi, 24 sept. 2026, 11:15 (intervalul tău)");
    expect(html).toContain("ultimul ping: joi, 24 sept. 2026, 10:30, sărit fără bază de date");
    expect(html).toContain("Setat joi, 24 sept. 2026, 10:00.");
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
  BR-REQ-090-03 criterion 14 (§NNN): the card says why an idle hour costs one wake — the safety
  look is on the hour, with the health monitor's check — to a reader who may not change it too.
*/
describe("§NNN the throttle card says the safety look is on the hour", () => {
  it("says it on the card, whether or not the reader may change the interval", async () => {
    const html = await render("immediate");
    expect(html).toContain('data-testid="job-cadence-on-the-hour"');
    expect(html).toContain(ro.Admin.tasks.jobCadence.onTheHour);
  });

  it("names the hour, the health monitor and the one wake of an idle hour in both languages", () => {
    expect(ro.Admin.tasks.jobCadence.onTheHour).toMatch(/ora fixă.*\/api\/health.*o oră fără nimic de făcut.*o trezire/);
    expect(en.Admin.tasks.jobCadence.onTheHour).toMatch(/on the hour.*\/api\/health.*idle hour.*one wake/);
  });

  it("promises no more lateness than the scheduler keeps: several checks, each at most the stretch late", () => {
    // `minimumIntervalEnd` moves a run off its interval's marks one stretch at a time — several
    // runs under an hour or two, not one — and the sentence says so, with the stretch's own length.
    expect(ALIGN_STRETCH_MINUTES).toBe(15);
    expect(ro.Admin.tasks.jobCadence.onTheHour).toMatch(/unele verificări pot întârzia fiecare cu până la un sfert de oră/);
    expect(en.Admin.tasks.jobCadence.onTheHour).toMatch(/some checks up to a quarter of an hour late each/);
    expect(ro.Admin.tasks.jobCadence.onTheHour).not.toMatch(/o dată|jumătate/);
    expect(en.Admin.tasks.jobCadence.onTheHour).not.toMatch(/once|half an hour/);
  });
});
