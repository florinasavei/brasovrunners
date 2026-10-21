import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { canManageVolunteers } from "@/modules/staff-identity/domain/roles";
import { requireStaff } from "@/modules/staff-identity/session";

export const dynamic = "force-dynamic";

/**
 * The role gate for «Voluntari» (§NNN), deliberately **above** the `loading.tsx` boundary beside it, for the same
 * reason the registrations list has one (`admin/registrations/(list)/layout.tsx`): a `notFound()` raised after
 * the Suspense shell has flushed cannot change the status any more, and BR-REQ-060-01 asks for a real 404. The
 * page asserts the same thing again — a page is a request of its own. The `(list)` route group keeps this
 * `loading.tsx` off the person's page beside it, whose own 404 must stay a 404.
 */
export default async function SectionLayout({ children }: { children: ReactNode }) {
  const actor = await requireStaff();
  if (!canManageVolunteers(actor.role)) notFound();

  return <>{children}</>;
}
