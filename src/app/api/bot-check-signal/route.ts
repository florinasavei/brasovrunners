import { getDb } from "@/db/client";
import { isBotCheckSignal, recordBotCheckSignal } from "@/modules/registrations/bot-check-signals";

/**
 * `POST /api/bot-check-signal` — the browser says the anti-bot check let somebody down (§NNN): a
 * held press the eight-second valve sent, or a widget that failed or never loaded. The body is the
 * signal's word and nothing else; it is counted per hour for `/api/health` and forgotten a day
 * later by the retention sweep.
 *
 * Always `204`, whatever happened: the page sent it with a beacon and reads no answer, and a
 * refused or failed count must never become an error somebody sees. A body that is not one of the
 * two words, or a request another site sent (`Sec-Fetch-Site`), is not counted — a stranger can
 * inflate a figure on a health page at most from this site's own pages.
 */
export const dynamic = "force-dynamic";

const NOTHING = () => new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });

export async function POST(request: Request): Promise<Response> {
  const site = request.headers.get("sec-fetch-site");
  if (site && site !== "same-origin") return NOTHING();
  let body: string;
  try {
    body = (await request.text()).trim();
  } catch {
    return NOTHING();
  }
  if (body.length > 32 || !isBotCheckSignal(body)) return NOTHING();
  try {
    await recordBotCheckSignal(getDb(), body, new Date());
  } catch (error) {
    // Logged without the driver's message detail reaching the answer (§14.3).
    console.error("[bot-check-signal] could not count a signal", error);
  }
  return NOTHING();
}
