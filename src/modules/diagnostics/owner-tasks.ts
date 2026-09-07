/**
 * What is still owed before this platform can take a real entry, in the club's own terms.
 *
 * `/devs` answers "is the deployment healthy" for somebody who can read a status enum. This
 * answers a different question, for a different person: **what is waiting on me?** The club's
 * organizers are volunteers, the outstanding work is mostly theirs rather than a developer's —
 * approving legal wording, buying a domain, deciding what an event costs — and until now the
 * only record of it was prose spread across `CLAUDE.md`, `SETUP.md` and three runbooks.
 *
 * A pure function over facts the caller has already read, so the whole list is testable without
 * a database and cannot drift from what the deployment actually reports. Every task states who
 * it belongs to, because "waiting on the club" and "waiting on a developer" are the difference
 * between a list somebody acts on and a list they scroll past.
 */

export type TaskOwner = "club" | "developer";

/**
 * `blocking` is reserved for the things that stop a real person registering today. Everything
 * else is `open`: real work, no deadline attached to it by the software.
 */
export type TaskState = "blocking" | "open" | "done";

export type OwnerTask = {
  id: string;
  owner: TaskOwner;
  state: TaskState;
};

export type OwnerTaskInputs = {
  /** Is the approved privacy notice the club's own wording, or still the sample? */
  legalTextIsSample: boolean;
  /** Does an approved privacy notice exist at all? Without one, registration refuses everyone. */
  hasApprovedPrivacyNotice: boolean;
  /**
   * Is the club's own domain bound and serving this deployment?
   *
   * False on a provider hostname *and* on a developer's machine. "Not a provider hostname" was
   * the old test and it read `localhost` as a bound domain, which marked the domain task done
   * on every developer's laptop.
   */
  clubDomainBound: boolean;
  emailDeliveryMode: "capture" | "allowlist" | "live";
  /** A scheduler that has stopped means nothing is sent and no hold ever expires. */
  jobsHealthy: boolean;
  /** Events the club has published, so an empty site reads as work rather than as success. */
  publishedEventCount: number;
};

export function ownerTasks(input: OwnerTaskInputs): OwnerTask[] {
  const tasks: OwnerTask[] = [];

  /**
   * First, because it is the one that refuses people rather than merely inconveniencing them.
   *
   * No approved privacy notice means `submitRegistration` refuses every entry (BR-REQ-053-01),
   * and sample wording means the notice on screen is not the club's promise. Both are the
   * club's to resolve, and neither can be resolved by writing code — `docs/RUNBOOKS.md` §
   * Legal document version is the procedure.
   */
  tasks.push({
    id: "approveLegalText",
    owner: "club",
    state: !input.hasApprovedPrivacyNotice
      ? "blocking"
      : input.legalTextIsSample
        ? "blocking"
        : "done",
  });

  // Nothing reaches a real person while the site captures mail, and the sandbox that replaces
  // capture reaches five addresses. Both are steps on the way to the same place.
  tasks.push({
    id: "liveEmail",
    owner: "club",
    state: input.emailDeliveryMode === "live" ? "done" : "blocking",
  });

  // Not blocking: the site works on the provider's hostname, it simply is not the club's.
  tasks.push({
    id: "registerDomain",
    owner: "club",
    state: input.clubDomainBound ? "done" : "open",
  });

  tasks.push({
    id: "publishEvents",
    owner: "club",
    state: input.publishedEventCount > 0 ? "done" : "open",
  });

  // The one developer-owned entry, and it earns its place: when the scheduler stops, no message
  // is sent and no hold expires, and neither failure announces itself on the public site.
  tasks.push({
    id: "scheduler",
    owner: "developer",
    state: input.jobsHealthy ? "done" : "blocking",
  });

  return tasks;
}

/** Blocking first, then open, then done — the order somebody scanning the page needs. */
export function sortTasks(tasks: OwnerTask[]): OwnerTask[] {
  const rank: Record<TaskState, number> = { blocking: 0, open: 1, done: 2 };
  return [...tasks].sort((a, b) => rank[a.state] - rank[b.state]);
}
