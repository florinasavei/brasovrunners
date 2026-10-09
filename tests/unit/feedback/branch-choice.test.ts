import LocalFloristOutlinedIcon from "@mui/icons-material/LocalFloristOutlined";
import { createTranslator } from "next-intl";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { BRANCH_SLUG, FEEDBACK_BRANCHES, type FeedbackBranch } from "@/modules/feedback/domain/branches";
import { branchLabelLang, FEEDBACK_BRANCH_GLYPH, FEEDBACK_BRANCH_TINT } from "@/modules/feedback/ui/branch-glyph";
import { privacyNoticeEn, privacyNoticeRo } from "@/modules/legal-documents/templates/privacy-notice";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";

/**
 * BR-REQ-070-04 — «Spune-ne ceva»'s step 1 as cards (§676, §678, §679), rendered
 * on the server as a visitor's browser receives it: one card per branch offered, each a `<label>` around
 * a visible native radio named `tip` with the branch's slug, its glyph, its name and its hint; the
 * chosen branch checked by default; the women's form in the owner's words; and one glyph for every
 * branch, no more, no fewer.
 */
let locale: "ro" | "en" = "ro";

vi.mock("next-intl/server", () => ({
  getTranslations: async (namespace: string) => createTranslator({ locale, messages: locale === "ro" ? ro : en, namespace: namespace as "Tell" }),
  getLocale: async () => locale,
}));

const { default: BranchChoice } = await import("@/modules/feedback/ui/BranchChoice");

async function render(branches: readonly FeedbackBranch[], chosen: FeedbackBranch, inLocale: "ro" | "en" = "ro") {
  locale = inLocale;
  return renderToStaticMarkup(await BranchChoice({ branches, chosen }));
}

/** The radios in the order drawn, each with its value and whether it is checked. */
function radios(html: string) {
  return [...html.matchAll(/<input[^>]*type="radio"[^>]*>/g)].map(([tag]) => ({
    name: /name="([^"]*)"/.exec(tag)?.[1],
    value: /value="([^"]*)"/.exec(tag)?.[1],
    checked: /\schecked(=""|\s|\/|>)/.test(tag),
    hidden: /opacity|width:\s*1px/.test(tag),
  }));
}

describe("BR-REQ-070-04 step 1: one card per branch offered", () => {
  it("draws four cards, each a label around a visible native radio named tip with the branch's slug and its glyph", async () => {
    const html = await render(FEEDBACK_BRANCHES, "howItWent");

    expect(html).toContain("<fieldset");
    expect(html).toContain("<legend");
    expect(html).toContain(ro.Tell.choose.legend);
    expect(radios(html)).toEqual(
      FEEDBACK_BRANCHES.map((branch, index) => ({ name: "tip", value: BRANCH_SLUG[branch], checked: index === 0, hidden: false })),
    );
    for (const branch of FEEDBACK_BRANCHES) {
      const slug = BRANCH_SLUG[branch];
      const card = new RegExp(`<label[^>]*data-testid="feedback-choice-${slug}"[\\s\\S]*?</label>`).exec(html)?.[0] ?? "";
      expect(card, branch).not.toBe("");
      expect(card).toContain(`data-testid="feedback-glyph-${slug}"`);
      expect(card).toContain(`value="${slug}"`);
      expect(card).toContain(ro.Tell.branches[branch].label);
      expect(card).toContain(ro.Tell.branches[branch].hint);
    }
    // The pictures the decision names, by Material's own test ids.
    for (const icon of ["DirectionsRunIcon", "LightbulbOutlinedIcon", "ReportProblemOutlinedIcon", "LocalFloristOutlinedIcon"]) {
      expect(html).toContain(`data-testid="${icon}"`);
    }
    // No drawn ring standing in for the radio.
    expect(html).not.toContain("RadioButtonCheckedIcon");
    expect(html).not.toContain("RadioButtonUncheckedIcon");
  });

  it("names each radio by its title alone and describes it by its hint", async () => {
    const html = await render(FEEDBACK_BRANCHES, "howItWent");
    for (const branch of FEEDBACK_BRANCHES) {
      const slug = BRANCH_SLUG[branch];
      const input = new RegExp(`<input[^>]*value="${slug}"[^>]*>`).exec(html)?.[0] ?? "";
      expect(input).toContain(`aria-labelledby="feedback-choice-${slug}-title"`);
      expect(input).toContain(`aria-describedby="feedback-choice-${slug}-hint"`);
      expect(html).toMatch(new RegExp(`id="feedback-choice-${slug}-title"[^>]*>${ro.Tell.branches[branch].label}<`));
      expect(html).toMatch(new RegExp(`id="feedback-choice-${slug}-hint"[^>]*>${ro.Tell.branches[branch].hint}<`));
    }
  });

  it("checks the branch ?tip= named, and only the branches offered are drawn", async () => {
    const html = await render(["suggestion", "safety"], "safety");
    expect(radios(html)).toEqual([
      { name: "tip", value: "sugestie", checked: false, hidden: false },
      { name: "tip", value: "siguranta", checked: true, hidden: false },
    ]);
    expect(html).not.toContain("feedback-choice-cum-a-fost");
    expect(html).not.toContain("feedback-choice-reclamatie");
  });

  it("names the women's form and says why, in the owner's words, in both languages", async () => {
    const roHtml = await render(["howItWent", "safety"], "howItWent");
    expect(roHtml).toContain("Girl Zone");
    expect(roHtml).toContain("Știm că alergatul, ca femeie, vine cu provocări în plus. Dacă ceva te-a făcut să nu te simți în siguranță la noi, spune-ne — confidențial.");

    const enHtml = await render(["howItWent", "safety"], "howItWent", "en");
    expect(enHtml).toContain("Girl Zone");
    expect(enHtml).toContain("We know running as a woman comes with extra challenges. If something made you feel unsafe with us, tell us — confidentially.");
  });

  it("the door says whom the confidential form is for, when it is the only one", () => {
    expect(ro.Tell.door.introSafety).toBe("Un formular confidențial pentru femeile care nu s-au simțit în siguranță la noi.");
    expect(en.Tell.door.introSafety).toBe("A confidential form for women who did not feel safe with us.");
  });
});

