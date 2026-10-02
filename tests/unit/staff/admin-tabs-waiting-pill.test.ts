import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import AdminTabs, { type AdminTab, type CountPill } from "@/modules/staff-identity/ui/AdminTabs";

vi.mock("next/navigation", () => ({ usePathname: () => "/ro/admin/registrations" }));

/**
 * BR-REQ-041-01, `DECISIONS.md` §626, §NNN — the «Înscrieri» tab: the badge is everyone with a place,
 * and each group still in progress has a small pill of its own beside it, glyph and number —
 * «Înscrieri [150] [✍ 16] [✉ 7] [⏳ 10]»: those completing their registration with a place (the pen,
 * a part of the 150), those awaiting the email confirmation (the envelope) and the waiting list (the
 * hourglass), in that order.
 *
 * Rendered to HTML, as the server sends it: a pill is there only above zero, it is named for a
 * screen reader and it sits inside the one focusable chunk the tooltip hangs on. The tab bar is
 * `variant="scrollable"`, so the pills lengthen the row, never the page, at 320 pixels.
 */
const tab = (extra: Partial<AdminTab> = {}): AdminTab => ({
  href: "/ro/admin/registrations",
  label: "Înscrieri",
  section: "registrations",
  count: 150,
  countHint: "Cu loc: 150 — 134 de confirmați, 16 în curs de confirmare · așteaptă confirmarea emailului: 7 · pe lista de așteptare: 10",
  ...extra,
});
const render = (items: AdminTab[]) => renderToStaticMarkup(createElement(AdminTabs, { items })).replace(/<style\b[\s\S]*?<\/style>/g, "");

/** The owner's race of 2026-10-02, handed over in a scrambled order: the tab decides the order. */
const OWNER_PILLS: CountPill[] = [
  { kind: "waiting", count: 10, label: "10 pe lista de așteptare" },
  { kind: "awaitingEmail", count: 7, label: "7 așteaptă confirmarea emailului" },
  { kind: "inProgress", count: 16, label: "16 în curs de confirmare" },
];

const PILLS = [
  { kind: "inProgress", testId: "registered-inProgress-pill", glyph: "DrawIcon", count: "16", label: "16 în curs de confirmare" },
  { kind: "awaitingEmail", testId: "registered-awaitingEmail-pill", glyph: "MarkEmailReadIcon", count: "7", label: "7 așteaptă confirmarea emailului" },
  { kind: "waiting", testId: "registered-waiting-pill", glyph: "HourglassTopIcon", count: "10", label: "10 pe lista de așteptare" },
] as const;

function pillOf(html: string, testId: string) {
  return new RegExp(`<span[^>]*data-testid="${testId}"[^>]*>([\\s\\S]*?)</span>`).exec(html);
}

describe("§NNN the tab's pills: everyone with a place, then each group in progress", () => {
  it("draws the figure with a place and, beside it, a pill per group with its glyph, its number and its name", () => {
    const html = render([tab({ countPills: OWNER_PILLS })]);
    expect(html).toContain(">150<");
    for (const expected of PILLS) {
      const pill = pillOf(html, expected.testId);
      expect(pill, expected.kind).not.toBeNull();
      expect(pill![0]).toContain(`aria-label="${expected.label}"`);
      expect(pill![0]).toContain('role="img"');
      // The glyph and the number, nothing else: the words are the pill's name.
      expect(pill![1]).toContain(`data-testid="${expected.glyph}"`);
      expect(pill![1].replace(/<svg[\s\S]*?<\/svg>/, "")).toBe(expected.count);
    }
  });

  it("draws them in progress first, then the email, then the waiting list, after the figure", () => {
    const html = render([tab({ countPills: OWNER_PILLS })]);
    const at = (needle: string) => html.indexOf(needle);
    expect(at(">150<")).toBeGreaterThan(-1);
    expect(at(">150<")).toBeLessThan(at(PILLS[0].testId));
    expect(at(PILLS[0].testId)).toBeLessThan(at(PILLS[1].testId));
    expect(at(PILLS[1].testId)).toBeLessThan(at(PILLS[2].testId));
  });

  it("draws a pill only above zero", () => {
    expect(render([tab()])).not.toContain("-pill");
    const html = render([
      tab({
        countPills: [
          { kind: "inProgress", count: 0, label: "0 în curs de confirmare" },
          { kind: "awaitingEmail", count: 3, label: "3 așteaptă confirmarea emailului" },
          { kind: "waiting", count: 0, label: "0 pe lista de așteptare" },
        ],
      }),
    ]);
    expect(html).not.toContain("registered-inProgress-pill");
    expect(html).not.toContain("registered-waiting-pill");
    expect(pillOf(html, "registered-awaitingEmail-pill")?.[0]).toContain('aria-label="3 așteaptă confirmarea emailului"');
  });

  it("keeps every pill inside the one focusable chunk the tooltip hangs on", () => {
    const html = render([tab({ countPills: OWNER_PILLS })]);
    const focusable = /<span tabindex="0"[^>]*>([\s\S]*?)<\/span><\/span><\/a>/.exec(html) ?? /<span[^>]*tabindex="0"[^>]*>([\s\S]*)/.exec(html);
    for (const expected of PILLS) expect(focusable?.[1] ?? "").toContain(expected.testId);
    expect(focusable?.[1] ?? "").toContain(">150<");
    // One focusable chunk, not one per pill — the selected tab's anchor and the chunk are the two —
    // and the pills are not links either: the tab is the one anchor.
    expect(html.match(/tabindex="0"/g)).toHaveLength(2);
    expect(html.match(/<a\b/g)).toHaveLength(1);
  });

  it("a tab with no figure has none", () => {
    const html = render([{ href: "/ro/admin/guide", label: "Ghid", section: "guide", countPills: OWNER_PILLS }]);
    expect(html).not.toContain("-pill");
  });
});
