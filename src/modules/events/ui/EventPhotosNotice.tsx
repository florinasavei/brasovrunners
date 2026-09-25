import Typography from "@mui/material/Typography";
import { getTranslations } from "next-intl/server";
import ContactLink from "@/shared/ui/ContactLink";
import LegalLink from "@/shared/ui/LegalLink";
import { DENSITY } from "@/theme/density";

/**
 * "A line on every event page about photographs" — the counsel review's photographs amendment
 * (§421): photographs are a legitimate-interest processing (§323), so the way to object is said where
 * they are taken, not only in the gallery (`Gallery.photosNotice`). Every event page — a race and
 * a group run alike — carries it near the facts, with a message (no reason asked) and a link to
 * the privacy notice that describes the processing.
 *
 * A Server Component, like `PartnerOverline` and `EventFacts` beside it: the links it renders are
 * made here, never handed to a client component as an element.
 */
export default async function EventPhotosNotice() {
  const t = await getTranslations("Event");
  return (
    <Typography variant="body2" color="text.secondary" sx={{ mt: 1, mb: { xs: DENSITY.gapSm, sm: 2 } }}>
      {t.rich("photosNotice", {
        contact: (chunks) => <ContactLink>{chunks}</ContactLink>,
        privacy: (chunks) => (
          <LegalLink href="/legal/privacy" newTabLabel={t("opensInNewTab")}>
            {chunks}
          </LegalLink>
        ),
      })}
    </Typography>
  );
}
