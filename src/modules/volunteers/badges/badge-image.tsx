import { readFile } from "node:fs/promises";
import path from "node:path";
import { ImageResponse } from "next/og";
import { bibFooterWidth } from "@/modules/registrations/bib-footer";
import { bibTitleWidth } from "@/modules/registrations/bib-header";
import { pictureDrawingIn } from "@/modules/registrations/bib-picture-frame";
import { COLOR } from "@/theme/brand";
import { brandFonts } from "@/theme/pdf/fonts";
import {
  type BadgeDesign,
  type BadgeLocale,
  type BadgeWords,
  badgeBandColour,
  badgeLabelText,
  badgeRoleColour,
  badgeRoleText,
  badgeTextOn,
} from "./badge-design";
import { BADGE_LAYOUT, type BadgeLayout, type BadgeTextLine, badgeImageSize, badgeLayout, badgeLineHeight } from "./badge-geometry";

/**
 * One volunteer badge as a picture (§764): **the paper `badges-pdf.ts` prints, at a screen's size**, the
 * bib's rule (§180, §338). Both draw `badgeLayout`'s points — this one multiplied by the picture's own
 * scale (`badgeImageSize`: the paper at 960 pixels across, whatever the size) — so the designer's preview
 * and the print section's pictures are previews of the sheet, never a card sized by eye. The logo is the
 * club's file as it is (`src/theme/pdf/logo.png`, blue on its own white ground, never recoloured); the
 * club's picture is handed in as an inline PNG by the route (`bib-pictures.ts`), because Satori reads no
 * WebP. Flexbox and absolute boxes only, the bundled Roboto.
 */

/** The paper's edge, drawn on the screen only: the printed badge has a dashed cut round it instead. */
const PAPER_EDGE = 2;

/** One picture as the renderer takes it: something `next/og` can load, and its size in pixels. */
export type BadgeImagePicture = { src: string; width: number; height: number };

export type BadgeImageInput = {
  design: BadgeDesign;
  locale: BadgeLocale;
  words: BadgeWords;
  /** The role's name in the badge's language and its colour; null draws a badge «fără rol». */
  role: { name: string; colour: string | null } | null;
  /** The header's picture as the route read it; null draws the band. */
  headerPicture?: BadgeImagePicture | null;
};

let logoDataUrl: Promise<string> | undefined;
/** The club's blue lockup on its white ground, the file the sheet embeds. */
function logo(): Promise<string> {
  logoDataUrl ??= readFile(path.join(process.cwd(), "src", "theme", "pdf", "logo.png")).then((buffer) => `data:image/png;base64,${buffer.toString("base64")}`);
  return logoDataUrl;
}

/** The badge's layout for this picture: the sheet's, with the same words and measure. */
export function badgeImageLayout(input: BadgeImageInput): BadgeLayout {
  const label = badgeLabelText(input.words.label, input.locale);
  return badgeLayout(
    { ...input.design, headerPicture: Boolean(input.headerPicture) },
    {
      title: input.words.title,
      label,
      role: input.role ? badgeRoleText(input.role.name, input.locale) : null,
      name: input.words.name,
      phone: input.words.phone,
      free: input.words.free,
      markerLabel: input.words.markerLabel,
    },
    { bold: bibTitleWidth, regular: bibFooterWidth },
  );
}

/**
 * The badge's markup at the sheet's points times `scale`: absolute boxes from the paper's top left — less
 * the drawn edge, as Satori places an absolute box inside a border. Exported so the test reads it.
 */
