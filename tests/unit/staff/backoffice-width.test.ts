import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { BACKOFFICE_WIDTH, PAGE_WIDTH } from "@/theme/brand";

/**
 * §NNN — the backoffice uses the whole window (the owner, 2026-11-17, on a wide screen where the staff pages stood in the
 * middle third: «ce mă disperă în backoffice în general e că avem un max-width...»). The public pages keep `PAGE_WIDTH`.
 */
const source = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8");

describe("§NNN the backoffice's width", () => {
  it("draws the backoffice's main column fluid — only the gutters — and leaves the public pages at PAGE_WIDTH", () => {
    expect(BACKOFFICE_WIDTH).toBe(false);
    expect(PAGE_WIDTH).toBe("xl");
    const shell = source("src/modules/staff-identity/ui/BackofficeShell.tsx");
    expect(shell).toMatch(/<Container id="main"[^>]*maxWidth=\{BACKOFFICE_WIDTH\}[^>]*data-backoffice=""/);
    expect(shell).not.toContain("PAGE_WIDTH");
  });
});
