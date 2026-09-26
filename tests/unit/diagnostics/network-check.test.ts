import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { NETWORK_PROBE_MARKER, NETWORK_PROBES, networkReport } from "@/modules/diagnostics/network-check";

/**
 * §NNN — `/admin/network`: what a staff member's network lets through, and the line for IT.
 *
 * The gate first (BR-REQ-060-01): the page, its do-nothing Server Action and the plain-form
 * probe's route answer staff only, each asserting it on the server. Then the report a person
 * copies — the results and the browser, nothing about them — and the rule that every host the
 * page names comes from configuration (AGENTS.md §8). The rows turning green and red in a browser
 * have no spec: the owner cut the browser run on 2026-09-26 (§NNN).
 */
const ROOT = path.resolve(__dirname, "../../..");
const read = (relative: string) => readFileSync(path.join(ROOT, relative), "utf8").replace(/\r\n/g, "\n");

const session = vi.hoisted(() => ({ staff: null as null | { id: string; role: string } }));
vi.mock("@/modules/staff-identity/session", () => ({
  DEV_STAFF_COOKIE: "dev-staff",
  getCurrentStaffUser: async () => session.staff,
  requireStaff: async () => {
    if (!session.staff) throw Object.assign(new Error("no staff session"), { code: "UNAUTHENTICATED" });
    return session.staff;
  },
}));

const { POST } = await import("@/app/api/admin/network-probe/route");
const { probeSaveAction } = await import("@/app/[locale]/admin/network/actions");

describe("§NNN the network check is staff-only, on the server", () => {
  it("the plain-form probe answers 404 to anybody signed out, and its marker to staff", async () => {
    session.staff = null;
    expect((await POST()).status).toBe(404);
    session.staff = { id: "s1", role: "VOLUNTEER" };
    const answer = await POST();
    expect(answer.status).toBe(200);
    expect(answer.headers.get("content-type")).toContain("text/html");
    expect(answer.headers.get("cache-control")).toBe("no-store");
    expect(await answer.text()).toContain(`id="${NETWORK_PROBE_MARKER}"`);
  });

  it("the saves probe refuses anybody signed out and answers ok to every staff role", async () => {
    session.staff = null;
    await expect(probeSaveAction()).rejects.toThrow();
    session.staff = { id: "s1", role: "VOLUNTEER" };
    await expect(probeSaveAction()).resolves.toBe("ok");
  });

  it("the page asserts a staff session itself, whatever the layout did", () => {
    const page = read("src/app/[locale]/admin/network/page.tsx");
    expect(page).toMatch(/await requireStaff\(\);/);
    expect(read("src/i18n/routing.ts")).toContain('"/admin/network": "/admin/network"');
  });

  it("names every host from configuration — the site's, the store's, Turnstile's own script address", () => {
    const page = read("src/app/[locale]/admin/network/page.tsx");
    expect(page).toContain("new URL(env.APP_BASE_URL).host");
    expect(page).toContain("publicPictureHost()");
    expect(page).toContain("new URL(TURNSTILE_SCRIPT_URL).host");
    expect(page).not.toMatch(/https?:\/\//);
  });
});

describe("§NNN the report", () => {
  it("lists every row, the line for IT only where one is given, the site and the browser — nothing about the person", () => {
    const text = networkReport({
      heading: "Brașov Runners — verificarea rețelei",
      when: "2026-09-26T08:00:00.000Z",
      siteLabel: "Site",
      site: "qa.example.test",
      browserLabel: "Browser",
      browser: "Mozilla/5.0",
      lines: [
        { title: "Salvările", status: "Blocat", allow: "Permite: cererile POST către qa.example.test" },
        { title: "Calea simplă", status: "Merge", allow: null },
      ],
    });
    expect(text.split("\n")).toEqual([
      "Brașov Runners — verificarea rețelei",
      "2026-09-26T08:00:00.000Z",
      "Site: qa.example.test",
      "- Salvările: Blocat — Permite: cererile POST către qa.example.test",
      "- Calea simplă: Merge",
      "Browser: Mozilla/5.0",
    ]);
  });

  it("tries four things, in the page's order", () => {
    expect(NETWORK_PROBES).toEqual(["saves", "post", "pictures", "botCheck"]);
  });
});
