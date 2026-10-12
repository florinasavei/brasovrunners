import { describe, expect, it } from "vitest";
import { privacyNoticeEn, privacyNoticeRo } from "@/modules/legal-documents/templates/privacy-notice";

/**
 * §NNN (amends §739, §718) — the notice's template says what the site does: an event's Strava map
 * loads with the page, Garmin Connect's when its tab is chosen, each provider then seeing the
 * visitor's IP address; only a YouTube film still waits for a press.
 */
const paragraphs = (body: typeof privacyNoticeRo) => body.sections.flatMap((s) => s.paragraphs);
const cookies = (body: typeof privacyNoticeRo, marker: string) => {
  const found = paragraphs(body).filter((p) => p.includes(marker));
  expect(found).toHaveLength(1);
  return found[0]!;
};

describe("§NNN the notice's route-map sentence", () => {
  it("ro: names Strava and Garmin Connect as receiving the IP address, and no map waits for a press", () => {
    const p = cookies(privacyNoticeRo, "YouTube");
    expect(p).toMatch(/Strava/);
    expect(p).toMatch(/Garmin Connect/);
    expect(p).toMatch(/Strava, respectiv Garmin, primește adresa ta IP/);
    expect(p).toMatch(/Un videoclip YouTube[^.]*doar când apeși/);
    expect(p).not.toMatch(/harta[^.]*doar când apeși/i);
  });

  it("en: names Strava and Garmin Connect as receiving the IP address, and no map waits for a press", () => {
    const p = cookies(privacyNoticeEn, "YouTube");
    expect(p).toMatch(/Strava/);
    expect(p).toMatch(/Garmin Connect/);
    expect(p).toMatch(/Strava, or Garmin, receives your IP address/);
    expect(p).toMatch(/A YouTube video[^.]*only when you press/);
    expect(p).not.toMatch(/map[^.]*only when you press/i);
  });
});
