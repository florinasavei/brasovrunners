"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { getPathname } from "@/i18n/navigation";
import { routing, type Locale } from "@/i18n/routing";
import { changeClubTodo, type ClubTodoRequest } from "@/modules/club-todo/club-todo";
import { giveOlderPicturesTheirLadder } from "@/modules/media/older-pictures";
import { requireStaff, requireStaffCapability } from "@/modules/staff-identity/session";
import { canManageClubSettings } from "@/modules/staff-identity/domain/roles";
import { isDomainError } from "@/shared/errors/domain-error";
import { flashOutcome } from "@/shared/feedback/flash";
import { type FormOutcome, refused } from "@/shared/forms/outcome";

/** Which language to land back in: the form carries it, because an action has no request locale. */
function localeOf(form: FormData): Locale {
  const raw = form.get("uiLocale");
  return typeof raw === "string" && (routing.locales as readonly string[]).includes(raw) ? (raw as Locale) : routing.defaultLocale;
}

/**
 * One press of "Fă mărimile" (§430): the next batch of the pictures stored before §414 gets its
 * ladder. Administrator at the door, the service asserting the role again and writing the audit
 * row; lands back on the card, which says how many are left and goes once none are. The toast
 * carries the numbers only — how many converted, failed and left (§384).
 */
export async function giveOlderPicturesLadderAction(_previous: FormOutcome | null, form: FormData): Promise<FormOutcome | null> {
  const locale = localeOf(form);
  const path = getPathname({ locale, href: "/admin/tasks" });

  let result: { converted: number; failed: number; left: number };
  try {
    const actor = await requireStaffCapability(canManageClubSettings);
    result = await giveOlderPicturesTheirLadder(getDb(), actor, { now: new Date() });
  } catch (error) {
    return refused(error, form);
  }
  revalidatePath(path);
  const numbers = `count=${result.converted}&left=${result.left}&failed=${result.failed}`;
  await flashOutcome({
    saved: result.failed > 0 ? "picturesLadderedFailed" : "picturesLaddered",
    count: result.converted,
    left: result.left,
    failed: result.failed,
  });
  redirect(`${path}?saved=${result.failed > 0 ? "picturesLadderedFailed" : "picturesLaddered"}&${numbers}#admin-alert`);
}

// -------------------------------------------------------------------------------------------------
// «De făcut» — the club's own checklist (§438)
// -------------------------------------------------------------------------------------------------

function field(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}

/**
 * Back to «De făcut», keeping the reader's owner filter (`for`) so a tick on the Organizer's list lands
 * on the Organizer's list. A success says so in a toast (§384) and the URL carries `saved=` like every other
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
