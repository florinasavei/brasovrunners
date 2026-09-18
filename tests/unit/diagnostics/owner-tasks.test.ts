import { describe, expect, it } from "vitest";
import {
  ownerTasks,
  sortTasks,
  type OwnerTaskInputs,
} from "@/modules/diagnostics/owner-tasks";

/**
 * The club's own to-do list, derived rather than remembered.
 *
 * The property worth protecting is that `done` is never a guess: every state comes from what the
 * deployment reports, so a task cannot be ticked by somebody who merely intends to do it. The
 * tests below are mostly about the states that must NOT be reachable — an unapproved notice
 * reading as done, a sandbox reading as live email, one hand-inserted account reading as a team.
 */
const LAUNCHED: OwnerTaskInputs = {
  hasApprovedPrivacyNotice: true,
  legalTextIsSample: false,
  emailDeliveryMode: "live",
  staleJobNames: [],
  staffCount: 3,
  publishedEventCount: 4,
  roDomainBound: true,
  storageConfigured: true,
};

const stateOf = (input: OwnerTaskInputs, id: string) =>
  ownerTasks(input).find((task) => task.id === id)?.state;

describe("owner tasks", () => {
  it("says nothing is blocking once everything is really in place", () => {
    expect(ownerTasks(LAUNCHED).every((task) => task.state === "done")).toBe(true);
  });

  it("treats sample legal text as blocking, not as done", () => {
    // The trap this exists to avoid: QA has an approved privacy notice, so a naive check reads
    // "approved" and ticks the box — while the text on screen says it is not the club's.
    expect(stateOf({ ...LAUNCHED, legalTextIsSample: true }, "approveLegalText")).toBe("blocking");
  });

  it("treats a missing privacy notice as blocking, because registration refuses everyone", () => {
    expect(
      stateOf({ ...LAUNCHED, hasApprovedPrivacyNotice: false }, "approveLegalText"),
    ).toBe("blocking");
  });

  it("does not count captured or allowlisted email as reaching participants, and names the mode", () => {
    for (const mode of ["capture", "allowlist"] as const) {
      const task = ownerTasks({ ...LAUNCHED, emailDeliveryMode: mode }).find(
        (candidate) => candidate.id === "liveEmail",
      );
      expect(task?.state).toBe("blocking");
      // The page appends it, so "not live" says which of the two not-live modes it is.
      expect(task?.detail).toBe(mode);
    }
    expect(stateOf(LAUNCHED, "liveEmail")).toBe("done");
  });

  it("blocks on a stopped scheduler, names the job, and says it belongs to the developer", () => {
    // One boolean for "are the jobs healthy" hid the defect this exists to catch: QA ran
    // `email-outbox` every five minutes and `registration-maintenance` every two hours, because
    // only one of the two monitors `SETUP.md` §26 asks for was ever created. Rolled together,
    // that reads as a single amber light. Named, it says which monitor is missing.
    const tasks = ownerTasks({ ...LAUNCHED, staleJobNames: ["registration-maintenance"] });
    const scheduler = tasks.find((task) => task.id === "scheduler");
    expect(scheduler?.detail).toBe("registration-maintenance");
    expect(scheduler?.state).toBe("blocking");
    expect(scheduler?.owner).toBe("developer");
  });

  it("reads one staff account as a team still to invite, and never as a blocker", () => {
    // The first Administrator is a row inserted by hand (CLAUDE.md § What is deployed), so one
    // account proves nothing about `/admin/staff` having been used. A second one does.
    expect(stateOf({ ...LAUNCHED, staffCount: 1 }, "inviteStaff")).toBe("open");
    expect(stateOf({ ...LAUNCHED, staffCount: 0 }, "inviteStaff")).toBe("open");
    expect(stateOf({ ...LAUNCHED, staffCount: 2 }, "inviteStaff")).toBe("done");
  });

  it("keeps the .ro domain open for a year without blocking anything", () => {
    // `DECISIONS.md` §55: the .com now, the .ro a year later. The only fact the software can
    // read is the hostname it serves on, so the task closes itself and is never ticked.
    expect(stateOf({ ...LAUNCHED, roDomainBound: false }, "roDomain")).toBe("open");
    expect(stateOf(LAUNCHED, "roDomain")).toBe("done");
  });

  it("keeps the photo bucket open, never blocking, until the R2 variables exist", () => {
    // Read from `STORAGE_MODE`: a deployed environment without the five variables cannot take
    // a photo, and a checklist somebody ticks would not know that.
    expect(stateOf({ ...LAUNCHED, storageConfigured: false }, "mediaStorage")).toBe("open");
    expect(stateOf(LAUNCHED, "mediaStorage")).toBe("done");
  });

  it("leaves every task but the scheduler to the club", () => {
    const clubOwned = ownerTasks(LAUNCHED).filter((task) => task.owner === "club");
    expect(clubOwned.map((task) => task.id)).toEqual([
      "approveLegalText",
      "liveEmail",
      "inviteStaff",
      "publishEvents",
      "mediaStorage",
      "roDomain",
    ]);
  });

  it("orders blocking first, then open, then done", () => {
    const sorted = sortTasks(
      ownerTasks({
        ...LAUNCHED,
        legalTextIsSample: true,
        roDomainBound: false,
      }),
    );
    expect(sorted.map((task) => task.state)).toEqual(
      [...sorted.map((task) => task.state)].sort((a, b) => {
        const rank = { blocking: 0, open: 1, done: 2 } as const;
        return rank[a] - rank[b];
      }),
    );
    expect(sorted[0].state).toBe("blocking");
  });
});
