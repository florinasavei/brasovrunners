import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";

/**
 * §456 (amending §377) — "Termene" advises a value per deadline: `RECOMMENDED`, the platform's
 * defaults; each box's help says it in both languages; a chip marks a stored value that differs;
 * «Completează valorile recomandate» fills the boxes and never saves.
 */
const lang = vi.hoisted(() => ({ current: "ro" as "ro" | "en" }));
const save = vi.hoisted(() => vi.fn(async () => null));
vi.mock("next-intl/server", async () => {
  const { createTranslator } = await import("next-intl");
  const all = { ro: (await import("../../../messages/ro.json")).default, en: (await import("../../../messages/en.json")).default };
  return {
    getTranslations: async (namespace: string) =>
      createTranslator({ locale: lang.current, messages: all[lang.current], namespace: namespace as "Admin" }),
    getLocale: async () => lang.current,
  };
});
vi.mock("@/app/[locale]/admin/emails/actions", () => ({ updateDeadlinesAction: save, updateAddressCapAction: async () => null }));

const { default: DeadlinesPanel } = await import("@/modules/deadlines/ui/DeadlinesPanel");
const { fillRecommended } = await import("@/modules/deadlines/ui/FillRecommendedButton");
const { DEADLINE_KEYS, DEFAULT_DEADLINES, RECOMMENDED } = await import("@/modules/deadlines/domain/deadlines");

async function render(locale: "ro" | "en", deadlines = DEFAULT_DEADLINES, mayEdit = true): Promise<string> {
  lang.current = locale;
  const html = renderToStaticMarkup(
    (await DeadlinesPanel({ locale, state: { deadlines, updatedAt: null }, mayEdit })) as ReactElement,
  );
  return html.replace(/<style[^>]*>[\s\S]*?<\/style>/g, "");
}

beforeEach(() => save.mockClear());

describe("§456 the recommended deadlines", () => {
  it("recommends exactly the platform's defaults", () => {
    expect(RECOMMENDED).toEqual(DEFAULT_DEADLINES);
  });

  it("says each recommended number in the help, in both languages", async () => {
    for (const [locale, prefix] of [["ro", "Recomandat: "], ["en", "Recommended: "]] as const) {
      const html = await render(locale);
      for (const key of DEADLINE_KEYS) expect(html, `${locale} ${key}`).toContain(`${prefix}${RECOMMENDED[key]}.`);
    }
  });

  it("marks only the deadline that differs", async () => {
    const html = await render("ro", { ...DEFAULT_DEADLINES, holdMinutes: DEFAULT_DEADLINES.holdMinutes + 1 });
    expect(html).toContain('data-testid="deadline-holdMinutes-differs"');
    expect(html.match(/-differs"/g)).toHaveLength(1);
    expect(html).toContain(ro.Admin.emails.deadlines.differs);
    expect(await render("en")).not.toContain("-differs");
  });

  it("offers the fill as a plain button inside the one save form, never a second form", async () => {
    const html = await render("en", { ...DEFAULT_DEADLINES, offerHours: 12 });
    expect(html.match(/<form/g)).toHaveLength(1);
    expect(html).toMatch(/<button[^>]*type="button"[^>]*data-testid="deadlines-fill-recommended"/);
    expect(html).toContain(en.Admin.emails.deadlines.fillRecommended);
  });

  it("fills the boxes without calling the save", () => {
    const boxes: Record<string, { value: string }> = Object.fromEntries(DEADLINE_KEYS.map((k) => [k, { value: "1" }]));
    fillRecommended({ namedItem: (name) => boxes[name] ?? null }, RECOMMENDED);
    for (const key of DEADLINE_KEYS) expect(boxes[key]!.value).toBe(String(RECOMMENDED[key]));
    expect(save).not.toHaveBeenCalled();
  });

  it("keeps the numbers out of the catalogues", () => {
    for (const words of [ro.Admin.emails.deadlines, en.Admin.emails.deadlines]) {
      for (const key of ["differs", "fillRecommended", "bounds"] as const) expect(words[key], key).not.toMatch(/\d/);
    }
  });
});
