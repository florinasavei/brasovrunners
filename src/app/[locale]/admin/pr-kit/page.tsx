import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { routing } from "@/i18n/routing";
import {
  KIT_PUBLIC_PATH,
  LOGO_FORMATS,
  LOGO_INK_GROUND,
  type LogoFormat,
  logoFileName,
  logoVariants,
  rgbOf,
  shownAddress,
  type StickerSheetKey,
} from "@/modules/pr-kit/domain/kit";
import { canWorkTheDesk } from "@/modules/staff-identity/domain/roles";
import { requireStaff } from "@/modules/staff-identity/session";
import { env } from "@/shared/config/env";
import GlyphButton from "@/shared/ui/GlyphButton";
import { HEADING_SX } from "@/shared/ui/heading-scale";
import Panel from "@/shared/ui/Panel";
import { PALETTE } from "@/theme/brand";

type Props = { params: Promise<{ locale: string }> };

export const dynamic = "force-dynamic";

/** Each sheet's words in the catalogue, by the sheet's key. */
const SHEET_WORDS = {
  "qr-12": "qr12",
  "qr-24": "qr24",
  "logo-12": "logo12",
  "logo-24": "logo24",
  "logo-40": "logo40",
  "logo-12-primary": "logo12Primary",
} as const satisfies Record<StickerSheetKey, string>;

/** The two groups of sheets, in the page's order: a code to the site, then the logo alone. */
const SHEET_GROUPS: ReadonlyArray<{ words: "withCode" | "logoOnly"; sheets: readonly StickerSheetKey[] }> = [
  { words: "withCode", sheets: ["qr-12", "qr-24"] },
  { words: "logoOnly", sheets: ["logo-12", "logo-24", "logo-40", "logo-12-primary"] },
];

/** A download's glyph: the PDF's own for a PDF, the arrow for a file to save. */
const FORMAT_ICON = { svg: "download", png: "download", pdf: "pdf" } as const satisfies Record<LogoFormat, string>;

/** A link a thumb must hit (BR-REQ-041-01 criterion 6). */
const TARGET_SX = { minHeight: 44, minWidth: 44 } as const;

/**
 * «PR Kit» (§NNN; the owner, 2026-11-20: «also put them in the backoffice website and call it "PR Kit" so we can download it
 * at any time, even the volunteers can do that»): the club's logo files, the sticker sheets and the YouTube poster, and the
 * club's colour for a print shop — for every backoffice role, the volunteers included (`canWorkTheDesk`), asserted here and
 * again by every route a link below leads to (`modules/pr-kit/http.ts`, BR-REQ-060-01). The team's undertaking (§1006) stands
 * in front of it as in front of every page: `requireStaff` sends a colleague who owes it there.
 *
 * Nothing here writes: every link is a GET that hands a file out. The logo's tiles show the kit's own SVGs, each on the ground
 * it is meant for; the sticker sheets and the poster are drawn on request. The poster is offered only while the club's
 * YouTube address is set (`CLUB_YOUTUBE_URL`); until then one line says where it is set.
 */
