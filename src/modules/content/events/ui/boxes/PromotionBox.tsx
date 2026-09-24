import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import { getTranslations } from "next-intl/server";
import CheckboxField from "@/shared/ui/CheckboxField";
import Panel from "@/shared/ui/Panel";
import { promotionSummary } from "../box-summaries";
import { BoxNote, type BoxProps, SettingsReadOnly, summaryWords } from "./box-kit";

/**
 * Box 13, "Evidențiere pe site" (§NNN): the two marks that make an event stand out — the site's
 * lead event, one at a time, and a special edition (§168), any number of them, on one date of a
 * series too.
 */
export default async function PromotionBox({ event, mayEditSettings }: BoxProps) {
  const t = await getTranslations("Admin");
  const { words } = await summaryWords();
  return (
    <Panel collapsible id="box-promotion" title={t("editor.boxes.promotion.title")} aside={promotionSummary(words, event)}>
      {mayEditSettings ? (
        <Stack spacing={1.5}>
          <Box>
            <CheckboxField name="event.featured" defaultChecked={event?.featured ?? false}>
              {t("editor.featured")}
            </CheckboxField>
            <BoxNote>{t("editor.featuredHelp")}</BoxNote>
          </Box>
          <Box>
            <CheckboxField name="event.isSpecial" defaultChecked={event?.isSpecial ?? false}>
              {t("editor.special")}
            </CheckboxField>
            <BoxNote>{t("editor.specialHelp")}</BoxNote>
          </Box>
        </Stack>
      ) : (
        <SettingsReadOnly />
      )}
    </Panel>
  );
}
