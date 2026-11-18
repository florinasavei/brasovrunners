import { describe, expect, it } from "vitest";
import { PLAN_LINK_LABEL_MAX, PLAN_LINK_URL_MAX, PLAN_LINKS_MAX, PLAN_PICTURES_MAX } from "@/db/schema/volunteer-plan";
import { planLinkHost, planLinkShort, planMapsRefusalValues, PlanMapsRefusal, readPlanLinkLabel, readPlanLinkUrl } from "@/modules/volunteers/domain/plan-link";

/**
 * §NNN «Poze și hărți» — what an address must be to stand on the volunteers' plan, and how the page and the email say one: pure
 * rules (`volunteers/domain/plan-link.ts`), held by the service before anything is written.
 */
describe("§NNN a link of the plan", () => {
  it("takes an http(s) address, trimmed, as typed", () => {
    expect(readPlanLinkUrl("  https://www.google.com/maps/d/viewer?mid=1AbC&usp=sharing ")).toBe("https://www.google.com/maps/d/viewer?mid=1AbC&usp=sharing");
    expect(readPlanLinkUrl("http://traseu.example.test/harta.pdf")).toBe("http://traseu.example.test/harta.pdf");
    expect(readPlanLinkUrl("HTTPS://MAPS.EXAMPLE.TEST/X")).toBe("HTTPS://MAPS.EXAMPLE.TEST/X");
  });

  it("refuses anything else, naming its box: another scheme, no host, a space or a control character inside, nothing, too long", () => {
    for (const value of [
      "",
      "  ",
      "javascript:alert(1)",
      "JavaScript:alert(1)",
      "data:text/html;base64,PGI+",
      "mailto:ana.pop@example.test",
      "tel:+40700000001",
      "ftp://files.example.test/harta",
      "file:///C:/harta.png",
      "maps.google.com/d/viewer",
      "//maps.example.test/x",
      "https://",
      "https:///path",
      "https:maps.example.test/x",
      "https://maps.example.test/a b",
      "https://maps.example.test/a\nb",
      "https://maps.example.test/a\u0000b",
      `https://maps.example.test/${"x".repeat(PLAN_LINK_URL_MAX)}`,
      undefined,
      null,
      42,
      ["https://maps.example.test"],
    ]) {
      expect(() => readPlanLinkUrl(value), JSON.stringify(value)?.slice(0, 40)).toThrow(PlanMapsRefusal);
      try {
        readPlanLinkUrl(value);
      } catch (error) {
        expect(error).toMatchObject({ code: "VALIDATION_ERROR", reason: "PLAN_LINK_URL", fields: ["url"] });
      }
    }
  });

  it("keeps a label trimmed, one for both languages, none for an empty one, and refuses one too long", () => {
    expect(readPlanLinkLabel("  Harta voluntarilor  ")).toBe("Harta voluntarilor");
    for (const none of ["", "   ", undefined, null]) expect(readPlanLinkLabel(none)).toBeNull();
    expect(readPlanLinkLabel("h".repeat(PLAN_LINK_LABEL_MAX))).toHaveLength(PLAN_LINK_LABEL_MAX);
    expect(() => readPlanLinkLabel("h".repeat(PLAN_LINK_LABEL_MAX + 1))).toThrow(PlanMapsRefusal);
    expect(() => readPlanLinkLabel("o\nlinie")).toThrow(PlanMapsRefusal);
  });

  it("is said by its host without `www.`, and with no label by its host and the start of its path, cut", () => {
    expect(planLinkHost("https://www.google.com/maps/d/viewer?mid=1")).toBe("google.com");
    expect(planLinkHost("http://traseu.example.test/x")).toBe("traseu.example.test");
    expect(planLinkShort("https://www.google.com/maps/d/viewer?mid=1AbC")).toBe("google.com/maps/d/viewer");
    expect(planLinkShort("https://maps.example.test/")).toBe("maps.example.test");
    const long = planLinkShort("https://traseu.example.test/harti/2026/crosul-de-toamna-varianta-lunga-cu-puncte.pdf");
    expect(long).toHaveLength(48);
    expect(long.endsWith("…")).toBe(true);
  });

  it("fills the sentences' numbers: twelve pictures, twelve links, 120 characters", () => {
    expect([PLAN_PICTURES_MAX, PLAN_LINKS_MAX, PLAN_LINK_URL_MAX, PLAN_LINK_LABEL_MAX]).toEqual([12, 12, 2000, 120]);
    expect(planMapsRefusalValues("PLAN_PICTURES_FULL")).toEqual({ max: "12" });
    expect(planMapsRefusalValues("PLAN_LINKS_FULL")).toEqual({ max: "12" });
    expect(planMapsRefusalValues("PLAN_LINK_LABEL")).toEqual({ max: "120" });
    expect(planMapsRefusalValues("PLAN_LINK_URL")).toEqual({});
    expect(planMapsRefusalValues("FORBIDDEN")).toEqual({});
  });
});
