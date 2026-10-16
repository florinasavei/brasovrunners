import FamilyRestroomIcon from "@mui/icons-material/FamilyRestroom";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { getTranslations } from "next-intl/server";
import type { Locale } from "@/i18n/routing";
import { emailLeavesWords } from "@/modules/notifications/domain/email-wait";
import { shortScreenEmailLeft } from "@/modules/registrations/domain/family-sitting";
import DoneHeading from "@/shared/ui/DoneHeading";
import { StepItem, StepList } from "@/shared/ui/StepList";
import { VOLUNTEER_STEPS, volunteerStepWords, type VolunteerStepKey } from "./VolunteerSteps";

/**
 * What the browser that sent the offer remembers of it for ten minutes (`stashSubmittedFacts`, the registration's own sealed
 * cookie on this page's path): the first word of the name, the address the receipt went to, and when that email leaves — the
 * scheduled pass the action computed once when the form was sent (`leavesAt`; null: the request sends it) and when it was sent.
 * Never in the address (§14.5), and never read back from the database: the screen cannot say whether an address was already on the list.
 */
export type VolunteerSent = {
  firstName: string | null;
  email: string | null;
  /** When the receipt leaves; `null` when the request itself sends it (`immediate`); `undefined` when the browser kept no time. */
  leavesAt?: Date | null;
  submittedAt?: Date;
};

/** The steps still ahead of a person who has just sent the offer: the first one, the form, is behind them. */
const AHEAD: readonly VolunteerStepKey[] = ["email", "role", "day"];

/**
 * «Mulțumim, Ana!» — the screen after the volunteers' form (§NNN; the owner, 2026-10-16: «trebuie să îi spunem voluntarului care
 * sunt pașii și că urmează să îl aprobăm (similar cu flow-ul participanților)»), the registration's «Aproape gata, Ana!»
 * (`CheckYourEmail`) for a volunteer: the same green-disc heading (`DoneHeading`), the lead that names the event and its date, the
 * receipt email's leaving line in bold and then «Ce urmează» as a numbered list of glyphs (`StepList`), whose words are the steps'
 * of the form's page (`volunteerStepWords`) — one text, typed once.
 *
 * **It reads the same for a new person and for a repeat** (BR-REQ-031-01 criterion 3): everything on it comes from the form the
 * person just posted and the event they posted it to, never from the offers table.
 *
 * **The leaving line** is the registration's (`emailLeavesWords`, `shortScreenEmailLeft`): «pleacă acum» on the redirect from the
 * send, «pleacă la 10:15» when the club sends on the scheduler's tick, «a plecat» once that pass or a minute has gone — from the time
 * the action kept, never recomputed here. The volunteers' post cannot know its outbox row, so this is the time the pass was due, not the
 * row's state. Without what the browser kept (ten minutes, another browser) it says only that the email comes to the address written,
 * and promises no hour.
 *
 * Under eighteen (§768), where the club takes minors, the parent's consent email is the second item — before the organizers can
 * confirm anybody — in `doneGuardian`'s words, on the list's `volunteer-done-guardian` item.
 *
 * A Server Component: the glyphs are children here, never props to a client island.
 */
export default async function VolunteerDone({
  locale,
  eventTitle,
  when,
  sent,
  minors,
  contact,
}: {
  locale: Locale;
  eventTitle: string;
  /** The event's start in its own zone and the page's language, or null when the date is held back (§533). */
  when: string | null;
  sent: VolunteerSent | null;
  /** The club takes a person under eighteen (§768): the parent's consent is the second thing to come. */
  minors: boolean;
  /** Some category has a contact person (§774): the last item points to it. */
  contact: boolean;
}) {
  const t = await getTranslations("Event");
  const now = new Date();
  const firstName = sent?.firstName ?? null;
  const email = sent?.email ?? null;
  const submittedAt = sent?.submittedAt;
  let leaving: string;
  if (email && submittedAt && sent?.leavesAt !== undefined) {
    const leavesAt = sent.leavesAt;
    const leaves = emailLeavesWords(leavesAt, now, locale, "prose");
    leaving = shortScreenEmailLeft({ leavesAt, submittedAt, now })
      ? t("volunteers.doneLeft", { email })
      : leaves.key === "leavesNow"
        ? t("volunteers.doneLeavesNow", { email })
        : leaves.key === "leavesToday"
          ? t("volunteers.doneLeavesToday", { email, at: leaves.at })
          : t("volunteers.doneLeavesOn", { email, at: leaves.at });
  } else {
    leaving = t("volunteers.doneEmailPlain");
  }

  // The steps ahead, in the order they come; the parent's consent (second, where minors are taken) is not a step of the page's list, so it is drawn from its own words.
  const items: { key: string; title: string; body: string; testId?: string; Icon: (typeof VOLUNTEER_STEPS)[number]["Icon"] | typeof FamilyRestroomIcon }[] = [];
  for (const key of AHEAD) {
    // The minor's sentence is its own item below, not the role's body twice.
    const words = await volunteerStepWords(key, { minors: false, contact });
    const Icon = VOLUNTEER_STEPS.find((step) => step.key === key)!.Icon;
    items.push({ key, ...words, Icon });
    if (key === "email" && minors) {
      items.push({ key: "guardian", title: t("volunteers.doneGuardianTitle"), body: t("volunteers.doneGuardian"), testId: "volunteer-done-guardian", Icon: FamilyRestroomIcon });
    }
  }

  return (
    <Stack spacing={3} role="status" data-testid="volunteer-done" sx={{ mt: 1 }}>
      <Box>
        <DoneHeading>{firstName ? t("volunteers.doneHeadingNamed", { name: firstName }) : t("volunteers.doneHeading")}</DoneHeading>
        <Typography variant="body1" data-testid="volunteer-done-lead">
          {when ? t("volunteers.doneLead", { event: eventTitle, date: when }) : t("volunteers.doneLeadNoDate", { event: eventTitle })}
        </Typography>
        <Typography variant="body1" sx={{ mt: 0.5, fontWeight: 700 }} data-testid="volunteer-done-leaves">
          {leaving}
        </Typography>
      </Box>
      <Box component="section" aria-labelledby="volunteer-done-next" data-testid="volunteer-done-next">
        <Typography id="volunteer-done-next" component="h3" variant="h3" sx={{ fontSize: "1.125rem", mb: 1.5 }}>
          {t("volunteers.doneNextTitle")}
        </Typography>
        <StepList>
          {items.map(({ key, title, body, testId, Icon }, index) => (
            <StepItem
              key={key}
              testId={testId ?? `volunteer-done-${key}`}
              tone={index === 0 ? "primary" : "quiet"}
              icon={<Icon fontSize="small" />}
              title={`${index + 1}. ${title}`}
              body={body}
            />
          ))}
        </StepList>
      </Box>
    </Stack>
  );
}
