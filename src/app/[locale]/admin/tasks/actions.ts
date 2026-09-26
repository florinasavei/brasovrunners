"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { getPathname } from "@/i18n/navigation";
import { routing, type Locale } from "@/i18n/routing";
import { changeClubTodo, type ClubTodoRequest } from "@/modules/club-todo/club-todo";
import { NeonLimitsRefusal, updateNeonLimits } from "@/modules/diagnostics/neon-limits";
import { updateNeonPlan } from "@/modules/diagnostics/neon-plan";
import { updateJobCadence } from "@/modules/jobs/cadence";
import { updateBotCheck } from "@/modules/registrations/bot-check";
import { requireStaff, requireStaffRole } from "@/modules/staff-identity/session";
import { env } from "@/shared/config/env";
import { isDomainError } from "@/shared/errors/domain-error";
import { flashOutcome } from "@/shared/feedback/flash";
import { type FormOutcome, refused } from "@/shared/forms/outcome";

/** Which language to land back in: the form carries it, because an action has no request locale. */
function localeOf(form: FormData): Locale {
  const raw = form.get("uiLocale");
  return typeof raw === "string" && (routing.locales as readonly string[]).includes(raw) ? (raw as Locale) : routing.defaultLocale;
}

/**
 * The anti-bot challenge, switched from the task board (`DECISIONS.md` §254).
 *
 * Administrator only — the same gate as every other setting that changes what a participant
 * meets (§100, §164, §244) — and the service asserts the role again and writes the audit row.
 * The panel posts the state it wants rather than a toggle, so two people pressing at once end
 * up where the second one aimed instead of flipping each other's decision.
 */
export async function updateBotCheckAction(_previous: FormOutcome | null, form: FormData): Promise<FormOutcome | null> {
  const locale = localeOf(form);
  const path = getPathname({ locale, href: "/admin/tasks" });

  let outcome: string;
  try {
    const actor = await requireStaffRole("ADMIN");
    /*
      One panel, two switches (§282): the captcha and the hidden trap. The form says which it
      is and the state it wants, so two people pressing at once end up where the second one
      aimed rather than flipping each other's decision.
    */
    const wanted = form.get("enabled") === "1";
    const which = form.get("which") === "honeypot" ? "honeypot" : "enabled";
    await updateBotCheck(getDb(), actor, { [which]: wanted }, new Date());
    outcome = `saved=${which === "honeypot" ? (wanted ? "honeypotOn" : "honeypotOff") : wanted ? "botCheckOn" : "botCheckOff"}`;
    await flashOutcome({ saved: outcome.slice("saved=".length) });
  } catch (error) {
    if (!isDomainError(error)) throw error;
    outcome = `error=${error.code}`;
  }
  // The page reads the setting it has just written; without this it comes back saying what it
  // said before the press (the trap §100 and §164 both documented).
  revalidatePath(path);
  redirect(`${path}?${outcome}#admin-alert`);
}

/**
 * "The Neon plan we are on" (`DECISIONS.md` §280's follow-up), from the costs panel. The same
 * gate and the same shape as the Mailgun plan on `/admin/emails` (§100): Administrator at the
 * door, the service asserting the role again and writing the audit row. Lands back on the
 * costs panel, where the figures that follow the plan are. A refusal is the form's returned
 * state, with the plan and the note as chosen (`DECISIONS.md` §315), as the Mailgun plan's is.
 */
export async function updateNeonPlanAction(_previous: FormOutcome | null, form: FormData): Promise<FormOutcome | null> {
  const locale = localeOf(form);
  const path = getPathname({ locale, href: "/admin/tasks" });

  try {
    const actor = await requireStaffRole("ADMIN");
    await updateNeonPlan(
      getDb(),
      actor,
      { plan: form.get("plan"), note: typeof form.get("note") === "string" ? form.get("note") : "" },
      new Date(),
    );
  } catch (error) {
    return refused(error, form);
  }
  revalidatePath(path);
  await flashOutcome({ saved: "neonPlan" });
  redirect(`${path}?panel=costs&saved=neonPlan#admin-alert`);
}

