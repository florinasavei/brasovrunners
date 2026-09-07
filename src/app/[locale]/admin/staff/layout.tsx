import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { canManageStaff } from "@/modules/staff-identity/domain/roles";
import { requireStaff } from "@/modules/staff-identity/session";

export const dynamic = "force-dynamic";

/**
 * The role gate for this section, above the `loading.tsx` boundary rather than inside it.
 *
 * The page asserts the same thing and keeps asserting it — a page is a request of its own, and
 * a guard that depends on a parent having run is a guard that disappears the first time the
 * page is rendered from somewhere else. This exists for the *status code*.
 *
 * `loading.tsx` wraps the page in Suspense, and Next flushes the shell as soon as it has one.
 * A `notFound()` raised after that flush cannot change the status any more, so the response was
 * **200 with the not-found page in the body** — which is not a refusal to a crawler, a monitor
 * or a script, and BR-REQ-060-01 asks for a refusal. Deciding it in the layout means the
 * decision happens before there is anything to flush, and the answer is a real 404 again.
 */
export default async function StaffSectionLayout({ children }: { children: ReactNode }) {
  const actor = await requireStaff();
  if (!canManageStaff(actor.role)) notFound();

  return <>{children}</>;
}
