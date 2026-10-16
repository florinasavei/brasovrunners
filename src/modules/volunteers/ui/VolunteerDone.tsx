import FamilyRestroomIcon from "@mui/icons-material/FamilyRestroom";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { getTranslations } from "next-intl/server";
import DoneHeading from "@/shared/ui/DoneHeading";
import { StepItem, StepList } from "@/shared/ui/StepList";
import { VOLUNTEER_STEPS, volunteerStepWords, type VolunteerStepKey } from "./VolunteerSteps";

/**
 * What the browser that sent the offer remembers of it for ten minutes (`stashSubmittedFacts`, the registration's sealed facts
 * cookie on this page's path, never in the URL, §14.5): the first word of the name and the address typed. Never read back from the
 * database: the screen cannot say whether an address was already on the list, so it says nothing of the email's hour or state.
 */
export type VolunteerSent = {
  firstName: string | null;
  email: string | null;
};

/** The steps still ahead of a person who has just sent the offer: the first one, the form, is behind them. */
const AHEAD: readonly VolunteerStepKey[] = ["email", "role", "day"];

/**
 * «Mulțumim, Ana!» — the screen after the volunteers' form (§800; the owner, 2026-10-16: «trebuie să îi spunem voluntarului care
 * sunt pașii și că urmează să îl aprobăm (similar cu flow-ul participanților)»), the registration's «Aproape gata, Ana!»
 * (`CheckYourEmail`) for a volunteer: the same green-disc heading (`DoneHeading`), the lead that names the event and its date, the
 * receipt email's line in bold and then «Ce urmează» as a list of glyphs (`StepList`, no numbers, as the registration's), whose words are
 * the steps' of the form's page (`volunteerStepWords`) — one text, typed once.
 *
 * **It reads the same for a new person and for a repeat** (BR-REQ-031-01 criterion 3): everything on it comes from the form the
 * person just posted and the event they posted it to, never from the offers table.
 *
 * **The email line** is one sentence that is true for every outcome of the post: the receipt comes to the address typed — and
 * whoever already sent an offer for this event has the first receipt. It names no hour and no state («pleacă acum», «a plecat»): a
 * repeat of the same person, the loser of a race and a honeypot hit queue no email, and the post cannot read its outbox row. Without
 * what the browser kept (ten minutes, another browser) it says the same of «the address you wrote».
 *
 * Under eighteen (§768), where the club takes minors, the parent's consent email is the second item — before the organizers can
 * confirm anybody — in `doneGuardian`'s words, on the list's `volunteer-done-guardian` item. The last item points to the contact
 * person in the receipt email, never «below»: the categories are not on this page.
 *
 * A Server Component: the glyphs are children here, never props to a client island.
 */
export default async function VolunteerDone({
  eventTitle,
  when,
  sent,
  minors,
  contact,
}: {
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
  const firstName = sent?.firstName ?? null;
  const email = sent?.email ?? null;
  const emailLine = email ? t("volunteers.doneEmail", { email }) : t("volunteers.doneEmailPlain");

  // The steps ahead, in the order they come; the parent's consent (second, where minors are taken) is not a step of the page's list, so it is drawn from its own words.
  const items: { key: string; title: string; body: string; testId?: string; Icon: (typeof VOLUNTEER_STEPS)[number]["Icon"] | typeof FamilyRestroomIcon }[] = [];
  for (const key of AHEAD) {
    // The minor's sentence is its own item below, not the role's body twice.
    const words = await volunteerStepWords(key, { minors: false, contact, where: "done" });
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
        <Typography variant="body1" sx={{ mt: 0.5, fontWeight: 700 }} data-testid="volunteer-done-email-line">
          {emailLine}
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
              title={title}
              body={body}
            />
          ))}
        </StepList>
      </Box>
    </Stack>
  );
}
