"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { getPathname } from "@/i18n/navigation";
import { type Locale, routing } from "@/i18n/routing";
import { changeEventTodo, type EventTodoRequest } from "@/modules/event-todos/event-todos";
import { requireStaff } from "@/modules/staff-identity/session";
import { isDomainError } from "@/shared/errors/domain-error";
import { flashOutcome } from "@/shared/feedback/flash";
import { type FormOutcome, refused } from "@/shared/forms/outcome";
import { isUuid } from "@/shared/ids";

/*
  An event's own to-dos (§NNN): the Server Actions behind the editor's «De făcut pentru pagina
  evenimentului» card. Each is a plain form that works with scripts off; every one asks
  `changeEventTodo`, which asserts the role again (the Organizer and the Administrators write, the
  Tehnic and the Redactor read — BR-REQ-060-01), so the buttons the card draws are a courtesy.
*/

function localeOf(form: FormData): Locale {
  const raw = form.get("uiLocale");
  return typeof raw === "string" && (routing.locales as readonly string[]).includes(raw) ? (raw as Locale) : routing.defaultLocale;
}

function field(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}

/** The event the form is about — a malformed id is the same refusal an unknown one gets. */
function eventIdOf(form: FormData): string {
  const id = field(form, "eventId");
  return isUuid(id) ? id : "";
}

/**
 * Back to the card, with the toast's word in the flash cookie (§384) or, for a one-button form
 * that has no boxes to keep, the refusal's code in the address for the card's banner.
 */
async function backToCard(form: FormData, outcome: { saved?: string; error?: string }): Promise<never> {
  const locale = localeOf(form);
  const id = eventIdOf(form);
  if (outcome.saved) await flashOutcome({ saved: outcome.saved });
  const path = getPathname({ locale, href: { pathname: "/admin/events/[id]", params: { id } } });
  revalidatePath(path);
  // «Ale mele» stays on across the press: a tick on the reader's own list lands on the reader's own list.
  const params = new URLSearchParams();
  if (field(form, "mine") === "1") params.set("mine", "1");
  if (outcome.error) params.set("todoError", outcome.error);
  const query = params.size > 0 ? `?${params}` : "";
  redirect(`${path}${query}#box-todos`);
}

async function run(request: EventTodoRequest) {
  const actor = await requireStaff();
  return changeEventTodo(getDb(), actor, request, new Date());
}

/** «Adaugă»: a new line, with its priority, who takes it and the day. A refusal keeps what was typed (§315). */
export async function addEventTodoAction(_previous: FormOutcome | null, form: FormData): Promise<FormOutcome | null> {
  try {
    await run({
      kind: "add",
      eventId: eventIdOf(form),
      text: field(form, "text"),
      priority: field(form, "priority"),
      assignee: field(form, "assignee"),
      due: field(form, "due"),
    });
  } catch (error) {
    return refused(error, form);
  }
  return backToCard(form, { saved: "eventTodoAdded" });
}

/** «Salvează» under «Modifică»: the words, the priority, who takes it and the day. */
export async function editEventTodoAction(_previous: FormOutcome | null, form: FormData): Promise<FormOutcome | null> {
  let changed: boolean;
  try {
    const result = await run({
      kind: "edit",
      eventId: eventIdOf(form),
      id: field(form, "itemId"),
      text: field(form, "text"),
      priority: field(form, "priority"),
      assignee: field(form, "assignee"),
      due: field(form, "due"),
    });
    changed = result.changed;
  } catch (error) {
    if (!isDomainError(error)) throw error;
    return backToCard(form, { error: error.code });
  }
  return backToCard(form, { saved: changed ? "eventTodoSaved" : "eventTodoUnchanged" });
}

/** The tick: the form posts the state it wants (`done=1` / `done=0`), never a toggle, so two presses end where the second aimed. */
export async function setEventTodoDoneAction(form: FormData): Promise<void> {
  const done = field(form, "done") === "1";
  let changed: boolean;
  try {
    const result = await run({ kind: "setDone", eventId: eventIdOf(form), id: field(form, "itemId"), done });
    changed = result.changed;
  } catch (error) {
    if (!isDomainError(error)) throw error;
    return backToCard(form, { error: error.code });
  }
  if (!changed) return backToCard(form, { saved: "eventTodoUnchanged" });
  return backToCard(form, { saved: done ? "eventTodoDone" : "eventTodoReopened" });
}

/** «Șterge»: asks first (§384) — a deleted line is gone, and the audit row keeps its words. */
export async function deleteEventTodoAction(_previous: FormOutcome | null, form: FormData): Promise<FormOutcome | null> {
  try {
    await run({ kind: "delete", eventId: eventIdOf(form), id: field(form, "itemId") });
  } catch (error) {
    if (!isDomainError(error)) throw error;
    return backToCard(form, { error: error.code });
  }
  return backToCard(form, { saved: "eventTodoDeleted" });
}
