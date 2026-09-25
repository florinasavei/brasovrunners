import { describe, expect, it } from "vitest";
import { STAFF_ROLES, type StaffRole } from "@/modules/staff-identity/domain/roles";
import { canOpenTasks, opsTaskPanels, resolveTaskPanel, TASK_PANELS } from "@/modules/diagnostics/domain/task-panels";

/**
 * The role gate for `/admin/tasks`, exhaustive over every role (`DECISIONS.md` §397).
 *
 * The owner, 2026-09-25: a tab that renders `docs/QUEUE.md` on `/admin/tasks`'s «De făcut», for
 * Administrator, Superadministrator and Tehnic; every other role gets no tab and a 404 on the
 * route. This is what a page render cannot show as clearly — the exact set the door opens for,
 * and what each role lands on when it opens.
 */
const APP_ROLES: readonly StaffRole[] = ["DEV", "ADMIN", "SUPERADMIN"];
const OPS_ROLES: readonly StaffRole[] = ["ADMIN", "SUPERADMIN"];
const SHUT_OUT_ROLES: readonly StaffRole[] = STAFF_ROLES.filter((role) => !APP_ROLES.includes(role));

describe("§397 canOpenTasks — who may open /admin/tasks at all", () => {
  it("is exactly Tehnic, Administrator and Superadministrator", () => {
    for (const role of APP_ROLES) expect(canOpenTasks(role)).toBe(true);
  });

  it("shuts out the volunteer, the copywriter and the organizer", () => {
    for (const role of SHUT_OUT_ROLES) expect(canOpenTasks(role)).toBe(false);
  });
});

describe("§397 resolveTaskPanel — which panel a request lands on", () => {
  it("defaults an Administrator or a Superadministrator to «De făcut»", () => {
    for (const role of OPS_ROLES) expect(resolveTaskPanel(role, undefined)).toBe("todo");
  });

  it("defaults a Tehnic, who has no ops panel, straight to «Aplicația»", () => {
    expect(resolveTaskPanel("DEV", undefined)).toBe("app");
  });

  it("lets an Administrator ask for any of the four panels by name", () => {
    for (const panel of TASK_PANELS) expect(resolveTaskPanel("ADMIN", panel)).toBe(panel);
  });

  it("refuses a Tehnic the ops panels, even asked for by name", () => {
    expect(resolveTaskPanel("DEV", "todo")).toBeNull();
    expect(resolveTaskPanel("DEV", "botCheck")).toBeNull();
    expect(resolveTaskPanel("DEV", "costs")).toBeNull();
    expect(resolveTaskPanel("DEV", "app")).toBe("app");
  });

  it("refuses every shut-out role every panel, «Aplicația» included", () => {
    for (const role of SHUT_OUT_ROLES) {
      for (const panel of TASK_PANELS) expect(resolveTaskPanel(role, panel)).toBeNull();
      expect(resolveTaskPanel(role, undefined)).toBeNull();
    }
  });

  it("reads an unrecognised value as nothing asked, same as the owner/kind filters", () => {
    expect(resolveTaskPanel("ADMIN", "not-a-panel")).toBe("todo");
    expect(resolveTaskPanel("DEV", "not-a-panel")).toBe("app");
  });
});

describe("§397 opsTaskPanels — the sub-navigation's own panels", () => {
  it("is the club's three ops panels, in order, for Administrator and Superadministrator", () => {
    for (const role of OPS_ROLES) expect(opsTaskPanels(role)).toEqual(["todo", "botCheck", "costs"]);
  });

  it("is empty for a Tehnic, who never sees the club's worklist or its money", () => {
    expect(opsTaskPanels("DEV")).toEqual([]);
  });
});
