import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { canReadContent } from "@/modules/staff-identity/domain/roles";
import { requireStaff } from "@/modules/staff-identity/session";

export const dynamic = "force-dynamic";

/**
 * The gate of «Sistemul de design» (§692), above the `loading.tsx` boundary for the reason the
 * staff section's layout gives: a `notFound()` raised after the shell has flushed cannot change the
 * status any more, and BR-REQ-060-01 asks for a refusal, not a 200 with a not-found body. Whoever
 * reads the club's content — the Redactor and up (`canReadContent`) — reads the look; a volunteer
 * gets a 404. The page asserts the same thing again, because a page is a request of its own.
 */
export default async function DesignSectionLayout({ children }: { children: ReactNode }) {
  const actor = await requireStaff();
  if (!canReadContent(actor.role)) notFound();

  return <>{children}</>;
}
