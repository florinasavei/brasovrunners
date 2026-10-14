import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import { getTranslations } from "next-intl/server";
import CheckboxField from "@/shared/ui/CheckboxField";
import Panel from "@/shared/ui/Panel";
import { promotionSummary } from "../box-summaries";
import { BoxNote, type BoxProps, summaryWords } from "./box-kit";

/**
 * «Evidențiere pe site» (§350): the two marks that make an event stand out — the site's lead event,
 * one at a time, and a special edition (§168), any number of them, on one date of a series too.
 *
 * A named card inside card 1 «Ce fel de eveniment» since §NNN (the owner, 2026-10-13: «„evidențierea
 * pe site” ar putea fi în același card cu „ce fel de eveniment”… nu trebuie să fie un card separat»):
 * what kind of event it is and how the site marks it, read together. It was a card of its own among
 * those not on the page (§406). The same two ticks, the same names, the same id `#box-promotion`, so a
 * deep link or a refusal still lands on it. Closed, its line says the marks; for a role that may only
 * read the settings it is its heading and its line, as the status and the declaration cards are —
 * the first card already says once that the settings are not theirs.
 */
export default async function PromotionBox({ event, mayEditSettings }: BoxProps) {
  const t = await getTranslations("Admin");
  const { words } = await summaryWords();
  const card = {
    id: "box-promotion",
    glyph: "promotion",
    level: 3,
    title: t("editor.boxes.promotion.title"),
    aside: promotionSummary(words, event),
  } as const;
  if (!mayEditSettings) return <Panel {...card} />;
  return (
    <Panel collapsible {...card}>
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
    </Panel>
  );
}
