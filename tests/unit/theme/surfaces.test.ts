import { describe, expect, it } from "vitest";
import * as surfaces from "@/theme/surfaces";

/**
 * `AGENTS.md` §14.1, `DECISIONS.md` §272 — a style in this module is handed to a client
 * component, so it may not contain a function.
 *
 * This exists because of a defect that reached QA on 2026-09-22 and read as the environment
 * being down. `specialCard` was written with `backgroundImage: (theme) => …`, which is MUI's own
 * documented `sx` callback and perfectly correct *inside* a client component. These objects are
 * different: a Server Component spreads them into the `sx` of MUI's `Card`, and React refuses to
 * serialize a function across that boundary. The page answered 200 and the cards did not render.
 *
 * The rule is not "never use a callback" — it is "not in this module", because everything here
 * is written on a server and read on a client. A colour that has to follow the scheme is a CSS
 * variable (`var(--mui-palette-…)`), which is a string.
 */
describe("DECISIONS.md §272 a shared surface style crosses to a client component", () => {
  const functionsIn = (value: unknown, path: string): string[] => {
    if (typeof value === "function") return [path];
    if (Array.isArray(value)) return value.flatMap((item, index) => functionsIn(item, `${path}[${index}]`));
    if (value && typeof value === "object") {
      return Object.entries(value).flatMap(([key, inner]) => functionsIn(inner, `${path}.${key}`));
    }
    return [];
  };

  it("exports no style carrying a function, at any depth", () => {
    const offenders = Object.entries(surfaces).flatMap(([name, value]) => functionsIn(value, name));
    expect(offenders, "a function here cannot be serialized into a client component's sx").toEqual([]);
  });

  it("keeps the special card's wash as a CSS variable, so it still follows the scheme", () => {
    // The variable is what replaced the callback: one string, two schemes.
    expect(surfaces.specialCard.backgroundImage).toContain("var(--mui-palette-secondary-main)");
    expect(surfaces.specialCard.borderColor).toBe("secondary.main");
  });

  /** §344 amended — the partner card's border and gray background, from theme tokens only. */
  it("keeps the partner card's border and wash as theme tokens, never a literal colour", () => {
    expect(surfaces.partnerCardSurface.borderColor).toBe("divider");
    expect(surfaces.partnerCardSurface.bgcolor).toBe("action.hover");
    expect(surfaces.partnerCardSurface.border).toBe(1);
  });
});
