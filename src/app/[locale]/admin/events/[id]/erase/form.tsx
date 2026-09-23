import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import { getTranslations } from "next-intl/server";
import { refusalMessages } from "@/modules/staff-identity/ui/refusal-messages";
import ActionForm from "@/shared/forms/ActionForm";
import RecallField from "@/shared/forms/recall";
import SubmitButton from "@/shared/ui/SubmitButton";
import { hardDeleteEventAction } from "../../../actions";

/**
 * The erase form (`DECISIONS.md` §114, §305): the event's title typed by hand, and a reason.
 *
 * A refusal — a mistyped title, most often — comes back with the reason still in its box and
 * the summary naming what was wrong. **The typed title never comes back**: it is the guard,
 * and a guard that fills itself in is no guard (`NEVER_KEPT`). A plain `TextField`, so that
 * is visible in the code and not only in the list.
 */
export default async function EraseEventForm({ locale, eventId, expected }: { locale: string; eventId: string; expected: string }) {
  const t = await getTranslations("Admin");

  return (
    <ActionForm
      action={hardDeleteEventAction}
      messages={await refusalMessages({ typedTitle: t("erase.typeTitleLabel"), reason: t("erase.reasonLabel") })}
      data-testid="erase-event-form"
    >
      <input type="hidden" name="uiLocale" value={locale} />
      <input type="hidden" name="eventId" value={eventId} />
      <Stack spacing={2}>
        <TextField
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
          <SubmitButton
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
