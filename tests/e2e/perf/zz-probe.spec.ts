import { test } from "@playwright/test";
import { hydrated, signIn } from "../support/featured-event";

// TEMPORARY probe — deleted before commit.
test.skip(process.env.PERF_PROBE !== "1", "probe");
test("probe: what a stylesheet insertion costs on the create page", async ({ page }) => {
  await signIn(page, "Dev Administrator");
  await page.goto("/ro/admin/events/new");
  await hydrated(page);
  await page.waitForTimeout(1000);
  const result = await page.evaluate(async () => {
    const frame = () => new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));
    const out: Record<string, unknown> = {};
    const sheets = [...document.styleSheets].map((sheet) => ({
      node: (sheet.ownerNode as HTMLElement | null)?.outerHTML?.slice(0, 80),
      rules: (() => {
        try {
          return sheet.cssRules.length;
        } catch {
          return -1;
        }
      })(),
      fontFaces: (() => {
        try {
          return [...sheet.cssRules].filter((rule) => rule instanceof CSSFontFaceRule).length;
        } catch {
          return -1;
        }
      })(),
      keyframes: (() => {
        try {
          return [...sheet.cssRules].filter((rule) => rule instanceof CSSKeyframesRule).length;
        } catch {
          return -1;
        }
      })(),
    }));
    out.sheets = sheets;
    const time = (label: string, act: () => void) => {
      const t0 = performance.now();
      act();
      document.body.getBoundingClientRect();
      void document.body.offsetHeight;
      out[label] = Math.round((performance.now() - t0) * 10) / 10;
    };
    await frame();
    time("noop", () => undefined);
    await frame();
    const emotion = [...document.styleSheets].filter((sheet) => (sheet.ownerNode as HTMLElement | null)?.getAttribute?.("data-emotion")?.startsWith("mui"));
    out.emotionSheets = emotion.map((sheet) => (sheet.ownerNode as HTMLElement).getAttribute("data-emotion"));
    const main = emotion[emotion.length - 1];
    time("insert plain rule", () => main.insertRule(".perf-probe-a{color:red}", main.cssRules.length));
    await frame();
    time("insert media rule", () => main.insertRule("@media (prefers-reduced-motion: no-preference){.perf-probe-b{animation:br-run 900ms infinite}}", main.cssRules.length));
    await frame();
    time("insert layered rule", () => main.insertRule("@layer mui{@layer components{.perf-probe-d{color:green}}}", main.cssRules.length));
    await frame();
    time("insert layered rule again", () => main.insertRule("@layer mui{@layer components{.perf-probe-e{color:green}}}", main.cssRules.length));
    await frame();
    time("insert plain rule again", () => main.insertRule(".perf-probe-f{color:red}", main.cssRules.length));
    await frame();
    out.sampleRules = [...main.cssRules].slice(0, 3).map((rule) => rule.cssText.slice(0, 160));
    const style = document.createElement("style");
    style.textContent = ".perf-probe-c{color:blue}";
    time("append style element", () => document.head.appendChild(style));
    await frame();
    time("text change in a button", () => {
      const button = [...document.querySelectorAll("button")].find((b) => b.textContent?.includes("Creează evenimentul"));
      if (button) button.lastChild!.textContent = "Se salvează…";
    });
    await frame();
    return out;
  });
  console.log(JSON.stringify(result, null, 2));
});
