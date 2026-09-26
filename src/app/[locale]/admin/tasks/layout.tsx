import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { canOpenTasks } from "@/modules/diagnostics/domain/task-panels";
import { requireStaff } from "@/modules/staff-identity/session";

export const dynamic = "force-dynamic";

/**
 * The role gate for this section, deliberately **above** the `loading.tsx` boundary beside it.
 *
 * The page asserts the same thing and keeps asserting it — a page is a request of its own, and a
 * guard that depends on a parent having run is a guard that disappears the first time the page is
 * rendered from somewhere else. This exists for the **status code**.
 *
 * `loading.tsx` wraps what is below it in Suspense, and Next flushes the shell as soon as it has
 * one. A `notFound()` raised after that flush cannot change the status any more, so the response
 * became **200 with the not-found page in the body** — which is not a refusal to a crawler, a
 * monitor or a script, and BR-REQ-060-01 asks for a refusal. Deciding it here happens before
 * there is anything to flush, so the answer is a real 404 again.
 *
 * This section has no child routes, so its `loading.tsx` covers only its own page and no route
 * group is needed to scope it.
 *
 * `canOpenTasks` (`modules/diagnostics/domain/task-panels.ts`, `DECISIONS.md` §397) is wider
 * than the old `canManageRegistrations` alone, since 2026-09-25: Tehnic may open this page too,
 * for the "Aplicația" panel, and since §438 every role from the Redactor up, for the club's
 * checklist «De făcut» — the page itself asserts which panel each role may reach. The volunteer
 * still meets a real 404 here.
 */
export default async function TasksLayout({ children }: { children: ReactNode }) {
  const actor = await requireStaff();
  if (!canOpenTasks(actor.role)) notFound();

  return <>{children}</>;
}
