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
  bibPictureUrl,
  DEFAULT_BIB_DESIGN,
  numberScaleFactor,
} from "./bib-design";
import { BIB_FOOTER_EMS, bibFooterLines, bibFooterParts } from "./bib-footer";
import {
  BIB_CARD,
  BIB_FOOTER_LINE,
  BIB_IMAGE,
  BIB_IMAGE_SCALE,
  BIB_LAYOUT,
  BIB_MARGIN,
  bibNumberPoints,
} from "./bib-geometry";

/**
 * One race number as a picture (`DECISIONS.md` §94, §180; the owner: "I should be able to
 * preview and see bibs for each participant — a pretty bib, with our logo, participant name,
 * race").
 *
 * **The paper `bibs-pdf.ts` prints, at a screen's size**, and that is the whole point of it: the
 * club looks at this before sending anything to a printer, so a preview that arranged the same
 * facts differently would be a preview of nothing. Both read `bib-design.ts` and `bib-footer.ts`
 * for the decisions that could drift — which colour the band is when the event names none, what
 * the footer says and where it breaks (§317) — and since the bib became an A5 sheet (§338) both
 * read `bib-geometry.ts` for where everything sits: this picture is 990×700, the A5 paper's own
 * proportion (√2), and every length in it is the sheet's length in points times
 * `BIB_IMAGE_SCALE` — the margin, the band, the lockup, the number, the name, the sponsors'
 * strip, the small print. Nothing here is sized by eye any more.
 *
 * The lockup is `src/theme/pdf/logo-white.png`, white on transparent (the raster
 * `scripts/brand-assets.mjs` writes), because the band is the event's colour and the email's
 * white lockup carries the club's blue baked in behind it. A literal path, so the file is
 * traced into the function. Drawn through `next/og` like the share cards: flexbox only, the
 * bundled Roboto.
 */

/** Points to this picture's pixels. */
const px = (points: number) => points * BIB_IMAGE_SCALE;

/**
 * The paper's edge, drawn on the screen only — the printed bib has no frame, its edge is the
 * paper's (§338) — so that a white A5 on a white page still shows where it ends. It sits inside
 * the margin: Satori sizes boxes border-box, so the padding is the margin less the border, and
 * everything inside starts exactly where the card starts on the paper.
 */
const PAPER_EDGE = 2;

/**
 * The small print's geometry (§317): the sheet's 523.28-point line and its 8-point type, both
 * multiplied by `BIB_IMAGE_SCALE` — 870 pixels of line at 13.3 pixels — which is the same
 * `BIB_FOOTER_EMS` wide. Not a round size, and deliberately: it is what makes a line that fits on
 * the paper fit here, break in the same place and be cut at the same character.
 */
const FOOTER_LINE = px(BIB_FOOTER_LINE.width);
export const BIB_IMAGE_FOOTER = { width: FOOTER_LINE, size: FOOTER_LINE / BIB_FOOTER_EMS } as const;

type BibImageInput = {
  bibNumber: number;
  registeredName: string;
  eventTitle: string;
  eventDate: string;
  bandColour?: string | null;
  partners?: readonly string[];
  replyTo?: string | null;
  /** `APP_BASE_URL`, for the website in the footer when the club asks for it (§317). */
  siteUrl?: string | null;
  /** What the club decided this bib shows (§249); absent is the platform's own design. */
  design?: BibDesign;
};

/**
 * The footer lines this picture draws, decided by `bib-footer.ts` from the club's design — the
 * sheet's `bibSheetFooterLines` over the same facts, and the test holds the two side by side.
 * `headerPicture` is whether this picture really draws the club's picture at the top rather
 * than the band.
 */
export function bibImageFooterLines(
  input: Pick<BibImageInput, "design" | "partners" | "replyTo" | "siteUrl" | "eventTitle" | "eventDate">,
  headerPicture: boolean,
): string[] {
  return bibFooterLines(
    bibFooterParts(input.design ?? DEFAULT_BIB_DESIGN, {
      partners: input.partners ?? [],
      replyTo: input.replyTo,
      siteUrl: input.siteUrl,
      eventTitle: input.eventTitle,
      eventDate: input.eventDate,
      headerPicture,
    }),
  );
}

let logoDataUrl: Promise<string> | undefined;
function logo(): Promise<string> {
  logoDataUrl ??= readFile(path.join(process.cwd(), "src", "theme", "pdf", "logo-white.png")).then(
    (buffer) => `data:image/png;base64,${buffer.toString("base64")}`,
  );
  return logoDataUrl;
}

