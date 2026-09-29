import { getTranslations } from "next-intl/server";
import type { TeamLinkKind } from "../links";

/** Each link kind's word in the request's language (§474), for the card and the editor's select. */
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
