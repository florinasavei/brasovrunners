import { getTranslations } from "next-intl/server";
import type { TeamLinkKind } from "../links";

/**
 * Each kind of a person's link in the request's language (§NNN) — what a link the club gave no
 * label reads as on the card, and the words of the editor's kind select, from one place.
 */
export async function teamLinkKindWords(): Promise<Record<TeamLinkKind, string>> {
  const t = await getTranslations("Team");
  return {
    STRAVA: t("linkKinds.STRAVA"),
    INSTAGRAM: t("linkKinds.INSTAGRAM"),
    FACEBOOK: t("linkKinds.FACEBOOK"),
    WEBSITE: t("linkKinds.WEBSITE"),
    OTHER: t("linkKinds.OTHER"),
  };
}
