import Stack from "@mui/material/Stack";
import { getTranslations } from "next-intl/server";
import GlyphButton from "@/shared/ui/GlyphButton";
import InfoTip from "@/shared/ui/InfoTip";
import { givePlaceRefusalAhead } from "../give-place-tip";

/**
 * «Dă-i un loc», the submit of the form its page renders — on the registration's page and at the
 * desk (§67, BR-REQ-037-07). On a full race it stays visible and pressable, and an «i» beside it,
 * 44 px, says why the press will be refused and what to do first (§592): the refusal banner's own
 * sentence with the numbers read now, on hover, on keyboard focus and on a tap. With a place free
 * there is no «i». The server still refuses a full race whatever this says (§589, §10.6).
 */
export default async function GivePlaceButton({ eventId, size }: { eventId: string; size?: "small" | "medium" }) {
  const [why, t] = await Promise.all([givePlaceRefusalAhead(eventId), getTranslations("Admin")]);
  return (
    <Stack direction="row" spacing={0.5} sx={{ alignItems: "center" }}>
      <GlyphButton icon="place" type="submit" variant="outlined" size={size} sx={{ minHeight: 44 }}>
        {t("desk.givePlace")}
      </GlyphButton>
      {why && <InfoTip text={why} />}
    </Stack>
  );
}
