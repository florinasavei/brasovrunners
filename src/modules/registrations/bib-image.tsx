import { readFile } from "node:fs/promises";
import path from "node:path";
import { ImageResponse } from "next/og";
import { COLOR } from "@/theme/brand";
import { brandFonts } from "@/theme/pdf/fonts";
import { env } from "@/shared/config/env";
import {
  bandTextColour,
  BIB_MEMBER_CARD,
  type BibDesign,
  bibBandColour,
  bibMemberBandColour,
  bibMemberCardBackground,
  bibEmergencyLine,
  bibMemberLabel,
  bibMemberStripeText,
  bibPictureUrl,
  DEFAULT_BIB_DESIGN,
  numberScaleFactor,
} from "./bib-design";
import { BIB_FOOTER_EMS, bibFooterLines, bibFooterParts, bibFooterWidth } from "./bib-footer";
import { pathOf } from "@/modules/routes/elevation/geometry";
import { ELEVATION_GLYPH_PATHS, GLYPH_EVEN_ODD } from "@/modules/routes/elevation/glyphs";
import type { BibProfileDrawing, BibProfileFigureLines } from "./bib-profile";
import { type BibProfileRow, bibProfileRow } from "./bib-profile-row";
import { bibPinGlyphScale } from "./bib-profile-strip";
import { BIB_MEMBER_MARK_PATHS, BIB_MEMBER_MARK_VIEWBOX, type BibMemberMark, bibMemberMarkBox, isVectorMark } from "./bib-member-mark";
import { BIB_PICTURE_BOX, type BibPictureSlot, bibPictureDrawing } from "./bib-picture-frame";
import {
  BIB_CARD,
  BIB_FOOTER_LINE,
  BIB_IMAGE,
  BIB_IMAGE_SCALE,
  BIB_LAYOUT,
  BIB_MARGIN,
  BIB_TEXT_ASCENT,
  BIB_TEXT_LINE,
  type BibHeaderLayout,
  bibEmergencyFit,
  bibExtrasHeight,
  bibExtrasTurn,
  bibNameReserve,
  bibNumberArea,
  bibNumberFit,
  bibStubScale,
} from "./bib-geometry";
import { bibHeader } from "./bib-header";
import { formatRaceNumber } from "./domain/race-number";

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
  /** Null draws a desk spare (§444): the empty line the name is written on, as the sheet prints it. */
  registeredName: string | null;
  eventTitle: string;
  eventDate: string;
  bandColour?: string | null;
  partners?: readonly string[];
  replyTo?: string | null;
  /** `APP_BASE_URL`, for the website in the footer when the club asks for it (§317). */
  siteUrl?: string | null;
  /** What the club decided this bib shows (§249); absent is the platform's own design. */
  design?: BibDesign;
  /** The small words under a desk spare's empty line (§444), as the sheet prints them. */
  blankMark?: string;
  /**
   * The club's pictures, already read by the route (§560, `bib-pictures.ts#loadBibPictures`): an
   * address `next/og` can draw — an inline PNG, because it cannot read the WebP every stored
   * picture is — and its size in pixels, which makes the crop exact. `null` for a place draws
   * none there (the band, no sponsors' strip), as the sheet does with a picture it could not fetch.
   * Absent, the design's own addresses are drawn as they are, with no size.
   */
  pictures?: Partial<Record<BibPictureSlot | "memberHeader", BibImagePicture | null>>;
  /**
   * A member's bib (§664): the members' header — their picture, else their colour, else the event's
   * band — and their label, over the same number, name and small print. Only while the design's
   * members' switch is on.
   */
  member?: boolean;
  /** The platform's words for the members' label when the club typed none («Membru {club}»), in the picture's language. */
  memberLabelDefault?: string;
  /** «Profilul traseului» (§750), already read from the event's GPX by the route (`bib-extras.ts`); drawn only while the design's tick is on. */
  profile?: BibProfileDrawing | null;
  /** The figures beside the club's picture of the profile (§759), from `bib-extras.ts`; null draws the picture across the strip. */
  profileFigures?: BibProfileFigureLines | null;
  /** The word before the emergency phone when the club typed none (§750, §759), in the picture's language. */
  emergencyLabel?: string;
  /** «21K» for the header's badge (§750), from `bib-extras.ts`; drawn only while the design's tick is on. */
  distanceBadge?: string | null;
};

