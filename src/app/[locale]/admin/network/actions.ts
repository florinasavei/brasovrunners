"use server";

import { requireStaff } from "@/modules/staff-identity/session";

/**
 * The network check's "Saves" probe (§436): a Server Action that does nothing but answer, called
 * from `/admin/network` exactly the way every backoffice save is called — a POST to the page with
 * the `Next-Action` header, answered as `text/x-component`. A network that blocks saves blocks
 * this, and the row turns red; nothing is read or written. Staff only, like every action behind
 * `/admin` (BR-REQ-060-01).
 */
export async function probeSaveAction(): Promise<"ok"> {
  await requireStaff();
  return "ok";
}
