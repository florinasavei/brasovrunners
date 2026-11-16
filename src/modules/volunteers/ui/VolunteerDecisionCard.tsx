import Stack from "@mui/material/Stack";
import { getTranslations } from "next-intl/server";
import ActionForm, { type ActionFormAction } from "@/shared/forms/ActionForm";
import RecallField from "@/shared/forms/recall";
import { refusalMessages } from "@/shared/forms/refusal-messages";
import GlyphButton from "@/shared/ui/GlyphButton";
import Panel from "@/shared/ui/Panel";
import { VOLUNTEER_DECISION_MAX } from "../domain/volunteer";
import type { VolunteerItem } from "../volunteers";

/** The card's address on a volunteer's page: where the «Voluntari» list's press goes when the browser runs no script. */
export const DECISION_ANCHOR = "decizie-ziua-cursei";

/**
 * «Decizie pentru ziua cursei» on a volunteer's page (§954; the owner, 2026-11-16: «si la voluntar trebuie sa am si decizie pt
 * ziua cursei»): the one short line in which the organizers write what THEY decided for the person on race day — «vine la 8:00
 * la start», «rezervă» — in the organizers' part of the page, beside their notes and before the person's own block, because it
 * is no answer of the person's. Not a note either: there is one line, and saving replaces it.
 *
 * An open card, never a fold: the «Voluntari» list's press lands here when the browser runs no script, and the form must be
 * standing. The box opens on the line as it stands; saved empty, it clears it. The form is the list's dialog's own — the same
 * action, handed in by the page, which asks the role and comes back to `returnTo` — a refusal comes back as the form's state,
 * the words still in the box (§315), with JavaScript off too.
 *
 * A presentation of one line and a form: no query and no role test. The page that draws it is for whoever works the
 * volunteers, and the service asserts the role again (BR-REQ-060-01). Which files may name the line is
 * `tests/unit/volunteers/decision-never-leaves.test.ts`.
 */
export default async function VolunteerDecisionCard({
  locale,
  person,
  returnTo,
  action,
}: {
  locale: string;
  person: Pick<VolunteerItem, "id" | "eventId" | "raceDayDecision">;
  /** Where a save comes back to: the person's own page — a path of the «Voluntari» screen, the only kind the action follows. */
  returnTo: string;
  action: ActionFormAction;
}) {
  const t = await getTranslations("Admin");
  const refusal = await refusalMessages({ decision: t("volunteers.decision.label") });
  return (
    <Panel glyph="raceDay" level={3} title={t("volunteers.decision.label")} intro={t("volunteers.decision.help")} id={DECISION_ANCHOR} data-testid="volunteer-decision-card">
      <ActionForm action={action} messages={refusal} scope="decision" data-testid="volunteer-decision-form">
        <input type="hidden" name="uiLocale" value={locale} />
        <input type="hidden" name="eventId" value={person.eventId} />
        <input type="hidden" name="volunteerId" value={person.id} />
        <input type="hidden" name="returnTo" value={returnTo} />
        <Stack spacing={1.5} sx={{ alignItems: "flex-start" }}>
          <RecallField
            name="decision"
            label={t("volunteers.decision.label")}
            multiline
            minRows={2}
            fullWidth
            defaultValue={person.raceDayDecision ?? ""}
            helperText={t("volunteers.decision.limit", { max: VOLUNTEER_DECISION_MAX })}
            slotProps={{ htmlInput: { maxLength: VOLUNTEER_DECISION_MAX } }}
          />
          <GlyphButton icon="save" type="submit" variant="contained" sx={{ minHeight: 44 }}>
            {t("volunteers.save")}
          </GlyphButton>
        </Stack>
      </ActionForm>
    </Panel>
  );
}
