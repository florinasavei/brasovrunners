import Typography from "@mui/material/Typography";
import { getTranslations } from "next-intl/server";
import type { RegistrationSex, RegistrationTshirtSize } from "@/db/schema/registrations";
import { shirtSizeShown } from "../domain/kit";
import { sexShown } from "../domain/sex";

/**
 * One line of the backoffice registration page (§NNN): «Sex: Masculin», or «Sex: —» for no answer —
 * a paper entry left blank, or the retired «Prefer să nu spun» of a row stored before it went — and
 * «· Tricou: M» only for an event that gives a T-shirt («Kit de participare»).
 */
export default async function SexAndShirtLine({
  sex,
  tshirtSize,
  kitShirt,
}: {
  sex: RegistrationSex | null;
  tshirtSize: RegistrationTshirtSize | null;
  kitShirt: boolean;
}) {
  const t = await getTranslations("Admin");
  const answer = sexShown(sex);
  const shirt = shirtSizeShown(kitShirt, tshirtSize);
  return (
    <Typography variant="body2" color="text.secondary" data-testid="registration-sex-shirt">
      {t("registrations.sexLine", { sex: answer ? t(`registrations.sexOptions.${answer}`) : "—" })}
      {shirt && ` · ${t("registrations.shirtLine", { size: shirt })}`}
    </Typography>
  );
}
