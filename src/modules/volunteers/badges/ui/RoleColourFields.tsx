import Stack from "@mui/material/Stack";
import { getTranslations } from "next-intl/server";
import { BIB_COLOURS } from "@/modules/content/events/ui/bib-colours";
import RecallField from "@/shared/forms/recall";
import { badgeColourReadable } from "../badge-design";
import { TYPED_COLOUR } from "../badges";

/** The palette's colours a role may wear: the bib's six (§177), those that carry their words at AA. */
export const READABLE_ROLE_COLOURS = BIB_COLOURS.filter((choice) => badgeColourReadable(choice.hex));

/** What a role's select shows for its stored colour: «Portocaliul clubului» (empty), a palette colour, or «Altă culoare». */
export function roleColourChoice(colour: string | null): { choice: string; palette: (typeof READABLE_ROLE_COLOURS)[number] | undefined } {
  const palette = READABLE_ROLE_COLOURS.find((option) => option.hex === colour);
  return { choice: colour === null ? "" : palette ? palette.hex : TYPED_COLOUR, palette };
}

/**
 * The two boxes of a role's band colour (§NNN): «Culoarea benzii» — the club's orange, one of the bib's
 * palette that reads at AA, or «Altă culoare» — and «Culoarea scrisă», the colour typed beside it, whose help
 * says the limits in words (a hash and six digits; white or black text must read on it, contrast 4.5 to 1).
 * One pair of boxes for the role's own form in the «Voluntari» card and for the badges' page, which save
 * through the one rule (`badges.ts#checkedRoleColour`); the caller names the boxes, so each form's refusal
 * links to its own.
 */
export default async function RoleColourFields({
  names,
  colour,
}: {
  names: { choice: string; typed: string };
  /** The role's colour as stored: a hex, or null for the club's orange. */
  colour: string | null;
}) {
  const t = await getTranslations("Admin");
  const { choice } = roleColourChoice(colour);
  return (
    <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5}>
      <RecallField
        select
        name={names.choice}
        label={t("badges.colours.choice")}
        defaultValue={choice}
        slotProps={{ select: { native: true }, inputLabel: { shrink: true } }}
        sx={{ width: { sm: 260 } }}
      >
        <option value="">{t("badges.colours.themeOption")}</option>
        {READABLE_ROLE_COLOURS.map((option) => (
          <option key={option.hex} value={option.hex}>
            {t(`editor.bibColours.${option.key}`)}
          </option>
        ))}
        <option value={TYPED_COLOUR}>{t("badges.colours.typed")}</option>
      </RecallField>
      <RecallField
        name={names.typed}
        label={t("badges.colours.typedLabel")}
        helperText={t("badges.colours.typedHelp")}
        defaultValue={choice === TYPED_COLOUR ? (colour ?? "") : ""}
        placeholder="#rrggbb"
        slotProps={{ htmlInput: { maxLength: 7, autoComplete: "off", spellCheck: false }, inputLabel: { shrink: true } }}
        sx={{ width: { sm: 260 } }}
      />
    </Stack>
  );
}
