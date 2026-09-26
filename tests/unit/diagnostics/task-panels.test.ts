import { describe, expect, it } from "vitest";
import { STAFF_ROLES, type StaffRole } from "@/modules/staff-identity/domain/roles";
import {
  canOpenTaskPanel,
  canOpenTasks,
  defaultTaskPanel,
  resolveTaskPanel,
  TASK_PANELS,
  visibleTaskPanels,
} from "@/modules/diagnostics/domain/task-panels";

/**
 * The role gate for `/admin/tasks`, exhaustive over every role (`DECISIONS.md` §397, §438;
 * BR-REQ-060-01, BR-REQ-090-05).
 *
 * Five panels since §438: «Club» (what the system says is still owed — it was «De făcut» until
 * then), «De făcut» (the club's own checklist), «Anti-robot», «Costuri» and «Aplicația». This is
 * what a page render cannot show as clearly — the exact set each door opens for, and what each
 * role lands on when it opens the bare address.
 */
const OPS_ROLES: readonly StaffRole[] = ["ADMIN", "SUPERADMIN"];
const APP_ROLES: readonly StaffRole[] = ["DEV", "ADMIN", "SUPERADMIN"];
const TODO_ROLES: readonly StaffRole[] = ["COPYWRITER", "MODERATOR", "DEV", "ADMIN", "SUPERADMIN"];

describe("§438 canOpenTasks — who may open /admin/tasks at all", () => {
  it("is every role that reads the club's content: Redactor, Organizer, Tehnic, Administrator, Superadministrator", () => {
    for (const role of TODO_ROLES) expect(canOpenTasks(role), role).toBe(true);
  });

  it("shuts out the volunteer, whose backoffice is the desk and the guide (§103)", () => {
    expect(canOpenTasks("CONTRIBUTOR")).toBe(false);
    expect(STAFF_ROLES.filter((role) => !canOpenTasks(role))).toEqual(["CONTRIBUTOR"]);
  });
});

describe("§438 canOpenTaskPanel — each panel's own door", () => {
  it("opens «Club», «Anti-robot» and «Costuri» to the Administrator and the Superadministrator only", () => {
    for (const panel of ["club", "botCheck", "costs"] as const) {
      expect(STAFF_ROLES.filter((role) => canOpenTaskPanel(role, panel)), panel).toEqual(OPS_ROLES);
    }
  });

  it("opens «De făcut» from the Redactor up", () => {
    expect(STAFF_ROLES.filter((role) => canOpenTaskPanel(role, "todo"))).toEqual(TODO_ROLES);
  });

  it("opens «Aplicația» from Tehnic up (§397, unchanged)", () => {
    expect(STAFF_ROLES.filter((role) => canOpenTaskPanel(role, "app"))).toEqual(APP_ROLES);
  });
});

describe("§438 the landing panel — a bare /admin/tasks", () => {
  it("lands the Administrator and the Superadministrator on «Club»", () => {
    for (const role of OPS_ROLES) {
      expect(defaultTaskPanel(role)).toBe("club");
      expect(resolveTaskPanel(role, undefined)).toBe("club");
    }
  });

  it("lands a Tehnic on «Aplicația», as before", () => {
    expect(resolveTaskPanel("DEV", undefined)).toBe("app");
  });

  it("lands the Redactor and the Organizer on «De făcut», the one panel they have", () => {
    expect(resolveTaskPanel("COPYWRITER", undefined)).toBe("todo");
    expect(resolveTaskPanel("MODERATOR", undefined)).toBe("todo");
  });

  it("lands the volunteer nowhere", () => {
    expect(defaultTaskPanel("CONTRIBUTOR")).toBeNull();
    expect(resolveTaskPanel("CONTRIBUTOR", undefined)).toBeNull();
    for (const panel of TASK_PANELS) expect(resolveTaskPanel("CONTRIBUTOR", panel)).toBeNull();
  });
});

describe("§438 resolveTaskPanel — a link naming a tab", () => {
  it("still opens every panel by name for an Administrator", () => {
    for (const panel of TASK_PANELS) expect(resolveTaskPanel("ADMIN", panel)).toBe(panel);
  });

  it("refuses a panel the role may not open, rather than showing it", () => {
    expect(resolveTaskPanel("DEV", "club")).toBeNull();
    expect(resolveTaskPanel("DEV", "costs")).toBeNull();
    expect(resolveTaskPanel("DEV", "todo")).toBe("todo");
    expect(resolveTaskPanel("MODERATOR", "club")).toBeNull();
    expect(resolveTaskPanel("MODERATOR", "app")).toBeNull();
    expect(resolveTaskPanel("COPYWRITER", "botCheck")).toBeNull();
  });

  it("reads an unrecognised value as nothing asked, same as the owner/kind filters", () => {
    expect(resolveTaskPanel("ADMIN", "not-a-panel")).toBe("club");
    expect(resolveTaskPanel("DEV", "not-a-panel")).toBe("app");
    expect(resolveTaskPanel("MODERATOR", "not-a-panel")).toBe("todo");
  });
});

describe("§438 visibleTaskPanels — the sub-navigation, in order", () => {
  it("is «Club», «De făcut», «Anti-robot», «Costuri», «Aplicația» for the Administrators", () => {
    for (const role of OPS_ROLES) expect(visibleTaskPanels(role)).toEqual(["club", "todo", "botCheck", "costs", "app"]);
  });

  it("is «De făcut» and «Aplicația» for a Tehnic, who never sees the club's worklist read from the system or its money", () => {
    expect(visibleTaskPanels("DEV")).toEqual(["todo", "app"]);
  });

  it("is «De făcut» alone for the Redactor and the Organizer, and nothing for the volunteer", () => {
    expect(visibleTaskPanels("COPYWRITER")).toEqual(["todo"]);
    expect(visibleTaskPanels("MODERATOR")).toEqual(["todo"]);
    expect(visibleTaskPanels("CONTRIBUTOR")).toEqual([]);
  });
});