/** One picture as the renderer takes it: something `next/og` can load, and its size in pixels. */
export type BibImagePicture = { src: string; width: number; height: number };

/**
 * A place's picture through the one crop rule (`bib-picture-frame.ts`, §560): a clipping box of
 * the place's size with the picture scaled and shifted inside it, so exactly the cropped part
 * fills it — the sheet draws the same numbers in points. With no crop, `object-fit` as before:
 * the header covers its strip, the sponsors' strip fits the whole picture.
 */
function placedPicture(slot: BibPictureSlot, picture: BibImagePicture, design: BibDesign, crop = slot === "header" ? design.headerImageCrop : design.sponsorImageCrop) {
  const { src } = picture;
  const size = picture.width > 0 && picture.height > 0 ? { width: picture.width, height: picture.height } : null;
  const box = { width: px(BIB_PICTURE_BOX[slot].width), height: px(BIB_PICTURE_BOX[slot].height) };
  const drawing = bibPictureDrawing(slot, crop, size, box);
  if (drawing.kind !== "crop") {
    // eslint-disable-next-line @next/next/no-img-element -- Satori draws it
    return <img src={src} alt="" width={box.width} height={box.height} style={{ flexShrink: 0, objectFit: drawing.kind === "cover" ? "cover" : "contain" }} />;
  }
  return (
    <div style={{ display: "flex", flexShrink: 0, position: "relative", overflow: "hidden", width: box.width, height: box.height }}>
      {/* eslint-disable-next-line @next/next/no-img-element -- Satori draws it */}
      <img
        src={src}
        alt=""
        width={drawing.width}
        height={drawing.height}
        style={{ position: "absolute", left: drawing.left, top: drawing.top, width: drawing.width, height: drawing.height }}
      />
    </div>
  );
}

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

/** The room the profile's SVG keeps round its chart so the line's stroke and the end dots are not clipped, in points. */
const PROFILE_PAD = 2;
/** The box a text of the strip is aligned in, in points: wider than any label the core keeps (`bib-profile-strip.ts`), so nothing is clipped. */
const STRIP_TEXT_BOX = 120;

