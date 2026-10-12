import { describe, expect, it } from "vitest";
import { judgeRoot } from "../../../scripts/smoke.mjs";

/**
 * BR-REQ-040-01 — the smoke's verdict on the site's root (§717, amending §353): a 307 to the listing
 * while «Pagina principală» is off, the home page's 200 when it is on, and never a 200 that is an
 * error document (the §353 failure mode: a redirect thrown from a page answered 200 with `__next_error__`).
 */
describe("§717 the smoke's verdict on the root", () => {
  it("accepts a 307 to the listing in either language, and the home page's 200", () => {
    expect(judgeRoot("ro", 307, "/ro/evenimente", "")).toMatchObject({ ok: true });
    expect(judgeRoot("en", 307, "https://club.example/en/events", "")).toMatchObject({ ok: true });
    expect(judgeRoot("ro", 200, "", '<main data-testid="home-page">…</main>')).toMatchObject({ ok: true });
  });

  it("accepts the previous build's 308 to the listing (§NNN: the migration window)", () => {
    expect(judgeRoot("ro", 308, "/ro/evenimente", "")).toMatchObject({ ok: true });
    expect(judgeRoot("en", 308, "https://club.example/en/events", "")).toMatchObject({ ok: true });
  });

  it("refuses a 308 elsewhere, a 307 elsewhere, a 200 that is an error document and a 200 that is not the home page", () => {
    expect(judgeRoot("ro", 308, "/ro/contact", "")).toMatchObject({ ok: false });
    expect(judgeRoot("ro", 308, "/en/events", "")).toMatchObject({ ok: false });
    expect(judgeRoot("ro", 307, "/ro/contact", "")).toMatchObject({ ok: false });
    expect(judgeRoot("ro", 200, "", '<div id="__next_error__"></div><main data-testid="home-page"></main>')).toMatchObject({ ok: false });
    expect(judgeRoot("ro", 200, "", "<html><body>hello</body></html>")).toMatchObject({ ok: false });
    expect(judgeRoot("ro", 500, "", "")).toMatchObject({ ok: false });
  });
});
