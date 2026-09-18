/**
 * What is still owed before this platform can take a real entry, in the club's own terms.
 *
 * `/devs` answers "is the deployment healthy" for somebody who can read a status enum. This
 * answers a different question, for a different person: **what is waiting on me?** The club's
 * organizers are volunteers, the outstanding work is mostly theirs rather than a developer's —
 * approving legal wording, verifying a sending domain, inviting the team — and until now the
 * only record of it was prose spread across `CLAUDE.md`, `SETUP.md` and three runbooks.
 *
 * A pure function over facts the caller has already read, so the whole list is testable without
 * a database and cannot drift from what the deployment actually reports. **Nothing here is
 * ticked by hand**: every state is derived from the environment, the database or the job
 * heartbeats, which is the page's one rule. Every task states who it belongs to, because
 * "waiting on the club" and "waiting on a developer" are the difference between a list somebody
 * acts on and a list they scroll past.
 *
 * Rewritten on 2026-09-17 to today's list (`DECISIONS.md` §61): the domain is bought and bound,
 * so "register the domain" is gone, and the `.ro` that follows it in a year is here instead.
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
  /** What the page appends to the sentence, when there is something specific to say. */
  detail?: string;
};

export type OwnerTaskInputs = {
  /** Is the approved privacy notice the club's own wording, or still the sample? */
  legalTextIsSample: boolean;
  /** Does an approved privacy notice exist at all? Without one, registration refuses everyone. */
  hasApprovedPrivacyNotice: boolean;
  /**
   * How email leaves this deployment. Only `live` reaches a real participant; `allowlist` is the
   * Mailgun sandbox, which reaches five authorized addresses, and `capture` transmits nothing.
   * Going live is one thing on the club's side — the sending domain `mail.<domain>` verified at
   * Mailgun (`docs/RUNBOOKS.md`) — and one variable on the deployment.
   */
  emailDeliveryMode: "capture" | "allowlist" | "live";
  /** Which deployment this is: off production, `allowlist` is the finished state (§16.4). */
  appEnv: "local" | "test" | "qa" | "production";
  /**
   * Each scheduled job's own liveness, not one boolean for all of them.
   *
   * It *was* one boolean, and that hid the defect it existed to catch. `SETUP.md` §26 asks for
   * **two** monitors per environment — one per job endpoint — and QA had only ever had one:
   * `email-outbox` ran every five minutes, `registration-maintenance` every two hours, on the
   * GitHub Actions backstop alone. Rolled into "are the jobs healthy", that read as a single
   * amber light somebody could explain away. Named, it says which monitor is missing.
   *
   * The two failures are not the same either. A late outbox delays a message; late maintenance
   * means a lapsed hold keeps occupying a place and the next runner is never offered it.
   */
  staleJobNames: readonly string[];
  /**
   * How many staff accounts exist. The first Administrator is a row inserted by hand, because
   * the screen that invites people is itself behind the sign-in it would be granting; a second
   * row means somebody used `/admin/staff`, which is the whole of "the team is invited".
   */
  staffCount: number;
  /** Events the club has published, so an empty site reads as work rather than as success. */
  publishedEventCount: number;
  /**
   * Can this environment store a photo? Derived from the five `R2_*` variables (`env.ts`,
   * `STORAGE_MODE`), so the row reads the environment and never a checklist. Local and test
   * always can — disk and memory — which is why the task can only be open on QA or production.
   */
  storageConfigured: boolean;
  /** Are both Turnstile keys set (`DECISIONS.md` §97)? Off, the honeypot and the timing check stand alone. */
  botCheckConfigured: boolean;
  /**
   * Does this deployment answer on a `.ro` hostname?
   *
   * The owner bought the `.com` on 2026-09-16 and decided a `.ro` follows a year later, both
   * alive at once (`DECISIONS.md` §55). The only fact the software can read about that is the
   * hostname it is serving on, so the task is open until `APP_BASE_URL` ends in `.ro` — which
   * on QA is never, and that is honest: QA is not the club's address.
   */
  roDomainBound: boolean;
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
  // capture reaches five addresses. The detail names the mode, so "not live" is not a mystery.
  // On QA the mode is `allowlist` by rule (§16.4: live is refused outside production), so the
  // row would read "blocking" for ever there and mean nothing. Off production the task is done
  // when the provider is configured at all; the detail still names the mode.
  const emailDone =
    input.emailDeliveryMode === "live" ||
    (input.appEnv !== "production" && input.emailDeliveryMode === "allowlist");
  tasks.push({
    id: "liveEmail",
    owner: "club",
    state: emailDone ? "done" : "blocking",
    detail: input.emailDeliveryMode === "live" ? undefined : input.emailDeliveryMode,
  });

  // The one developer-owned entry, and it earns its place: when a job stops, no message is sent
  // or no hold expires, and neither failure announces itself on the public site.
  tasks.push({
    id: "scheduler",
    owner: "developer",
    state: input.staleJobNames.length === 0 ? "done" : "blocking",
    // Carried so the page can name the job rather than say "something is late". A missing
    // monitor and a broken one look identical from here; the job name is what tells them apart.
    detail: input.staleJobNames.join(", ") || undefined,
  });

  // Not blocking: one Administrator can run a race alone. It is open because a club with one
  // account is a club whose backoffice goes with that one person's holiday.
  tasks.push({
    id: "inviteStaff",
    owner: "club",
    state: input.staffCount > 1 ? "done" : "open",
  });

  tasks.push({
    id: "publishEvents",
    owner: "club",
    state: input.publishedEventCount > 0 ? "done" : "open",
  });

  // Not blocking: registrations do not need photos. Open until the bucket exists, because an
  // album page without an upload button is a gallery nobody can fill (BR-REQ-054-01).
  tasks.push({
    id: "mediaStorage",
    owner: "club",
    state: input.storageConfigured ? "done" : "open",
  });

  // Not blocking either: the form already refuses the dumb bots. Open until the two keys exist,
  // because a race that opens entries to a hundred people is when the other kind shows up (§97).
  tasks.push({
    id: "botCheck",
    owner: "club",
    state: input.botCheckConfigured ? "done" : "open",
  });

  // Open for a year by design, and never blocking: the `.com` serves; the `.ro` is a second door.
  tasks.push({
    id: "roDomain",
    owner: "club",
    state: input.roDomainBound ? "done" : "open",
  });

  /**
   * The queued work (the owner, 2026-09-18: "all the queued work, so I can continue
   * tomorrow"): what was asked and not built yet, or built without the last mile. Static and
   * open — nothing in the system can tell when they are done; whoever finishes one removes it
   * here and records it in `DECISIONS.md`. Developer-owned, so they sort after the club's.
   */
  for (const id of BACKLOG) tasks.push({ id, owner: "developer", state: "open" });

  return tasks;
}

/** In the order to take them. Each has its title, its "why" and its steps in `Admin.tasks.items`. */
export const BACKLOG = [
  "clubMailbox",
  "minorsOnline",
  "scheduleStructured",
  "declarationArchiveMail",
  "vercelUsage",
  "docsSimplify",
] as const;

/** Blocking first, then open, then done — the order somebody scanning the page needs. */
export function sortTasks(tasks: OwnerTask[]): OwnerTask[] {
  const rank: Record<TaskState, number> = { blocking: 0, open: 1, done: 2 };
  return [...tasks].sort((a, b) => rank[a.state] - rank[b.state]);
}