/**
 * "Cât de des verifică platforma" (§334), from the costs panel beside the Neon plan: the minimum
 * minutes between two real runs of each scheduled job. The same gate and the same shape as the
 * Neon plan — Administrator at the door, the service asserting the role again, writing the audit
 * row and forgetting every cached schedule — and a refusal handed back as the form's state (§315).
 *
 * No `revalidatePath` here, unlike its neighbours, on purpose: the service's tag invalidation
 * already refreshes the page this action answers, and a path revalidation would make every
 * schedule the page reads from the cache look missing on it until the next real run.
 */
export async function updateJobCadenceAction(_previous: FormOutcome | null, form: FormData): Promise<FormOutcome | null> {
  const locale = localeOf(form);
  const path = getPathname({ locale, href: "/admin/tasks" });

  try {
    const actor = await requireStaffRole("ADMIN");
    await updateJobCadence(getDb(), actor, { minutes: form.get("minutes") }, new Date());
  } catch (error) {
    return refused(error, form);
  }
  await flashOutcome({ saved: "jobCadence" });
  redirect(`${path}?panel=costs&saved=jobCadence#admin-alert`);
}

/**
 * The database's brakes (§335), from the card beside the Neon plan: the compute's size ceiling
 * and the period's CU-hour limit, written to Neon itself. Administrator at the door, the service
 * asserting the role again, reading Neon fresh, checking the rules against that reading, writing,
 * reading back and auditing what Neon then says.
 *
 * A refusal keeps the chosen values in their boxes (§315) and names the reason — the rule the
 * form broke, or what Neon answered (a key that may read and not write, a project busy with
 * another change). The ticked confirmation is the one box that comes back empty: on production it
 * is the guard, and a guard that refills itself is none (`NEVER_KEPT`'s reasoning). The page is
 * revalidated on a refusal too, because a write refused halfway has still changed something, and
 * the readout above the form must say what Neon holds now.
 */
export async function updateNeonLimitsAction(_previous: FormOutcome | null, form: FormData): Promise<FormOutcome | null> {
  const locale = localeOf(form);
  const path = getPathname({ locale, href: "/admin/tasks" });

  let changed: boolean;
  try {
    const actor = await requireStaffRole("ADMIN");
    const outcome = await updateNeonLimits(
      getDb(),
      actor,
      {
        maxCu: typeof form.get("maxCu") === "string" ? form.get("maxCu") : "",
        quotaMode: form.get("quotaMode") === "limit" ? "limit" : "none",
        quotaCuHours: typeof form.get("quotaCuHours") === "string" ? form.get("quotaCuHours") : null,
        confirmSuspension: form.get("confirmSuspension") === "on",
      },
      { env, now: new Date() },
    );
    changed = outcome.changed;
  } catch (error) {
    const failure = refused(error, form, { never: ["confirmSuspension"] });
    revalidatePath(path);
    return error instanceof NeonLimitsRefusal ? { ...failure, error: error.reason } : failure;
  }
  revalidatePath(path);
  await flashOutcome({ saved: changed ? "neonLimits" : "neonLimitsSame" });
  redirect(`${path}?panel=costs&saved=${changed ? "neonLimits" : "neonLimitsSame"}#admin-alert`);
}

// -------------------------------------------------------------------------------------------------
// «De făcut» — the club's own checklist (§NNN)
// -------------------------------------------------------------------------------------------------

function field(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}

/**
 * Back to «De făcut», keeping the reader's owner filter (`for`) so a tick on Dani's list lands on
 * Dani's list. A success says so in a toast (§384) and the URL carries `saved=` like every other
 * panel's; a refusal of a one-button form (tick, move) comes back as `error=` for the panel's
 * banner, because those forms have no boxes to keep.
 */
async function backToClubTodo(form: FormData, outcome: { saved?: string; error?: string }): Promise<never> {
  const locale = localeOf(form);
  const owner = field(form, "for").trim();
  if (outcome.saved) await flashOutcome({ saved: outcome.saved });
  const path = getPathname({
    locale,
    href: {
      pathname: "/admin/tasks",
      query: {
        panel: "todo",
        ...(owner ? { for: owner } : {}),
        ...(outcome.saved ? { saved: outcome.saved } : {}),
        ...(outcome.error ? { error: outcome.error } : {}),
      },
    },
  });
  revalidatePath(getPathname({ locale, href: "/admin/tasks" }));
  redirect(`${path}#club-todo`);
}

