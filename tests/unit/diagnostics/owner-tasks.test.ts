import { describe, expect, it } from "vitest";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { translationCredit } from "@/modules/translate/domain/credit";
import {
  countTasks,
  filterTasks,
  isTaskKind,
  isTaskOwner,
  ownerTasks,
  sortTasks,
  TASK_KIND,
  TASK_KINDS,
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
  hasApprovedTerms: true,
  listStatesDescribed: true,
  listSocialsDescribed: true,
  listNumbersDescribed: true,
  invitationsDescribed: true,
  promoDescribed: true,
  sponsorShareDescribed: true,
  newsletterDescribed: true,
  gmailFallbackDescribed: true,
  refusalDescribed: true,
  teamPageDescribed: true,
  raceDeclarationsCurrent: true,
  groupRunSeriesTextsCurrent: true,
  legalTextIsSample: false,
  emailDeliveryMode: "live",
  appEnv: "production",
  emailFailSafe: { stoppedLong: 0, failed: 0, retryingLate: 0 },
  staleJobNames: [],
  failingJobNames: [],
  staffCount: 3,
  inviteKey: { kind: "ok" },
  publishedEventCount: 4,
  raceDaySheetsDue: [],
  domainRenewal: { status: "ok", expiresOn: "2029-09-16", daysLeft: 1086 },
  unreachableWindow: "clear",
  storageConfigured: true,
  botCheckConfigured: true,
  botCheckHealth: "ok",
  declarationArchiveConfigured: true,
  vercelUsageConfigured: true,
  translationConfigured: true,
  translationCredit: { ok: true, credit: translationCredit({ used: 0, limit: 1_000_000 }) },
  contactFormConfigured: true,
  // Production's own numbers set on Neon the evening of 2026-09-23: a 100 CU-hour quota, well
  // under a fifth spent.
  neonQuota: { quotaCuHours: 100, usedCuHours: 12.34 },
};

const stateOf = (input: OwnerTaskInputs, id: string) =>
  ownerTasks(input).find((task) => task.id === id)?.state;

