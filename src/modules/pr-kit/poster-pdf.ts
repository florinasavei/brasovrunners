import { CLUB_NAME, PALETTE, PR_KIT_COLOURS } from "@/theme/brand";
import { shownAddress } from "./domain/kit";
import { POSTER, POSTER_COLUMN, POSTER_FRAME, posterLayout } from "./domain/poster";
import { A4_MM, mm } from "./domain/sheets";
import { codeMatrix, drawCode, drawLogo, fittedSize, kitDocument, textLine, textWidth } from "./draw";
import { readLogoVector } from "./logo-vector";

/** The poster's words, in its language, from the catalogue (`Admin.prKit.poster.*`). */
export type PosterWords = { kicker: string; brand: string; lead: string; tab: string; scan: string };

/** Letter spacing, in millimetres: the big words drawn a little tighter, the tab and the hashtags a little looser. */
const SPACING = { kicker: -0.3, brand: -0.6 } as const;

/**
 * «Afiș YouTube» (§NNN): the owner's approved A4 poster of 2026-11-20, reproduced with pdfkit — the club's logo; «Suntem pe»
 * over YouTube's red play button beside «YouTube»; what the channel holds; the code to `CLUB_YOUTUBE_URL` in a white card
 * framed in the primary, «SCANEAZĂ-MĂ» on its top edge; how to scan it; the address without its scheme; the club's hashtags;
 * a rounded frame in the primary 7 mm in from the edge. Error correction Q, as the approved poster's: a poster on a wall gets
 * scuffed. The positions are `poster.ts`'s; the words are measured here with the font they are drawn in.
 */
export async function renderYoutubePoster(input: { url: string; words: PosterWords; hashtags: readonly string[]; generatedAt: Date }): Promise<Buffer> {
  const { words } = input;
  const vector = await readLogoVector("lockup", "primary");
  const { doc, finished } = await kitDocument({ title: `${CLUB_NAME} — YouTube`, generatedAt: input.generatedAt });
  const matrix = codeMatrix(input.url, "Q");
  const centre = A4_MM.width / 2;

  // «YouTube» as large as the column leaves it beside the button; the tab's word with its spacing.
  const brandRoom = POSTER_COLUMN.width - POSTER.brand.button.width - POSTER.brand.spacing;
  const brandSize = fittedSize(doc, words.brand, "bold", POSTER.brand.size, brandRoom, SPACING.brand);
  const lead = wrap(doc, words.lead, POSTER.lead.size, POSTER.lead.width);
  const layout = posterLayout({
    modules: matrix.size,
    leadLines: lead.length,
    logoAspect: vector.aspect,
    brandWordWidth: textWidth(doc, words.brand, "bold", brandSize, SPACING.brand),
    tabTextWidth: textWidth(doc, words.tab, "bold", POSTER.tab.size, POSTER.tab.letterSpacing),
  });

  // The frame, its line drawn along its middle: the outer corner 9 mm round.
  doc
    .roundedRect(mm(layout.frame.x), mm(layout.frame.y), mm(layout.frame.width), mm(layout.frame.height), mm(POSTER_FRAME.radius - POSTER_FRAME.stroke / 2))
    .lineWidth(mm(POSTER_FRAME.stroke))
    .stroke(PALETTE.primary);

  drawLogo(doc, vector, layout.logo, PALETTE.primary);
  textLine(doc, words.kicker, { font: "bold", size: layout.kicker.size, baseline: layout.kicker.baseline, colour: PALETTE.kit.deep, centre, characterSpacing: SPACING.kicker });

  // YouTube's play button, in YouTube's own colours.
  const { button, triangle } = layout;
  doc.roundedRect(mm(button.x), mm(button.y), mm(button.width), mm(button.height), mm(POSTER.brand.button.radius)).fill(PR_KIT_COLOURS.youtubeRed);
  doc
    .polygon([mm(triangle.x), mm(triangle.y)], [mm(triangle.x + triangle.width), mm(triangle.y + triangle.height / 2)], [mm(triangle.x), mm(triangle.y + triangle.height)])
    .fill(PR_KIT_COLOURS.youtubePlay);
  textLine(doc, words.brand, { font: "bold", size: brandSize, baseline: layout.word.baseline, colour: PALETTE.kit.deep, left: layout.word.x, characterSpacing: SPACING.brand });

  lead.forEach((text, index) => {
    textLine(doc, text, { font: "bold", size: layout.lead.size, baseline: layout.lead.firstBaseline + index * layout.lead.lineHeight, colour: PALETTE.primaryInk, centre });
  });

  // The card: white inside, its border in the primary, drawn along the border's middle.
  const { card } = layout;
  const half = POSTER.card.border / 2;
  doc
    .roundedRect(mm(card.x + half), mm(card.y + half), mm(card.width - POSTER.card.border), mm(card.height - POSTER.card.border), mm(POSTER.card.radius - half))
    .lineWidth(mm(POSTER.card.border))
    .fillAndStroke(PR_KIT_COLOURS.paper, PALETTE.primary);
  doc.roundedRect(mm(layout.tab.box.x), mm(layout.tab.box.y), mm(layout.tab.box.width), mm(layout.tab.box.height), mm(POSTER.tab.radius)).fill(PALETTE.primary);
  textLine(doc, words.tab, { font: "bold", size: layout.tab.size, baseline: layout.tab.baseline, colour: PR_KIT_COLOURS.paper, centre, characterSpacing: POSTER.tab.letterSpacing });
  drawCode(doc, matrix, layout.code, PR_KIT_COLOURS.code);

  const scanSize = fittedSize(doc, words.scan, "bold", layout.scan.size, POSTER_COLUMN.width);
  textLine(doc, words.scan, { font: "bold", size: scanSize, baseline: layout.scan.baseline, colour: PALETTE.kit.deep, centre });
  const address = shownAddress(input.url);
  textLine(doc, address, { font: "bold", size: fittedSize(doc, address, "bold", layout.address.size, POSTER_COLUMN.width), baseline: layout.address.baseline, colour: PALETTE.primary, centre });
  const tags = input.hashtags.join(" · ");
  if (tags !== "") {
    const tagsSize = fittedSize(doc, tags, "bold", layout.tags.size, POSTER_COLUMN.width, POSTER.tags.letterSpacing);
    textLine(doc, tags, { font: "bold", size: tagsSize, baseline: layout.tags.baseline, colour: PALETTE.accent, centre, characterSpacing: POSTER.tags.letterSpacing });
  }

  doc.end();
  return finished;
}

/** The lead's words in lines no wider than `width` millimetres, word by word: pdfkit's own wrapping would start pages. */
function wrap(doc: PDFKit.PDFDocument, text: string, size: number, width: number): string[] {
  const lines: string[] = [];
  let current = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const candidate = current === "" ? word : `${current} ${word}`;
    if (current !== "" && textWidth(doc, candidate, "bold", size) > width) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current !== "") lines.push(current);
  return lines;
}
