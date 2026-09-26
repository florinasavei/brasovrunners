import { hasLocale } from "next-intl";
import { formatDay } from "@/i18n/dates";
import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { routing } from "@/i18n/routing";
import { shownContactAddresses } from "@/modules/contact/shown-address";
import { renderBibSheet } from "@/modules/registrations/bibs-pdf";
import { findEventForBibs, listBibs } from "@/modules/registrations/bibs";
import { canReadRegistrations } from "@/modules/staff-identity/domain/roles";
import { requireStaff } from "@/modules/staff-identity/session";
import { bibPictureUrl } from "@/modules/registrations/bib-design";
import { env } from "@/shared/config/env";
import { isUuid } from "@/shared/ids";

/** A club's header or sponsors' strip: one of this site's own WebP variants, so both are small. */
const PICTURE_MAX_BYTES = 4 * 1024 * 1024;
const PICTURE_TIMEOUT_MS = 5_000;
import { isDomainError } from "@/shared/errors/domain-error";

/**
 * The race numbers of one event as a printable sheet (BR-REQ-038-01).
 *
 * `GET /api/admin/events/<id>/bibs?locale=ro&from=1&to=50&only=unprinted`. Whoever may read the
 * registrations (§289; the owner: "organizer should also be able to see BIDs and export them") —
 * a bib carries a participant's name, which is personal data the club holds for the event and
 * nothing else (`AGENTS.md` §19.2). `from` and `to` bound the numbers printed, for a reprint;
 * `only=unprinted` is the club's weekly job — the people who registered after the last sheet
 * went to the printer (§264). Omitted, every assigned number.
 *
 * **A GET that mutates nothing**, which is why marking a batch printed is a separate press on the
 * registrations list and not something this route does: the sheet has to be openable in a tab,
 * saveable and openable again (`AGENTS.md` §12.8). Assigning numbers is the action on the event's
 * page; this only reads what that assigned.
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
  if (!canReadRegistrations(actor.role)) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  const { id } = await context.params;
  if (!isUuid(id)) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
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
  // Two A5 bibs per A4 page unless "one" is asked for — each centred alone on its own page, no
  // cut line (§79); anything else is the default, not an error.
  const layout = url.searchParams.get("layout") === "one" ? ("one" as const) : ("two" as const);
  // The only scope besides a range: the bibs nobody has printed yet (§264).
  const only = url.searchParams.get("only") === "unprinted" ? ("unprinted" as const) : undefined;

  const db = getDb();
  const event = await findEventForBibs(db, id, locale);
  if (!event) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  const now = new Date();
  const rows = await listBibs(db, id, { from, to, only });

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
    eventDate: formatDay(event.startsAt, { locale, timeZone: event.timezone, style: "long" }),
    // The band in the event's own colour, and the facts the foot is composed from — the
    // partners, the club's mailbox, the site (§180, §317) — the same the preview draws from.
    bandColour: event.bibColour,
    partners: event.coHosts.map((host) => host.name),
    // The first address the club shows (§NNN): one line of small print has room for one.
    replyTo: (await shownContactAddresses(db))[0] ?? null,
    siteUrl: env.APP_BASE_URL,
    generatedAt: now,
    layout,
    design: event.design,
    pictures: { header, sponsors },
  });

  const suffix = `${from !== undefined || to !== undefined ? `-${from ?? 1}-${to ?? "end"}` : ""}${only ? "-unprinted" : ""}${layout === "one" ? "-one-per-page" : ""}`;
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
