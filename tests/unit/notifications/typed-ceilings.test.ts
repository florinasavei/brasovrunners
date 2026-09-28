import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { EMAIL_PLAN_IDS, TYPED_CEILING_PLAN_IDS, takesTypedCeilings } from "@/modules/notifications/domain/email-plan";
import { TYPED_CEILINGS_ATTRIBUTE, typedCeilingsHiddenSelector } from "@/modules/notifications/ui/typed-ceilings";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";

/**
 * §551, amending `DECISIONS.md` §100 — the typed monthly and daily limits on the Mailgun plan card
 * show only while «Altceva» is chosen. The owner, 2026-09-28: «ar trebui să apară doar când chiar
 * am selectat Altceva».
 */
describe("§551 the typed-ceiling boxes show only under «Altceva»", () => {
  const selector = typedCeilingsHiddenSelector();
  const shown: Record<(typeof EMAIL_PLAN_IDS)[number], boolean> = {
    FREE: false,
    BASIC: false,
    FOUNDATION: false,
    SCALE: false,
    CUSTOM: true,
  };

  for (const id of EMAIL_PLAN_IDS) {
    it(`${id}: the boxes are ${shown[id] ? "shown" : "hidden"}`, () => {
      expect(takesTypedCeilings(id)).toBe(shown[id]);
      // The hide rule is "hidden unless this option is the checked one": a plan's option is in
      // the exception list exactly when its choice shows the boxes.
      expect(selector.includes(`option[value="${id}"]:checked`)).toBe(shown[id]);
    });
  }

  it("names only «Altceva» and hides the marked boxes, never the select", () => {
    expect(TYPED_CEILING_PLAN_IDS).toEqual(["CUSTOM"]);
    expect(selector).toBe(`&:not(:has(select[name="plan"] option[value="CUSTOM"]:checked)) [${TYPED_CEILINGS_ATTRIBUTE}]`);
  });

  const panel = readFileSync(join(process.cwd(), "src/modules/notifications/ui/EmailPlanPanel.tsx"), "utf8");

  it("puts the rule on the stack that holds the select, and the mark on the boxes' row alone", () => {
    expect(panel).toContain("[typedCeilingsHiddenSelector()]: { display: \"none\" }");
    expect(panel.match(/\[TYPED_CEILINGS_ATTRIBUTE\]: ""/g)).toHaveLength(1);
    const boxes = panel.slice(panel.indexOf("[TYPED_CEILINGS_ATTRIBUTE]"), panel.indexOf("emails.plan.customHelp"));
    expect(boxes).toContain('name="dailyAllowance"');
    expect(boxes).toContain('name="monthlyAllowance"');
    expect(boxes).not.toContain('name="plan"');
    // A hidden box carries no constraint the browser would block a save on (the service checks).
    expect(boxes).not.toContain('type="number"');
    expect(boxes).not.toMatch(/\bmin:/);
  });

  it("says in the help line, in both languages, when the boxes appear", () => {
    expect(ro.Admin.emails.plan.customHelp).toMatch(/^Căsuțele de limite apar doar când alegi „Altceva”/);
    expect(en.Admin.emails.plan.customHelp).toMatch(/^The limit boxes appear only when you choose “Something else”/);
    // And what one empty box means — no such ceiling — not only the case of both empty (§100).
    expect(ro.Admin.emails.plan.customHelp).toContain("o căsuță lăsată goală înseamnă că limita aceea nu există");
    expect(en.Admin.emails.plan.customHelp).toContain("a box left empty means that limit does not exist");
    for (const text of [ro.Admin.emails.plan.customHelp, en.Admin.emails.plan.customHelp]) expect(text.length).toBeLessThanOrEqual(200);
  });
});
