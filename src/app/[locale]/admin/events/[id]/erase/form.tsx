import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import { getTranslations } from "next-intl/server";
import { refusalMessages } from "@/shared/forms/refusal-messages";
import ActionForm from "@/shared/forms/ActionForm";
import RecallField, { NeverKeptField } from "@/shared/forms/recall";
import GlyphSubmitButton from "@/shared/ui/GlyphSubmitButton";
import { hardDeleteEventAction } from "../../../actions";

/**
 * The erase form (`DECISIONS.md` §114, §315): the event's title typed by hand, and a reason.
 *
 * A refusal — a mistyped title, most often — comes back with the reason still in its box and
 * the summary naming what was wrong. **The typed title never comes back**: it is the guard,
 * and a guard that fills itself in is no guard (`NEVER_KEPT`). A `NeverKeptField`, so that is
 * visible in the code and not only in the list — and so the summary's link reaches the box.
 */
export default async function EraseEventForm({ locale, eventId, expected }: { locale: string; eventId: string; expected: string }) {
  const t = await getTranslations("Admin");

  return (
    <ActionForm
      action={hardDeleteEventAction}
      messages={await refusalMessages(
        { typedTitle: t("erase.typeTitleLabel"), reason: t("erase.reasonLabel") },
        { confirmation: true },
      )}
      data-testid="erase-event-form"
    >
      <input type="hidden" name="uiLocale" value={locale} />
      <input type="hidden" name="eventId" value={eventId} />
      <Stack spacing={2}>
        <NeverKeptField
          name="typedTitle"
          label={t("erase.typeTitleLabel")}
          helperText={t("erase.typeTitleHelp", { title: expected })}
          required
          autoComplete="off"
          slotProps={{ htmlInput: { maxLength: 300 } }}
        />
        <RecallField
          name="reason"
          label={t("erase.reasonLabel")}
          helperText={t("erase.reasonHelp")}
          required
          slotProps={{ htmlInput: { minLength: 3, maxLength: 500 } }}
        />
        <Box>
          <GlyphSubmitButton
            icon="erase"
            label={t("erase.action")}
            pendingLabel={t("erase.action")}
            incompleteHintNamed={t("forms.incompleteFirst")}
            color="error"
            size="medium"
          />
        </Box>
      </Stack>
    </ActionForm>
  );
}
