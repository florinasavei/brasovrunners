import { describe, expect, it } from "vitest";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { describesListSocials, isMergeField, mergeText } from "@/modules/legal-documents/domain/merge-fields";
import { privacyNoticeEn, privacyNoticeRo } from "@/modules/legal-documents/templates/privacy-notice";
import { termsEn, termsRo } from "@/modules/legal-documents/templates/terms";
import { DECLARATION_TOKENS } from "@/modules/legal-documents/templates/tokens";
import { withoutAnotherAdultsConsents } from "@/modules/registrations/fields";
import { readRegistrationForm } from "@/modules/registrations/form-mapping";
import { listSocialsClause, listSocialsMergeValues } from "@/modules/registrations/list-socials-words";
import { instagramProfileUrl, publicInstagramUrl, publicStravaUrl } from "@/modules/registrations/social-links";
import { REGISTRATION_SHEET_HEADERS } from "@/modules/registrations/workbook";

/**
 * §500 (widening §106) — Strava and Instagram beside a name on the public list: the privacy
 * notice's marker that switches it on, the form's tick, and the addresses a public page may print.
 */
describe("§500 the privacy notice's marker for the socials", () => {
  const text = (paragraph: string) => ({ sections: [{ paragraphs: [paragraph] }] });

  it("is a merge field the platform's notice and terms carry, in both languages, and the legend lists", () => {
    expect(isMergeField("participantListSocials")).toBe(true);
    expect(describesListSocials(privacyNoticeRo)).toBe(true);
    expect(describesListSocials(privacyNoticeEn)).toBe(true);
    expect(describesListSocials(termsRo)).toBe(true);
    expect(describesListSocials(termsEn)).toBe(true);
    const legend = DECLARATION_TOKENS.find((entry) => entry.token === "{{participantListSocials}}");
    expect(legend?.example).toEqual({ ro: listSocialsClause("ro"), en: listSocialsClause("en") });
  });

  it("is off for a text that does not name it, and a near miss is not the marker", () => {
    expect(describesListSocials(text("Lista publică arată doar numele participanților confirmați."))).toBe(false);
    expect(describesListSocials(text("{{participantListStates}}"))).toBe(false);
    expect(describesListSocials(text("{{participantListSocial}}"))).toBe(false);
    expect(describesListSocials("not a body")).toBe(false);
    expect(describesListSocials(text("Bifa {{ participantListSocials }}."))).toBe(true);
  });

  it("is filled with the form's own tick, quoted, in the notice's language — so the text names the box a runner ticks", () => {
    expect(listSocialsClause("ro")).toBe(`„${ro.Registration.listSocials}”`);
    expect(listSocialsClause("en")).toBe(`“${en.Registration.listSocials}”`);
    for (const [locale, body] of [["ro", privacyNoticeRo], ["en", privacyNoticeEn]] as const) {
      const all = body.sections.flatMap((section) => section.paragraphs).map((paragraph) => mergeText(paragraph, listSocialsMergeValues(locale))).join(" ");
      expect(all).toContain(listSocialsClause(locale));
      expect(all).not.toContain("{{participantListSocials}}");
    }
  });

  it("no longer lets the notice promise the socials never reach the site", () => {
    const socialsParagraph = (body: typeof privacyNoticeRo) =>
      body.sections.flatMap((section) => section.paragraphs).find((paragraph) => paragraph.includes("Strava") && paragraph.includes("6(1)(a)") && !paragraph.includes("{{"));
    expect(socialsParagraph(privacyNoticeRo)).not.toContain("pe site nu le publicăm");
    expect(socialsParagraph(privacyNoticeEn)).not.toContain("never publish them on the site");
  });
});

describe("§500 the form's tick", () => {
  it("is read as posted — the service, not the form, decides what is kept", () => {
    const form = new FormData();
    expect(readRegistrationForm(form, "ro").listSocials).toBe(false);
    form.set("listSocials", "on");
    expect(readRegistrationForm(form, "ro").listSocials).toBe(true);
  });

  it("is never another adult's to give from someone else's address (§421)", () => {
    const now = new Date("2026-09-25T10:00:00.000Z");
    const kept = withoutAnotherAdultsConsents({ birthDate: "1990-01-01", listSocials: true, listOptOut: false }, now) as Record<string, unknown>;
    expect(kept.listSocials).toBe(false);
    expect(kept.listOptOut).toBe(true);
  });
});

describe("§500 the export says whose socials the list prints", () => {
  it("carries the column beside Instagram on the spreadsheet", () => {
    const at = REGISTRATION_SHEET_HEADERS.indexOf("Instagram");
    expect(REGISTRATION_SHEET_HEADERS[at + 1]).toBe("Socials on the public list");
  });
});

describe("§500 the addresses a public page may print", () => {
  it("prints Strava's own addresses and a well-formed username's profile, and nothing else", () => {
    expect(publicStravaUrl("https://www.strava.com/athletes/12345")).toBe("https://www.strava.com/athletes/12345");
    expect(publicStravaUrl("https://strava.com/athletes/12345")).toBe("https://www.strava.com/athletes/12345");
    expect(publicStravaUrl("https://www.strava.com/athletes/12345/")).toBe("https://www.strava.com/athletes/12345");
    expect(publicStravaUrl("https://www.strava.com/pros/67890")).toBe("https://www.strava.com/pros/67890");
  });

  it("drops the app's share links (a third party's redirector) and anything not over https (§500)", () => {
    expect(publicStravaUrl("https://strava.app.link/AbC123")).toBeNull();
    expect(publicStravaUrl("http://www.strava.com/athletes/12345")).toBeNull();
    expect(publicStravaUrl("http://strava.com/athletes/12345")).toBeNull();
    expect(publicStravaUrl("https://strava.com.example.test/athletes/1")).toBeNull();
  });

  it("keeps refusing any other host and a username of the wrong shape", () => {
    expect(publicStravaUrl("https://example.com/athletes/1")).toBeNull();
    expect(publicStravaUrl("javascript:alert(1)")).toBeNull();
    expect(publicStravaUrl(null)).toBeNull();
    expect(publicInstagramUrl("ana.pop")).toBe(instagramProfileUrl("ana.pop"));
    expect(instagramProfileUrl("ana.pop")).toBe("https://www.instagram.com/ana.pop/");
    expect(publicInstagramUrl("bad handle!")).toBeNull();
    expect(publicInstagramUrl("")).toBeNull();
  });
});
