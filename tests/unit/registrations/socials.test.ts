import { describe, expect, it } from "vitest";
import { INSTAGRAM_HANDLE, registrationSubmissionSchema, STRAVA_URL } from "@/modules/registrations/fields";

/** BR-REQ-031-04 criterion 10 (`DECISIONS.md` §106) — the optional socials: Strava's own links, a bare username. */
const base = {
  firstName: "Ana",
  lastName: "Popescu",
  birthDate: "1990-05-17",
  sex: "UNSPECIFIED",
  nationality: "RO",
  city: "Brașov",
  phone: "+40711111111",
  emergencyContactName: "Ion Popescu",
  emergencyContactPhone: "+40722222222",
  email: "ana@example.ro",
  locale: "ro",
  privacyAcknowledged: true,
  fitnessDeclared: true,
  termsAccepted: true,
  rulesAcknowledged: true,
  resultsNameConsent: false,
  listOptOut: false,
  honeypot: "",
  renderedAt: new Date(Date.now() - 10_000).toISOString(),
};

describe("the socials on the form", () => {
  it("accepts Strava's own addresses and nothing else", () => {
    for (const url of ["https://www.strava.com/athletes/12345", "https://strava.com/athletes/ana_pop", "https://strava.app.link/AbC123"]) {
      expect(STRAVA_URL.test(url), url).toBe(true);
    }
    for (const url of ["https://example.com/athletes/1", "http://www.strava.com/athletes/1", "https://www.strava.com/activities/1", "javascript:alert(1)"]) {
      expect(STRAVA_URL.test(url), url).toBe(false);
    }
    expect(registrationSubmissionSchema.safeParse({ ...base, stravaUrl: "https://example.com/x" }).success).toBe(false);
    const parsed = registrationSubmissionSchema.parse({ ...base, stravaUrl: "https://www.strava.com/athletes/12345" });
    expect(parsed.stravaUrl).toBe("https://www.strava.com/athletes/12345");
  });

  it("stores an Instagram username without the @ and refuses what is not one", () => {
    expect(registrationSubmissionSchema.parse({ ...base, instagramHandle: "@ana.pop" }).instagramHandle).toBe("ana.pop");
    expect(registrationSubmissionSchema.parse({ ...base, instagramHandle: "" }).instagramHandle).toBeUndefined();
    expect(registrationSubmissionSchema.safeParse({ ...base, instagramHandle: "ana pop" }).success).toBe(false);
    expect(registrationSubmissionSchema.safeParse({ ...base, instagramHandle: "https://instagram.com/ana" }).success).toBe(false);
    expect(INSTAGRAM_HANDLE.test("brasov_runners.club")).toBe(true);
  });

  it("means nothing when left empty, which is the common case", () => {
    const parsed = registrationSubmissionSchema.parse({ ...base, stravaUrl: "", instagramHandle: "" });
    expect(parsed.stravaUrl).toBeUndefined();
    expect(parsed.instagramHandle).toBeUndefined();
  });
});