describe("BR-REQ-070-04 one glyph per branch", () => {
  it("FEEDBACK_BRANCH_GLYPH and its tint cover exactly the branches", () => {
    expect(Object.keys(FEEDBACK_BRANCH_GLYPH).sort()).toEqual([...FEEDBACK_BRANCHES].sort());
    expect(Object.keys(FEEDBACK_BRANCH_TINT).sort()).toEqual([...FEEDBACK_BRANCHES].sort());
    expect(new Set(Object.values(FEEDBACK_BRANCH_GLYPH)).size).toBe(FEEDBACK_BRANCHES.length);
  });

  it("§679 the safety form is «Girl Zone» with a flower, in both languages; the hint and the door's sentence stay", () => {
    expect(FEEDBACK_BRANCH_GLYPH.safety).toBe(LocalFloristOutlinedIcon);
    expect(renderToStaticMarkup(createElement(LocalFloristOutlinedIcon))).toContain('data-testid="LocalFloristOutlinedIcon"');
    expect(ro.Tell.branches.safety.label).toBe("Girl Zone");
    expect(en.Tell.branches.safety.label).toBe("Girl Zone");
    expect(ro.Admin.emails.feedbackForms.branches.safety).toBe("Girl Zone (confidențial)");
    expect(en.Admin.emails.feedbackForms.branches.safety).toBe("Girl Zone (confidential)");
    expect(ro.Tell.branches.safety.hint).toBe(
      "Știm că alergatul, ca femeie, vine cu provocări în plus. Dacă ceva te-a făcut să nu te simți în siguranță la noi, spune-ne — confidențial.",
    );
    expect(en.Tell.branches.safety.hint).toBe(
      "We know running as a woman comes with extra challenges. If something made you feel unsafe with us, tell us — confidentially.",
    );
    expect(ro.Tell.door.introSafety).toBe("Un formular confidențial pentru femeile care nu s-au simțit în siguranță la noi.");
    expect(en.Tell.door.introSafety).toBe("A confidential form for women who did not feel safe with us.");
    for (const catalogue of [ro, en]) expect(JSON.stringify(catalogue)).not.toMatch(/Siguranță pentru femei|Safety for women/);
  });

  it("§679 «Girl Zone» is said as English on the Romanian page, and nothing else carries a lang", async () => {
    expect(branchLabelLang("safety", "ro")).toBe("en");
    expect(branchLabelLang("safety", "en")).toBeUndefined();
    for (const branch of ["howItWent", "suggestion", "complaint"] as const) {
      expect(branchLabelLang(branch, "ro")).toBeUndefined();
      expect(branchLabelLang(branch, "en")).toBeUndefined();
    }
    const roHtml = await render(FEEDBACK_BRANCHES, "howItWent", "ro");
    expect(roHtml).toMatch(/id="feedback-choice-siguranta-title"[^>]*lang="en"|lang="en"[^>]*id="feedback-choice-siguranta-title"/);
    expect(roHtml.match(/lang="/g)).toHaveLength(1);
    const enHtml = await render(FEEDBACK_BRANCHES, "howItWent", "en");
    expect(enHtml).not.toContain('lang="');
  });

  it("§679 the privacy notice's template names «Girl Zone» three times per language and keeps both markers", () => {
    for (const [body, name] of [[privacyNoticeRo, "„Girl Zone”"], [privacyNoticeEn, "“Girl Zone”"]] as const) {
      const text = JSON.stringify(body);
      expect(text.split(name).length - 1).toBe(3);
      expect(text).toContain("{{feedbackForms}}");
      expect(text).toContain("{{feedbackFormsNamed}}");
      expect(text).not.toMatch(/Siguranță pentru femei|Safety for women/);
    }
  });
});
