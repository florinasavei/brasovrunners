import { canManageRegistrations, canSeeDiagnostics, type StaffRole } from "@/modules/staff-identity/domain/roles";

/**
 * The panels of `/admin/tasks` (`DECISIONS.md` §265, §360) and who may open each one — pulled
 * out of the page so the gate is one pure function, tested exhaustively over every role rather
 * than read off a rendered page.
 *
 * `todo`, `botCheck` and `costs` are the club's own worklist and its money, behind
 * `canManageRegistrations` (Administrator and Superadministrator) as they always were.
 * `app` — "Aplicația" / "The app" — is `docs/QUEUE.md`, the dispatcher's own work queue
 * (`DECISIONS.md` §368, §NNN), rendered read-only. The owner, 2026-09-25: "în «De făcut» vreau
 * un tab unde să randez efectiv MD file din repo cu tasklisturi și ce mai e de făcut în
 * aplicație." It is diagnostic reading, not a club decision, so it sits behind the same
 * threshold as `/devs` — `canSeeDiagnostics`, which is Tehnic and everything above it — rather
 * than behind `canManageRegistrations`. Because `ADMIN` and `SUPERADMIN` already outrank `DEV`
 * in the one hierarchy (`roles.ts`), `canSeeDiagnostics` alone is exactly "Administrator,
 * Superadministrator and Tehnic": nobody has to be granted a second capability.
 */
export const TASK_PANELS = ["todo", "botCheck", "costs", "app"] as const;
export type TaskPanel = (typeof TASK_PANELS)[number];

function isTaskPanel(value: string | undefined): value is TaskPanel {
  return (TASK_PANELS as readonly string[]).includes(value ?? "");
}

/** Whether `role` may open `/admin/tasks` at all — the union of its ops panels and the app tab. */
export function canOpenTasks(role: StaffRole): boolean {
  return canManageRegistrations(role) || canSeeDiagnostics(role);
}

/**
 * The panel a request lands on, or `null` when the role may not see the one it asked for (the
 * caller answers a 404, the same way every other guard on this page does).
 *
 * An unrecognised query value reads as "nothing asked", exactly as the owner/kind filters do —
 * and then each role gets its own default: `todo` for the club's ops roles, `app` for a Tehnic
 * who has nothing else on this page.
 */
export function resolveTaskPanel(role: StaffRole, requested: string | undefined): TaskPanel | null {
  const isOps = canManageRegistrations(role);
  const canApp = canSeeDiagnostics(role);
  const asked = isTaskPanel(requested) ? requested : undefined;
  const panel = asked ?? (isOps ? "todo" : canApp ? "app" : null);
  if (panel === null) return null;
  if (panel === "app") return canApp ? "app" : null;
  return isOps ? panel : null;
}

/** The ops panels a role may see, in the order the sub-navigation shows them. */
export function opsTaskPanels(role: StaffRole): readonly TaskPanel[] {
  return canManageRegistrations(role) ? (["todo", "botCheck", "costs"] as const) : [];
}
