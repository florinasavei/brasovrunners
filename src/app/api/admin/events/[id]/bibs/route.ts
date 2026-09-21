import { hasLocale } from "next-intl";
import { getFormatter, getTranslations } from "next-intl/server";
import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { routing } from "@/i18n/routing";
import { renderBibSheet } from "@/modules/registrations/bibs-pdf";
import { findEventForBibs, listBibs } from "@/modules/registrations/bibs";
import { canManageRegistrations } from "@/modules/staff-identity/domain/roles";
import { requireStaff } from "@/modules/staff-identity/session";
import { bibPictureUrl } from "@/modules/registrations/bib-design";
import { env } from "@/shared/config/env";

/** A club's header or sponsors' strip: one of this site's own WebP variants, so both are small. */
const PICTURE_MAX_BYTES = 4 * 1024 * 1024;
const PICTURE_TIMEOUT_MS = 5_000;
import { isDomainError } from "@/shared/errors/domain-error";

/**
 * The race numbers of one event as a printable sheet (BR-REQ-038-01).
 *
 * `GET /api/admin/events/<id>/bibs?locale=ro&from=1&to=50`. Administrator only — a bib carries
 * a participant's name, which is personal data the club holds for the event and nothing else
 * (`AGENTS.md` §19.2). `from` and `to` bound the numbers printed, for a reprint or for the batch
 * confirmed after the first sheet; omitted, every assigned number. A GET that mutates nothing:
 * assigning numbers is the action on the event's page, and this only reads what it assigned.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  let actor;
  try {
    actor = await requireStaff();
  } catch (error) {
    if (isDomainError(error)) return NextResponse.json({ error: error.code }, { status: 401 });
    throw error;
  }
  if (!canManageRegistrations(actor.role)) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  const { id } = await context.params;
  const url = new URL(request.url);
  const locale = url.searchParams.get("locale") ?? routing.defaultLocale;
  if (!hasLocale(routing.locales, locale)) {
    return NextResponse.json({ error: "VALIDATION_ERROR" }, { status: 400 });
  }
  const bound = (name: string) => {
    const raw = url.searchParams.get(name);
    if (raw === null || raw === "") return undefined;
    const value = Number(raw);
    return Number.isInteger(value) && value > 0 ? value : Number.NaN;
  };
  const from = bound("from");
  const to = bound("to");
  if (Number.isNaN(from) || Number.isNaN(to)) {
    return NextResponse.json({ error: "VALIDATION_ERROR" }, { status: 400 });
  }
  // Two per page unless "one" is asked for; anything else is the default, not an error.
  const layout = url.searchParams.get("layout") === "one" ? ("one" as const) : ("two" as const);

  const db = getDb();
  const event = await findEventForBibs(db, id, locale);
  if (!event) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  const t = await getTranslations({ locale, namespace: "Admin" });
  const format = await getFormatter({ locale });
  const now = new Date();
  const rows = await listBibs(db, id, { from, to });

  /*
    The club's own pictures, fetched here rather than inside the renderer (§249).

    pdfkit takes bytes, and the sheet must print whatever happens: a store that is slow, a
    picture that was deleted, a variant that is not an image any more. So each is fetched with
    a deadline and a ceiling, and anything that fails is `null` — which prints the coloured
    band and no sponsors' strip, exactly as every sheet printed before this existed.
  */
  const picture = async (src: string | null): Promise<Buffer | null> => {
    const address = bibPictureUrl(src, env.APP_BASE_URL);
    if (!address) return null;
    try {
      const response = await fetch(address, { signal: AbortSignal.timeout(PICTURE_TIMEOUT_MS) });
      if (!response.ok) return null;
      const bytes = await response.arrayBuffer();
      return bytes.byteLength > PICTURE_MAX_BYTES ? null : Buffer.from(bytes);
    } catch {
      return null;
    }
  };
  const [header, sponsors] = await Promise.all([
    picture(event.design.headerImageSrc),
    picture(event.design.sponsorImageSrc),
  ]);

  const pdf = await renderBibSheet({
    rows,
    eventTitle: event.title,
    eventDate: format.dateTime(event.startsAt, { timeZone: event.timezone, dateStyle: "long" }),
    // The band in the event's own colour, and the foot naming its partners and the club's
    // mailbox (§180) — the same three the preview picture draws from.
    bandColour: event.bibColour,
    partners: event.coHosts.map((host) => host.name),
    replyTo: env.EMAIL_REPLY_TO,
    pageLabel: (n, total) => t("bibs.page", { n, total }),
    generatedAt: now,
    layout,
    design: event.design,
    pictures: { header, sponsors },
  });

  const suffix = `${from !== undefined || to !== undefined ? `-${from ?? 1}-${to ?? "end"}` : ""}${layout === "one" ? "-one-per-page" : ""}`;
  return new Response(new Uint8Array(pdf), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="bibs-${id.slice(0, 8)}${suffix}.pdf"`,
      "Content-Length": String(pdf.byteLength),
      "Cache-Control": "private, no-store",
    },
  });
}
