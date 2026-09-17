import { describe, expect, it } from "vitest";
import { isStravaLink } from "@/modules/events/domain/event-type";

/**
 * BR-REQ-011-01 criterion 8 — the Strava mark beside a route link, and only beside one.
 *
 * The recogniser decides whether the event page decorates "View the route" with Strava's mark.
 * It has to be exact about the host: a look-alike domain carrying the mark would lend a stranger's
 * page the club's endorsement, and a Strava link missing the mark is merely plain.
 */
describe("BR-REQ-011-01 criterion 8 recognising a Strava route link", () => {
  it("recognises Strava routes and activities, on the bare and the www host", () => {
    expect(isStravaLink("https://www.strava.com/routes/3123456789")).toBe(true);
    expect(isStravaLink("https://strava.com/activities/1234567890")).toBe(true);
    expect(isStravaLink("https://WWW.STRAVA.COM/clubs/example")).toBe(true);
  });

  it("does not recognise a look-alike host, or any other service", () => {
    expect(isStravaLink("https://strava.com.example.test/routes/1")).toBe(false);
    expect(isStravaLink("https://notstrava.com/routes/1")).toBe(false);
    expect(isStravaLink("https://routes.example.test/traseu-tampa")).toBe(false);
  });

  it("answers no for something that is not a URL rather than throwing", () => {
    // The column is https-checked, but this is also handed values from a preview and a test.
    expect(isStravaLink("not a url")).toBe(false);
    expect(isStravaLink("")).toBe(false);
  });
});
