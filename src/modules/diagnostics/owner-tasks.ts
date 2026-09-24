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

import { isNeonQuotaNearLimit } from "./domain/neon-limits";

export type TaskOwner = "club" | "developer";

/** The two owners, in the order the filter offers them; also the closed set a query value is checked against. */
export const TASK_OWNERS: readonly TaskOwner[] = ["club", "developer"];

/**
 * `blocking` is reserved for the things that stop a real person registering today. Everything
 * else is `open`: real work, no deadline attached to it by the software.
 *
 * `broken` is the fourth answer, added with the invitation key (§288): something that is set up
 * and **does not work** — red, because it needs a hand today, and not `blocking`, because it
 * stops no registration and the line above the list must go on being true. A missing key is
 * `open`; a key that authenticates and can do nothing is `broken`, and telling those two apart
 * is the whole reason the row exists.
 */
export type TaskState = "blocking" | "broken" | "open" | "done";

/**
 * What sort of work a task is (§150; the owner: "a filter by issue type and owner"). Four
 * kinds, because the list has four sorts of row and a fifth would be a kind with one member:
 * an **account** or key to create at a provider, a **decision** the club has to take, a
 * **text** to write or approve, and a **check** — a rehearsal or a monitor that has to be seen
 * running. The kind says what a volunteer needs in hand to close the row: a browser and a
 * credit card, a meeting, an afternoon of writing, or a phone on race day.
 */
export type TaskKind = "account" | "decision" | "text" | "check";

/** In the order the filter offers them, and the closed set a query value is checked against. */
export const TASK_KINDS: readonly TaskKind[] = ["account", "decision", "text", "check"];

/** Every task the list can carry. A new id is a TypeScript error until `TASK_KIND` names its kind. */
export type TaskId =
  | "approveLegalText"
  | "liveEmail"
  | "scheduler"
  | "retentionSweep"
  | "inviteStaff"
  | "inviteKey"
  | "publishEvents"
  | "raceDaySheets"
  | "mediaStorage"
  | "botCheck"
  | "declarationArchiveMail"
  | "vercelUsage"
  | "contactForm"
  | "roDomain"
  | "neonLimits";

/**
 * Each task's kind, typed as a `Record` over every id so a task added without one does not
 * compile — the filter must never offer a row it cannot classify.
 */
export const TASK_KIND: Record<TaskId, TaskKind> = {
  approveLegalText: "text",
  liveEmail: "account",
  scheduler: "check",
  retentionSweep: "check",
  inviteStaff: "account",
  inviteKey: "account",
  publishEvents: "text",
  raceDaySheets: "check",
  mediaStorage: "account",
  botCheck: "account",
  declarationArchiveMail: "decision",
  vercelUsage: "account",
  contactForm: "account",
  roDomain: "decision",
  neonLimits: "decision",
};

export type OwnerTask = {
  id: TaskId;
  owner: TaskOwner;
  state: TaskState;
  kind: TaskKind;
  /** What the page appends to the sentence, when there is something specific to say. */
  detail?: string;
  /**
   * The catalogue key under `items.<id>` whose sentence describes this state, when neither
   * `todo` nor `done` says it: a key that is set and does not work needs a third sentence, and
   * "we could not check" a fourth. Unset, the page reads `todo` or `done` from the state.
   */
  text?: string;
  /** The steps array under `items.<id>` to show instead of `how`: fixing a thing is not setting it up. */
  steps?: string;
};

/**
 * What `checkInviteKey` answered (`diagnostics/invite-key.ts`), reduced to what a row needs:
 * the verdict, and Zitadel's own words where it gave any.
 */
export type InviteKeyState = {
  kind: "inapplicable" | "unconfigured" | "ok" | "blind" | "refused" | "unreachable";
  reason?: string;
};

export function isTaskOwner(value: string | undefined): value is TaskOwner {
  return TASK_OWNERS.some((owner) => owner === value);
}

