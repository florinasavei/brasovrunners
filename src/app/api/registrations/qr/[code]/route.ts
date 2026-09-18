import { eq } from "drizzle-orm";
import QRCode from "qrcode";
import { getDb } from "@/db/client";
import { registrations } from "@/db/schema/registrations";
import { getPathname } from "@/i18n/navigation";
import { isCheckinCode } from "@/modules/registrations/checkin-code";
import { env } from "@/shared/config/env";

/**
 * The QR a participant shows at the desk (BR-REQ-037-08), as a PNG the confirmation email
 * links to — hosted, because a data URI is stripped by enough mail clients that a runner would
 * arrive with a blank square. It encodes the desk page's address for this code, so a phone's
 * camera app opens the check-in page directly; a volunteer signed in there sees the runner.
 *
 * Public and unauthenticated by design: the code is a 50-bit identifier that confers nothing
 * (`registrations.checkin_code`), the image carries only that code, and the page it points at
 * is behind staff sign-in. An unknown code is a 404, so the route cannot be used to mint QR
 * images for arbitrary text.
 */
export async function GET(_request: Request, context: { params: Promise<{ code: string }> }): Promise<Response> {
  const { code: raw } = await context.params;
  const code = raw.replace(/\.png$/i, "");
  if (!isCheckinCode(code)) return new Response(null, { status: 404 });

  const [row] = await getDb()
    .select({ id: registrations.id })
    .from(registrations)
    .where(eq(registrations.checkinCode, code))
    .limit(1);
  if (!row) return new Response(null, { status: 404 });

  const target = `${env.APP_BASE_URL}${getPathname({ locale: "ro", href: { pathname: "/admin/checkin/[code]", params: { code } } })}`;
  const png = await QRCode.toBuffer(target, { type: "png", width: 480, margin: 2, errorCorrectionLevel: "M" });

  return new Response(new Uint8Array(png), {
    status: 200,
    headers: {
      "Content-Type": "image/png",
      "Content-Length": String(png.byteLength),
      // The code never changes, so the image never does; a day keeps mail clients from
      // re-fetching on every open without making a revoked code linger for long.
      "Cache-Control": "public, max-age=86400",
    },
  });
}
