import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { DEFAULT_IMAGE_QUALITY } from "@/modules/media/ladder";
import { HIGH_WEB_MAX, LOW_WEB_MAX, ORIGINAL_WEB_MAX, WEB_MAX } from "@/modules/media/limits";
import ImageQualityChoice, { type ImageQualityLabels } from "@/modules/media/ui/ImageQualityChoice";

/**
 * BR-REQ-054-01 criterion 12, BR-REQ-050-03 criterion 22 (`DECISIONS.md` §414, four levels since
 * §437) — «Calitate» beside every upload: four choices, smallest first, «Medie» where a new tab
 * starts, and the help that says what each keeps. Rendered as the server sends it, with the
 * catalogue's own words, so a missing or reordered level fails here and not only in the browser.
 */
function labelsOf(catalogue: typeof ro): ImageQualityLabels {
  const rt = catalogue.Admin.richText;
  const help = rt.imageQualityHelp
    .replace("{lowMax}", String(LOW_WEB_MAX))
    .replace("{normalMax}", String(WEB_MAX))
    .replace("{highMax}", String(HIGH_WEB_MAX))
    .replace("{originalMax}", String(ORIGINAL_WEB_MAX));
  return {
    legend: rt.imageQualityLegend,
    low: rt.imageQualityLow,
    normal: rt.imageQualityNormal,
    high: rt.imageQualityHigh,
    original: rt.imageQualityOriginal,
    help,
  };
}

const render = (labels: ImageQualityLabels) =>
  renderToStaticMarkup(createElement(ImageQualityChoice, { value: DEFAULT_IMAGE_QUALITY, onChange: () => {}, labels }));

describe("§437 «Calitate» with four levels", () => {
  it("offers four radios, Minimă, Medie, Mare, Originală, in that order, with Medie checked", () => {
    const html = render(labelsOf(ro));
    const radios = [...html.matchAll(/<input[^>]*type="radio"[^>]*>/g)].map((match) => match[0]);
    expect(radios).toHaveLength(4);
    expect(radios.map((radio) => /value="([a-z]+)"/.exec(radio)?.[1])).toEqual(["low", "normal", "high", "original"]);
    expect(radios.map((radio) => / checked=""/.test(radio))).toEqual([false, true, false, false]);

    const order = ["Minimă", "Medie (recomandat)", "Mare", "Originală"].map((word) => html.indexOf(word));
    for (const position of order) expect(position).toBeGreaterThan(-1);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("says the help, with every level's pixels filled in, in both languages", () => {
    for (const catalogue of [ro, en] as const) {
      const labels = labelsOf(catalogue as typeof ro);
      const html = render(labels);
      expect(html).toContain(labels.legend);
      for (const pixels of [LOW_WEB_MAX, WEB_MAX, HIGH_WEB_MAX, ORIGINAL_WEB_MAX]) expect(labels.help).toContain(String(pixels));
      expect(labels.help).not.toMatch(/\{\w+\}/);
      // The help is the group's description, not a stray paragraph.
      const describedBy = /role="radiogroup"[^>]*aria-describedby="([^"]+)"|aria-describedby="([^"]+)"[^>]*role="radiogroup"/.exec(html);
      const id = describedBy?.[1] ?? describedBy?.[2];
      expect(id).toBeTruthy();
      expect(html).toContain(`id="${id}"`);
      expect(html).toContain(labels.help.slice(0, 40).replace(/&/g, "&amp;"));
    }
  });
});