export function isTaskKind(value: string | undefined): value is TaskKind {
  return TASK_KINDS.some((kind) => kind === value);
}

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
   * The jobs that run on time and fail their work (`jobs/health.ts`, `failing`, §322): today only
   * registration-maintenance, whose retention sweep failed two runs in a row. Not a stale
   * scheduler — the monitors are fine, and the steps for setting them up would send the reader
   * the wrong way — so it is its own row (§324), pointing at `/devs` and the failed steps.
   */
  failingJobNames: readonly string[];
  /**
   * How many staff accounts exist. The first Administrator is a row inserted by hand, because
   * the screen that invites people is itself behind the sign-in it would be granting; a second
   * row means somebody used `/admin/staff`, which is the whole of "the team is invited".
   */
  staffCount: number;
  /**
   * Whether the invitation key can do what "Add" on Echipa needs it for (§288), tested with a
   * real search rather than read from the environment. `inapplicable` where the development
   * switcher is the provider, and the row is then not shown at all: a laptop has no key to owe.
   */
  inviteKey: InviteKeyState;
  /** Events the club has published, so an empty site reads as work rather than as success. */
  publishedEventCount: number;
  /**
   * The events with registration on the site that started between seven and thirty days ago,
   * by title (§323). The privacy notice promises that exported lists and printed race-day sheets
   * are destroyed within 30 days of the event, and the identity numbers are gone from the
   * database after seven — so for those three weeks the copies outside it are the club's to
   * delete, and nothing in the system can see them. The row is the reminder; it goes by itself.
   */
  raceDaySheetsDue: readonly string[];
  /**
   * Can this environment store a photo? Derived from the five `R2_*` variables (`env.ts`,
   * `STORAGE_MODE`), so the row reads the environment and never a checklist. Local and test
   * always can — disk and memory — which is why the task can only be open on QA or production.
   */
  storageConfigured: boolean;
  /** Are both Turnstile keys set (`DECISIONS.md` §97)? Off, the honeypot and the timing check stand alone. */
  botCheckConfigured: boolean;
  /** Is `DECLARATIONS_ARCHIVE_TO` set (§99)? Off, the club downloads the bundle per event. */
  declarationArchiveConfigured: boolean;
  /** Are `VERCEL_API_TOKEN` + `VERCEL_PROJECT_ID` set (§101)? Off, `/devs` links to the dashboard. */
  vercelUsageConfigured: boolean;
  /**
   * Can the contact form reach the club (§149, §164)? Both halves: a way to send — the Gmail
   * account and its app password, `CONTACT_FORM_MODE` (`capture` on a laptop counts, as the
   * local media store does) — and somebody to send to, from the club's own list on
   * `/admin/emails` or from `CONTACT_FORM_TO` behind it. Either one missing and the page
   * shows the club's address instead, so the row is open until both answer.
   */
  contactFormConfigured: boolean;
  /**
   * Does this deployment answer on a `.ro` hostname?
   *
   * The owner bought the `.com` on 2026-09-16 and decided a `.ro` follows a year later, both
   * alive at once (`DECISIONS.md` §55). The only fact the software can read about that is the
   * hostname it is serving on, so the task is open until `APP_BASE_URL` ends in `.ro` — which
   * on QA is never, and that is honest: QA is not the club's address.
   */
  roDomainBound: boolean;
  /**
   * This environment's monthly compute-time quota and this period's spend against it, both read
   * from the same Neon project row the consumption panel already fetches (§NNN) — never a
   * second request. `null` when there is no quota, or when Neon could not be read at all (no
   * key, or no answer): the row asks for the same next step either way — set a limit, or find
   * out why it could not be checked — so both are `open`.
   */
  neonQuota: { quotaCuHours: number | null; usedCuHours: number } | null;
};

