import { readFile } from "node:fs/promises";
import path from "node:path";
import { ImageResponse } from "next/og";
import { COLOR } from "@/theme/brand";
import { brandFonts } from "@/theme/pdf/fonts";
import { bibBandColour, bibFooterLine } from "./bib-design";

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
}): Promise<ImageResponse> {
  const { width, height } = BIB_IMAGE;
  const digits = String(input.bibNumber);
  const numberSize = digits.length >= 5 ? 218 : digits.length === 4 ? 273 : 312;
  const nameSize = input.registeredName.length > 26 ? 30 : 37;
  const band = bibBandColour(input.bandColour);
  const footer = bibFooterLine(input.partners ?? [], input.replyTo);
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
          {/* eslint-disable-next-line @next/next/no-img-element -- Satori draws the data URI */}
          <img src={await logo()} alt="" width={LOGO_WIDTH} height={84} style={{ objectFit: "contain" }} />
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", color: COLOR.surface }}>
            <div style={{ display: "flex", fontWeight: 700, fontSize: 20 }}>{input.eventTitle}</div>
            <div style={{ display: "flex", fontSize: 17 }}>{input.eventDate}</div>
          </div>
        </div>
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
