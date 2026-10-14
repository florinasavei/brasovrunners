import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { getTranslations } from "next-intl/server";
import { contrastRatio } from "@/modules/appearance/domain/tint-contrast";
import { badgeColourReadable, badgeRoleColour, badgeTextOn } from "../badge-design";
import { roleColourChoice } from "./RoleColourFields";

/**
 * A role's band as the badge prints it (§764): a sample of the colour with «VOLUNTAR» in the ink the badge
 * sets on it, then the colour's name and its contrast in words — so the state is never told by colour alone.
 * Drawn on the role's row in the «Voluntari» card and on the badges' page, from one rule: a stored colour no
 * word reads on (written by hand) prints the club's orange, and the line says so.
 */
export default async function RoleColourSample({
  colour,
  label,
  locale,
  testId = "badge-colour-state",
}: {
  /** The role's colour as stored: a hex, or null for the club's orange. */
  colour: string | null;
  /** «VOLUNTAR» as the badges print it. */
  label: string;
  locale: string;
  testId?: string;
}) {
  const t = await getTranslations("Admin");
  const shown = badgeRoleColour(colour);
  const ink = badgeTextOn(shown);
  const { palette } = roleColourChoice(colour);
  const colourName =
    colour === null
      ? t("badges.colours.theme")
      : palette
        ? t(`editor.bibColours.${palette.key}`)
        : badgeColourReadable(colour)
          ? colour
          : t("badges.colours.unreadable", { colour });
  const ratio = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(contrastRatio(ink, shown));
  return (
    <Stack direction="row" sx={{ alignItems: "center", flexWrap: "wrap", gap: 1.5 }}>
      <Box
        aria-hidden
        sx={{ minWidth: 96, minHeight: 32, px: 1, display: "inline-flex", alignItems: "center", justifyContent: "center", bgcolor: shown, color: ink, fontWeight: 700, borderRadius: 0.5, border: 1, borderColor: "divider" }}
      >
        {label}
      </Box>
      <Typography variant="body2" color="text.secondary" data-testid={testId}>
        {t("badges.colours.state", { colour: colourName, ratio })}
      </Typography>
    </Stack>
  );
}