/** One line of text that never wraps and is cut with "…" where the sheet's would be. */
const ONE_LINE = { display: "flex", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" } as const;

export async function renderBibImage(input: BibImageInput): Promise<ImageResponse> {
  const { width, height } = BIB_IMAGE;
  const L = BIB_LAYOUT;
  const design = input.design ?? DEFAULT_BIB_DESIGN;
  const digits = String(input.bibNumber);
  // The sheet's size in points, the club's scale included, then to pixels (§249).
  const numberSize = px(bibNumberPoints(digits, numberScaleFactor(design)));
  const band = bibBandColour(input.bandColour);
  const bandText = bandTextColour(band);
  // A picture the club uploaded, made absolute for the renderer (§249); the band when there is
  // none. Satori fetches it itself, from this site's own store — nowhere else is accepted.
  const header = bibPictureUrl(design.headerImageSrc, env.APP_BASE_URL);
  const sponsors = bibPictureUrl(design.sponsorImageSrc, env.APP_BASE_URL);
  // Told which header this picture draws, as the sheet is (§317).
  const footerLines = bibImageFooterLines(input, header !== null);
  const footerHeight = L.footerHeight + Math.max(0, footerLines.length - 1) * BIB_FOOTER_LINE.lineHeight;
  // The race and its date at the right of the band, in what the lockup leaves — the sheet's width.
  const headerTextWidth = BIB_CARD.width - (design.showLogo ? L.logoWidth + 3 * L.inset : 2 * L.inset);
  /**
   * The name, above the number or below it — and nowhere when the club switched it off — in the
   * strip the sheet gives it, at the sheet's size, cut with "…" where the sheet cuts it.
   */
  const name = design.showName ? (
    <div
      style={{
        display: "flex",
        flexShrink: 0,
        height: px(L.nameBlock),
        padding: `${px(L.nameTop)}px ${px(L.inset)}px 0 ${px(L.inset)}px`,
        justifyContent: "center",
      }}
    >
      <div style={{ ...ONE_LINE, fontSize: px(L.nameSize), fontWeight: 700 }}>{input.registeredName}</div>
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
          border: `${PAPER_EDGE}px solid ${COLOR.line}`,
          padding: px(BIB_MARGIN) - PAPER_EDGE,
        }}
      >
        {/* The club's own header picture across the top (§249), or the coloured band with the
            lockup and the race on it. The picture replaces the band whole: a band *and* a
            picture is two headers, and the club chose the picture. It covers the strip, centred,
            exactly as the sheet crops it. */}
        {header ? (
          // eslint-disable-next-line @next/next/no-img-element -- Satori fetches it
          <img
            src={header}
            alt=""
            width={px(BIB_CARD.width)}
            height={px(L.bandHeight)}
            style={{ flexShrink: 0, objectFit: "cover" }}
          />
        ) : (
          <div
            style={{
              display: "flex",
              flexShrink: 0,
              height: px(L.bandHeight),
              position: "relative",
              padding: `0 ${px(L.inset)}px`,
              background: band,
            }}
          >
            {design.showLogo ? (
              // eslint-disable-next-line @next/next/no-img-element -- Satori draws the data URI
              <img
                src={await logo()}
                alt=""
                width={px(L.logoWidth)}
                height={px(L.logoWidth / L.logoRatio)}
                style={{
                  position: "absolute",
                  left: px(L.inset),
                  top: px((L.bandHeight - L.logoWidth / L.logoRatio) / 2),
                  objectFit: "contain",
                }}
              />
            ) : null}
            {/*
              The race and its date, each at the same fixed offset from the card's top the sheet
              draws them at (`BIB_LAYOUT.titleTop`/`dateTop`/`dateTopAlone`) — not centred on the
              band as a group, which is what let the preview drift from the paper it is meant to
              be a picture of.
            */}
            {design.showEventTitle && (
              <div
                style={{
                  ...ONE_LINE,
                  position: "absolute",
                  top: px(L.titleTop),
                  right: px(L.inset),
                  maxWidth: px(headerTextWidth),
                  color: bandText,
                  fontWeight: 700,
                  fontSize: px(L.titleSize),
                }}
              >
                {input.eventTitle}
              </div>
            )}
            {design.showDate && (
              <div
                style={{
                  ...ONE_LINE,
                  position: "absolute",
                  top: px(design.showEventTitle ? L.dateTop : L.dateTopAlone),
                  right: px(L.inset),
                  maxWidth: px(headerTextWidth),
                  color: bandText,
                  fontSize: px(L.dateSize),
                }}
              >
                {input.eventDate}
              </div>
            )}
          </div>
        )}
        {design.namePosition === "above" ? name : null}
        {/* The number, centred on what the card has left, as the sheet centres it. */}
        <div
          style={{
            display: "flex",
            flex: 1,
            alignItems: "center",
            justifyContent: "center",
            fontSize: numberSize,
            fontWeight: 700,
            color: COLOR.ink,
            lineHeight: 1,
          }}
        >
          {digits}
        </div>
        {design.namePosition === "below" ? name : null}
        {/* The sponsors' strip, when the club has one (§249): above the small print, across
            the card less its inset, its own proportion kept. */}
        {sponsors ? (
          <div style={{ display: "flex", flexShrink: 0, height: px(L.sponsorHeight), paddingTop: px(L.sponsorTop), justifyContent: "center" }}>
            {/* eslint-disable-next-line @next/next/no-img-element -- Satori fetches it */}
            <img
              src={sponsors}
              alt=""
              width={px(BIB_CARD.width - 2 * L.inset)}
              height={px(L.sponsorPicture)}
              style={{ objectFit: "contain" }}
            />
          </div>
        ) : null}
        {/* The small print as the club composed it (§317), in the lines `bib-footer.ts` laid out
            for the sheet too: each its own row with wrapping off, so the picture breaks where
            the paper breaks, the last line as far above the card's foot as the sheet sets it.
            `pre`, because the separator's two spaces are two on the paper and Satori would
            otherwise collapse them into one. The overflow rule is a safety net, never the rule. */}
        <div
          style={{
            display: "flex",
            flexShrink: 0,
            flexDirection: "column",
            justifyContent: "flex-end",
            alignItems: "center",
            height: px(footerHeight),
            paddingBottom: px(BIB_FOOTER_LINE.lastLineTop - BIB_FOOTER_LINE.lineHeight),
            fontSize: BIB_IMAGE_FOOTER.size,
            lineHeight: `${px(BIB_FOOTER_LINE.lineHeight)}px`,
            color: COLOR.inkMuted,
          }}
        >
          {footerLines.map((line, index) => (
            <div key={index} style={{ display: "flex", maxWidth: BIB_IMAGE_FOOTER.width, whiteSpace: "pre", overflow: "hidden" }}>
              {line}
            </div>
          ))}
        </div>
      </div>
    ),
    { width, height, fonts: await brandFonts() },
  );
}
