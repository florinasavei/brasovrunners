import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import { getLocale, getTranslations } from "next-intl/server";
import { yearsPhrase } from "@/modules/registrations/domain/age";
import { type EventType, publicAgeRule } from "../domain/event-type";

/**
 * Who may take part, by age, inside the event page's «Condiții de participare» fold (§498), after
 * the rules and before the photographs notice (§505). The minimum age is set in the editor's
 * «Regulamentul» for every type, so the page says it where the rules are read — no longer as a
 * «Vârstă» row of the facts (§329, §410).
 *
 * The sentence is `publicAgeRule`'s: where the club takes the registrations, the form's own
 * sentence (the page and the form cannot disagree); anywhere else the minimum with the parent's
 * consent below eighteen; nothing for no minimum where nobody registers here. A `h3` like the
 * fold's other parts, so it stays in a screen reader's list of headings. A Server Component.
 */
export default async function EventAgeRule({
  event,
}: {
  event: { type: EventType; registrationMode: "NONE" | "INTERNAL" | "EXTERNAL"; minAge: number };
}) {
  const variant = publicAgeRule(event);
  if (!variant) return null;
  const [t, rt, locale] = await Promise.all([getTranslations("Event"), getTranslations("Registration"), getLocale()]);
  return (
    <Box component="section" id="age" aria-labelledby="age-title" data-testid="conditions-age" sx={{ mt: 1 }}>
      <Typography component="h3" id="age-title" variant="h3" sx={{ fontSize: "1.0625rem", mb: 0.5 }}>
        {t("age")}
      </Typography>
      <Typography variant="body1" sx={{ m: 0 }}>
        {rt(`ageRule.${variant}`, { age: yearsPhrase(event.minAge, locale) })}
      </Typography>
    </Box>
  );
}
