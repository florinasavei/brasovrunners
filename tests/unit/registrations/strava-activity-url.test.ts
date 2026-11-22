import { describe, expect, it } from "vitest";
import { stravaActivityUrl } from "@/modules/registrations/social-links";

/**
 * §1048 — «Activitatea ta pe Strava»: what the runner may paste, and the one address the platform keeps and prints. An activity on
 * strava.com, however it was copied — never the app's `strava.app.link` redirector (§500), a profile, or another site.
 */
describe("§1048 a Strava activity, normalised", () => {
  it("keeps an activity on strava.com as `https://www.strava.com/activities/<id>`, however it was copied", () => {
    for (const typed of [
      "https://www.strava.com/activities/16512345678",
      "https://strava.com/activities/16512345678",
      "http://www.strava.com/activities/16512345678",
      "www.strava.com/activities/16512345678",
      "strava.com/activities/16512345678",
      "  https://www.strava.com/activities/16512345678/overview  ",
      "https://www.strava.com/activities/16512345678?share_sig=ABC123&utm_medium=social",
      "https://www.strava.com/activities/16512345678#comments",
      "HTTPS://WWW.STRAVA.COM/activities/16512345678",
    ]) {
      expect(stravaActivityUrl(typed), typed).toBe("https://www.strava.com/activities/16512345678");
    }
  });

  it("refuses the app's redirector, a profile, another site and anything that is not one activity", () => {
    for (const typed of [
      "https://strava.app.link/AbCdEf123",
      "https://www.strava.com/athletes/12345",
      "https://www.strava.com/activities/",
      "https://www.strava.com/activities/abc",
      "https://evil.example/strava.com/activities/123",
      "https://www.strava.com.evil.example/activities/123",
      "https://www.strava.com/activities/123 https://evil.example",
      "javascript:alert(1)",
      "",
    ]) {
      expect(stravaActivityUrl(typed), typed).toBeNull();
    }
    expect(stravaActivityUrl(null)).toBeNull();
    expect(stravaActivityUrl(undefined)).toBeNull();
  });
});
