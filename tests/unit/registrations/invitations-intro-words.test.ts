import { describe, expect, it } from "vitest";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";

/**
 * «Invitații» says that an invitation's link works while registration on the site is stopped or closed
 * (BR-REQ-037-07). The owner asked it twice — 2026-11-04: «trebuie să poată lumea să se înscrie prin invitație,
 * chiar dacă înscrierile pe site sunt închise»; 2026-11-11: «zi asta: invitații speciali se pot înscrie chiar
 * dacă înscrierile sunt oprite, nu?» — because no screen answered. The behaviour is
 * `elite-at-entry-and-invitation.test.ts` («an invitation is accepted with the public door shut»); this holds the
 * sentence, so rewording it away fails a test.
 */
describe("BR-REQ-037-07 «Invitații» says the link works while registration on the site is stopped or closed", () => {
  it("in both languages, in the panel's own intro, within the length a help line may have", () => {
    const roIntro = ro.Admin.invitations.intro;
    const enIntro = en.Admin.invitations.intro;
    expect(roIntro).toContain("Linkul merge și cu înscrierile de pe site oprite sau închise.");
    expect(enIntro).toContain("The link works even while registration on the site is stopped or closed.");
    expect(roIntro.length).toBeLessThanOrEqual(200);
    expect(enIntro.length).toBeLessThanOrEqual(200);
  });
});