/** One line of text that never wraps and is cut with "…" where the sheet's would be. */
const ONE_LINE = { display: "flex", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" } as const;

/**
 * The race and its date on the band (§755): each line `bibHeader` laid out, as its own one-line box at
 * the layout's top, right-aligned on the column's right edge — the sheet's points — at the line's own
 * height (`BIB_TEXT_LINE`, the height pdfkit gives it and Satori's own normal line for Roboto, so a
 * title on one line draws pixel for pixel where it did). Nothing here wraps: the layout decided the
 * lines, measured never narrower than Satori sets them, and the box's width is only a safety net.
 * Exported so the test can hold the markup to the layout without reading pixels.
 */
export function bibHeaderLines(words: BibHeaderLayout, colour: string) {
  const L = BIB_LAYOUT;
  const box = { position: "absolute", right: px(BIB_CARD.width - words.right), maxWidth: px(words.right - words.left), color: colour } as const;
  return [
    ...(words.title?.lines ?? []).map((line, index) => (
      <div
        key={`title-${index}`}
        data-testid="bib-header-title"
        style={{ ...ONE_LINE, ...box, top: px(line.top), fontWeight: 700, fontSize: px(words.title!.size), lineHeight: `${px(BIB_TEXT_LINE * words.title!.size)}px` }}
      >
        {line.text}
      </div>
    )),
    ...(words.date
      ? [
          <div
            key="date"
            data-testid="bib-header-date"
            style={{ ...ONE_LINE, ...box, top: px(words.date.top), fontSize: px(L.dateSize), lineHeight: `${px(BIB_TEXT_LINE * L.dateSize)}px` }}
          >
            {words.date.text}
          </div>,
        ]
      : []),
  ];
}

let clubLogoDataUrl: Promise<string> | undefined;
/** The club's blue lockup (`src/theme/pdf/logo.png`, the file the sheet embeds for the same mark), as `next/og` loads it. */
function clubLogo(): Promise<string> {
  clubLogoDataUrl ??= readFile(path.join(process.cwd(), "src", "theme", "pdf", "logo.png")).then(
    (buffer) => `data:image/png;base64,${buffer.toString("base64")}`,
  );
  return clubLogoDataUrl;
}

/**
 * The member mark (§750; its shape the club's, §759) at the sheet's points: absolute at the card's left
 * inset under the header. A star or a registry glyph is the one path of `bib-member-mark.ts`, in its
 * 24-unit box, filled in the number's ink — the very string the sheet hands pdfkit; the club's logo is
 * the blue lockup the sheet prints, never recoloured. Exported so the test reads the markup.
 */
export function bibMemberMarkElement(shape: BibMemberMark, ink: string, logoSrc: string | null) {
  const L = BIB_LAYOUT;
  const box = bibMemberMarkBox(shape);
  // From inside the paper's drawn edge, as Satori places an absolute box: less `PAPER_EDGE`.
  const place = { position: "absolute", top: px(BIB_MARGIN + L.bandHeight + L.memberMarkTop) - PAPER_EDGE, left: px(BIB_MARGIN + L.inset) - PAPER_EDGE } as const;
  if (isVectorMark(shape)) {
    return (
      <svg
        width={px(box.width)}
        height={px(box.height)}
        viewBox={`0 0 ${BIB_MEMBER_MARK_VIEWBOX} ${BIB_MEMBER_MARK_VIEWBOX}`}
        data-testid="bib-member-mark"
        data-mark={shape}
        style={place}
      >
        <path d={BIB_MEMBER_MARK_PATHS[shape]} fill={ink} />
      </svg>
    );
  }
  if (!logoSrc) return null;
  // eslint-disable-next-line @next/next/no-img-element -- Satori draws the data URI
  return <img src={logoSrc} alt="" width={px(box.width)} height={px(box.height)} data-testid="bib-member-mark" data-mark="logo" style={{ ...place, objectFit: "contain" }} />;
}

/**
 * The profile's row (§750) at the sheet's points: the line drawn from the GPX with its words and the
 * checkpoints' marks, or the club's picture fitted whole (§759) — either in the chart's width the row
 * decided (`bib-profile-row.ts`), with the figures beside it when the club shows them.
 */
function profileRowElement(row: BibProfileRow, ink: string, picture: BibImagePicture | null) {
  const L = BIB_LAYOUT;
  const chartWidth = row.chartWidth;
  const figures = row.figures
    ? [
        row.figures.distance ? (
          <div key="distance" style={{ ...ONE_LINE, position: "absolute", left: px(L.inset + chartWidth + L.profileTextGap), top: px(L.profileDistanceTop), fontSize: px(L.profileTextSize), color: ink }}>
            {row.figures.distance}
          </div>
        ) : null,
        row.figures.gain ? (
          <div key="gain" style={{ ...ONE_LINE, position: "absolute", left: px(L.inset + chartWidth + L.profileTextGap), top: px(L.profileGainTop), fontSize: px(L.profileTextSize), color: ink }}>
            {row.figures.gain}
          </div>
        ) : null,
      ]
    : null;
  if (row.kind === "picture") {
    return (
      <div data-testid="bib-profile-row" data-source="picture" style={{ display: "flex", flexShrink: 0, position: "relative", height: px(L.profileHeight) }}>
        {picture ? (
          // eslint-disable-next-line @next/next/no-img-element -- Satori draws it
          <img
            src={picture.src}
            alt=""
            width={px(chartWidth)}
            height={px(L.profilePictureHeight)}
            data-testid="bib-profile-picture"
            style={{ position: "absolute", left: px(L.inset), top: px(L.profilePictureTop), objectFit: "contain" }}
          />
        ) : null}
        {figures}
      </div>
    );
  }
  // The strip is the core's answer in its own box (`bib-profile-strip.ts`): `chartWidth` × `profileHeight` points from the row's top left.
  const { strip } = row;
  const g = strip.geometry;
  const size = L.profileLabelSize;
  const scaleStyle = { stroke: ink, strokeOpacity: L.profileScaleOpacity, strokeWidth: L.profileKmTickWeight } as const;
  const glyphScale = bibPinGlyphScale(g.pinRadius);
  return (
    <div data-testid="bib-profile-row" data-source="gpx" style={{ display: "flex", flexShrink: 0, position: "relative", height: px(L.profileHeight) }}>
      <svg
        width={px(chartWidth + 2 * PROFILE_PAD)}
        height={px(L.profileHeight + 2 * PROFILE_PAD)}
        viewBox={`${-PROFILE_PAD} ${-PROFILE_PAD} ${chartWidth + 2 * PROFILE_PAD} ${L.profileHeight + 2 * PROFILE_PAD}`}
        data-testid="bib-profile"
        style={{ position: "absolute", left: px(L.inset - PROFILE_PAD), top: px(-PROFILE_PAD) }}
      >
        <path d={pathOf(g.area, true)} fill={ink} fillOpacity={L.profileAreaOpacity} stroke="none" />
        <path d={pathOf(g.line)} fill="none" stroke={ink} strokeWidth={L.profileLineWeight} strokeLinecap="round" strokeLinejoin="round" />
        <circle cx={g.line[0][0]} cy={g.line[0][1]} r={1.8} fill={ink} />
        <circle cx={g.line[g.line.length - 1][0]} cy={g.line[g.line.length - 1][1]} r={1.8} fill={ink} />
        {/* The scale (§NNN): a foot rule and a tick at each kilometre the core kept, faint beside the line. */}
        {strip.scale ? (
          <g data-testid="bib-profile-scale">
            <line x1={g.plot.left} y1={g.plot.bottom} x2={g.plot.right} y2={g.plot.bottom} {...scaleStyle} />
            {g.kmTicks.map((tick) => (
              <line key={tick.km} x1={tick.x} y1={g.plot.bottom} x2={tick.x} y2={g.plot.bottom + L.profileKmTick} {...scaleStyle} />
            ))}
          </g>
        ) : null}
        {/* The route's checkpoints (`bib-checkpoints.ts`), where the core puts them: a stem from the pin down to the plot's foot, a dot on
            the line, and in the band above the plot a ring with the kind's glyph from the core's set. */}
        {g.markers.map((marker) => (
          <g key={marker.index} data-testid="bib-checkpoint-mark" data-glyph={marker.glyph}>
            <line x1={marker.headX} y1={marker.headY + g.pinRadius} x2={marker.x} y2={marker.tickTo} stroke={ink} strokeWidth={L.checkpointTickWeight} />
            <circle cx={marker.x} cy={marker.y} r={L.checkpointDot} fill={ink} />
            <circle cx={marker.headX} cy={marker.headY} r={g.pinRadius} fill="none" stroke={ink} strokeWidth={L.profilePinWeight} />
            <path
              d={ELEVATION_GLYPH_PATHS[marker.glyph]}
              transform={`translate(${marker.headX} ${marker.headY}) scale(${glyphScale})`}
              fill={ink}
              fillRule={GLYPH_EVEN_ODD[marker.glyph] ? "evenodd" : "nonzero"}
            />
          </g>
        ))}
      </svg>
      {/* Every word of the strip at the baseline the core gave it: «Start» and «Sosire», the points' words, the kilometres and their
          unit, the altitudes — a box of its own, aligned by the text's anchor, its line's top where the baseline needs it. */}
      {strip.texts.map((text, at) => (
        <div
          key={at}
          data-testid="bib-profile-text"
          style={{
            ...ONE_LINE,
            position: "absolute",
            left: px(L.inset + (text.anchor === "start" ? text.x : text.anchor === "end" ? text.x - STRIP_TEXT_BOX : text.x - STRIP_TEXT_BOX / 2)),
            top: px(text.baseline - BIB_TEXT_ASCENT * size),
            width: px(STRIP_TEXT_BOX),
            justifyContent: text.anchor === "start" ? "flex-start" : text.anchor === "end" ? "flex-end" : "center",
            fontSize: px(size),
            lineHeight: `${px(BIB_TEXT_LINE * size)}px`,
            color: ink,
          }}
        >
          {text.text}
        </div>
      ))}
      {figures}
    </div>
  );
}

/** Half a circle, for what the runner reads looking down at the chest (§750, §759). */
const TURNED = { transform: "rotate(180deg)" } as const;

/**
 * The block under the name (§750, amending it §759): the profile's row, then the emergency line — its
 * label and numbers set at the size that fits (`bibEmergencyFit`) — turned as `bibExtrasTurn` decides:
 * both turned is **one** block turned about its own centre (the phone comes out above the profile, and
 * reads right under it for the runner), else each row alone. Null when neither is drawn. Exported so
 * the test reads the markup.
 */
export function bibExtrasBlock(input: {
  row: BibProfileRow | null;
  picture: BibImagePicture | null;
  emergency: { text: string; size: number } | null;
  turn: { block: boolean; profile: boolean; phone: boolean };
  ink: string;
}) {
  const L = BIB_LAYOUT;
  if (!input.row && !input.emergency) return null;
  const profileRow = input.row ? profileRowElement(input.row, input.ink, input.picture) : null;
  const emergencyRow = input.emergency ? (
    <div
      data-testid="bib-emergency"
      style={{
        display: "flex",
        flexShrink: 0,
        height: px(L.emergencyHeight),
        alignItems: "center",
        justifyContent: "center",
        fontSize: px(input.emergency.size),
        color: input.ink,
        whiteSpace: "nowrap",
        ...(input.turn.phone ? TURNED : {}),
      }}
    >
      {input.emergency.text}
    </div>
  ) : null;
  return (
    <div
      data-testid="bib-extras"
      data-turn={input.turn.block ? "block" : input.turn.profile ? "profile" : input.turn.phone ? "phone" : "none"}
      style={{ display: "flex", flexDirection: "column", flexShrink: 0, ...(input.turn.block ? TURNED : {}) }}
    >
      {profileRow && input.turn.profile ? <div style={{ display: "flex", flexDirection: "column", flexShrink: 0, ...TURNED }}>{profileRow}</div> : profileRow}
      {emergencyRow}
    </div>
  );
}

export async function renderBibImage(input: BibImageInput): Promise<ImageResponse> {
  const { width, height } = BIB_IMAGE;
  const L = BIB_LAYOUT;
  const design = input.design ?? DEFAULT_BIB_DESIGN;
  // As the event writes it (§735): «007» under «Trei cifre»; its length sizes it, as ever.
  const digits = formatRaceNumber(input.bibNumber, design.numberFormat);
  // The members' header (§664) only while the switch is on; everything under it is the one design.
  const asMember = input.member === true && design.member.enabled;
  const band = asMember ? bibMemberBandColour(design.member, input.bandColour) : bibBandColour(input.bandColour);
  const bandText = bandTextColour(band);
  const memberLabel = asMember ? bibMemberLabel(design.member, input.memberLabelDefault ?? "") : "";
  // «Tot numărul» (§NNN): the members' background over the whole card, the label a stripe.
  const asCard = asMember && design.member.style === "card";
  // The member mark (§750, its shape §759); the name set above the number steps aside for its width (`bibNameReserve`).
  const markDrawn = asMember && design.member.mark;
  const markShape = design.member.markShape;
  const nameReserve = bibNameReserve(markDrawn ? bibMemberMarkBox(markShape).width : null, design.namePosition === "above");
  /*
    The route's profile — from the GPX or the club's picture of it (§759) — and the emergency phone with
    its label and numbers (§750, §759), when ticked and available, decided as the sheet decides them.
  */
  const profilePicture = design.showProfile && design.profileSource === "picture" ? (input.pictures ? (input.pictures.profile ?? null) : (() => {
        const address = bibPictureUrl(design.profileImageSrc, env.APP_BASE_URL);
        return address ? { src: address, width: 0, height: 0 } : null;
      })()) : null;
  const profileRow = bibProfileRow(design, { profile: input.profile ?? null, profileFigures: input.profileFigures ?? null }, profilePicture !== null);
  const emergencyText = bibEmergencyLine(design, input.emergencyLabel ?? "");
  const emergency = emergencyText ? bibEmergencyFit(emergencyText, bibFooterWidth) : null;
  const turn = bibExtrasTurn({
    profile: profileRow !== null,
    profileTurned: design.profileOrientation === "turned",
    phone: emergency !== null,
    phoneTurned: design.emergencyUpsideDown,
  });
  const sponsorsAtBottom = design.sponsorPlace === "bottom";
  const badge = design.showDistance ? (input.distanceBadge ?? null) : null;
  // The stubs (§750) are why the sponsors' row exists with no picture.
  const stubs = design.numberStubs;
  // A picture the club uploaded (§249): the one the route read (§560), or — when the caller read
  // none — the design's own address made absolute; the band when there is none.
  const pictureOf = (slot: BibPictureSlot, src: string | null): BibImagePicture | null => {
    if (input.pictures) return input.pictures[slot] ?? null;
    const address = bibPictureUrl(src, env.APP_BASE_URL);
    return address ? { src: address, width: 0, height: 0 } : null;
  };
  // A member's card draws its own photograph, never a header (§NNN); a member's band draws the
  // members' picture or none — never the event's (§664): its band instead.
  const cardPicture = asCard
    ? input.pictures
      ? (input.pictures.memberCard ?? null)
      : (() => {
          const address = bibPictureUrl(design.member.cardImageSrc, env.APP_BASE_URL);
          return address ? { src: address, width: 0, height: 0 } : null;
        })()
    : null;
  const cardBackground = asCard ? bibMemberCardBackground(design.member, cardPicture !== null) : null;
  const header = asCard
    ? null
    : asMember
    ? input.pictures
      ? (input.pictures.memberHeader ?? null)
      : (() => {
          const address = bibPictureUrl(design.member.headerImageSrc, env.APP_BASE_URL);
          return address ? { src: address, width: 0, height: 0 } : null;
        })()
    : pictureOf("header", design.headerImageSrc);
  const headerCrop = asMember ? design.member.headerImageCrop : design.headerImageCrop;
  const sponsors = pictureOf("sponsors", design.sponsorImageSrc);
  // Told which header this picture draws, as the sheet is (§317).
  const footerLines = bibImageFooterLines(input, header !== null);
  const footerHeight = L.footerHeight + Math.max(0, footerLines.length - 1) * BIB_FOOTER_LINE.lineHeight;
  // A member's card's coloured part: everything above the sponsors' strip and the small print (§NNN).
  const sponsorRow = sponsors || stubs ? L.sponsorHeight : 0;
  const cardHeight = BIB_CARD.height - footerHeight - sponsorRow;
  const stripe = asCard && memberLabel ? bibMemberStripeText(memberLabel) : "";
  // The number's size in points, the club's scale included but never more than the area the rows
  // under the band leave it — the sheet's rule — then to pixels (§249, §750).
  const numberArea = bibNumberArea({
    footer: footerHeight,
    name: design.showName ? L.nameBlock : 0,
    sponsors: sponsorRow,
    stripe: stripe ? L.memberStripeHeight : 0,
    extras: bibExtrasHeight(profileRow !== null, emergency !== null),
  });
  const numberSize = px(bibNumberFit(digits, numberScaleFactor(design), numberArea));
  // The background's own box: under an opaque stripe it stops half-way, so the flow's sub-pixel
  // rounding never shows a line of it between the stripe and the small print.
  const backgroundHeight = px(cardHeight - (stripe ? L.memberStripeHeight / 2 : 0));
  // The number and the name: white on a member's card, the body ink on the white paper.
  const ink = asCard ? BIB_MEMBER_CARD.text : COLOR.ink;
  const headerText = asCard ? BIB_MEMBER_CARD.text : bandText;
  // The race and its date at the right of the band, laid out as the sheet lays them out (§755): the
  // members' label on the band under them stops the column above it.
  const headerWords = bibHeader({
    title: design.showEventTitle ? input.eventTitle : null,
    date: design.showDate ? input.eventDate : null,
    logo: design.showLogo,
    badge: badge !== null,
    label: memberLabel !== "" && !asCard && header === null,
  });
  // The badge: the header's text colour as the tag, the band's colour on it (the card's white tag takes the body ink).
  const badgeInk = asCard ? COLOR.ink : band;
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
        padding: `${px(L.nameTop)}px ${px(L.inset + nameReserve)}px 0 ${px(L.inset + nameReserve)}px`,
        justifyContent: "center",
      }}
    >
      {input.registeredName === null ? (
        // A desk spare (§444): the sheet's rule, at the sheet's point in the strip — `nameTop` is
        // the strip's padding here, so the rule sits `blankLineTop − nameTop` below it — and the
        // small mark under it, its top `blankMarkTop` into the strip as on the paper.
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
          <div
            style={{
              display: "flex",
              marginTop: px(L.blankLineTop - L.nameTop) - px(L.blankLineWeight) / 2,
              width: px(L.blankLineWidth),
              height: px(L.blankLineWeight),
              background: COLOR.ink,
            }}
          />
          {input.blankMark ? (
            <div
              style={{
                ...ONE_LINE,
                marginTop: px(L.blankMarkTop - L.blankLineTop) - px(L.blankLineWeight) / 2,
                fontSize: px(L.blankMarkSize),
                color: COLOR.inkMuted,
              }}
            >
              {input.blankMark}
            </div>
          ) : null}
        </div>
      ) : (
        <div style={{ ...ONE_LINE, fontSize: px(L.nameSize), fontWeight: 700, color: ink }}>{input.registeredName}</div>
      )}
    </div>
  ) : null;
  // The sponsors' strip (§249) and the small print (§317), in the order the design's place says.
  const sponsorsStrip = sponsors ? (
    <div style={{ display: "flex", flexShrink: 0, height: px(L.sponsorHeight), paddingTop: px(L.sponsorTop), justifyContent: "center" }}>
      {/* With the stubs the picture is scaled whole, about its centre, to what is left between them (§750). */}
      {stubs ? (
        <div style={{ display: "flex", transform: `scale(${bibStubScale(true)})` }}>{placedPicture("sponsors", sponsors, design)}</div>
      ) : (
        placedPicture("sponsors", sponsors, design)
      )}
    </div>
  ) : null;
  /*
    The sponsors' row (§249) and, with the club's tick, the number repeated at its two ends (§750): the
    owner's tear-off stubs, small and bold in the body ink, inside the inset — the sheet's points.
  */
  const sponsorRowEl =
    sponsors || stubs ? (
      <div style={{ display: "flex", flexDirection: "column", flexShrink: 0, position: "relative", height: px(L.sponsorHeight) }}>
        {sponsorsStrip}
        {stubs
          ? (["left", "right"] as const).map((side) => (
              <div
                key={side}
                data-testid="bib-stub"
                style={{
                  display: "flex",
                  position: "absolute",
                  [side]: px(L.inset),
                  top: px(L.sponsorTop),
                  height: px(L.sponsorPicture),
                  alignItems: "center",
                  fontSize: px(L.stubSize),
                  fontWeight: 700,
                  color: COLOR.ink,
                  lineHeight: 1,
                }}
              >
                {digits}
              </div>
            ))
          : null}
      </div>
    ) : null;
  /*
    The small print as the club composed it (§317), in the lines `bib-footer.ts` laid out for the
    sheet too: each its own row with wrapping off, so the picture breaks where the paper breaks, the
    last line as far above the strip's foot as the sheet sets it. `pre`, because the separator's two
    spaces are two on the paper and Satori would otherwise collapse them into one. The overflow rule
    is a safety net, never the rule.
  */
  const smallPrint = (
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
  );
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
        {/* A member's card (§NNN): its background behind everything, at the sheet's points — the
            photograph in the card's shape under the navy veil, the colour, or the kit's gradient. */}
        {cardBackground ? (
          <div
            style={{
              display: "flex",
              position: "absolute",
              top: px(BIB_MARGIN) - PAPER_EDGE,
              left: px(BIB_MARGIN) - PAPER_EDGE,
              width: px(BIB_CARD.width),
              height: backgroundHeight,
              overflow: "hidden",
              ...(cardBackground.kind === "colour"
                ? { background: cardBackground.colour }
                : cardBackground.kind === "gradient"
                  ? { backgroundImage: `linear-gradient(180deg, ${cardBackground.stops[0]} 0%, ${cardBackground.stops[1]} 100%)` }
                  : {}),
            }}
          >
            {cardBackground.kind === "picture" && cardPicture ? placedPicture("memberCard", cardPicture, design, design.member.cardImageCrop) : null}
            {cardBackground.kind === "picture" ? (
              <div
                style={{
                  display: "flex",
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: px(BIB_CARD.width),
                  height: backgroundHeight,
                  background: BIB_MEMBER_CARD.veil,
                  opacity: BIB_MEMBER_CARD.veilOpacity,
                }}
              />
            ) : null}
          </div>
        ) : null}
        {/* The club's own header picture across the top (§249), or the coloured band with the
            lockup and the race on it. The picture replaces the band whole: a band *and* a
            picture is two headers, and the club chose the picture. It covers the strip, centred,
            exactly as the sheet crops it — the club's crop when it drew one (§560). */}
        {header ? (
          placedPicture("header", header, design, headerCrop)
        ) : (
          <div
            style={{
              display: "flex",
              flexShrink: 0,
              height: px(L.bandHeight),
              position: "relative",
              padding: `0 ${px(L.inset)}px`,
              background: asCard ? "transparent" : band,
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
            {badge ? (
              <div
                data-testid="bib-badge"
                style={{
                  display: "flex",
                  position: "absolute",
                  top: px(headerWords.badgeTop),
                  right: px(L.inset),
                  width: px(L.badgeWidth),
                  height: px(L.badgeHeight),
                  alignItems: "center",
                  justifyContent: "center",
                  borderRadius: px(L.badgeRadius),
                  background: headerText,
                  color: badgeInk,
                  fontSize: px(L.badgeSize),
                  fontWeight: 700,
                  lineHeight: 1,
                }}
              >
                {badge}
              </div>
            ) : null}
            {bibHeaderLines(headerWords, headerText)}
          </div>
        )}
        {/* The members' label (§664), at the sheet's points (`BIB_LAYOUT.memberTag*`): absolute over
            the header's right, a filled tag on the members' picture, the band itself on a band. */}
        {memberLabel && !asCard ? (
          <div
            style={{
              display: "flex",
              position: "absolute",
              // From inside the paper's drawn edge, as Satori places an absolute box: less `PAPER_EDGE`.
              top: px(BIB_MARGIN + L.memberTagTop) - PAPER_EDGE,
              right: px(BIB_MARGIN + L.inset - L.memberTagPad) - PAPER_EDGE,
              height: px(L.memberTagHeight),
              alignItems: "center",
              padding: `0 ${px(L.memberTagPad)}px`,
              background: header ? band : "transparent",
              color: bandText,
              fontSize: px(L.memberLabelSize),
              whiteSpace: "nowrap",
            }}
          >
            {memberLabel}
          </div>
        ) : null}
        {/* The member mark (§750; its shape the club's, §759), the sheet's at the sheet's points. */}
        {markDrawn ? bibMemberMarkElement(markShape, ink, markShape === "logo" ? await clubLogo() : null) : null}
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
            color: ink,
            lineHeight: 1,
          }}
        >
          {digits}
        </div>
        {design.namePosition === "below" ? name : null}
        {bibExtrasBlock({ row: profileRow, picture: profilePicture, emergency, turn, ink })}
        {/* A member's card's stripe (§NNN): its foot on the background's foot, the label in capitals. */}
        {stripe ? (
          <div
            style={{
              display: "flex",
              flexShrink: 0,
              height: px(L.memberStripeHeight),
              alignItems: "center",
              justifyContent: "center",
              background: BIB_MEMBER_CARD.stripe,
              color: BIB_MEMBER_CARD.stripeText,
              fontSize: px(L.memberStripeSize),
              fontWeight: 700,
              letterSpacing: px(L.memberStripeSpacing),
              whiteSpace: "nowrap",
            }}
          >
            {stripe}
          </div>
        ) : null}
        {/* «Jos de tot» (§750): the small print, then the sponsors' strip as the card's last row;
            «Deasupra subsolului»: the strip, then the small print, as before. */}
        {sponsorsAtBottom ? smallPrint : sponsorRowEl}
        {sponsorsAtBottom ? sponsorRowEl : smallPrint}
      </div>
    ),
    { width, height, fonts: await brandFonts() },
  );
}
