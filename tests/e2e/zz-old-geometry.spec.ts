import { expect, test } from "@playwright/test";
import { FEATURED, hydrated } from "./support/featured-event";

// TEMPORARY — measurement only, deleted before commit.
test("measure detail", async ({ page }) => {
  await page.goto(`/ro/evenimente/${FEATURED.slug}/inscriere`);
  await hydrated(page);
  const block = page.getByTestId("registration-consents");
  await expect(block).toBeVisible();
  const detail = await block.evaluate((el) => {
    const out: string[] = [];
    el.querySelectorAll("label, a, .MuiTypography-caption, button, .MuiCheckbox-root, .MuiFormControlLabel-label").forEach((n) => {
      const r = (n as HTMLElement).getBoundingClientRect();
      const cs = getComputedStyle(n as HTMLElement);
      out.push(`${n.tagName}.${(n as HTMLElement).className.toString().slice(0, 40)} y=${Math.round(r.top)} h=${Math.round(r.height)} w=${Math.round(r.width)} lh=${cs.lineHeight} fs=${cs.fontSize} disp=${cs.display} minh=${cs.minHeight} pad=${cs.padding} "${(n.textContent ?? "").slice(0, 30)}"`);
    });
    return out;
  });
  console.log("DETAIL " + page.viewportSize()?.width + "\n" + detail.join("\n"));
});
