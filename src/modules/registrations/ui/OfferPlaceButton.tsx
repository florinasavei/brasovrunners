import Stack from "@mui/material/Stack";
import { getTranslations } from "next-intl/server";
import GlyphButton from "@/shared/ui/GlyphButton";
import InfoTip from "@/shared/ui/InfoTip";
import { givePlaceRefusalAhead } from "../give-place-tip";

/**
 * «Trimite-i oferta», the submit of the form its page renders — on each waiting row of «Coada de
 * înscrieri» and on the registration's own page, beside «Dă-i un loc» (§615). The same free-place
 * question as «Dă-i un loc» (`offerPlaceToByStaff` refuses a full event with §589's sentence), so the
 * same «i» says why before the press on a full event (§592), read once per event per request; with a
 * place free there is no «i». The server decides whatever this says. 44 pixels tall.
 */
export default async function OfferPlaceButton({ eventId, size }: { eventId: string; size?: "small" | "medium" }) {
  const [why, t] = await Promise.all([givePlaceRefusalAhead(eventId), getTranslations("Admin")]);
  return (
    <Stack direction="row" spacing={0.5} sx={{ alignItems: "center" }}>
      <GlyphButton icon="send" type="submit" variant="outlined" size={size} sx={{ minHeight: 44 }}>
        {t("desk.offerPlace")}
      </GlyphButton>
      {why && <InfoTip text={why} />}
    </Stack>
  );
}
