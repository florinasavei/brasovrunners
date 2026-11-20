import { CLUB_NAME } from "@/theme/brand";
import { LOGO_INK_HEX, type LogoInk, type LogoShape } from "./domain/kit";
import { mm } from "./domain/sheets";
import { drawLogo, kitDocument } from "./draw";
import { readLogoVector } from "./logo-vector";

/**
 * The logo as a vector PDF (§1015): one page exactly the size of the kit's SVG — 200 mm wide, as tall as its frame — and on it
 * the SVG's own paths, drawn by pdfkit's `doc.path()` under the file's translation, in the ink's colour, the margin around the
 * drawing kept. Nothing else on the page and no background: a print shop places it as it would the SVG. The white one is white
 * on a white page — it is meant for a dark ground.
 */
export async function renderLogoPdf(input: { shape: LogoShape; ink: LogoInk; generatedAt: Date }): Promise<Buffer> {
  const vector = await readLogoVector(input.shape, input.ink);
  const { doc, finished } = await kitDocument({ title: `${CLUB_NAME} — ${input.shape} (${input.ink})`, generatedAt: input.generatedAt }, [mm(vector.widthMm), mm(vector.heightMm)]);
  // The page is the frame at its written size, so the drawing sits where the SVG puts it: the frame's margin around it.
  const unit = vector.widthMm / vector.frame.width;
  drawLogo(
    doc,
    vector,
    { x: (vector.drawing.x - vector.frame.x) * unit, y: (vector.drawing.y - vector.frame.y) * unit, width: vector.drawing.width * unit, height: vector.drawing.height * unit },
    LOGO_INK_HEX[input.ink],
  );
  doc.end();
  return finished;
}