describe("owner tasks", () => {
  it("says nothing is blocking once everything is really in place", () => {
    const tasks = ownerTasks(LAUNCHED);
    expect(tasks.some((task) => task.state === "blocking")).toBe(false);
    // The club's rows are all done; the developer's queued work stays open by design (§97).
    expect(tasks.filter((task) => task.owner === "club").every((task) => task.state === "done")).toBe(true);
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

  /** §396 — the public list's states wait on the club's notice, and the row says so without blocking anybody. */
  it("keeps the list-states row open while the notice in force does not describe them, and never blocking", () => {
    expect(stateOf({ ...LAUNCHED, listStatesDescribed: false }, "listStatesNotice")).toBe("open");
    expect(stateOf(LAUNCHED, "listStatesNotice")).toBe("done");
    // With no notice at all the approval row is the thing to do; this one is not shown.
    expect(ownerTasks({ ...LAUNCHED, hasApprovedPrivacyNotice: false }).some((task) => task.id === "listStatesNotice")).toBe(false);
    for (const catalogue of [ro, en]) {
      const item = catalogue.Admin.tasks.items.listStatesNotice;
      expect(item.title && item.todo && item.done && item.how.length > 0).toBeTruthy();
      expect(item.how.join("\n")).toContain("/admin/legal");
    }
  });

  /** §647 — the invitations by email: the club may invite meanwhile; the row says what the notice owes, open, never blocking. */
  it("keeps the invitations row open while the notice in force does not describe them, and never blocking", () => {
    expect(stateOf({ ...LAUNCHED, invitationsDescribed: false }, "invitationsNotice")).toBe("open");
    expect(stateOf(LAUNCHED, "invitationsNotice")).toBe("done");
    expect(ownerTasks({ ...LAUNCHED, hasApprovedPrivacyNotice: false }).some((task) => task.id === "invitationsNotice")).toBe(false);
    for (const catalogue of [ro, en]) {
      const item = catalogue.Admin.tasks.items.invitationsNotice;
      expect(item.title && item.todo && item.done && item.how.length > 0).toBeTruthy();
      expect(item.how.join("\n")).toContain("/admin/legal");
    }
  });

  /** §613 — the race number beside a confirmed name waits on the club's notice, like the states; open, never blocking. */
  it("keeps the list-numbers row open while the notice in force does not describe the number, and never blocking", () => {
    expect(stateOf({ ...LAUNCHED, listNumbersDescribed: false }, "listNumbersNotice")).toBe("open");
    expect(stateOf(LAUNCHED, "listNumbersNotice")).toBe("done");
    // Its own answer, not the states' or the socials': a notice naming those and not the number leaves it open.
    expect(stateOf({ ...LAUNCHED, listNumbersDescribed: false }, "listStatesNotice")).toBe("done");
    expect(stateOf({ ...LAUNCHED, listStatesDescribed: false, listSocialsDescribed: false }, "listNumbersNotice")).toBe("done");
    expect(ownerTasks({ ...LAUNCHED, hasApprovedPrivacyNotice: false }).some((task) => task.id === "listNumbersNotice")).toBe(false);
    for (const catalogue of [ro, en]) {
      const item = catalogue.Admin.tasks.items.listNumbersNotice;
      expect(item.title && item.todo && item.done && item.how.length > 0).toBeTruthy();
      expect(item.how.join("\n")).toContain("/admin/legal");
      // §613: the club writes to the runners registered under the earlier notice BEFORE it approves the new one,
      // with the backoffice's own message, and names the participant's own control for withdrawing.
      const approveStep = item.how.findIndex((step) => /Aprobă și publică|Approve and publish/.test(step));
      const messageStep = item.how.findIndex((step) => step.includes(catalogue.Admin.participantMessages.link));
      expect(messageStep).toBeGreaterThanOrEqual(0);
      expect(messageStep).toBeLessThan(approveStep);
      expect(item.how.join("\n")).toContain(catalogue.Registrations.list.optOut);
      expect(item.how.join("\n")).not.toContain("„—”");
      expect(item.how.join("\n")).not.toContain("“—”");
      expect(item.how.every((step) => step.length <= 200)).toBe(true);
    }
  });

  /** §636 — the club's right to refuse a registration waits on the terms in force, like the notice's rows; open, never blocking. */
  it("keeps the refusal row open while the terms in force do not carry the grounds, and done once they do", () => {
    expect(stateOf({ ...LAUNCHED, refusalDescribed: false }, "refusalTerms")).toBe("open");
    expect(stateOf(LAUNCHED, "refusalTerms")).toBe("done");
    // Its own answer: a notice that names every field leaves it open while the terms do not.
    expect(stateOf({ ...LAUNCHED, refusalDescribed: false }, "listStatesNotice")).toBe("done");
    expect(ownerTasks({ ...LAUNCHED, refusalDescribed: false }).some((task) => task.state === "blocking")).toBe(false);
    // Its own gate, the terms in force: shown without a notice, hidden without terms.
    expect(stateOf({ ...LAUNCHED, hasApprovedPrivacyNotice: false, refusalDescribed: false }, "refusalTerms")).toBe("open");
    expect(ownerTasks({ ...LAUNCHED, hasApprovedTerms: false, refusalDescribed: false }).some((task) => task.id === "refusalTerms")).toBe(false);
    for (const catalogue of [ro, en]) {
      const item = catalogue.Admin.tasks.items.refusalTerms;
      expect(item.title && item.todo && item.done && item.how.length > 0).toBeTruthy();
      expect(item.how.join("\n")).toContain("/admin/legal");
      // The click: the terms' card, the new template, the approval.
      expect(item.how[0]).toContain(catalogue.Admin.legal.shortKeys.TERMS);
      expect(item.how[0]).toContain(catalogue.Admin.legal.kinds.templateNew);
      expect(item.how.join("\n")).toMatch(/Aprobă și publică|Approve and publish/);
      // What is missing on the sites while it is open: the form's box and the steps.
      expect(item.todo).toMatch(/formular|form/);
      for (const text of [item.title, item.todo, item.done, ...item.how]) expect(text.length).toBeLessThanOrEqual(200);
    }
  });

  /** §500 — Strava and Instagram beside a name wait on the club's notice, like the states; open, never blocking. */
  it("keeps the list-socials row open while the notice in force does not describe them, and never blocking", () => {
    expect(stateOf({ ...LAUNCHED, listSocialsDescribed: false }, "listSocialsNotice")).toBe("open");
    expect(stateOf(LAUNCHED, "listSocialsNotice")).toBe("done");
    expect(ownerTasks({ ...LAUNCHED, hasApprovedPrivacyNotice: false }).some((task) => task.id === "listSocialsNotice")).toBe(false);
    for (const catalogue of [ro, en]) {
      const item = catalogue.Admin.tasks.items.listSocialsNotice;
      expect(item.title && item.todo && item.done && item.how.length > 0).toBeTruthy();
      expect(item.how.join("\n")).toContain("/admin/legal");
    }
  });

  /** §562 — the offers-and-benefits box waits on the club's notice, like the socials; open, never blocking. */
  it("keeps the offers-and-benefits row open while the notice in force does not describe them, and never blocking", () => {
    expect(stateOf({ ...LAUNCHED, promoDescribed: false }, "promoNotice")).toBe("open");
    expect(stateOf(LAUNCHED, "promoNotice")).toBe("done");
    expect(ownerTasks({ ...LAUNCHED, hasApprovedPrivacyNotice: false }).some((task) => task.id === "promoNotice")).toBe(false);
    for (const catalogue of [ro, en]) {
      const item = catalogue.Admin.tasks.items.promoNotice;
      expect(item.title && item.todo && item.done && item.how.length > 0).toBeTruthy();
      expect(item.how.join("\n")).toContain("/admin/legal");
    }
  });

  /** §570 — the list for sponsors waits on a notice that says partners may receive it; open, never blocking. */
  it("keeps the sponsor-list row open while the notice in force does not describe the sharing, and never blocking", () => {
    expect(stateOf({ ...LAUNCHED, sponsorShareDescribed: false }, "sponsorNotice")).toBe("open");
    expect(stateOf(LAUNCHED, "sponsorNotice")).toBe("done");
    expect(ownerTasks({ ...LAUNCHED, hasApprovedPrivacyNotice: false }).some((task) => task.id === "sponsorNotice")).toBe(false);
    expect(ownerTasks({ ...LAUNCHED, sponsorShareDescribed: false }).find((task) => task.id === "sponsorNotice")).toMatchObject({ owner: "club", kind: "text" });
    for (const catalogue of [ro, en]) {
      const item = catalogue.Admin.tasks.items.sponsorNotice;
      expect(item.title && item.todo && item.done && item.how.length > 0).toBeTruthy();
      expect(item.how.join("\n")).toContain("/admin/legal");
    }
  });

  /** §459 — the team page's names and photographs wait on the club's notice; open, never blocking. */
  it("keeps the team-page notice row open while the notice in force does not describe the page", () => {
    expect(stateOf({ ...LAUNCHED, teamPageDescribed: false }, "teamPageNotice")).toBe("open");
    expect(stateOf(LAUNCHED, "teamPageNotice")).toBe("done");
    expect(ownerTasks({ ...LAUNCHED, hasApprovedPrivacyNotice: false }).some((task) => task.id === "teamPageNotice")).toBe(false);
    for (const catalogue of [ro, en]) {
      const item = catalogue.Admin.tasks.items.teamPageNotice;
      expect(item.title && item.todo && item.done && item.how.length > 0).toBeTruthy();
      expect(item.how.join("\n")).toContain("/admin/legal");
    }
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

  it("§435 the domain's renewal: green, amber at 90 days, red at 30 and past, never blocking", () => {
    const row = (domainRenewal: OwnerTaskInputs["domainRenewal"]) =>
      ownerTasks({ ...LAUNCHED, domainRenewal }).find((task) => task.id === "domainRenewal");
    expect(row({ status: "ok", expiresOn: "2027-09-16", daysLeft: 91 })).toMatchObject({ state: "done", owner: "club" });
    expect(row({ status: "soon", expiresOn: "2027-09-16", daysLeft: 90 })).toMatchObject({ state: "open" });
    expect(row({ status: "urgent", expiresOn: "2027-09-16", daysLeft: 30 })).toMatchObject({ state: "broken" });
    expect(row({ status: "urgent", expiresOn: "2027-09-16", daysLeft: 30 })?.text).toBeUndefined();
    // Red, but never «Nu funcționează»: the domain still works until the day.
    expect(row({ status: "urgent", expiresOn: "2027-09-16", daysLeft: 30 })?.label).toBe("due");
    expect(row({ status: "expired", expiresOn: "2027-09-16", daysLeft: -1 })?.label).toBeUndefined();
    expect(row({ status: "expired", expiresOn: "2027-09-16", daysLeft: -1 })).toMatchObject({ state: "broken", text: "expired" });
    // Unset dates remind nobody: open, with the sentence that says what is missing.
    expect(row({ status: "unknown" })).toMatchObject({ state: "open", text: "unknown" });
    // The .ro row is gone (the owner, 2026-09-26: one address for search engines).
    expect(ownerTasks(LAUNCHED).map((task) => task.id)).not.toContain("roDomain");
  });

  it("§435 the renewal row's sentences exist in both catalogues and fill the expiry", () => {
    for (const catalogue of [ro, en]) {
      const item = catalogue.Admin.tasks.items.domainRenewal;
      for (const key of ["todo", "done", "expired"] as const) expect(item[key]).toContain("{domainExpiresOn}");
      expect(typeof item.unknown).toBe("string");
      expect(item.how.join(" ")).toContain("DOMAIN_RENEWAL_YEARS");
      expect(catalogue.Admin.tasks.items).not.toHaveProperty("roDomain");
    }
  });

  it("keeps the photo bucket open, never blocking, until the R2 variables exist", () => {
    // Read from `STORAGE_MODE`: a deployed environment without the five variables cannot take
    // a photo, and a checklist somebody ticks would not know that.
    expect(stateOf({ ...LAUNCHED, storageConfigured: false }, "mediaStorage")).toBe("open");
    expect(stateOf(LAUNCHED, "mediaStorage")).toBe("done");
    // The queued work: developer-owned, always open, after the club's rows.
    const developer = ownerTasks(LAUNCHED).filter((task) => task.owner === "developer").map((task) => task.id);
    expect(developer).toEqual(["scheduler"]);
    // Vercel's figures (§101): the row is the club's switch — a token and a project id.
    expect(stateOf({ ...LAUNCHED, vercelUsageConfigured: false }, "vercelUsage")).toBe("open");
    expect(stateOf(LAUNCHED, "vercelUsage")).toBe("done");
    // The archive copy is built (§99); the row is the club's switch, open until the mailbox is named.
    expect(stateOf({ ...LAUNCHED, declarationArchiveConfigured: false }, "declarationArchiveMail")).toBe("open");
    expect(stateOf(LAUNCHED, "declarationArchiveMail")).toBe("done");
    // The bot check is a switch the club flips (§97): open without the keys, never blocking.
    expect(stateOf({ ...LAUNCHED, botCheckConfigured: false }, "botCheck")).toBe("open");
    expect(stateOf(LAUNCHED, "botCheck")).toBe("done");
    // A secret that is set but wrong is broken, red — not the quiet "open" a missing key gets
    // (§420, finding (10)'s health half): the difference between "not set up yet" and "set up
    // and does not work" is the whole reason this state exists.
    expect(
      stateOf({ ...LAUNCHED, botCheckConfigured: true, botCheckHealth: "misconfigured" }, "botCheck"),
    ).toBe("broken");
    // A timeout or Cloudflare having a bad moment must never turn this row red on its own — the
    // same "absence of evidence" reasoning `verifyTurnstile` uses for a real submission.
    expect(
      stateOf({ ...LAUNCHED, botCheckConfigured: true, botCheckHealth: "unreachable" }, "botCheck"),
    ).toBe("done");
    // The contact form (§149): built; open until the Gmail app password and the recipients exist.
    expect(stateOf({ ...LAUNCHED, contactFormConfigured: false }, "contactForm")).toBe("open");
    expect(stateOf(LAUNCHED, "contactForm")).toBe("done");
  });

  /*
    §323: the privacy notice promises exported lists and printed race-day sheets are destroyed
    within 30 days of the event. The system cannot see a spreadsheet on a laptop, so the row is a
    reminder that exists only while there is something to destroy — and names the events.
  */
  it("reminds the club to destroy exports and sheets only while an event is seven to thirty days past", () => {
    expect(ownerTasks(LAUNCHED).some((task) => task.id === "raceDaySheets")).toBe(false);
    const due = ownerTasks({ ...LAUNCHED, raceDaySheetsDue: ["Crosul aniversar", "Tura de toamnă"] }).find(
      (task) => task.id === "raceDaySheets",
    );
    expect(due).toMatchObject({ owner: "club", state: "open", kind: "check", detail: "Crosul aniversar, Tura de toamnă" });
    // Every sentence the row can show exists in both languages, steps included.
    for (const catalogue of [ro, en]) {
      const item = catalogue.Admin.tasks.items.raceDaySheets;
      expect(item.title && item.todo && item.done).toBeTruthy();
      expect(item.how.length).toBeGreaterThan(0);
      // The notice's three-year promise covers the club's other mail too (review finding): the
      // confirmation notices and the club copies each have a search, in both subjects' languages.
      const steps = item.how.join("\n");
      for (const subject of ["Declarație semnată", "Signed declaration", "Înscriere confirmată", "Registration confirmed", "Copie club", "Club copy"]) {
        expect(steps, subject).toContain(subject);
      }
    }
  });

  /*
    §324 (review nit on §322): a retention sweep that fails two runs in a row is `failing`, not a
    stale scheduler. Folded into "scheduler" it read as a missing monitor and sent the reader to
    set up cron jobs that were fine; it is its own red row, the developer's, and only while it fails.
  */
  it("shows a failing retention sweep as its own red row, not as a stale scheduler", () => {
    expect(ownerTasks(LAUNCHED).some((task) => task.id === "retentionSweep")).toBe(false);
    const failing = { ...LAUNCHED, failingJobNames: ["registration-maintenance"] };
    expect(ownerTasks(failing).find((task) => task.id === "retentionSweep")).toMatchObject({
      owner: "developer",
      state: "broken",
      detail: "registration-maintenance",
    });
    expect(stateOf(failing, "scheduler")).toBe("done");
    for (const catalogue of [ro, en]) {
      const item = catalogue.Admin.tasks.items.retentionSweep;
      expect(item.title && item.todo && item.done).toBeTruthy();
      expect(item.how.join("\n")).toContain("/devs");
    }
  });

  it("leaves every task but the scheduler to the club", () => {
    const clubOwned = ownerTasks(LAUNCHED).filter((task) => task.owner === "club");
    expect(clubOwned.map((task) => task.id)).toEqual([
      "approveLegalText",
      "listStatesNotice",
      "listSocialsNotice",
      "listNumbersNotice",
      "invitationsNotice",
      "promoNotice",
      "sponsorNotice",
      "newsletterNotice",
      "gmailFallbackNotice",
      "refusalTerms",
      "teamPageNotice",
      "raceDeclarations",
      "groupRunSeriesTexts",
      "emailFailSafe",
      "liveEmail",
      "inviteStaff",
      "inviteKey",
      "publishEvents",
      "mediaStorage",
      "botCheck",
      "declarationArchiveMail",
      "vercelUsage",
      "translation",
      "contactForm",
      "domainRenewal",
      "unreachableWindow",
      "neonLimits",
    ]);
  });

  // §657: the outage grace — blocking while a window is open or a claim it did not revive still waits, broken while one is stuck.
  it("§657 the unreachable window: blocking while open or while a claim not revived waits, broken while stuck, done otherwise", () => {
    const row = (unreachableWindow: OwnerTaskInputs["unreachableWindow"]) => ownerTasks({ ...LAUNCHED, unreachableWindow }).find((task) => task.id === "unreachableWindow");
    expect(row("clear")).toMatchObject({ state: "done", owner: "club", kind: "check" });
    expect(row("clear")?.text).toBeUndefined();
    expect(row("open")).toMatchObject({ state: "blocking", text: "open" });
    expect(row("notRevived")).toMatchObject({ state: "blocking", text: "notRevived" });
    expect(row("stuck")).toMatchObject({ state: "broken", text: "stuck" });
  });

  it("§657 the unreachable window's sentences exist in both catalogues and fill the window's values", () => {
    for (const catalogue of [ro, en]) {
      const item = catalogue.Admin.tasks.items.unreachableWindow;
      for (const key of ["{windowFrom}", "{windowUntil}", "{windowGranted}", "{windowMoved}"]) expect(item.todo).toContain(key);
      expect(item.open).toContain("{windowFrom}");
      expect(item.stuck).toContain("{windowUntil}");
      expect(item.notRevived).toContain("{windowNotRevived}");
      // The job seats nobody: no word of the special list in the row.
      expect(JSON.stringify(item)).not.toMatch(/invitați speciali|special guests/i);
      expect(typeof item.done).toBe("string");
      expect(item.how.length).toBeGreaterThan(0);
    }
  });

  // §622: email nothing is carrying — red with the remedies, green otherwise, and always on the list.
  it("turns the email fail-safe row red while a stopped row waits past ninety minutes or a message failed this week", () => {
    expect(ownerTasks(LAUNCHED).find((task) => task.id === "emailFailSafe")).toMatchObject({ owner: "club", kind: "check", state: "done" });
    expect(ownerTasks({ ...LAUNCHED, emailFailSafe: { stoppedLong: 2, failed: 0, retryingLate: 0 } }).find((task) => task.id === "emailFailSafe")).toMatchObject({
      state: "broken",
      text: "broken",
    });
    expect(stateOf({ ...LAUNCHED, emailFailSafe: { stoppedLong: 0, failed: 1, retryingLate: 0 } }, "emailFailSafe")).toBe("broken");
    // A transient refusal retried for ever (§622): red, and the steps name the refusal that does not pass.
    expect(stateOf({ ...LAUNCHED, emailFailSafe: { stoppedLong: 0, failed: 0, retryingLate: 1 } }, "emailFailSafe")).toBe("broken");
    for (const catalogue of [ro, en]) {
      const item = catalogue.Admin.tasks.items.emailFailSafe;
      expect(item.broken).toContain("90");
      expect(item.how.join("\n")).toContain("MAILGUN_API_BASE_URL");
    }
  });

  /** §622 — Gmail carrying while Mailgun is stopped waits on a notice that names it; open, never blocking. */
  it("keeps the Gmail-fallback notice row open while the notice in force does not name it, and says what to approve and why", () => {
    expect(stateOf({ ...LAUNCHED, gmailFallbackDescribed: false }, "gmailFallbackNotice")).toBe("open");
    expect(stateOf(LAUNCHED, "gmailFallbackNotice")).toBe("done");
    expect(ownerTasks({ ...LAUNCHED, hasApprovedPrivacyNotice: false }).some((task) => task.id === "gmailFallbackNotice")).toBe(false);
    expect(ownerTasks({ ...LAUNCHED, gmailFallbackDescribed: false }).find((task) => task.id === "gmailFallbackNotice")).toMatchObject({ owner: "club", kind: "text" });
    for (const catalogue of [ro, en]) {
      const item = catalogue.Admin.tasks.items.gmailFallbackNotice;
      expect(item.title && item.todo && item.done && item.how.length > 0).toBeTruthy();
      expect(item.how.join("\n")).toContain("/admin/legal");
      // Why: a participant's data reaches Google only under a notice that says so.
      expect(item.how.join("\n")).toContain("Google");
    }
  });

  // §523: the group-run declarations written for one signature per series, approved again.
  it("asks for the group-run declarations again while one in force is older, and says nothing while none is in force", () => {
    expect(stateOf({ ...LAUNCHED, groupRunSeriesTextsCurrent: false }, "groupRunSeriesTexts")).toBe("open");
    expect(stateOf(LAUNCHED, "groupRunSeriesTexts")).toBe("done");
    expect(ownerTasks({ ...LAUNCHED, groupRunSeriesTextsCurrent: null }).some((task) => task.id === "groupRunSeriesTexts")).toBe(false);
    expect(ownerTasks({ ...LAUNCHED, groupRunSeriesTextsCurrent: false }).find((task) => task.id === "groupRunSeriesTexts")).toMatchObject({ owner: "club", kind: "text" });
    for (const catalogue of [ro, en]) {
      const item = catalogue.Admin.tasks.items.groupRunSeriesTexts;
      expect(item.how.length).toBeGreaterThan(0);
      expect(item.todo).not.toBe("");
      expect(item.done).not.toBe("");
    }
  });

  // «Tradu din română» (§464): built, open until DeepL's key is on the deployment, never blocking.
  it("asks for the DeepL key in its own row, open until it is set, with its steps in both languages", () => {
    expect(stateOf({ ...LAUNCHED, translationConfigured: false }, "translation")).toBe("open");
    expect(stateOf(LAUNCHED, "translation")).toBe("done");
    expect(ownerTasks({ ...LAUNCHED, translationConfigured: false }).find((task) => task.id === "translation")).toMatchObject({
      owner: "club",
      kind: "account",
    });
    for (const catalogue of [ro, en]) {
      const item = catalogue.Admin.tasks.items.translation;
      expect(item.title && item.todo && item.done).toBeTruthy();
      expect(item.how.join("\n")).toContain("DEEPL_API_KEY");
    }
  });

  // §497: the credit behind the key is given once — amber at 80 %, red at 95 % and when spent.
  it("reads the DeepL credit: watch is amber, low and spent are red, each with its own sentence and steps", () => {
    const at = (used: number): OwnerTaskInputs["translationCredit"] => ({ ok: true, credit: translationCredit({ used, limit: 1_000_000 }) });
    const row = (reading: OwnerTaskInputs["translationCredit"]) =>
      ownerTasks({ ...LAUNCHED, translationCredit: reading }).find((task) => task.id === "translation");
    expect(row(at(1_000_000))).toMatchObject({ state: "broken", text: "spent", steps: "howCredit" });
    expect(row(at(960_000))).toMatchObject({ state: "broken", text: "low", steps: "howCredit" });
    expect(row(at(950_000))).toMatchObject({ state: "broken", text: "low", steps: "howCredit" });
    expect(row(at(949_999))).toMatchObject({ state: "open", text: "watch", steps: "howCredit" });
    expect(row(at(800_000))).toMatchObject({ state: "open", text: "watch", steps: "howCredit" });
    // Under 80 % the row is done (green) and still says the figures (the `credit` sentence).
    for (const used of [0, 799_999]) {
      expect(row(at(used))).toMatchObject({ state: "done", text: "credit" });
      expect(row(at(used))?.steps).toBeUndefined();
    }
    // Unread: «—» with the reason; a refused key or a 456 is red, a silent DeepL leaves it done.
    expect(row({ ok: false, reason: "unavailable" })).toMatchObject({ state: "done", text: "creditUnread" });
    expect(row({ ok: false, reason: "refused" })).toMatchObject({ state: "broken", text: "creditUnread" });
    expect(row({ ok: false, reason: "quota" })).toMatchObject({ state: "broken", text: "creditUnread", steps: "howCredit" });
    // `off` on purpose: no key, nothing to read, nothing owed.
    expect(row({ ok: false, reason: "unconfigured" })).toMatchObject({ state: "done" });
    expect(row({ ok: false, reason: "unconfigured" })?.text).toBeUndefined();
    // Never blocking: a spent credit stops no registration.
    expect(row(at(1_000_000))?.state).not.toBe("blocking");
    // Without a key the credit is not the question.
    expect(ownerTasks({ ...LAUNCHED, translationConfigured: false, translationCredit: at(1_000_000) }).find((task) => task.id === "translation")?.state).toBe("open");
    for (const catalogue of [ro, en]) {
      const item = catalogue.Admin.tasks.items.translation;
      // Every credit sentence names the figures the page fills in; the unread one the reason.
      for (const text of [item.credit, item.watch, item.low]) {
        for (const value of ["{creditUsed}", "{creditLimit}", "{creditPercent}", "{creditRemaining}"]) expect(text).toContain(value);
      }
      expect(item.spent).toContain("{creditUsed}");
      expect(item.creditUnread).toContain("—");
      expect(item.creditUnread).toContain("{creditReason}");
      expect(item.howCredit.join("\n")).toContain("DEEPL_API_KEY");
      // The key's allowance is a one-time credit: no step promises a monthly one.
      expect([...item.how, ...item.howCredit].join("\n")).not.toMatch(/500[.,]000|a month, free|pe lună, gratuit|renewed monthly\)|lunar\)/);
    }
  });

  it("orders blocking first, then broken, then open, then done", () => {
    const sorted = sortTasks(
      ownerTasks({
        ...LAUNCHED,
        legalTextIsSample: true,
        domainRenewal: { status: "soon", expiresOn: "2026-12-01", daysLeft: 66 },
        inviteKey: { kind: "blind" },
      }),
    );
    expect(sorted.map((task) => task.state)).toEqual(
      [...sorted.map((task) => task.state)].sort((a, b) => {
        const rank = { blocking: 0, broken: 1, open: 2, done: 3 } as const;
        return rank[a] - rank[b];
      }),
    );
    expect(sorted[0].state).toBe("blocking");
    const states = sorted.map((task) => task.state);
    expect(states.indexOf("broken")).toBeGreaterThan(states.lastIndexOf("blocking"));
    expect(states.indexOf("open")).toBeGreaterThan(states.lastIndexOf("broken"));
  });
});

/**
 * The invitation key, tested rather than merely present (`DECISIONS.md` §288). For two days the
 * key was set on both projects, authenticated on every call and could create nobody; the board
 * asked "is it set" and said done. The row now carries the answer to "does it work", and the
 * fourth state exists so that "set and not working" is red without claiming to block anybody.
 */
describe("the invitation key row (§288)", () => {
  const keyRow = (inviteKey: OwnerTaskInputs["inviteKey"]) =>
    ownerTasks({ ...LAUNCHED, inviteKey }).find((task) => task.id === "inviteKey");

  it("is done only when a real search found the reader, and open with the procedure without a key", () => {
    expect(keyRow({ kind: "ok" })).toMatchObject({ state: "done", owner: "club", kind: "account" });
    expect(keyRow({ kind: "ok" })?.text).toBeUndefined();
    const missing = keyRow({ kind: "unconfigured" });
    expect(missing?.state).toBe("open");
    // The default sentence and the default steps: `todo`, and the whole of SETUP.md §37.
    expect(missing?.text).toBeUndefined();
    expect(missing?.steps).toBeUndefined();
  });

  it("is broken — red, with the one step that was missed — when the key authenticates and cannot see accounts", () => {
    // The club's own instance for two days: set, authenticating, and shown nobody.
    const blind = keyRow({ kind: "blind" });
    expect(blind).toMatchObject({ state: "broken", text: "blind", steps: "howBroken" });
    expect(blind?.detail).toBeUndefined();
    const refused = keyRow({ kind: "refused", reason: "403 membership not found (AUTHZ-cdgFk)" });
    expect(refused).toMatchObject({
      state: "broken",
      text: "refused",
      steps: "howBroken",
      detail: "403 membership not found (AUTHZ-cdgFk)",
    });
  });

  it("gives no verdict on a provider that did not answer, and never blocks a registration", () => {
    const silent = keyRow({ kind: "unreachable", reason: "TimeoutError: The operation was aborted due to timeout" });
    expect(silent).toMatchObject({ state: "open", text: "unreachable", steps: "howUnreachable" });
    expect(silent?.detail).toContain("TimeoutError");
    // Whatever the key does, it stops no registration: the line above the list stays true.
    for (const kind of ["blind", "refused", "unreachable", "unconfigured"] as const) {
      expect(ownerTasks({ ...LAUNCHED, inviteKey: { kind } }).some((task) => task.state === "blocking")).toBe(false);
    }
  });

  it("warns, open and with its own words, when the accounts listing reached its ceiling (§524)", () => {
    for (const key of [{ kind: "ok", capped: true }, { kind: "capped" }] as const) {
      expect(keyRow(key)).toMatchObject({ state: "open", text: "capped", steps: "howCapped" });
    }
    expect(keyRow({ kind: "ok", capped: false })?.state).toBe("done");
    for (const catalogue of [ro, en]) {
      const row = catalogue.Admin.tasks.items.inviteKey as Record<string, unknown>;
      expect(typeof row.capped).toBe("string");
      expect(Array.isArray(row.howCapped)).toBe(true);
    }
  });

  it("has no row at all where the development switcher is the provider", () => {
    expect(keyRow({ kind: "inapplicable" })).toBeUndefined();
  });

  it("points only at sentences and steps both catalogues carry", () => {
    // The page builds these keys from the row (`items.<id>.<text>`, `items.<id>.<steps>`), so
    // the static catalogue scan cannot see them; a missing one renders the key to the club.
    const items = (messages: typeof ro) => messages.Admin.tasks.items.inviteKey;
    for (const catalogue of [ro, en]) {
      const row = items(catalogue);
      for (const kind of ["blind", "refused", "unreachable"] as const) {
        expect(keyRow({ kind, reason: "x" })?.text).toBe(kind);
        expect(typeof row[kind]).toBe("string");
      }
      expect(Array.isArray(row.howBroken)).toBe(true);
      expect(Array.isArray(row.howUnreachable)).toBe(true);
      expect(row.howBroken.length).toBeGreaterThan(0);
      expect(row.howUnreachable.length).toBeGreaterThan(0);
      expect(typeof catalogue.Admin.tasks.state.broken).toBe("string");
    }
  });
});

/**
 * The database's monthly compute-time limit (§335; the owner, 2026-09-23, after $1.09 in two
 * days of Launch: "I want toggles in my admin area, so I can throttle myself when needed").
 *
 * `owner-tasks.ts`'s one rule is that nothing here is ticked by hand, so the three states this
 * row can be in must come from the same reading `readNeonConsumption` already makes for the
 * Costuri panel — never a second request, and never a setting an Administrator could tick
 * without a quota actually existing on Neon.
 */
describe("BR-REQ-090-07 criterion 12 — the database limit row (§335)", () => {
  const limitsRow = (neonQuota: OwnerTaskInputs["neonQuota"], appEnv: OwnerTaskInputs["appEnv"] = LAUNCHED.appEnv) =>
    ownerTasks({ ...LAUNCHED, appEnv, neonQuota }).find((task) => task.id === "neonLimits");

  it("is open with no quota set, and open too when Neon could not be read at all", () => {
    expect(limitsRow({ quotaCuHours: null, usedCuHours: 0 }, "qa")).toMatchObject({
      state: "open",
      owner: "club",
      kind: "decision",
    });
    // `null` is what the page passes when `readNeonConsumption` itself failed — "there is none"
    // and "we could not check" ask for the same next step, so both read the same state, on
    // every environment, production included.
    expect(limitsRow(null, "qa")?.state).toBe("open");
    expect(limitsRow(null, "production")?.state).toBe("open");
  });

  it("is open on production with no quota too — the owner capped production (SETUP.md §40), so no limit is a limit owed", () => {
    // The earlier reading of production's "no quota" as the card's own advice is gone with that
    // advice: the card recommends a limit with room everywhere, and the row agrees with it.
    for (const appEnv of ["production", "local", "test", "qa"] as const) {
      expect(limitsRow({ quotaCuHours: null, usedCuHours: 0 }, appEnv), appEnv).toMatchObject({ state: "open", text: undefined });
    }
  });

  it("is done once a quota exists and this period is comfortably under it", () => {
    expect(limitsRow({ quotaCuHours: 100, usedCuHours: 12.34 })?.state).toBe("done");
    // Just under the 80% line: still done.
    expect(limitsRow({ quotaCuHours: 100, usedCuHours: 79.9 })?.state).toBe("done");
  });

  it("turns broken — red — at 80% of the quota, before Neon would suspend the database at 100%", () => {
    expect(limitsRow({ quotaCuHours: 100, usedCuHours: 80 })).toMatchObject({ state: "broken", text: "broken" });
    expect(limitsRow({ quotaCuHours: 30, usedCuHours: 27 })?.state).toBe("broken"); // QA's own quota
    expect(limitsRow({ quotaCuHours: 100, usedCuHours: 100 })?.state).toBe("broken");
    // The default sentence pair otherwise: `done`'s own text, and `todo` while it is open.
    expect(limitsRow({ quotaCuHours: 100, usedCuHours: 12.34 })?.text).toBeUndefined();
    expect(limitsRow(null)?.text).toBeUndefined();
  });

  it("never blocks a registration, whatever the spend", () => {
    for (const neonQuota of [null, { quotaCuHours: null, usedCuHours: 0 }, { quotaCuHours: 100, usedCuHours: 100 }]) {
      expect(ownerTasks({ ...LAUNCHED, neonQuota }).some((task) => task.state === "blocking")).toBe(false);
    }
  });

  it("points at sentences and steps both catalogues carry", () => {
    for (const catalogue of [ro, en]) {
      const row = catalogue.Admin.tasks.items.neonLimits;
      expect(typeof row.title).toBe("string");
      expect(typeof row.todo).toBe("string");
      expect(typeof row.broken).toBe("string");
      expect(typeof row.done).toBe("string");
      // The sentence that called production's missing limit "what this screen recommends" is gone.
      expect(row).not.toHaveProperty("recommendedProduction");
      expect(Array.isArray(row.how)).toBe(true);
      expect(row.how.length).toBeGreaterThan(0);
    }
  });
});

/**
 * The counter and the two filters (§150; the owner: "show a counter of how many items are
 * pending, and a filter by issue type and owner"). Pure over the list, so the page's chips
 * and its "De făcut: N · Gata: M" line are tested here without a browser.
 */
describe("the counter and the filters", () => {
  // A board where every state occurs: two blocking, three open, the rest done.
  const MIXED: OwnerTaskInputs = {
    ...LAUNCHED,
    legalTextIsSample: true, // approveLegalText: blocking (club, text)
    staleJobNames: ["email-outbox"], // scheduler: blocking (developer, check)
    staffCount: 1, // inviteStaff: open (club, account)
    domainRenewal: { status: "soon", expiresOn: "2026-12-01", daysLeft: 66 }, // domainRenewal: open (club, decision)
    contactFormConfigured: false, // contactForm: open (club, account)
  };

  it("gives every task a kind from the closed set, and the map names every id the list produces", () => {
    const tasks = ownerTasks(MIXED);
    for (const task of tasks) {
      expect(TASK_KINDS).toContain(task.kind);
      expect(TASK_KIND[task.id]).toBe(task.kind);
    }
    // The four kinds are all in use; a kind nothing carries is a chip that filters to nothing.
    expect(new Set(tasks.map((task) => task.kind)).size).toBe(TASK_KINDS.length);
  });

  it("counts what is pending — blocking counts as pending — and what is done", () => {
    const tasks = ownerTasks(MIXED);
    expect(countTasks(tasks)).toEqual({ pending: 5, done: tasks.length - 5 });
    expect(countTasks(ownerTasks(LAUNCHED))).toEqual({ pending: 0, done: tasks.length });
    expect(countTasks([])).toEqual({ pending: 0, done: 0 });
  });

  it("narrows by owner, by kind, and by both at once — and an empty filter keeps everything", () => {
    const tasks = sortTasks(ownerTasks(MIXED));
    expect(filterTasks(tasks, {})).toEqual(tasks);

    const club = filterTasks(tasks, { owner: "club" });
    expect(club.every((task) => task.owner === "club")).toBe(true);
    expect(club.map((task) => task.id)).not.toContain("scheduler");

    const accounts = filterTasks(tasks, { kind: "account" });
    expect(accounts.every((task) => task.kind === "account")).toBe(true);
    expect(accounts.map((task) => task.id)).toEqual(
      expect.arrayContaining(["inviteStaff", "contactForm", "liveEmail"]),
    );

    // Both halves combine, and the sort order survives the narrowing.
    const developerChecks = filterTasks(tasks, { owner: "developer", kind: "check" });
    expect(developerChecks.map((task) => task.id)).toEqual(["scheduler"]);
    expect(filterTasks(tasks, { owner: "developer", kind: "text" })).toEqual([]);
    const clubOpen = filterTasks(tasks, { owner: "club" });
    expect(clubOpen.map((task) => task.state)).toEqual(sortTasks(clubOpen).map((task) => task.state));

    // The counter follows the filter: it counts the rows shown, not the board — three
    // decision-kind rows now that neonLimits is one (§335), and MIXED leaves it inherited "done".
    expect(countTasks(filterTasks(tasks, { kind: "decision" }))).toEqual({ pending: 1, done: 2 });
  });

  it("reads a query value only from the closed sets", () => {
    expect(isTaskOwner("club")).toBe(true);
    expect(isTaskOwner("developer")).toBe(true);
    expect(isTaskOwner("CLUB")).toBe(false);
    expect(isTaskOwner(undefined)).toBe(false);
    expect(isTaskKind("account")).toBe(true);
    expect(isTaskKind("cont")).toBe(false);
    expect(isTaskKind("")).toBe(false);
  });
});

describe("the email task off production", () => {
  it("reads done on QA in allowlist mode, where live is refused by rule, and blocking in capture", async () => {
    const { ownerTasks } = await import("@/modules/diagnostics/owner-tasks");
    const qa = ownerTasks({ ...LAUNCHED, appEnv: "qa", emailDeliveryMode: "allowlist" });
    expect(qa.find((task) => task.id === "liveEmail")?.state).toBe("done");
    const captured = ownerTasks({ ...LAUNCHED, appEnv: "qa", emailDeliveryMode: "capture" });
    expect(captured.find((task) => task.id === "liveEmail")?.state).toBe("blocking");
    // Production still needs `live`.
    const prod = ownerTasks({ ...LAUNCHED, appEnv: "production", emailDeliveryMode: "allowlist" });
    expect(prod.find((task) => task.id === "liveEmail")?.state).toBe("blocking");
  });
});

/** §NNN — the club's side of «Email respins» on «Sarcini»: three rows, each from what the system reports. */
describe("the email rows of «Sarcini»", () => {
  const rows = (input: Partial<OwnerTaskInputs>) => ownerTasks({ ...LAUNCHED, ...input });

  it("reds the club's mailboxes row while one refuses, and greens it after thirty quiet days", () => {
    const red = rows({ clubMailboxRefusals: 2 }).find((task) => task.id === "clubMailboxRefusals");
    expect(red).toMatchObject({ state: "broken", owner: "club", kind: "check", count: 2 });
    expect(rows({ clubMailboxRefusals: 0 }).find((task) => task.id === "clubMailboxRefusals")?.state).toBe("done");
    // Not read: no row at all.
    expect(rows({}).some((task) => task.id === "clubMailboxRefusals")).toBe(false);
  });

  it("says «none refused» only when none did, and where the removed ones are when only they refused", () => {
    // No refusal at all in thirty days: the plain green sentence.
    const quiet = rows({ clubMailboxRefusals: 0, clubMailboxesRemoved: 0 }).find((task) => task.id === "clubMailboxRefusals");
    expect(quiet?.state).toBe("done");
    expect(quiet?.text).toBeUndefined();
    expect(ro.Admin.tasks.items.clubMailboxRefusals.done).toBe("Nicio adresă a clubului nu a respins emailuri în ultimele 30 de zile.");
    // Only addresses removed since refused: green, and it points at the panel that still lists them.
    const removed = rows({ clubMailboxRefusals: 0, clubMailboxesRemoved: 1 }).find((task) => task.id === "clubMailboxRefusals");
    expect(removed).toMatchObject({ state: "done", text: "doneRemoved" });
    expect(ro.Admin.tasks.items.clubMailboxRefusals.doneRemoved).toBe(
      "Nicio adresă din „Copiile clubului” nu cere ceva; adresele scoase între timp apar în „Setări → Emailuri”.",
    );
    expect(en.Admin.tasks.items.clubMailboxRefusals.doneRemoved).toContain("Settings → Emails");
    // One still in the settings outranks the removed: red, by its count.
    expect(rows({ clubMailboxRefusals: 1, clubMailboxesRemoved: 2 }).find((task) => task.id === "clubMailboxRefusals")).toMatchObject({ state: "broken", count: 1 });
  });

  it("says Mailgun's «Delivered» events do not arrive only when some left this week and none was reported", () => {
    expect(rows({ deliveryEvidence: { mailgunSent: 12, delivered: 0 } }).find((task) => task.id === "deliveryReports")).toMatchObject({ state: "broken", kind: "account" });
    expect(rows({ deliveryEvidence: { mailgunSent: 12, delivered: 3 } }).some((task) => task.id === "deliveryReports")).toBe(false);
    expect(rows({ deliveryEvidence: { mailgunSent: 0, delivered: 0 } }).some((task) => task.id === "deliveryReports")).toBe(false);
    // A laptop captures and never hears from Mailgun: nothing owed there.
    expect(rows({ emailDeliveryMode: "capture", deliveryEvidence: { mailgunSent: 12, delivered: 0 } }).some((task) => task.id === "deliveryReports")).toBe(false);
  });

  it("gives each race whose participants have an email that needs attention its own row, its count and its filtered list", () => {
    const tasks = rows({
      emailAttention: [
        { eventId: "e1", title: "Crosul", count: 2 },
        { eventId: "e2", title: "Semimaratonul", count: 0 },
      ],
    }).filter((task) => task.id === "emailAttention");
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({ state: "open", key: "emailAttention-e1", values: { event: "Crosul" }, count: 2, registrationsOf: { eventId: "e1", title: "Crosul" } });
  });

  it("words each row in both catalogues, by count form, under 200 characters, its link on the board", () => {
    for (const catalogue of [ro, en]) {
      const items = catalogue.Admin.tasks.items;
      for (const form of ["one", "few", "other"] as const) {
        expect(items.clubMailboxRefusals.todo[form]).toContain("{count}");
        expect(items.emailAttention.todo[form]).toContain("{event}");
      }
      expect(items.emailAttention.link).toContain("{event}");
      expect(items.deliveryReports.how.join("\n")).toContain("{webhookUrl}");
      const strings = [
        items.clubMailboxRefusals.title, items.clubMailboxRefusals.done, items.clubMailboxRefusals.doneRemoved, ...Object.values(items.clubMailboxRefusals.todo), ...items.clubMailboxRefusals.how,
        items.deliveryReports.title, items.deliveryReports.todo, ...items.deliveryReports.how,
        items.emailAttention.title, items.emailAttention.link, ...Object.values(items.emailAttention.todo), ...items.emailAttention.how,
      ];
      for (const text of strings) expect(text.length, text).toBeLessThanOrEqual(200);
    }
    expect(ro.Admin.tasks.items.deliveryReports.todo).toBe("Mailgun nu trimite evenimentele „Delivered”; fără ele, „Email respins” nu se stinge.");
  });
});

