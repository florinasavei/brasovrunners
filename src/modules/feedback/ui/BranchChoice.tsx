import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import { getLocale, getTranslations } from "next-intl/server";
import { BRANCH_SLUG, FEEDBACK_QUERY, type FeedbackBranch } from "@/modules/feedback/domain/branches";
import { TAP_TARGET } from "@/shared/ui/tap-target";
import { DENSITY } from "@/theme/density";
import { branchLabelLang, FEEDBACK_BRANCH_GLYPH, FEEDBACK_BRANCH_TINT, paletteWash } from "./branch-glyph";

/**
 * A branch's glyph on its tinted tile — 40 pixels, a rounded square, a 24-pixel picture — the same on
 * step 1's card and beside step 2's title. Decoration: the branch's name is always written next to it.
 */
export function BranchGlyphTile({ branch }: { branch: FeedbackBranch }) {
  const Glyph = FEEDBACK_BRANCH_GLYPH[branch];
  const tint = FEEDBACK_BRANCH_TINT[branch];
  return (
    <Box
      aria-hidden="true"
      data-testid={`feedback-glyph-${BRANCH_SLUG[branch]}`}
      sx={{ flex: "none", width: 40, height: 40, borderRadius: 1.5, display: "grid", placeItems: "center", bgcolor: paletteWash(tint, 14), color: `${tint}.main` }}
    >
      <Glyph aria-hidden="true" sx={{ fontSize: 24 }} />
    </Box>
  );
}

/**
 * Step 1's choice (§676, §678): one card per branch offered, in a fieldset whose legend asks «Despre
 * ce e vorba?». Each card is a `<label>` around the native radio named `tip`, visible at the card's
 * right edge and painted in the primary colour (`accent-color`), so the keyboard, a screen reader and
 * a page with no JavaScript behave exactly as with a plain radio; the card's own outline and tint follow
 * `:checked`, and its focus ring the radio's `:focus-visible`, in CSS alone (`:has`). No client island.
 * The radio is named by the branch's title alone and described by its hint (`aria-labelledby`,
 * `aria-describedby`), so a screen reader says the name first and the sentence after it.
 *
 * `chosen` is checked by default — the first branch, or the one `?tip=` named. A name written in
 * another language than the page's — «Girl Zone» on the Romanian page — carries its `lang` (§NNN).
 */
export default async function BranchChoice({ branches, chosen }: { branches: readonly FeedbackBranch[]; chosen: FeedbackBranch }) {
  const t = await getTranslations("Tell");
  const locale = await getLocale();
  return (
    <Box component="fieldset" sx={{ border: 0, m: 0, p: 0, minWidth: 0 }}>
      <Typography component="legend" variant="h2" sx={{ fontSize: "1.25rem", mb: 1 }}>
        {t("choose.legend")}
      </Typography>
      <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" }, gap: { xs: DENSITY.gapSm, sm: 1.5 } }}>
        {branches.map((branch) => {
          const slug = BRANCH_SLUG[branch];
          // One choice per page, so the slug is a unique id.
          const idBase = `feedback-choice-${slug}`;
          return (
            <Box
              key={branch}
              component="label"
              data-testid={`feedback-choice-${slug}`}
              sx={{
                ...TAP_TARGET,
                display: "flex",
                alignItems: "flex-start",
                gap: 1.5,
                p: 1.5,
                // Two pixels wide always, so choosing a card never moves its words.
                border: 2,
                borderColor: "divider",
                borderRadius: 2,
                cursor: "pointer",
                transition: "border-color 120ms, background-color 120ms",
                "&:hover": { borderColor: "primary.main" },
                "&:has(input:checked)": { borderColor: "primary.main", bgcolor: paletteWash("primary", 8) },
                // The keyboard's ring on the whole card, not only the radio — the primary colour's own
                // variable, so it follows the colour scheme.
                "&:has(input:focus-visible)": { outline: "2px solid var(--mui-palette-primary-main)", outlineOffset: "2px" },
                "& input": { flex: "none", width: 22, height: 22, m: 0, mt: 1.25, ml: "auto", accentColor: "var(--mui-palette-primary-main)", cursor: "pointer" },
              }}
            >
              <BranchGlyphTile branch={branch} />
              <Box sx={{ minWidth: 0, flex: 1 }}>
                <Typography id={`${idBase}-title`} component="span" variant="body1" lang={branchLabelLang(branch, locale)} sx={{ display: "block", fontWeight: 600 }}>
                  {t(`branches.${branch}.label`)}
                </Typography>
                <Typography id={`${idBase}-hint`} component="span" variant="body2" color="text.secondary" sx={{ display: "block", mt: 0.25 }}>
                  {t(`branches.${branch}.hint`)}
                </Typography>
              </Box>
              <input
                type="radio"
                name={FEEDBACK_QUERY.branch}
                value={slug}
                defaultChecked={branch === chosen}
                aria-labelledby={`${idBase}-title`}
                aria-describedby={`${idBase}-hint`}
              />
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}
