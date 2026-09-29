import { getTranslations } from "next-intl/server";
import { env } from "@/shared/config/env";
import type { SocialNetwork } from "./SocialIcon";

export type ClubSocialLink = { network: SocialNetwork; href: string; label: string };

/**
 * The club's own profiles elsewhere, in the order the footer draws them — the one list the bar's
 * marks and the identity block's middle column both read (§565: reuse, never a second list). From
 * the environment (`CLUB_FACEBOOK_URL`, `CLUB_INSTAGRAM_URL`, `CLUB_STRAVA_URL`, `env.ts`); an
 * unset one is left out, and none set is an empty list.
 */
export async function clubSocialLinks(): Promise<ClubSocialLink[]> {
  const footer = await getTranslations("Footer");
  const entries: Array<{ network: SocialNetwork; href: string | undefined; label: string }> = [
    { network: "facebook", href: env.CLUB_FACEBOOK_URL, label: footer("about.facebook") },
    { network: "instagram", href: env.CLUB_INSTAGRAM_URL, label: footer("about.instagram") },
    { network: "strava", href: env.CLUB_STRAVA_URL, label: footer("about.strava") },
  ];
  return entries.filter((entry): entry is ClubSocialLink => Boolean(entry.href));
}
