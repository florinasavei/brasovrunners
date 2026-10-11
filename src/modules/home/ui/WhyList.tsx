import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import { getTranslations } from "next-intl/server";
import type { Locale } from "@/i18n/routing";
import { pickText } from "../domain/home-text";
import { WHY_GLYPHS, type WhyContent } from "../domain/why";
import { HOME_GLYPHS } from "./home-glyphs";
import { GLYPH_SEAT_SX, HOME_HEADING_SX, HOME_RADIUS_PX } from "./home-surfaces";

export type WhyListProps = {
  /** What the club typed (`domain/why.ts`); an empty reason draws the platform's sentence, an empty quote nothing. */
  content: WhyContent;
  locale: Locale;
};

/** The handwriting face (Caveat, §460): never preloaded, so only a page that draws a quote fetches it. */
const HAND_FONT = "var(--font-signature), cursive";

/**
 * «De ce» (§714; `docs/REDESIGN.md` § What exists versus what is new): four reasons to run with the
 * club, each a glyph of the home registry, a short title and one sentence — one column on a phone, two
 * from `sm`, four from `md` — and under them the quote the club chose, in the handwriting face, with
 * who said it.
 *
 * The quote is drawn only when the club wrote one in both languages: the platform lends no one's
 * words (`domain/why.ts`). A `<figure>` with its `<blockquote>` and `<figcaption>`, so a screen reader
 * hears a quotation and its author. A Server Component with no island.
 */
export default async function WhyList({ content, locale }: WhyListProps) {
  const t = await getTranslations("HomeSections");
  const items = WHY_GLYPHS.map((glyph, index) => ({
    glyph,
    title: pickText(content.items[index]?.title, locale) ?? t(`why.items.${index + 1}.title`),
    body: pickText(content.items[index]?.body, locale) ?? t(`why.items.${index + 1}.body`),
  }));
  const quote = pickText(content.quote, locale);
  const quoteBy = quote ? pickText(content.quoteBy, locale) : null;

  return (
    <Box component="section" aria-labelledby="home-why-title" data-testid="home-why" sx={{ py: { xs: 4, md: 6 } }}>
      <Typography variant="h2" id="home-why-title" sx={{ ...HOME_HEADING_SX, mb: 3 }}>
        {pickText(content.title, locale) ?? t("why.title")}
      </Typography>

      <Box
        component="ul"
        sx={{ listStyle: "none", m: 0, p: 0, display: "grid", gap: { xs: 2, md: 3 }, gridTemplateColumns: { xs: "1fr", sm: "repeat(2, minmax(0, 1fr))", md: `repeat(${WHY_GLYPHS.length}, minmax(0, 1fr))` } }}
      >
        {items.map((item) => {
          const Glyph = HOME_GLYPHS[item.glyph];
          return (
            <Box
              component="li"
              key={item.glyph}
              data-why={item.glyph}
              sx={{ border: 1, borderColor: "divider", borderRadius: `${HOME_RADIUS_PX}px`, bgcolor: "background.paper", p: 2.5, display: "grid", gap: 1, alignContent: "start", minWidth: 0 }}
            >
              <Box sx={GLYPH_SEAT_SX}>
                <Glyph aria-hidden="true" />
              </Box>
              <Typography variant="h3" sx={{ fontSize: "1.125rem", overflowWrap: "anywhere" }}>
                {item.title}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {item.body}
              </Typography>
            </Box>
          );
        })}
      </Box>

      {quote && (
        <Box component="figure" data-testid="home-why-quote" sx={{ m: 0, mt: { xs: 4, md: 5 }, mx: "auto", maxWidth: "40rem", textAlign: "center" }}>
          <Box component="blockquote" sx={{ m: 0 }}>
            <Typography component="p" sx={{ fontFamily: HAND_FONT, fontSize: { xs: "1.75rem", md: "2.25rem" }, lineHeight: 1.25, color: "primary.main" }}>
              {t("why.quote", { quote })}
            </Typography>
          </Box>
          {quoteBy && (
            <Typography component="figcaption" color="text.secondary" sx={{ mt: 1 }}>
              {t("why.quoteBy", { name: quoteBy })}
            </Typography>
          )}
        </Box>
      )}
    </Box>
  );
}