export function ownerTasks(input: OwnerTaskInputs): OwnerTask[] {
  const tasks: OwnerTask[] = [];
  // One door for every row, so the kind is looked up and never typed: a task is its id's kind.
  const push = (id: TaskId, task: Omit<OwnerTask, "id" | "kind">) =>
    tasks.push({ id, kind: TASK_KIND[id], ...task });

  /**
   * First, because it is the one that refuses people rather than merely inconveniencing them.
   *
   * No approved privacy notice means `submitRegistration` refuses every entry (BR-REQ-053-01),
   * and sample wording means the notice on screen is not the club's promise. Both are the
   * club's to resolve, and neither can be resolved by writing code — `docs/RUNBOOKS.md` §
   * Legal document version is the procedure.
   */
  push("approveLegalText", {
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
  push("liveEmail", {
    owner: "club",
    state: emailDone ? "done" : "blocking",
    detail: input.emailDeliveryMode === "live" ? undefined : input.emailDeliveryMode,
  });

  // The one developer-owned entry, and it earns its place: when a job stops, no message is sent
  // or no hold expires, and neither failure announces itself on the public site.
  push("scheduler", {
    owner: "developer",
    state: input.staleJobNames.length === 0 ? "done" : "blocking",
    // Carried so the page can name the job rather than say "something is late". A missing
    // monitor and a broken one look identical from here; the job name is what tells them apart.
    detail: input.staleJobNames.join(", ") || undefined,
  });

  // Only while it fails (§324): the retention sweep ran and could not do its work, two runs in a
  // row. Red, the developer's, and never folded into "scheduler", whose steps are about monitors.
  if (input.failingJobNames.length > 0) {
    push("retentionSweep", {
      owner: "developer",
      state: "broken",
      detail: input.failingJobNames.join(", "),
    });
  }

  // Not blocking: one Administrator can run a race alone. It is open because a club with one
  // account is a club whose backoffice goes with that one person's holiday.
  push("inviteStaff", {
    owner: "club",
    state: input.staffCount > 1 ? "done" : "open",
  });

  /**
   * The key behind "Add", tested rather than merely present (§288). For two days the key was set
   * on both projects, authenticated on every call and could create nobody, and the first person
   * to know was a colleague at the sign-in page. So: no key is `open`, with the procedure; a key
   * that answers and cannot see the reader's own account, or that Zitadel refuses, is `broken`,
   * red, with the one step that was missed; a provider that did not answer is `open` with its
   * words and no verdict, because a timeout says nothing about the key.
   */
  if (input.inviteKey.kind !== "inapplicable") {
    const key = input.inviteKey;
    const broken = key.kind === "blind" || key.kind === "refused";
    push("inviteKey", {
      owner: "club",
      state: key.kind === "ok" ? "done" : broken ? "broken" : "open",
      text: key.kind === "ok" || key.kind === "unconfigured" ? undefined : key.kind,
      steps: broken ? "howBroken" : key.kind === "unreachable" ? "howUnreachable" : undefined,
      detail: key.reason,
    });
  }

  push("publishEvents", {
    owner: "club",
    state: input.publishedEventCount > 0 ? "done" : "open",
  });

  // Only while there is something to destroy (§323): seven to thirty days after an event, open
  // and never blocking, naming the events. There is no "done" to reach — the system cannot see
  // a spreadsheet on somebody's laptop — so the row simply leaves when the window closes.
  if (input.raceDaySheetsDue.length > 0) {
    push("raceDaySheets", {
      owner: "club",
      state: "open",
      detail: input.raceDaySheetsDue.join(", "),
    });
  }

  // Not blocking: registrations do not need photos. Open until the bucket exists, because an
  // album page without an upload button is a gallery nobody can fill (BR-REQ-054-01).
  push("mediaStorage", {
    owner: "club",
    state: input.storageConfigured ? "done" : "open",
  });

  // Not blocking either: the form already refuses the dumb bots. Open until the two keys exist,
  // because a race that opens entries to a hundred people is when the other kind shows up (§97).
  push("botCheck", {
    owner: "club",
    state: input.botCheckConfigured ? "done" : "open",
  });

  // Built (§99); open until the club names the mailbox, never blocking: the per-event bundle
  // on the event page is the archive meanwhile.
  push("declarationArchiveMail", {
    owner: "club",
    state: input.declarationArchiveConfigured ? "done" : "open",
  });

  // Built (§101), as far as Vercel's API allows; open until the token exists, never blocking.
  push("vercelUsage", {
    owner: "club",
    state: input.vercelUsageConfigured ? "done" : "open",
  });

  // Built (§149); open until the club's Gmail lends the form its app password, never
  // blocking: without it the contact page shows the club's address as a link.
  push("contactForm", {
    owner: "club",
    state: input.contactFormConfigured ? "done" : "open",
  });

  // Open for a year by design, and never blocking: the `.com` serves; the `.ro` is a second door.
  push("roDomain", {
    owner: "club",
    state: input.roDomainBound ? "done" : "open",
  });

  /**
   * The monthly compute-time limit, and this period's spend against it (§NNN; the owner,
   * 2026-09-23, after $1.09 in two days of Launch: "I want toggles in my admin area, so I can
   * throttle myself when needed"). Not blocking: a limit is a brake the club chooses to pull,
   * not something a registration depends on. `broken` — red — at 80% of the quota is
   * deliberately the same word the invitation key's row uses for "set up and needs a hand
   * today": Neon suspends the whole database at 100%, every page down until the next billing
   * period, and a row that still had time to prevent that must not read as merely `open`.
   *
   * No quota is two different facts and only one of them is `open`: `input.neonQuota === null`
   * means Neon could not be read at all (no key, or no answer) — still `open`, the same "find
   * out why" as before. `input.neonQuota.quotaCuHours === null` means Neon answered and there is
   * genuinely no limit — on production that is the panel's own recommendation
   * (`NeonLimitsPanel`'s `recommendProduction`: "no limit on production; use Neon's spending
   * alert instead"), so a board that kept the row open would be asking the club to undo advice
   * this same screen gives; everywhere else a limit is still worth setting, so it stays `open`.
   */
  const noReading = input.neonQuota === null;
  const quota = input.neonQuota?.quotaCuHours ?? null;
  const nearLimit = quota !== null && isNeonQuotaNearLimit(input.neonQuota?.usedCuHours ?? 0, quota);
  const noQuotaAsRecommended = !noReading && quota === null && input.appEnv === "production";
  push("neonLimits", {
    owner: "club",
    state: noReading || quota === null ? (noQuotaAsRecommended ? "done" : "open") : nearLimit ? "broken" : "done",
    // `broken` needs its own sentence — the default "todo"/"done" pair cannot say "this is
    // about to suspend the database", which is the one thing this row exists to say in time.
    text: nearLimit ? "broken" : noQuotaAsRecommended ? "recommendedProduction" : undefined,
  });

  /**
   * The queued work (the owner, 2026-09-18: "all the queued work, so I can continue
   * tomorrow"): what was asked and not built yet, or built without the last mile. Static and
   * open — nothing in the system can tell when they are done; whoever finishes one removes it
   * here and records it in `DECISIONS.md`. Developer-owned, so they sort after the club's.
   * Empty since 2026-09-19 (§117, §118); the next ask goes here with its catalogue entry.
   */
  for (const id of BACKLOG) push(id, { owner: "developer", state: "open" });

  return tasks;
}

/** In the order to take them. Each has its title, its "why" and its steps in `Admin.tasks.items`. */
export const BACKLOG: readonly TaskId[] = [];

/** Blocking first, then broken, then open, then done — the order somebody scanning the page needs. */
export function sortTasks(tasks: OwnerTask[]): OwnerTask[] {
  const rank: Record<TaskState, number> = { blocking: 0, broken: 1, open: 2, done: 3 };
  return [...tasks].sort((a, b) => rank[a.state] - rank[b.state]);
}

/** The board's two filters (§150). `undefined` is "all"; a value outside the closed sets never gets here. */
export type TaskFilter = { owner?: TaskOwner; kind?: TaskKind };

/** The rows a filter keeps, in the order given. Both halves combine; an empty filter keeps everything. */
export function filterTasks(tasks: readonly OwnerTask[], filter: TaskFilter): OwnerTask[] {
  return tasks.filter(
    (task) =>
      (filter.owner === undefined || task.owner === filter.owner) &&
      (filter.kind === undefined || task.kind === filter.kind),
  );
}

/**
 * What the counter says: `pending` is everything not done — a blocking row is pending too,
 * only more so — and `done` the rest. Counted over the rows handed in, so the page counts
 * what it shows: a counter that says four while the filter shows two is a counter to distrust.
 */
export function countTasks(tasks: readonly OwnerTask[]): { pending: number; done: number } {
  let done = 0;
  for (const task of tasks) if (task.state === "done") done += 1;
  return { pending: tasks.length - done, done };
}
