import { getTranslations } from "next-intl/server";
import type { PersonData } from "@/modules/registrations/person-data";
import { CLUB_NAME } from "@/theme/brand";

/**
 * What a volunteer said about themselves (§765) as «Toate datele unei persoane» lists it, after the organizers' note: the
 * age, the sex, the city, the two claims and the T-shirt's size, each only when the row holds it — every column of the
 * row, because a person may ask for all of it (art. 15 GDPR). The retired «Prefer să nu spun» and the kit's «Fără
 * tricou» read as no answer, as they do everywhere. Since §768 also the parent or guardian of a volunteer under eighteen — name,
 * address and whether they accepted, and how — the same row's data. A Server Component of its own so a test can draw the line without
 * the page's lookup.
 */
export default async function VolunteerAnswers({
  offer,
}: {
  offer: Pick<
    PersonData["volunteerOffers"][number],
    "age" | "sex" | "city" | "volunteeredBefore" | "clubMember" | "shirtSize" | "guardianName" | "guardianEmail" | "guardianAcceptedAt" | "guardianMethod"
  >;
}) {
  const t = await getTranslations("Admin");
  return (
    <>
      {offer.age !== null ? ` · ${t("volunteers.person.ageValue", { age: String(offer.age) })}` : ""}
      {offer.sex && offer.sex !== "UNSPECIFIED" ? ` · ${t(`registrations.answers.sex.${offer.sex}`)}` : ""}
      {offer.city ? ` · ${t("volunteers.person.cityValue", { city: offer.city })}` : ""}
      {offer.volunteeredBefore ? ` · ${t("volunteers.chips.before")}` : ""}
      {offer.clubMember ? ` · ${t("volunteers.chips.club", { club: CLUB_NAME })}` : ""}
      {offer.shirtSize && offer.shirtSize !== "NONE" ? ` · ${t("volunteers.person.shirtValue", { size: offer.shirtSize })}` : ""}
      {offer.guardianName ? ` · ${t("volunteers.person.guardianValue", { name: offer.guardianName })}` : ""}
      {offer.guardianName && offer.guardianEmail ? ` · ${offer.guardianEmail}` : ""}
      {offer.guardianName ? ` · ${offer.guardianAcceptedAt && offer.guardianMethod ? `${t("volunteers.guardian.accepted")} (${t(`volunteers.guardian.methods.${offer.guardianMethod}`)})` : t("volunteers.guardian.missing")}` : ""}
    </>
  );
}
