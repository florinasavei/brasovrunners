import { NETWORK_PROBE_MARKER } from "@/modules/diagnostics/network-check";
import { getCurrentStaffUser } from "@/modules/staff-identity/session";

/**
 * The network check's plain-form probe (§436): `/admin/network` posts a small
 * `multipart/form-data` form here into a hidden frame — the same kind of request the fallback of a
 * blocked save sends — and reads the marker below out of the frame. A proxy that refuses the post,
 * or answers it with its own page, leaves no marker, and the row turns red.
 *
 * It changes nothing and reads nothing of the form; it answers only a signed-in member of staff
 * (BR-REQ-060-01), and a 404 to anybody else, like every other backoffice address.
 */
export const dynamic = "force-dynamic";

export async function POST(): Promise<Response> {
  if (!(await getCurrentStaffUser())) return new Response("Not found", { status: 404 });
  return new Response(`<!doctype html><title>ok</title><p id="${NETWORK_PROBE_MARKER}">ok</p>`, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "x-robots-tag": "noindex",
    },
  });
}