/**
 * Every change goes through `changeClubTodo`, which asserts the role again (the Organizer, the
 * Administrator, the Superadministrator — BR-REQ-060-01), writes under the row lock and records
 * the audit row. The session is only the door.
 */
async function runClubTodo(request: ClubTodoRequest) {
  const actor = await requireStaff();
  return changeClubTodo(getDb(), actor, request, new Date());
}

/** «Adaugă»: a new line at the end of the list. A refusal keeps what was typed (§315). */
export async function addClubTodoAction(_previous: FormOutcome | null, form: FormData): Promise<FormOutcome | null> {
  try {
    await runClubTodo({ kind: "add", text: field(form, "text"), owner: field(form, "owner"), due: field(form, "due") });
  } catch (error) {
    return refused(error, form);
  }
  return backToClubTodo(form, { saved: "clubTodoAdded" });
}

/**
 * «Salvează» under «Modifică»: the line's words, its owner and its day. A refusal lands on the
 * panel's banner (`error=`) rather than as a kept form: the line's own words are still in its
 * box after the reload, the browser has already refused an empty one (`required`), and a refusal
 * catalogue shipped with every line of the list would weigh more than the list itself.
 */
export async function editClubTodoAction(_previous: FormOutcome | null, form: FormData): Promise<FormOutcome | null> {
  let changed: boolean;
  try {
    const result = await runClubTodo({
      kind: "edit",
      id: field(form, "itemId"),
      text: field(form, "text"),
      owner: field(form, "owner"),
      due: field(form, "due"),
    });
    changed = result.changed;
  } catch (error) {
    if (!isDomainError(error)) throw error;
    return backToClubTodo(form, { error: error.code });
  }
  return backToClubTodo(form, { saved: changed ? "clubTodoSaved" : "clubTodoUnchanged" });
}

/**
 * The tick. The form posts the state it wants (`done=1` or `done=0`), never a toggle — two people
 * pressing at once end up where the second one aimed (the anti-bot switch's reasoning, §254).
 */
export async function setClubTodoDoneAction(form: FormData): Promise<void> {
  const done = field(form, "done") === "1";
  let changed: boolean;
  try {
    const result = await runClubTodo({ kind: "setDone", id: field(form, "itemId"), done });
    changed = result.changed;
  } catch (error) {
    if (!isDomainError(error)) throw error;
    return backToClubTodo(form, { error: error.code });
  }
  if (!changed) return backToClubTodo(form, { saved: "clubTodoUnchanged" });
  return backToClubTodo(form, done ? { saved: "clubTodoDone" } : { saved: "clubTodoReopened" });
}

/** ↑ / ↓: among the open lines the reader sees — the owner filter's, when one is on. */
export async function moveClubTodoAction(form: FormData): Promise<void> {
  const owner = field(form, "for").trim();
  let changed: boolean;
  try {
    const result = await runClubTodo({
      kind: "move",
      id: field(form, "itemId"),
      direction: field(form, "direction") === "up" ? "up" : "down",
      ...(owner ? { owner } : {}),
    });
    changed = result.changed;
  } catch (error) {
    if (!isDomainError(error)) throw error;
    return backToClubTodo(form, { error: error.code });
  }
  return backToClubTodo(form, { saved: changed ? "clubTodoMoved" : "clubTodoUnchanged" });
}

/** «Șterge»: asks first (§384) — a deleted line is gone, and the audit row keeps its words. */
export async function deleteClubTodoAction(_previous: FormOutcome | null, form: FormData): Promise<FormOutcome | null> {
  try {
    await runClubTodo({ kind: "delete", id: field(form, "itemId") });
  } catch (error) {
    if (!isDomainError(error)) throw error;
    return backToClubTodo(form, { error: error.code });
  }
  return backToClubTodo(form, { saved: "clubTodoDeleted" });
}
