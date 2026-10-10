import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { canReadShop } from "@/modules/staff-identity/domain/roles";
import { requireStaff } from "@/modules/staff-identity/session";

export const dynamic = "force-dynamic";

/**
 * «Magazin»'s gate (§687), above the `loading.tsx` boundary rather than inside it — the shape of
 * «Echipa»'s (`admin/staff/layout.tsx`), for the same reason: a `notFound()` raised after the
 * loading shell has flushed is a 200 with the not-found page in its body, and BR-REQ-060-01 asks
 * for a refusal. The page asserts the same predicate again, and every verb's action and service
 * assert `canManageShop`.
 *
 * Asked of the actor, not the role: a volunteer holding «Gestionează magazinul» opens the section;
 * the same volunteer without it gets the 404 any typed address gets.
 */
export default async function ShopSectionLayout({ children }: { children: ReactNode }) {
  const actor = await requireStaff();
  if (!canReadShop(actor)) notFound();

  return <>{children}</>;
}
