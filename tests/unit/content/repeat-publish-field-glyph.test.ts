import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RepeatPublishField } from "@/modules/content/events/ui/RepeatRuleFields";

/**
 * `DECISIONS.md` §398 — the owner: the robot glyph belongs "wherever it appears", and the
 * create page's own "Publică datele noi automat" switch (`RepeatFields` → `RepeatPublishField`)
 * had it only on `RecurrenceSeriesPanel`'s state line, never on the switch itself.
 */
describe("§398 RepeatPublishField carries the renew glyph on its own line", () => {
  const render = () =>
    renderToStaticMarkup(
      createElement(RepeatPublishField, {
        name: "repeat.publish",
        draftSource: true,
        labels: { label: "Publică datele noi automat", off: "Rămân ciornă.", draft: "Cât timp seria e ciornă, rămân ciornă." },
      }),
    );

  it("leads the switch's label with the renew (robot) glyph, decorative and aria-hidden", () => {
    const html = render();
    const testId = html.indexOf('data-testid="repeat-publish-field"');
    expect(testId).toBeGreaterThanOrEqual(0);
    const iconIndex = html.indexOf("SmartToyIcon", testId);
    const labelIndex = html.indexOf("Publică datele noi automat", testId);
    expect(iconIndex).toBeGreaterThan(testId);
    expect(labelIndex).toBeGreaterThan(iconIndex);
    // Decorative: hidden from assistive tech, no accessible name of its own.
    const iconTagStart = html.lastIndexOf("<svg", iconIndex);
    const iconTagEnd = html.indexOf(">", iconTagStart);
    expect(html.slice(iconTagStart, iconTagEnd)).toContain('aria-hidden="true"');
  });
});
