import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { canOpenSettings } from "@/modules/staff-identity/domain/roles";
import { requireStaff } from "@/modules/staff-identity/session";

export const dynamic = "force-dynamic";

/**
 * «Setări» (§NNN): the gate for the whole section, a real 404 for a role with no tab here (the
 * volunteer, whose backoffice is the desk and the guide — §103). Each tab's page asserts its own
 * gate again (`canOpenSettingsTab`), and every form on it its own predicate at the action and the
 * service (BR-REQ-060-01): this is the door, never the permission.
 *
 * No `loading.tsx` in this section, on purpose: a Suspense boundary would flush a 200 before a
 * tab could refuse a role (the reason `/admin/tasks` needed its gate above one).
 */
export default async function SettingsLayout({ children }: { children: ReactNode }) {
  const actor = await requireStaff();
  if (!canOpenSettings(actor.role)) notFound();

  return <>{children}</>;
}
