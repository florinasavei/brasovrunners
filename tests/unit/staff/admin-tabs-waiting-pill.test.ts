import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import AdminTabs, { type AdminTab } from "@/modules/staff-identity/ui/AdminTabs";

vi.mock("next/navigation", () => ({ usePathname: () => "/ro/admin/registrations" }));

/**
 * BR-REQ-041-01, `DECISIONS.md` §NNN — the «Înscrieri» tab: the badge is the confirmed, and the
 * people waiting have a pill of their own beside it, with the waiting list's hourglass and the number.
 *
 * Rendered to HTML, as the server sends it: the pill is there only above zero, it is named for a
 * screen reader and it sits inside the one focusable chunk the tooltip hangs on. The tab bar is
 * `variant="scrollable"`, so the extra pill lengthens the row, never the page, at 320 pixels.
 */
const tab = (extra: Partial<AdminTab> = {}): AdminTab => ({
  href: "/ro/admin/registrations",
  label: "Înscrieri",
  section: "registrations",
  count: 133,
  countHint: "Confirmați: 133 · pe lista de așteptare: 10 · în curs: 24",
  ...extra,
});
const render = (items: AdminTab[]) => renderToStaticMarkup(createElement(AdminTabs, { items })).replace(/<style\b[\s\S]*?<\/style>/g, "");

describe("§NNN the tab's two pills", () => {
  it("draws the confirmed figure and, beside it, the waiting pill with a glyph and its number", () => {
    const html = render([tab({ countWaiting: 10, countWaitingLabel: "10 pe lista de așteptare" })]);
    expect(html).toContain(">133<");
    const pill = /<span[^>]*data-testid="registered-waiting-pill"[^>]*>([\s\S]*?)<\/span>/.exec(html);
    expect(pill, "the waiting pill").not.toBeNull();
    expect(pill![0]).toContain('aria-label="10 pe lista de așteptare"');
    expect(pill![0]).toContain('role="img"');
    // The hourglass (MUI's `HourglassTop`) and the number, nothing else.
    expect(pill![1]).toContain("<svg");
    expect(pill![1]).toContain('data-testid="HourglassTopIcon"');
    expect(pill![1].replace(/<svg[\s\S]*?<\/svg>/, "")).toBe("10");
  });

  it("draws no waiting pill when nobody waits", () => {
    expect(render([tab()])).not.toContain("registered-waiting-pill");
    expect(render([tab({ countWaiting: 0 })])).not.toContain("registered-waiting-pill");
  });

  it("keeps both pills inside the one focusable chunk the tooltip hangs on", () => {
    const html = render([tab({ countWaiting: 10, countWaitingLabel: "10 pe lista de așteptare" })]);
    const focusable = /<span tabindex="0"[^>]*>([\s\S]*?)<\/span><\/span><\/a>/.exec(html) ?? /<span[^>]*tabindex="0"[^>]*>([\s\S]*)/.exec(html);
    expect(focusable?.[1] ?? "").toContain("registered-waiting-pill");
    expect(focusable?.[1] ?? "").toContain(">133<");
  });

  it("a tab with no figure has neither", () => {
    const html = render([{ href: "/ro/admin/guide", label: "Ghid", section: "guide" }]);
    expect(html).not.toContain("registered-waiting-pill");
  });
});
