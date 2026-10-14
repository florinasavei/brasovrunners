import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { getTranslations } from "next-intl/server";
import { saveBadgeRoleColoursAction } from "@/app/[locale]/admin/events/[id]/badges/actions";
import type { Locale } from "@/i18n/routing";
import { contrastRatio } from "@/modules/appearance/domain/tint-contrast";
import { BIB_COLOURS } from "@/modules/content/events/ui/bib-colours";
import ActionForm from "@/shared/forms/ActionForm";
import RecallField from "@/shared/forms/recall";
import { refusalMessages } from "@/shared/forms/refusal-messages";
import GlyphSubmitButton from "@/shared/ui/GlyphSubmitButton";
import Panel from "@/shared/ui/Panel";
import { badgeColourReadable, badgeRoleColour, badgeTextOn } from "../badge-design";
import { type BadgeRole, badgeRoleName, roleColourBoxes, TYPED_COLOUR } from "../badges";

/** The palette's colours a role may wear: the bib's six (§177), those that carry their words at AA. */
const READABLE = BIB_COLOURS.filter((choice) => badgeColourReadable(choice.hex));

/**
 * «Culorile rolurilor» (§NNN): each role's band colour on the badge — «Culoarea temei» (the theme's, the
 * kit's orange), one of the bib's palette, or a colour typed beside «Altă culoare» and refused when its
 * words would not read at AA. On this page, not in the «Voluntari» card's role form, so the role's own
 * editor stays the volunteers' card's alone.
 *
 * Every role shows its band as saved — a sample of the colour with «VOLUNTAR» in the text colour the
 * badge prints on it, the colour's name and its contrast in words — so the state is never told by colour
 * alone. One form, one press: «Salvează culorile» (`ActionForm`).
 */
export default async function BadgeRoleColours({ eventId, locale, roles }: { eventId: string; locale: Locale; roles: readonly BadgeRole[] }) {
  const t = await getTranslations("Admin");
  const fields: Record<string, string> = {};
  for (const role of roles) {
    const boxes = roleColourBoxes(role.id);
    fields[boxes.choice] = t("badges.colours.choiceOf", { role: badgeRoleName(role, locale) });
    fields[boxes.typed] = t("badges.colours.typedOf", { role: badgeRoleName(role, locale) });
  }
  const messages = await refusalMessages(fields);
  const ratioWords = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });
  const aside = roles.length === 0 ? t("badges.colours.none") : t("badges.colours.aside", { count: String(roles.filter((role) => role.colour).length), total: String(roles.length) });

  return (
    <Panel glyph="appearance" collapsible level={2} id="box-badge-colours" title={t("badges.colours.title")} aside={aside} data-testid="badge-colours">
      <Stack spacing={1.5}>
        <Typography variant="body2" color="text.secondary">
          {t("badges.colours.intro")}
        </Typography>
        {roles.length === 0 ? (
          <Typography variant="body2" color="text.secondary" data-testid="badge-colours-empty">
            {t("badges.colours.empty")}
          </Typography>
        ) : (
          <ActionForm action={saveBadgeRoleColoursAction} scope="badge-colours" messages={messages} data-testid="badge-colours-form">
            <input type="hidden" name="uiLocale" value={locale} />
            <input type="hidden" name="eventId" value={eventId} />
            <Stack spacing={2} component="ul" sx={{ listStyle: "none", m: 0, p: 0 }}>
              {roles.map((role) => {
                const boxes = roleColourBoxes(role.id);
                const shown = badgeRoleColour(role.colour);
                const ink = badgeTextOn(shown);
                const palette = READABLE.find((choice) => choice.hex === role.colour);
                const choice = role.colour === null ? "" : palette ? palette.hex : TYPED_COLOUR;
                // A stored colour no word reads on (written by hand) prints the theme's, and the line says so.
                const colourName =
                  role.colour === null
                    ? t("badges.colours.theme")
                    : palette
                      ? t(`editor.bibColours.${palette.key}`)
                      : badgeColourReadable(role.colour)
                        ? role.colour
                        : t("badges.colours.unreadable", { colour: role.colour });
                return (
                  <Box component="li" key={role.id} data-testid="badge-colour-row" data-role-id={role.id}>
                    <input type="hidden" name="roleId" value={role.id} />
                    <Stack spacing={1}>
                      <Stack direction="row" sx={{ alignItems: "center", flexWrap: "wrap", gap: 1.5 }}>
                        {/* The band as it prints: the colour, and the word in the ink the badge sets on it. */}
                        <Box
                          aria-hidden
                          sx={{ minWidth: 96, minHeight: 32, px: 1, display: "inline-flex", alignItems: "center", justifyContent: "center", bgcolor: shown, color: ink, fontWeight: 700, borderRadius: 0.5, border: 1, borderColor: "divider" }}
                        >
                          {t("badges.defaults.label")}
                        </Box>
                        <Typography variant="body1" sx={{ fontWeight: 600 }}>
                          {badgeRoleName(role, locale)}
                        </Typography>
                        <Typography variant="body2" color="text.secondary" data-testid="badge-colour-state">
                          {t("badges.colours.state", { colour: colourName, ratio: ratioWords.format(contrastRatio(ink, shown)) })}
                        </Typography>
                      </Stack>
                      <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5}>
                        <RecallField
                          select
                          name={boxes.choice}
                          label={t("badges.colours.choice")}
                          defaultValue={choice}
                          slotProps={{ select: { native: true }, inputLabel: { shrink: true } }}
                          sx={{ width: { sm: 260 } }}
                        >
                          <option value="">{t("badges.colours.theme")}</option>
                          {READABLE.map((option) => (
                            <option key={option.hex} value={option.hex}>
                              {t(`editor.bibColours.${option.key}`)}
                            </option>
                          ))}
                          <option value={TYPED_COLOUR}>{t("badges.colours.typed")}</option>
                        </RecallField>
                        <RecallField
                          name={boxes.typed}
                          label={t("badges.colours.typedLabel")}
                          helperText={t("badges.colours.typedHelp")}
                          defaultValue={choice === TYPED_COLOUR ? (role.colour ?? "") : ""}
                          placeholder="#rrggbb"
                          slotProps={{ htmlInput: { maxLength: 7, autoComplete: "off", spellCheck: false }, inputLabel: { shrink: true } }}
                          sx={{ width: { sm: 260 } }}
                        />
                      </Stack>
                    </Stack>
                  </Box>
                );
              })}
            </Stack>
            <Box sx={{ mt: 2 }}>
              <GlyphSubmitButton label={t("badges.colours.save")} pendingLabel={t("badges.colours.saving")} icon="save" />
            </Box>
          </ActionForm>
        )}
      </Stack>
    </Panel>
  );
}
