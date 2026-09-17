import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { isEditorial } from "@/modules/staff-identity/domain/roles";
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
 * That is also why the list lives in a `(list)` route group: a `loading.tsx` at the section root
 * would cover this section's `[id]` and `new` routes too, and turn *their* 404s into 200s.
 */
export default async function SectionLayout({ children }: { children: ReactNode }) {
  const actor = await requireStaff();
  if (!isEditorial(actor.role)) notFound();

  return <>{children}</>;
}
