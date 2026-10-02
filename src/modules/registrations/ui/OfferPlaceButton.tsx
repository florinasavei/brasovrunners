import { getTranslations } from "next-intl/server";
import GlyphButton from "@/shared/ui/GlyphButton";

/**
 * «Trimite-i oferta», the submit of the form its page renders — on each waiting row of «Coada de
 * înscrieri» and on the registration's own page, beside «Dă-i un loc» (§615). Since §NNN a full event
 * does not refuse the press — it adds one supplementary place — so there is no «i» warning of a
 * refusal (`givePlaceRefusalAhead` stays «Dă-i un loc»'s); the dialog says what the press will do.
 * The server decides whatever this says. 44 pixels tall.
 */
export default async function OfferPlaceButton({ size }: { size?: "small" | "medium" }) {
  const t = await getTranslations("Admin");
  return (
    <GlyphButton icon="send" type="submit" variant="outlined" size={size} sx={{ minHeight: 44 }}>
      {t("desk.offerPlace")}
    </GlyphButton>
  );
}
