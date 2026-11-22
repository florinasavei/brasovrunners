import { readFile } from "node:fs/promises";
import { NextResponse } from "next/server";
import { parseLogoFile } from "@/modules/pr-kit/domain/kit";
import { kitDownload, refusePrKit } from "@/modules/pr-kit/http";
import { renderLogoPdf } from "@/modules/pr-kit/logo-pdf";
import { kitFilePath } from "@/modules/pr-kit/logo-vector";

/**
 * «PR Kit» → «Logo» (§1015): one logo file, by its own name — `GET /api/admin/pr-kit/logo/<slug>-logo-primary.svg`, `…-4000px.png`
 * or `….pdf`, the lockup or the mountains, in the primary, white or black — the white also `-on-primary` (§1046). The SVG and the PNG are the files `yarn brand:assets`
 * wrote (`public/brand/kit/`), handed out as they are; the PDF is drawn here from the same SVG's paths (`logo-pdf.ts`). Any other
 * name is not found — the name is matched whole against the kit's list, so it never reaches the disk as a path.
 *
 * Every backoffice role, the volunteers included (`refusePrKit`); a GET that writes nothing. **The SVG and the PNG are public
 * files all the same** — the club's public logo, which the page's tiles read straight from `/brand/kit/` and anybody can fetch
 * without signing in — so for them this route only makes the download an attachment under its slug name; what the role guards
 * is the PDF drawn on request.
 */
export async function GET(_request: Request, context: { params: Promise<{ file: string }> }): Promise<Response> {
  const refused = await refusePrKit();
  if (refused) return refused;
  const { file } = await context.params;
  const named = parseLogoFile(file);
  if (!named) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  if (named.format === "pdf") return kitDownload(await renderLogoPdf({ shape: named.shape, ink: named.ink, ground: named.ground, generatedAt: new Date() }), "application/pdf", file);
  return kitDownload(await readFile(kitFilePath(file)), named.format === "svg" ? "image/svg+xml" : "image/png", file);
}
