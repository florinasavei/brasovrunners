"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { getPathname } from "@/i18n/navigation";
import { type Locale, routing } from "@/i18n/routing";
import { changeEventTodo, type EventTodoRequest } from "@/modules/event-todos/event-todos";
import { requireStaff } from "@/modules/staff-identity/session";
import { isDomainError } from "@/shared/errors/domain-error";
import { noticeOf } from "@/shared/feedback/notice";
import { type FormOutcome, refused, succeeded } from "@/shared/forms/outcome";
import { isUuid } from "@/shared/ids";

/*
  An event's own to-dos (§749, amended by §NNN): the Server Actions behind the editor's «De făcut
  pentru pagina evenimentului» card. Each is a plain form that works with scripts off; every one
  asks `changeEventTodo`, which asserts the role again (the Organizer and the Administrators
  write, the Tehnic and the Redactor read — BR-REQ-060-01), so the buttons the card draws are a
  courtesy.

  **No redirect on success (§NNN).** A press that worked answers with the toast's notice and
  re-reads the page in place (`stayOnCard`). It used to redirect to the editor's own address, and
  the navigation's second render replaced the whole editor a moment after the first: a «Modifică»
  the reader had just opened closed under their thumb, and the words typed in it were gone.
*/

function localeOf(form: FormData): Locale {
  const raw = form.get("uiLocale");
  return typeof raw === "string" && (routing.locales as readonly string[]).includes(raw) ? (raw as Locale) : routing.defaultLocale;
}

function field(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}

/** The event the form is about — a malformed id is passed on and `changeEventTodo` refuses it (NOT_FOUND). */
function eventIdOf(form: FormData): string {
  const id = field(form, "eventId");
  return isUuid(id) ? id : "";
}

/**
 * A refusal that is not a box's — a role that may not write, a line that is gone — back to the
 * card with the refusal's code in the address for the card's banner (`?todoError=`). The one
 * case that still navigates: it is rare, and the banner is the card's, not a row's.
 */
function backToCardWithError(form: FormData, code: string): never {
  const locale = localeOf(form);
  const id = eventIdOf(form);
  const path = getPathname({ locale, href: { pathname: "/admin/events/[id]", params: { id } } });
  // «Ale mele» stays on across the press.
  const params = new URLSearchParams();
  if (field(form, "mine") === "1") params.set("mine", "1");
  params.set("todoError", code);
  redirect(`${path}?${params}#box-todos`);
}

/**
 * «It worked», without leaving the page (§384): the page is read again in place and the answer
 * carries the toast's notice, which `ActionForm` hands to the provider. No navigation, no second
 * render — the folds the reader opened and the boxes they typed in stay as they are, and
 * «Ale mele» stays on because the address never changed.
 */
function stayOnCard(form: FormData, saved: string): FormOutcome {
  const path = getPathname({ locale: localeOf(form), href: { pathname: "/admin/events/[id]", params: { id: eventIdOf(form) } } });
  revalidatePath(path);
  return succeeded(noticeOf({ saved }) ?? { kind: "success", key: saved });
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
  return stayOnCard(form, "eventTodoAdded");
}

/** «Salvează» under ✎: the words, the priority, who takes it and the day. */
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
    if (isDomainError(error) && error.code === "VALIDATION_ERROR") return refused(error, form);
    if (!isDomainError(error)) throw error;
    return backToCardWithError(form, error.code);
  }
  return stayOnCard(form, changed ? "eventTodoSaved" : "eventTodoUnchanged");
}

/** The tick: the form posts the state it wants (`done=1` / `done=0`), never a toggle, so two presses end where the second aimed. */
export async function setEventTodoDoneAction(_previous: FormOutcome | null, form: FormData): Promise<FormOutcome | null> {
  const done = field(form, "done") === "1";
  let changed: boolean;
  try {
    const result = await run({ kind: "setDone", eventId: eventIdOf(form), id: field(form, "itemId"), done });
    changed = result.changed;
  } catch (error) {
    if (!isDomainError(error)) throw error;
    return backToCardWithError(form, error.code);
  }
  if (!changed) return stayOnCard(form, "eventTodoUnchanged");
  return stayOnCard(form, done ? "eventTodoDone" : "eventTodoReopened");
}

/** «Șterge»: asks first (§384) — a deleted line is gone, and the audit row keeps its words. */
export async function deleteEventTodoAction(_previous: FormOutcome | null, form: FormData): Promise<FormOutcome | null> {
  try {
    await run({ kind: "delete", eventId: eventIdOf(form), id: field(form, "itemId") });
  } catch (error) {
    if (!isDomainError(error)) throw error;
    return backToCardWithError(form, error.code);
  }
  return stayOnCard(form, "eventTodoDeleted");
}
