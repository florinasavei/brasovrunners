import { getTranslations } from "next-intl/server";
import type { PersonData } from "@/modules/registrations/person-data";
import { shownTypedDate } from "@/shared/forms/pickers/wall-values";
import { CLUB_NAME } from "@/theme/brand";

/**
 * What a volunteer said about themselves (§765) as «Toate datele unei persoane» lists it, after the organizers' note: the
 * age and — since §773 — the date of birth it was derived from, the sex, the city, the two claims and the T-shirt's size, each only when the row holds it — every column of the
 * row, because a person may ask for all of it (art. 15 GDPR). The retired «Prefer să nu spun» and the kit's «Fără
 * tricou» read as no answer, as they do everywhere. Since §768 also the parent or guardian of a volunteer under eighteen — name,
 * address and whether they accepted, and how — the same row's data. Since §NNN also «Pe lista publică», the person's tick for the event page's list. A Server Component of its own so a test can draw the line without
 * the page's lookup.
 */
export default async function VolunteerAnswers({
  offer,
}: {
  offer: Pick<
    PersonData["volunteerOffers"][number],
    "age" | "dateOfBirth" | "sex" | "city" | "volunteeredBefore" | "clubMember" | "shirtSize" | "guardianName" | "guardianEmail" | "guardianAcceptedAt" | "guardianMethod"
  > & {
    /** «Vreau să apar pe lista publică a voluntarilor» (§NNN): shown when the row holds it, like the claims — absent in a caller that predates it. */
    listOptIn?: boolean;
  };
}) {
  const t = await getTranslations("Admin");
  return (
    <>
      {offer.age !== null ? ` · ${t("volunteers.person.ageValue", { age: String(offer.age) })}` : ""}
      {/* The date of birth the age was derived from (§773), day first, beside it: a row from before has an age alone. */}
      {offer.dateOfBirth !== null ? ` · ${t("volunteers.person.birthDateValue", { date: shownTypedDate(offer.dateOfBirth) })}` : ""}
      {offer.sex && offer.sex !== "UNSPECIFIED" ? ` · ${t(`registrations.answers.sex.${offer.sex}`)}` : ""}
      {offer.city ? ` · ${t("volunteers.person.cityValue", { city: offer.city })}` : ""}
      {offer.volunteeredBefore ? ` · ${t("volunteers.chips.before")}` : ""}
      {offer.clubMember ? ` · ${t("volunteers.chips.club", { club: CLUB_NAME })}` : ""}
      {offer.listOptIn ? ` · ${t("volunteers.chips.onList")}` : ""}
      {offer.shirtSize && offer.shirtSize !== "NONE" ? ` · ${t("volunteers.person.shirtValue", { size: offer.shirtSize })}` : ""}
      {offer.guardianName ? ` · ${t("volunteers.person.guardianValue", { name: offer.guardianName })}` : ""}
      {offer.guardianName && offer.guardianEmail ? ` · ${offer.guardianEmail}` : ""}
      {offer.guardianName ? ` · ${offer.guardianAcceptedAt && offer.guardianMethod ? `${t("volunteers.guardian.accepted")} (${t(`volunteers.guardian.methods.${offer.guardianMethod}`)})` : t("volunteers.guardian.missing")}` : ""}
    </>
  );
}