export function badgeMarkup(input: BadgeImageInput, logoSrc: string) {
  const { width, height, scale } = badgeImageSize(input.design);
  const px = (points: number) => points * scale;
  const layout = badgeImageLayout(input);
  const { content, pad } = layout;
  const band = badgeBandColour(input.design);
  const bandText = badgeTextOn(band);
  const roleColour = badgeRoleColour(input.role?.colour ?? null);
  const roleText = badgeTextOn(roleColour);
  const at = (left: number, top: number) => ({ position: "absolute", left: px(left) - PAPER_EDGE, top: px(top) - PAPER_EDGE }) as const;

  /** One line, never wrapped: centred in the band's width, or at `left`, or right-aligned on `right`. */
  const lineBox = (line: BadgeTextLine, colour: string, weight: 400 | 700, place: { centre: true } | { left: number } | { right: number }, testId: string) => {
    const common = {
      display: "flex",
      whiteSpace: "nowrap",
      overflow: "hidden",
      fontSize: px(line.size),
      fontWeight: weight,
      lineHeight: `${px(badgeLineHeight(line.size))}px`,
      color: colour,
    } as const;
    if ("centre" in place) {
      return (
        <div data-testid={testId} style={{ ...common, ...at(content.left + pad, line.top), width: px(content.width - 2 * pad), justifyContent: "center" }}>
          {line.text}
        </div>
      );
    }
    if ("left" in place) {
      return (
        <div data-testid={testId} style={{ ...common, ...at(place.left, line.top) }}>
          {line.text}
        </div>
      );
    }
    return (
      <div data-testid={testId} style={{ ...common, position: "absolute", top: px(line.top) - PAPER_EDGE, right: px(layout.paper.width - place.right) - PAPER_EDGE }}>
        {line.text}
      </div>
    );
  };

  /** One faint horizontal line, `width` points long, centred on `y`. */
  const hairline = (left: number, y: number, width: number, testId: string) => (
    <div
      data-testid={testId}
      style={{
        display: "flex",
        ...at(left, y - BADGE_LAYOUT.lineWeight / 2),
        width: px(width),
        height: Math.max(1, px(BADGE_LAYOUT.lineWeight)),
        background: COLOR.inkMuted,
        opacity: BADGE_LAYOUT.lineOpacity,
      }}
    />
  );

  const headerBox = { width: px(content.width), height: px(layout.header.height) };
  const picture = input.headerPicture ?? null;
  const drawing = picture
    ? pictureDrawingIn(
        headerBox,
        headerBox.width / headerBox.height,
        "cover",
        input.design.headerImageCrop,
        picture.width > 0 && picture.height > 0 ? { width: picture.width, height: picture.height } : null,
      )
    : null;

  return (
    <div
      style={{
        width,
        height,
        display: "flex",
        position: "relative",
        background: COLOR.surface,
        color: COLOR.ink,
        fontFamily: "Roboto, sans-serif",
        border: `${PAPER_EDGE}px solid ${COLOR.line}`,
      }}
    >
      {/* The header: the club's picture across the band, cropped by the bib's rule, or the band's colour. */}
      {picture && drawing ? (
        <div data-testid="badge-header-picture" style={{ display: "flex", overflow: "hidden", ...at(content.left, layout.header.top), ...headerBox }}>
          {drawing.kind === "crop" ? (
            // eslint-disable-next-line @next/next/no-img-element -- Satori draws it
            <img src={picture.src} alt="" width={drawing.width} height={drawing.height} style={{ position: "absolute", left: drawing.left, top: drawing.top, width: drawing.width, height: drawing.height }} />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element -- Satori draws it
            <img src={picture.src} alt="" width={headerBox.width} height={headerBox.height} style={{ objectFit: "cover" }} />
          )}
        </div>
      ) : (
        <div data-testid="badge-header-band" style={{ display: "flex", ...at(content.left, layout.header.top), ...headerBox, background: band }} />
      )}
      {layout.logo ? (
        // eslint-disable-next-line @next/next/no-img-element -- Satori draws the data URI
        <img
          src={logoSrc}
          alt=""
          data-testid="badge-logo"
          width={px(layout.logo.width)}
          height={px(layout.logo.height)}
          style={{ ...at(layout.logo.left, layout.logo.top), objectFit: "contain" }}
        />
      ) : null}
      {layout.title ? lineBox(layout.title, bandText, 700, { right: layout.title.right }, "badge-title") : null}
      {/* The role's band, «VOLUNTAR» small above the role's name — or alone and large on a badge «fără rol». */}
      <div data-testid="badge-role-band" style={{ display: "flex", ...at(content.left, layout.role.top), width: px(content.width), height: px(layout.role.height), background: roleColour }} />
      {layout.label ? lineBox(layout.label, roleText, 700, { centre: true }, "badge-label") : null}
      {lineBox(layout.roleLine, roleText, 700, { centre: true }, "badge-role")}
      {/* The free-text line (§776): the club's own words, small and centred under the role's band. */}
      {layout.freeLine ? lineBox(layout.freeLine, COLOR.ink, 400, { centre: true }, "badge-free") : null}
      {/* The writing area: «Nume:», and the faint line the name is written on in marker. */}
      {lineBox(layout.name, COLOR.inkMuted, 400, { left: layout.name.left }, "badge-name")}
      {layout.line ? hairline(layout.line.left, layout.line.y, layout.line.right - layout.line.left, "badge-line") : null}
      {/* «Spațiu pentru marker» (§776): a divider, the club's label and one faint line at the name's height. */}
      {layout.marker ? (
        <>
          <div
            data-testid="badge-divider"
            style={{
              display: "flex",
              ...at(layout.marker.divider.x - BADGE_LAYOUT.lineWeight / 2, layout.marker.divider.top),
              width: Math.max(1, px(BADGE_LAYOUT.lineWeight)),
              height: px(layout.marker.divider.bottom - layout.marker.divider.top),
              background: COLOR.inkMuted,
              opacity: BADGE_LAYOUT.lineOpacity,
            }}
          />
          {layout.marker.label ? lineBox(layout.marker.label, COLOR.inkMuted, 400, { left: layout.marker.label.left }, "badge-marker-label") : null}
          {hairline(layout.marker.line.left, layout.marker.line.y, layout.marker.line.right - layout.marker.line.left, "badge-marker-line")}
        </>
      ) : null}
      {layout.phoneLine ? lineBox(layout.phoneLine, COLOR.ink, 400, { centre: true }, "badge-phone") : null}
    </div>
  );
}

export async function renderBadgeImage(input: BadgeImageInput): Promise<ImageResponse> {
  const { width, height } = badgeImageSize(input.design);
  return new ImageResponse(badgeMarkup(input, await logo()), { width, height, fonts: await brandFonts() });
}
