import { NextResponse } from "next/server";
import { volunteersScreenPathOf } from "@/app/[locale]/admin/events/[id]/volunteer-return";
import { getDb } from "@/db/client";
import { getPathname } from "@/i18n/navigation";
import { type Locale, routing } from "@/i18n/routing";
import { canManageVolunteers } from "@/modules/staff-identity/domain/roles";
import { requireStaff } from "@/modules/staff-identity/session";
import { attachSignedContractsByName, matchSignedContractFiles } from "@/modules/volunteers/signed-contract";
import { isDomainError } from "@/shared/errors/domain-error";
import { flashOutcome } from "@/shared/feedback/flash";
import { isUuid } from "@/shared/ids";

/**
 * «Încarcă contractele semnate» on the «Voluntari» list of one event (§NNN): many files, each attached to the one volunteer **of
 * this event** whose name it carries (`domain/signed-contract.ts#matchContractFiles`), the rest named with the reason.
 *
 * - **With scripts** the list's island posts `answer=json` and the files' **names** alone (`names`): the answer is each one's match
 *   or refusal, and the island then sends every matched file to its volunteer's own route, one request a file (pieces for a large
 *   one), and lists the files left with their reasons — the names stay in the page, never in an address.
 * - **With scripts off** the form posts every file (`files`): each matched one is attached in a transaction of its own, so one bad
 *   file never stops the others, and the page comes back (303) to the list it came from, the toast saying how many were attached
 *   and how many were not — counts only: a file's name carries a person's, and goes in neither a cookie nor an address. Pressed
 *   with no file chosen, it comes back with `VOLUNTEER_CONTRACTS_NONE_CHOSEN` in the address, never «0 attached».
 *
 * Whoever works the volunteers (`canManageVolunteers`), asserted here and again by the service (BR-REQ-060-01): no session is 401,
 * any other role 403, an event nobody has or a malformed id 404. A refusal writes nothing.
 */

type Context = { params: Promise<{ id: string }> };

const NO_STORE = { "Cache-Control": "private, no-store" } as const;

/** The most a request here may carry: a few dozen Word files at once with scripts off; the host's own limit is lower still. */
const REQUEST_MAX_BYTES = 64 * 1024 * 1024;

function localeOf(form: FormData | null): Locale {
  const raw = form?.get("locale");
  return typeof raw === "string" && (routing.locales as readonly string[]).includes(raw) ? (raw as Locale) : routing.defaultLocale;
}

export async function POST(request: Request, context: Context): Promise<Response> {
  let actor;
  try {
    actor = await requireStaff();
  } catch (error) {
    if (isDomainError(error)) return NextResponse.json({ error: error.code }, { status: 401, headers: NO_STORE });
    throw error;
  }
  if (!canManageVolunteers(actor.role)) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403, headers: NO_STORE });
  const { id } = await context.params;
  if (!isUuid(id)) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404, headers: NO_STORE });
  if (Number(request.headers.get("content-length") ?? 0) > REQUEST_MAX_BYTES) return NextResponse.json({ error: "VOLUNTEER_CONTRACT_TOO_LARGE" }, { status: 413, headers: NO_STORE });
  const form = await request.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "VALIDATION_ERROR" }, { status: 400, headers: NO_STORE });
  const db = getDb();

  if (form.get("answer") === "json") {
    const names = form.getAll("names").filter((name): name is string => typeof name === "string");
    try {
      return NextResponse.json({ matches: await matchSignedContractFiles(db, actor, id, names) }, { headers: NO_STORE });
    } catch (error) {
      if (!isDomainError(error)) throw error;
      return NextResponse.json({ error: error.code }, { status: error.code === "NOT_FOUND" ? 404 : error.code === "FORBIDDEN" ? 403 : 400, headers: NO_STORE });
    }
  }

  // With scripts off: every file the form carries — a box left empty posts one nameless, empty file, which is no file, and none at
  // all is the service's `VOLUNTEER_CONTRACTS_NONE_CHOSEN`, back in the address like every refusal.
  const posted = form.getAll("files").filter((file): file is File => file instanceof File && (file.size > 0 || file.name !== ""));
  const locale = localeOf(form);
  const back = volunteersScreenPathOf(String(form.get("returnTo") ?? "")) ?? `${getPathname({ locale, href: "/admin/volunteers" })}?eventId=${id}`;
  const [pathOnly, search = ""] = back.split("?");
  const params = new URLSearchParams(search);
  params.delete("volunteerError");
  try {
    const files = await Promise.all(posted.map(async (file) => ({ fileName: file.name, bytes: new Uint8Array(await file.arrayBuffer()) })));
    const outcomes = await attachSignedContractsByName(db, actor, id, files, new Date());
    const attached = outcomes.filter((outcome) => outcome.outcome === "attached").length;
    const left = outcomes.length - attached;
    await flashOutcome(left > 0 ? { saved: "volunteerContractsAttachedSome", count: attached, left } : { saved: "volunteerContractsAttached", count: attached });
  } catch (error) {
    if (!isDomainError(error)) throw error;
    params.set("volunteerError", error.code);
  }
  const query = params.toString();
  // A path alone, no host: the browser resolves it against the address it asked.
  return new Response(null, { status: 303, headers: { Location: `${pathOnly}${query ? `?${query}` : ""}`, ...NO_STORE } });
}
