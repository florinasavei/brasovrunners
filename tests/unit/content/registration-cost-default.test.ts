import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { initialCostTypeOf } from "@/modules/content/events/ui/box-summaries";

/**
 * §NNN — the owner, 2026-09-25: "by default toate evenimentele sunt gratuite". A new event's
 * cost select preselects `FREE` (`initialCostTypeOf`, tested on its own in
 * `box-summaries.test.ts`); this checks that `RegistrationBox` actually reads the select's
 * `defaultValue`, and `CostFields`' visibility switch, off that one function — so the create
 * page and the closed summary can never drift apart on what "default" means.
 *
 * A save that never opens the box still writes `FREE`: the select is a real form control inside
 * the box's `<details>`, and a closed `<details>` still submits what is inside it (unlike a box
 * hidden by `OnlyForType`/`OnlyForMode`, which the service has to ignore on purpose). No schema
 * or column change was needed — `content/events/fields.ts#costType` already accepts a real
 * enum value; only the form's own default was missing.
 */
const SOURCE = readFileSync(path.join(process.cwd(), "src", "modules", "content", "events", "ui", "boxes", "RegistrationBox.tsx"), "utf8");

describe("§NNN a new event starts free", () => {
  it("computes the box's cost value with initialCostTypeOf, not straight off the event", () => {
    expect(SOURCE).toContain("const initialCostType = initialCostTypeOf(event);");
  });

  it("preselects the cost select off that value", () => {
    expect(SOURCE).toMatch(/name="event\.costType"[\s\S]{0,300}defaultValue=\{initialCostType\}/);
  });

  it("keeps CostFields' shown/hidden switch and the closed line off the same value", () => {
    expect(SOURCE).toContain("initialCostType={initialCostType}");
    expect(SOURCE).toMatch(/costAmount = initialCostType === "PAID" \|\| initialCostType === "DONATION"/);
    expect(SOURCE).toMatch(/costLabel = initialCostType \?/);
  });
});

describe("§NNN initialCostTypeOf agrees with RegistrationBox's use of it", () => {
  it("FREE on create, kept as typed on an edit — including an unstated cost", () => {
    expect(initialCostTypeOf(null)).toBe("FREE");
    expect(initialCostTypeOf({ costType: null })).toBe("");
    expect(initialCostTypeOf({ costType: "PAID" })).toBe("PAID");
  });
});
