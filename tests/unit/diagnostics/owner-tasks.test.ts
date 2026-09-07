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
 * reading as done, a sandbox reading as live email.
 */
const LAUNCHED: OwnerTaskInputs = {
  hasApprovedPrivacyNotice: true,
  legalTextIsSample: false,
  clubDomainBound: true,
  emailDeliveryMode: "live",
  jobsHealthy: true,
  publishedEventCount: 4,
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

  it("does not count captured or allowlisted email as reaching participants", () => {
    for (const mode of ["capture", "allowlist"] as const) {
      expect(stateOf({ ...LAUNCHED, emailDeliveryMode: mode }, "liveEmail")).toBe("blocking");
    }
    expect(stateOf(LAUNCHED, "liveEmail")).toBe("done");
  });

  it("treats the provider hostname as work to do, not as a blocker", () => {
    // The site genuinely works on it, which is the difference between this and the two above.
    expect(stateOf({ ...LAUNCHED, clubDomainBound: false }, "registerDomain")).toBe("open");
  });

  it("blocks on a stopped scheduler, and says it belongs to the developer", () => {
    const tasks = ownerTasks({ ...LAUNCHED, jobsHealthy: false });
    const scheduler = tasks.find((task) => task.id === "scheduler");
    expect(scheduler?.state).toBe("blocking");
    expect(scheduler?.owner).toBe("developer");
  });

  it("leaves every other task to the club", () => {
    const clubOwned = ownerTasks(LAUNCHED).filter((task) => task.owner === "club");
    expect(clubOwned.map((task) => task.id)).toEqual([
      "approveLegalText",
      "liveEmail",
      "registerDomain",
      "publishEvents",
    ]);
  });

  it("orders blocking first, then open, then done", () => {
    const sorted = sortTasks(
      ownerTasks({
        ...LAUNCHED,
        legalTextIsSample: true,
        clubDomainBound: false,
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
