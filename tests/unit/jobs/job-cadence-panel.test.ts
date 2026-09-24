import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
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
    §NNN weekday on every date: the card's times are platform timestamps, so they are read in the
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
            job: "maintenance",
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
