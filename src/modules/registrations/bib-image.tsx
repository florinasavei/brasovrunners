import { readFile } from "node:fs/promises";
import path from "node:path";
import { ImageResponse } from "next/og";
import { COLOR } from "@/theme/brand";
import { brandFonts } from "@/theme/pdf/fonts";
import { env } from "@/shared/config/env";
import {
  bandTextColour,
  type BibDesign,
  bibBandColour,
  bibFooterLine,
  bibPictureUrl,
  DEFAULT_BIB_DESIGN,
  numberScaleFactor,
} from "./bib-design";

/**
 * One race number as a picture (`DECISIONS.md` §94, §180; the owner: "I should be able to
 * preview and see bibs for each participant — a pretty bib, with our logo, participant name,
 * race").
 *
 * **The same card `bibs-pdf.ts` prints**, and that is the whole point of it: the club looks at
 * this before sending anything to a printer, so a preview that arranged the same facts
 * differently would be a preview of nothing. Both read `bib-design.ts` for the two decisions
 * that could drift — which colour the band is when the event names none, and what the footer
 * line says — and both lay out a coloured band with the white lockup and the race on it, the
 * number under it in the body ink, the registered name beneath, and the small print at the
 * foot. 900×600, near enough the proportion of an A5 bib lying on its side.
 *
 * The lockup is `src/theme/pdf/logo-white.png`, white on transparent (the raster
 * `scripts/brand-assets.mjs` writes), because the band is the event's colour and the email's
 * white lockup carries the club's blue baked in behind it. A literal path, so the file is
 * traced into the function. Drawn through `next/og` like the share cards: flexbox only, the
 * bundled Roboto.
 */
export const BIB_IMAGE = { width: 900, height: 600 } as const;

/** The band, and the lockup that sits in it, at this card's scale. */
const BAND_HEIGHT = 96;
const LOGO_WIDTH = 204;

let logoDataUrl: Promise<string> | undefined;
function logo(): Promise<string> {
  logoDataUrl ??= readFile(path.join(process.cwd(), "src", "theme", "pdf", "logo-white.png")).then(
    (buffer) => `data:image/png;base64,${buffer.toString("base64")}`,
  );
  return logoDataUrl;
}

export async function renderBibImage(input: {
  bibNumber: number;
  registeredName: string;
  eventTitle: string;
  eventDate: string;
  bandColour?: string | null;
  partners?: readonly string[];
  replyTo?: string | null;
  /** What the club decided this bib shows (§249); absent is the platform's own design. */
  design?: BibDesign;
}): Promise<ImageResponse> {
  const { width, height } = BIB_IMAGE;
  const design = input.design ?? DEFAULT_BIB_DESIGN;
  const digits = String(input.bibNumber);
  const numberSize = Math.round((digits.length >= 5 ? 218 : digits.length === 4 ? 273 : 312) * numberScaleFactor(design));
  const nameSize = input.registeredName.length > 26 ? 30 : 37;
  const band = bibBandColour(input.bandColour);
  const bandText = bandTextColour(band);
  const footer = bibFooterLine(input.partners ?? [], input.replyTo);
  // A picture the club uploaded, made absolute for the renderer (§249); the band when there is
  // none. Satori fetches it itself, from this site's own store — nowhere else is accepted.
  const header = bibPictureUrl(design.headerImageSrc, env.APP_BASE_URL);
  const sponsors = bibPictureUrl(design.sponsorImageSrc, env.APP_BASE_URL);
  /** The name, above the number or below it — and nowhere when the club switched it off. */
  const name = design.showName ? (
    <div
      style={{
        display: "flex",
        justifyContent: "center",
        padding: "0 30px",
        fontSize: nameSize,
        fontWeight: 700,
        whiteSpace: "nowrap",
        overflow: "hidden",
      }}
    >
      {input.registeredName}
    </div>
  ) : null;
  return new ImageResponse(
    (
      <div
        style={{
          width,
          height,
          display: "flex",
          flexDirection: "column",
          background: COLOR.surface,
          color: COLOR.ink,
          fontFamily: "Roboto, sans-serif",
          border: `2px solid ${COLOR.line}`,
        }}
      >
        {/* The club's own header picture across the top (§249), or the coloured band with the
            lockup and the race on it. The picture replaces the band whole: a band *and* a
            picture is two headers, and the club chose the picture. */}
        {header ? (
          // eslint-disable-next-line @next/next/no-img-element -- Satori fetches it
          <img src={header} alt="" width={width} height={BAND_HEIGHT} style={{ objectFit: "cover" }} />
        ) : (
          <div
            style={{
              display: "flex",
              height: BAND_HEIGHT,
              alignItems: "center",
              justifyContent: "space-between",
              padding: "0 30px",
              background: band,
            }}
          >
            {design.showLogo ? (
              // eslint-disable-next-line @next/next/no-img-element -- Satori draws the data URI
              <img src={await logo()} alt="" width={LOGO_WIDTH} height={84} style={{ objectFit: "contain" }} />
            ) : (
              <div style={{ display: "flex" }} />
            )}
            <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", color: bandText }}>
              {design.showEventTitle && <div style={{ display: "flex", fontWeight: 700, fontSize: 20 }}>{input.eventTitle}</div>}
              {design.showDate && <div style={{ display: "flex", fontSize: 17 }}>{input.eventDate}</div>}
            </div>
          </div>
        )}
        {design.namePosition === "above" ? name : null}
        <div
          style={{
            display: "flex",
            flex: 1,
            alignItems: "center",
            justifyContent: "center",
            fontSize: numberSize,
            fontWeight: 700,
            color: COLOR.ink,
            letterSpacing: -6,
            lineHeight: 1,
          }}
        >
          {digits}
        </div>
        {design.namePosition === "below" ? name : null}
        {/* The sponsors' strip, when the club has one (§249): above the small print, across
            the card, its own proportion kept. */}
        {sponsors ? (
          // eslint-disable-next-line @next/next/no-img-element -- Satori fetches it
          <img src={sponsors} alt="" width={width - 60} height={64} style={{ margin: "0 30px", objectFit: "contain" }} />
        ) : null}
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            padding: "14px 30px 16px 30px",
            fontSize: 13,
            color: COLOR.inkMuted,
            whiteSpace: "nowrap",
            overflow: "hidden",
          }}
        >
          {footer}
        </div>
      </div>
    ),
    { width, height, fonts: await brandFonts() },
  );
}