export default async function PrKitPage({ params }: Props) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const actor = await requireStaff();
  if (!canWorkTheDesk(actor.role)) notFound();

  const t = await getTranslations("Admin");
  const youtube = env.CLUB_YOUTUBE_URL;
  const [red, green, blue] = rgbOf(PALETTE.primary);

  return (
    <Stack spacing={3} data-testid="pr-kit">
      <Box>
        <Typography variant="h2" sx={HEADING_SX.title}>
          {t("prKit.title")}
        </Typography>
        <Typography color="text.secondary" sx={{ mt: 0.5 }}>
          {t("prKit.intro")}
        </Typography>
      </Box>

      <Panel glyph="prLogo" title={t("prKit.logo.title")} intro={t("prKit.logo.intro")} introMore={t("prKit.logo.introMore")} id="logo" data-testid="pr-kit-logo">
        <Box sx={{ display: "grid", gap: 2, gridTemplateColumns: { xs: "minmax(0, 1fr)", sm: "repeat(2, minmax(0, 1fr))", lg: "repeat(3, minmax(0, 1fr))" } }}>
          {logoVariants().map(({ shape, ink }) => {
            const name = t("prKit.logo.tile", { shape: t(`prKit.logo.shape.${shape}`), ink: t(`prKit.logo.ink.${ink}`) });
            return (
              <Box key={`${shape}-${ink}`} data-testid="pr-kit-logo-tile" data-shape={shape} data-ink={ink} sx={{ minWidth: 0 }}>
                {/* The variant on the ground it is meant for: the white one on the club's colour, the others on white. */}
                <Box sx={{ bgcolor: LOGO_INK_GROUND[ink], border: 1, borderColor: "divider", borderRadius: 1, p: 2, aspectRatio: "5 / 2", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <Box component="img" src={`${KIT_PUBLIC_PATH}/${logoFileName(shape, ink, "svg")}`} alt={name} sx={{ display: "block", width: "100%", height: "100%", objectFit: "contain" }} />
                </Box>
                <Typography variant="body2" sx={{ mt: 1, fontWeight: 500 }}>
                  {name}
                </Typography>
                <Stack direction="row" sx={{ mt: 0.5, flexWrap: "wrap", gap: 1 }}>
                  {LOGO_FORMATS.map((format) => (
                    <GlyphButton
                      key={format}
                      icon={FORMAT_ICON[format]}
                      href={`/api/admin/pr-kit/logo/${logoFileName(shape, ink, format)}`}
                      variant="outlined"
                      size="small"
                      sx={TARGET_SX}
                      aria-label={t("prKit.logo.download", { name, format: t(`prKit.logo.format.${format}`) })}
                      data-testid={`pr-kit-logo-${format}`}
                    >
                      {t(`prKit.logo.format.${format}`)}
                    </GlyphButton>
                  ))}
                </Stack>
              </Box>
            );
          })}
        </Box>
      </Panel>

      <Panel glyph="prStickers" title={t("prKit.stickers.title")} intro={t("prKit.stickers.intro")} introMore={t("prKit.stickers.introMore")} id="stickers" data-testid="pr-kit-stickers">
        <Stack spacing={2.5}>
          {SHEET_GROUPS.map((group) => (
            <Box key={group.words}>
              <Typography component="h3" variant="h2" sx={HEADING_SX[3]}>
                {t(`prKit.stickers.${group.words}`)}
              </Typography>
              {group.words === "withCode" && (
                <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25, overflowWrap: "anywhere" }}>
                  {t("prKit.stickers.codeTo", { address: shownAddress(env.APP_BASE_URL) })}
                </Typography>
              )}
              <Stack spacing={1} sx={{ mt: 1 }}>
                {group.sheets.map((sheet) => {
                  const words = SHEET_WORDS[sheet];
                  return (
                    <Stack
                      key={sheet}
                      direction={{ xs: "column", sm: "row" }}
                      data-testid="pr-kit-sheet"
                      data-sheet={sheet}
                      sx={{ gap: 1, alignItems: { sm: "center" }, justifyContent: "space-between", borderTop: 1, borderColor: "divider", pt: 1 }}
                    >
                      <Box sx={{ minWidth: 0 }}>
                        <Typography sx={{ fontWeight: 500 }}>{t(`prKit.stickers.sheet.${words}`)}</Typography>
                        <Typography variant="body2" color="text.secondary">
                          {t(`prKit.stickers.what.${words}`)}
                        </Typography>
                      </Box>
                      <GlyphButton
                        icon="pdf"
                        href={`/api/admin/pr-kit/stickers/${sheet}`}
                        variant="outlined"
                        size="small"
                        sx={{ ...TARGET_SX, alignSelf: { xs: "flex-start", sm: "center" }, flexShrink: 0 }}
                        aria-label={t("prKit.stickers.downloadLabel", { name: `${t(`prKit.stickers.sheet.${words}`)} — ${t(`prKit.stickers.what.${words}`)}` })}
                      >
                        {t("prKit.stickers.download")}
                      </GlyphButton>
                    </Stack>
                  );
                })}
              </Stack>
            </Box>
          ))}
        </Stack>
      </Panel>

      <Panel glyph="prPoster" title={t("prKit.poster.title")} intro={t("prKit.poster.intro")} id="poster" data-testid="pr-kit-poster">
        {youtube ? (
          <Stack spacing={1} sx={{ alignItems: "flex-start" }}>
            <Typography variant="body2" color="text.secondary" sx={{ overflowWrap: "anywhere" }}>
              {t("prKit.poster.codeTo", { address: shownAddress(youtube) })}
            </Typography>
            <GlyphButton icon="pdf" href={`/api/admin/pr-kit/poster?locale=${locale}`} variant="outlined" size="small" sx={TARGET_SX} data-testid="pr-kit-poster-download">
              {t("prKit.poster.download")}
            </GlyphButton>
          </Stack>
        ) : (
          <Typography variant="body2" data-testid="pr-kit-poster-unset" sx={{ overflowWrap: "anywhere" }}>
            {t("prKit.poster.unset")}
          </Typography>
        )}
      </Panel>

      <Panel glyph="prColours" title={t("prKit.colours.title")} intro={t("prKit.colours.intro")} id="colours" data-testid="pr-kit-colours">
        <Stack direction="row" sx={{ gap: 2, alignItems: "center" }}>
          <Box aria-hidden sx={{ width: 56, height: 56, flexShrink: 0, borderRadius: 1, bgcolor: PALETTE.primary, border: 1, borderColor: "divider" }} />
          <Box sx={{ minWidth: 0 }}>
            <Typography sx={{ fontWeight: 500 }}>{t("prKit.colours.primary")}</Typography>
            <Typography variant="body2" sx={{ fontFamily: "monospace" }} data-testid="pr-kit-colour-hex">
              {t("prKit.colours.hex", { hex: PALETTE.primary.toUpperCase() })}
            </Typography>
            <Typography variant="body2" sx={{ fontFamily: "monospace" }} data-testid="pr-kit-colour-rgb">
              {t("prKit.colours.rgb", { r: red, g: green, b: blue })}
            </Typography>
          </Box>
        </Stack>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5 }}>
          {t("prKit.colours.paper")}
        </Typography>
      </Panel>
    </Stack>
  );
}
