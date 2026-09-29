import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import { getTranslations } from "next-intl/server";
import { CLUB_NAME } from "@/theme/brand";
import { DENSITY } from "@/theme/density";

/**
 * «Reguli de siguranță» / "Safety rules" on every group run's page (§556, amending §393 and §498; the
 * second review of 2026-09-29).
 *
 * The self-declaration stays optional — «Semnarea acestei declarații este opțională…», and a group
 * run takes no registration (§111) — so most runners never read it. The review's point: the safety
 * rules the declaration names should not reach only the few who sign. So every group run's page says
 * them, in plain words, inside the «Condiții de participare» fold (§498), above the optional
 * declaration: a group run, with no individual supervision and no (mountain) guiding; each runner
 * chooses their own pace and way within the group; shoes and clothing for the ground and the weather,
 * a headlamp on a night run; their own water and food; running only if, as far as they know, their
 * health allows it; the organiser's general safety instructions for animals and weather; telling the
 * organiser when they leave the group.
 *
 * **Platform text, not the club's.** The same seven lines on every group run, so no editor field, and
 * nothing that varies by run — no number, no place — only the club's name, from `CLUB_NAME`. Both
 * languages from `messages/*.json`. A trail run says «ghidaj montan», any other «ghidaj»: the words
 * the declaration of that surface uses (`group-run-declaration.ts`).
 *
 * A race keeps its own rules section (§96) and gets none of this: the component draws nothing for
 * any type but a group run, so the page can mount it unconditionally and the test can prove both.
 */
export const SAFETY_RULE_KEYS = ["pace", "gear", "supplies", "health", "wildlife", "leaving"] as const;

export default async function GroupRunSafetyRules({ event }: { event: { type: string; surface: string | null } }) {
  if (event.type !== "GROUP_RUN") return null;
  const t = await getTranslations("Event");
  const intro = event.surface === "TRAIL" ? t("safetyRules.introMountain", { club: CLUB_NAME }) : t("safetyRules.intro", { club: CLUB_NAME });
  return (
    <Box component="section" id="safety" aria-labelledby="safety-title" sx={{ mt: { xs: DENSITY.gapSm, sm: 2 } }} data-testid="group-run-safety-rules">
      <Typography component="h3" id="safety-title" variant="h3" sx={{ fontSize: "1.0625rem", mb: 1 }}>
        {t("safetyRules.heading")}
      </Typography>
      <Box component="ul" sx={{ m: 0, pl: 2.5, "& > li": { mb: 0.5 } }}>
        <Typography component="li" variant="body2">
          {intro}
        </Typography>
        {SAFETY_RULE_KEYS.map((key) => (
          <Typography key={key} component="li" variant="body2">
            {t(`safetyRules.${key}`)}
          </Typography>
        ))}
      </Box>
    </Box>
  );
}
