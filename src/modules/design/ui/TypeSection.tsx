import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import { getTranslations } from "next-intl/server";
import { FONT } from "@/theme/brand";
import { PREVIEW_FONTS } from "@/theme/preview";
import { theme } from "@/theme/theme";
import DesignSection, { Block, Code } from "./section";

/** MUI's typography variants, in the order a reader meets them: the headings, the subtitles, the body, the small ones. */
const VARIANTS = ["h1", "h2", "h3", "h4", "h5", "h6", "subtitle1", "subtitle2", "body1", "body2", "button", "caption", "overline"] as const;

/**
 * The faces the locale layout self-hosts (`src/app/[locale]/layout.tsx`, §460), by the CSS variable
 * each defines: the three the theme lab offers (`theme/preview.ts`), the signature hand and the kit's
 * logotype. The names are the layout's own; nothing is loaded here that the layout does not.
 */
const FACES = [
  { key: "roboto", family: PREVIEW_FONTS.roboto.family, weight: 400, style: "normal" },
  { key: "inter", family: PREVIEW_FONTS.inter.family, weight: 400, style: "normal" },
  { key: "nunito", family: PREVIEW_FONTS.nunito.family, weight: 400, style: "normal" },
  { key: "signature", family: "var(--font-signature)", weight: 500, style: "normal" },
  { key: "facon", family: FONT.wordmark, weight: 900, style: "italic" },
] as const;

/** The Romanian letters a face must carry, and the figures. */
const DIACRITICS = "ș ț ă â î Ș Ț Ă Â Î 0123456789";

/** The first family of a `font-family` list, as the theme writes it. */
const firstFamily = (fontFamily: unknown) => (typeof fontFamily === "string" ? fontFamily.split(",")[0].trim() : "—");

/**
 * «Tipografie» (§NNN): every variant of the theme rendered as itself with a sample sentence in the
 * reader's language, and beside it the family, the weight and the size read from
 * `theme.typography[variant]`; then the faces with the Romanian letters in each; then the two font
 * roles of `FONT`. Headings are drawn as paragraphs so the page's own outline stays its own.
 */
export default async function TypeSection() {
  const t = await getTranslations("Admin");
  const sample = t("design.type.sample");

  return (
    <DesignSection id="type" title={t("design.sections.type")} intro={t("design.type.intro")}>
      <Block title={t("design.type.variants")}>
        <Box sx={{ display: "grid", gap: 2 }} data-testid="design-variants">
          {VARIANTS.map((variant) => {
            const style = theme.typography[variant];
            return (
              <Box key={variant} sx={{ display: "grid", gap: 0.5, gridTemplateColumns: { xs: "1fr", md: "minmax(0, 1fr) 320px" }, alignItems: "baseline" }}>
                <Typography variant={variant} component="p" sx={{ overflowWrap: "anywhere" }}>
                  {sample}
                </Typography>
                <Typography variant="caption" color="text.secondary" component="p">
                  <Code>{variant}</Code> · {t("design.type.family")}: {firstFamily(style.fontFamily)} · {t("design.type.weight")}: {String(style.fontWeight ?? "—")} ·{" "}
                  {t("design.type.size")}: {String(style.fontSize ?? "—")}
                </Typography>
              </Box>
            );
          })}
        </Box>
      </Block>

      <Block title={t("design.type.faces")} note={t("design.type.facesNote")}>
        <Box sx={{ display: "grid", gap: 1.5 }} data-testid="design-faces">
          {FACES.map((face) => (
            <Box key={face.key} sx={{ display: "grid", gap: 0.25, gridTemplateColumns: { xs: "1fr", md: "220px minmax(0, 1fr)" }, alignItems: "baseline" }}>
              <Typography variant="body2">
                {t(`design.type.faceNames.${face.key}`)} · <Code>{face.family}</Code>
              </Typography>
              <Typography sx={{ fontFamily: `${face.family}, ${FONT.fallback}`, fontWeight: face.weight, fontStyle: face.style, fontSize: "1.25rem", overflowWrap: "anywhere" }}>
                {DIACRITICS}
              </Typography>
            </Box>
          ))}
        </Box>
      </Block>

      <Block title={t("design.type.roles")} note={t("design.type.rolesNote")}>
        <Box component="dl" sx={{ m: 0, display: "grid", gap: 0.5, gridTemplateColumns: { xs: "1fr", sm: "auto 1fr" }, "& dt": { fontWeight: 600 }, "& dd": { m: 0 } }}>
          <dt>{t("design.type.display")}</dt>
          <dd>
            <Code>{FONT.display}</Code>
          </dd>
          <dt>{t("design.type.body")}</dt>
          <dd>
            <Code>{FONT.body}</Code>
          </dd>
          <dt>{t("design.type.wordmark")}</dt>
          <dd>
            <Code>{FONT.wordmark}</Code>
          </dd>
          <dt>{t("design.type.fallback")}</dt>
          <dd>
            <Code>{FONT.fallback}</Code>
          </dd>
        </Box>
      </Block>
    </DesignSection>
  );
}
