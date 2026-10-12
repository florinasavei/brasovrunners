import { describe, expect, it } from "vitest";
import { privacyNoticeEn, privacyNoticeRo } from "@/modules/legal-documents/templates/privacy-notice";

/**
 * §741 (amends §739, §718) — the notice's template says what the site does: an event's Strava map
 * loads with the page (with both providers' maps, the chosen tab's first), each provider then seeing the
 * visitor's IP address; only a YouTube film still waits for a press.
 */
const paragraphs = (body: typeof privacyNoticeRo) => body.sections.flatMap((s) => s.paragraphs);
const cookies = (body: typeof privacyNoticeRo, marker: string) => {
  const found = paragraphs(body).filter((p) => p.includes(marker));
  expect(found).toHaveLength(1);
  return found[0]!;
};

describe("§741 the notice's route-map sentence", () => {
  it("ro: names Strava and Garmin Connect as receiving the IP address, and no map waits for a press", () => {
    const p = cookies(privacyNoticeRo, "YouTube");
    expect(p).toMatch(/Strava/);
    expect(p).toMatch(/Garmin Connect/);
    expect(p).toMatch(/Strava, respectiv Garmin, primește adresa ta IP/);
    expect(p).toMatch(/și pe Strava, și pe Garmin Connect, se încarcă doar cea din fila aleasă \(întâi Strava\)/);
    expect(p).not.toMatch(/Garmin Connect când alegi fila/);
    expect(p).toMatch(/Un videoclip YouTube[^.]*doar când apeși/);
    expect(p).not.toMatch(/harta[^.]*doar când apeși/i);
  });

  it("en: names Strava and Garmin Connect as receiving the IP address, and no map waits for a press", () => {
    const p = cookies(privacyNoticeEn, "YouTube");
    expect(p).toMatch(/Strava/);
    expect(p).toMatch(/Garmin Connect/);
    expect(p).toMatch(/Strava, or Garmin, receives your IP address/);
    expect(p).toMatch(/both Strava and Garmin Connect, only the one in the chosen tab loads \(Strava first\)/);
    expect(p).not.toMatch(/Garmin Connect map when you choose its tab/);
    expect(p).toMatch(/A YouTube video[^.]*only when you press/);
    expect(p).not.toMatch(/map[^.]*only when you press/i);
  });
});
