import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { getTranslations } from "next-intl/server";
import RecallField, { RecallCheckbox } from "@/shared/forms/recall";
import { TAP_TARGET } from "@/shared/ui/tap-target";
import { PARTNER_NAME_FIELD, PARTNER_NAME_MAX, PARTNER_TICK_FIELD } from "../partner-mark";

/** The one id of a page's suggestions: every box of the page names the same list. */
export const PARTNER_SUGGESTIONS_ID = "partner-suggestions";

/**
 * «E de la parteneri» and the box «Numele partenerului sau sponsorului» (the decision «De la parteneri»), inside a backoffice
 * form — the internal list's add and its line's fold, the registration's page. A Server Component of plain inputs that come
 * back as they were after a refusal (§315): the tick posts `partner=on`, the box `partnerName`. The box is what is stored; a
 * tick with the box empty is refused at the box by the server (`PARTNER_NAME_MISSING`), and unticking clears it. The box
 * suggests the event's earlier names from the page's one `<datalist>` (`PartnerSuggestionList`), as the sponsors' recipient
 * box does — no script.
 */
export default async function PartnerMarkFields({ name, testId = "partner-mark" }: { name: string | null; testId?: string }) {
  const t = await getTranslations("Admin");
  return (
    <Stack spacing={1} sx={{ width: "100%" }} data-testid={testId}>
      <Box component="label" sx={{ display: "flex", alignItems: "center", gap: 1.25, minHeight: TAP_TARGET.minHeight, cursor: "pointer" }}>
        <RecallCheckbox name={PARTNER_TICK_FIELD} defaultChecked={name !== null} style={{ width: 20, height: 20, flexShrink: 0 }} data-testid="partner-tick" />
        <Typography component="span" variant="body2">
          {t("partner.tick")}
        </Typography>
      </Box>
      <RecallField
        name={PARTNER_NAME_FIELD}
        label={t("partner.name")}
        helperText={t("partner.nameHelp")}
        defaultValue={name ?? ""}
        fullWidth
        size="small"
        slotProps={{ htmlInput: { maxLength: PARTNER_NAME_MAX, list: PARTNER_SUGGESTIONS_ID, autoComplete: "off", "data-testid": "partner-name" } }}
      />
    </Stack>
  );
}

/** The page's one list of the event's earlier partners' names, each once, newest first (`listPartnerSuggestions`). */
export function PartnerSuggestionList({ names }: { names: readonly string[] }) {
  return (
    <datalist id={PARTNER_SUGGESTIONS_ID} data-testid="partner-suggestions">
      {names.map((name) => (
        <option key={name} value={name} />
      ))}
    </datalist>
  );
}
