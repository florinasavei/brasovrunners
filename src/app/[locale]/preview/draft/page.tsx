import Container from "@mui/material/Container";
import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { routing } from "@/i18n/routing";
import EventDraftFrame from "@/modules/content/events/ui/EventDraftFrame";
import { canPreviewEventDraft } from "@/modules/staff-identity/domain/roles";
import { getCurrentStaffUser } from "@/modules/staff-identity/session";
import { PAGE_WIDTH } from "@/theme/brand";
import { DENSITY } from "@/theme/density";
import { previewEventDraftAction } from "../../admin/actions";

type Props = { params: Promise<{ locale: string }> };

export const dynamic = "force-dynamic";

/** Never indexed (BR-REQ-051-02 criterion 2), like the saved draft's preview beside it. */
export const metadata: Metadata = { robots: { index: false, follow: false, nocache: true } };

/**
 * The site's header and footer, out of the frame: the editor's preview shows the card or the page,
 * not the site around them twice. By the frame's own mark, so no other page is touched.
 */
const FRAME_ONLY_CSS = "body:has(#draft-preview-frame) :is(header, footer):not(#draft-preview-frame *) { display: none !important; }";

/**
 * **The frame of the editor's «Previzualizare» (§579)**, in the language of its address: the site's
 * own layout — theme, fonts, the public words in this language — at the width the editor gives the
 * frame (360 pixels, or a desktop's, scaled down to fit), so the card, the page and the registration
 * form (§586) are drawn with the breakpoints a visitor's screen has. It holds no data: the editor
 * posts its unsaved values into it, and `previewEventDraftAction` answers with the three.
 *
 * Staff only, and only the roles that may preview (`canPreviewEventDraft`), asserted here and again
 * in the action (BR-REQ-060-01) — anybody else meets the 404 an unknown address gets. Under
 * `/preview`, which the proxy serves `private, no-store` and `noindex` (`private-paths.ts`) and
 * `robots.txt` disallows: never a public route, never a cached page.
 */
export default async function DraftPreviewFramePage({ params }: Props) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const staffUser = await getCurrentStaffUser();
  if (!staffUser || !canPreviewEventDraft(staffUser.role)) notFound();

  return (
    <>
      <style>{FRAME_ONLY_CSS}</style>
      {/* The listing's and the event page's own container, so both are drawn at their widths. */}
      <Container id="main" component="main" maxWidth={PAGE_WIDTH} sx={{ py: { xs: DENSITY.pagePadY, sm: 3 } }}>
        <EventDraftFrame action={previewEventDraftAction} locale={locale} />
      </Container>
    </>
  );
}
