import { NextResponse } from "next/server";
import { isStickerSheetKey, stickerFileName } from "@/modules/pr-kit/domain/kit";
import { kitDownload, refusePrKit } from "@/modules/pr-kit/http";
import { renderStickerSheet } from "@/modules/pr-kit/stickers-pdf";
import { env } from "@/shared/config/env";

/**
 * «PR Kit» → «Autocolante» (§NNN): one A4 sheet of stickers as a PDF, drawn on request — `GET /api/admin/pr-kit/stickers/qr-12`
 * (and `qr-24`, `logo-12`, `logo-24`, `logo-40`, `logo-12-primary`). The two with a code point it at this site, from
 * `APP_BASE_URL` (AGENTS.md §8) — production's stickers at production, QA's at QA. Any other sheet is not found.
 *
 * Every backoffice role, the volunteers included (`refusePrKit`); a GET that writes nothing.
 */
export async function GET(_request: Request, context: { params: Promise<{ sheet: string }> }): Promise<Response> {
  const refused = await refusePrKit();
  if (refused) return refused;
  const { sheet } = await context.params;
  if (!isStickerSheetKey(sheet)) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  const pdf = await renderStickerSheet({ sheet, siteUrl: env.APP_BASE_URL, generatedAt: new Date() });
  return kitDownload(pdf, "application/pdf", stickerFileName(sheet));
}
