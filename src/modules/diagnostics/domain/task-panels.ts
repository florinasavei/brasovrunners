import { canReadClubTodo } from "@/modules/club-todo/domain/club-todo";
import { canManageRegistrations, canSeeDiagnostics, type StaffRole } from "@/modules/staff-identity/domain/roles";

/**
 * The panels of `/admin/tasks` (`DECISIONS.md` §265, §360) and who may open each one — pulled
 * out of the page so the gate is one pure function, tested exhaustively over every role rather
 * than read off a rendered page.
 *
 * `club`, `botCheck` and `costs` are the club's own worklist read from the system and its money,
 * behind `canManageRegistrations` (Administrator and Superadministrator) as they always were.
 * `club` — «Club» — is the list that was called «De făcut» until §438: what the platform still
 * needs before it takes real entries, read from the system, never ticked by hand. It is still
 * where a bare `/admin/tasks` lands for those two roles (the owner, 2026-09-26: "by default I
 * need to be on the «Club» tab").
 *
 * `todo` — «De făcut» / "To do" — is the club's own checklist since §438: lines people type and
 * tick (`modules/club-todo`). Every role that reads the club's content opens it
 * (`canReadClubTodo`: Redactor, Organizer, Tehnic, Administrator, Superadministrator); the
 * service decides who may write (`canEditClubTodo`). It is where the Redactor and the Organizer
 * land, since it is all this page holds for them.
 *
 * `app` — "Aplicația" / "The app" — is `docs/QUEUE.md`, the dispatcher's own work queue
 * (`DECISIONS.md` §368, §397), rendered read-only, behind `canSeeDiagnostics` (Tehnic and up);
 * a Tehnic still lands there.
 */
export const TASK_PANELS = ["club", "todo", "botCheck", "costs", "app"] as const;
export type TaskPanel = (typeof TASK_PANELS)[number];

function isTaskPanel(value: string | undefined): value is TaskPanel {
  return (TASK_PANELS as readonly string[]).includes(value ?? "");
}

/** Whether `role` may open `/admin/tasks` at all — the union of every panel's own gate. */
export function canOpenTasks(role: StaffRole): boolean {
  return canManageRegistrations(role) || canSeeDiagnostics(role) || canReadClubTodo(role);
}

/** Whether `role` may open one panel. */
export function canOpenTaskPanel(role: StaffRole, panel: TaskPanel): boolean {
  switch (panel) {
    case "todo":
      return canReadClubTodo(role);
    case "app":
      return canSeeDiagnostics(role);
    default:
      return canManageRegistrations(role);
  }
}

/**
 * Where a bare `/admin/tasks` lands: «Club» for the Administrator and the Superadministrator,
 * «Aplicația» for a Tehnic (§397, unchanged), «De făcut» for the Redactor and the Organizer;
 * `null` for a role that may open nothing here.
 */
export function defaultTaskPanel(role: StaffRole): TaskPanel | null {
  if (canManageRegistrations(role)) return "club";
  if (canSeeDiagnostics(role)) return "app";
  if (canReadClubTodo(role)) return "todo";
  return null;
}

/**
 * The panel a request lands on, or `null` when the role may not see the one it asked for. This
 * page cannot answer a real 404 for that case — it is below `loading.tsx`'s Suspense boundary,
 * which has already flushed a 200 by the time it runs — so its caller redirects to the role's
 * own default panel instead (`admin/tasks/page.tsx`'s own comment explains why).
 *
 * An unrecognised query value reads as "nothing asked", exactly as the owner/kind filters do —
 * and then each role gets its own default (`defaultTaskPanel`).
 */
export function resolveTaskPanel(role: StaffRole, requested: string | undefined): TaskPanel | null {
  if (!isTaskPanel(requested)) return defaultTaskPanel(role);
  return canOpenTaskPanel(role, requested) ? requested : null;
}

/**
 * The panels a role may see, in the order the sub-navigation shows them: «Club», «De făcut»,
 * «Anti-robot», «Costuri», then «Aplicația» (the page puts the «Sistem» link to `/devs` before
 * it, §397).
 */
export function visibleTaskPanels(role: StaffRole): TaskPanel[] {
  return TASK_PANELS.filter((panel) => canOpenTaskPanel(role, panel));
}
