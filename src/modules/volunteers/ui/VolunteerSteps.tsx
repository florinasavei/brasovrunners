import EventAvailableIcon from "@mui/icons-material/EventAvailable";
import AssignmentIndIcon from "@mui/icons-material/AssignmentInd";
import FormatListNumberedIcon from "@mui/icons-material/FormatListNumbered";
import MarkEmailReadIcon from "@mui/icons-material/MarkEmailRead";
import PersonAddIcon from "@mui/icons-material/PersonAdd";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import { getTranslations } from "next-intl/server";
import { DISCLOSURE_OPEN_ARROW, DISCLOSURE_SUMMARY_SX, FOLD_GLYPH_SX } from "@/shared/ui/disclosure";
import { StepItem, StepList } from "@/shared/ui/StepList";

/**
 * The four steps, in the order a volunteer lives them. `Icon` is a rendered glyph's component between two Server Components,
 * never a prop of a client island (`GlyphChip.tsx`).
 */
export const VOLUNTEER_STEPS = [
  { key: "form", Icon: PersonAddIcon },
  { key: "email", Icon: MarkEmailReadIcon },
  { key: "role", Icon: AssignmentIndIcon },
  { key: "day", Icon: EventAvailableIcon },
] as const;
export type VolunteerStepKey = (typeof VOLUNTEER_STEPS)[number]["key"];

/**
 * The words of one step, in the page's language: the same keys the volunteers' thank-you screen draws under «Ce urmează»
 * (`VolunteerDone`), so the steps before the form and the list after it are one text, typed once.
 *
 * - The third step adds the minor's sentence (`volunteers.doneGuardian`, the very words of the thank-you) only where the club
 *   takes minors (`minors`, §768) — the notice and the agreement in force describe them; where it does not, the page does not
 *   speak of a parent.
 * - The last step points to the contact person written under the categories (§774) only when some category has one. On the form
 *   (`where: "form"`) it says where: «scrisă la categoria rolului, mai jos»; on the thank-you (`"done"`) the categories are gone
 *   from the page, so it points to the receipt email, which carries the contacts of the ticked roles' categories.
 */
export async function volunteerStepWords(
  key: VolunteerStepKey,
  { minors, contact, where = "form" }: { minors: boolean; contact: boolean; where?: "form" | "done" },
): Promise<{ title: string; body: string }> {
  const t = await getTranslations("Event");
  const title = t(`volunteers.steps.${key}.title`);
  if (key === "role") {
    const body = t("volunteers.steps.role.body");
    return { title, body: minors ? `${body} ${t("volunteers.doneGuardian")}` : body };
  }
  if (key === "day") {
    return { title, body: contact ? t(where === "done" ? "volunteers.steps.day.bodyContactDone" : "volunteers.steps.day.bodyContact") : t("volunteers.steps.day.body") };
  }
  return { title, body: t(`volunteers.steps.${key}.body`) };
}

/**
 * «Cum funcționează voluntariatul» — what happens between the form and the day, in four steps with a glyph each (§800; the owner,
 * 2026-10-16: «trebuie să îi spunem voluntarului care sunt pașii și că urmează să îl aprobăm (similar cu flow-ul participanților)»).
 * The shape is the registration's (`RegistrationSteps`, §91): the same `StepList`, and, `folded`, the same `<details>` with the
 * house's fold look — closed, a numbered-list glyph and the title in its summary — the way the register page draws them.
 *
 * It names no deadline and no number: a volunteer owes nothing between the form and the role, and the organizers' own hours are
 * theirs to tell. Server Component with no state and no read: it works with scripts off, and costs a visitor no database.
 */
export default async function VolunteerSteps({
  folded = false,
  minors,
  contact,
}: {
  folded?: boolean;
  /** The club takes a person under eighteen (§768): the third step adds the parent's consent that comes first. */
  minors: boolean;
  /** Some category of the event has a contact person (§774): the last step points to it. */
  contact: boolean;
}) {
  const t = await getTranslations("Event");
  const steps = await Promise.all(VOLUNTEER_STEPS.map(async ({ key }) => volunteerStepWords(key, { minors, contact })));
  const list = (
    <StepList>
      {VOLUNTEER_STEPS.map(({ key, Icon }, index) => (
        <StepItem key={key} testId={`volunteer-step-${key}`} icon={<Icon fontSize="small" />} title={`${index + 1}. ${steps[index].title}`} body={steps[index].body} />
      ))}
    </StepList>
  );

  if (!folded) {
    return (
      <Box component="section" aria-labelledby="volunteer-steps-title" data-testid="volunteer-steps">
        <Typography id="volunteer-steps-title" component="h2" variant="h2" sx={{ fontSize: "1.125rem", mb: 1.5 }}>
          {t("volunteers.steps.title")}
        </Typography>
        {list}
      </Box>
    );
  }

  return (
    <Box
      component="details"
      data-testid="volunteer-steps"
      sx={{
        border: 1,
        borderColor: "divider",
        borderRadius: 1,
        px: 2,
        "& > summary": { ...DISCLOSURE_SUMMARY_SX, py: 1.5, fontWeight: 600 },
        ...DISCLOSURE_OPEN_ARROW,
      }}
    >
      <Typography component="summary" variant="body1" data-testid="volunteer-steps-summary">
        <FormatListNumberedIcon aria-hidden sx={FOLD_GLYPH_SX} />
        {/* The summary says the one fact a visitor wants before the form — that the organizers confirm — with the fold closed. */}
        {t("volunteers.steps.summary")}
      </Typography>
      <Box sx={{ pb: 2 }}>{list}</Box>
    </Box>
  );
}
