import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import { Link } from "@/i18n/navigation";
import ArrowButtonLink from "@/shared/ui/ArrowButtonLink";
import { HOME_CARD_BODY_SX, HOME_CARD_PICTURE_SX, HOME_CARD_SX, HOME_CARD_TITLE_SX } from "./card-sx";
import HomePicture, { type HomePictureSources } from "./HomePicture";
import RoundArrow from "./RoundArrow";
import RunTag, { type RunTagProps } from "./RunTag";

/** One card: an event, or a series shown by its next date (§113). */
export type RunCardItem = {
  key: string;
  slug: string;
  title: string;
  /** The first line under the title: a weekly run's rhythm («În fiecare marți, la 18:30»), else the date. */
  when: string;
  /** A second line: the next date of a weekly run, or the place; null for none. */
  detail: string | null;
  picture: HomePictureSources | null;
  tag: RunTagProps;
};

export type RunCardGridProps = {
  /** The section's anchor and its heading's id prefix: `weekly`, `special`. */
  id: string;
  title: string;
  intro: string;
  cards: readonly RunCardItem[];
  /** What the section says when nothing of its kind is ahead. */
  empty: string;
  /** «Toate alergările»: the listing, which holds every card the section leaves out. */
  more: { label: string } | null;
};

/**
 * A section of the home page's runs (the facelift's phase 3, §NNN): the weekly runs, or the special
 * events (decision 9) — a heading, a line, and a card per event with its cover on top, the kind's tag
 * over the picture, the title as the link over the whole card, a line or two of when, and the round
 * arrow (decision 10).
 *
 * **A carousel without an island** (the plan's «carousels are CSS scroll-snap strips»): on a phone
 * the cards are one row the thumb swipes, each snapping into place, the next card's edge showing so
 * the row says there is more; from `md` they are a grid of three. Nothing runs in the browser, and
 * with scripts off it is the same strip. The row scrolls inside itself, so the page never scrolls
 * sideways.
 *
 * A Server Component with typed props (§370).
 */
export default function RunCardGrid({ id, title, intro, cards, empty, more }: RunCardGridProps) {
  return (
    <Box component="section" aria-labelledby={`home-${id}-title`} id={id} data-testid={`home-${id}`}>
      <Typography variant="h2" id={`home-${id}-title`} sx={{ fontSize: { xs: "1.375rem", sm: "1.625rem" } }}>
        {title}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, mb: 1.5 }}>
        {intro}
      </Typography>
      {cards.length === 0 ? (
        <Typography variant="body2" data-testid={`home-${id}-empty`}>
          {empty}
        </Typography>
      ) : (
        <Box
          component="ul"
          data-testid={`home-${id}-cards`}
          sx={{
            listStyle: "none",
            m: 0,
            p: 0,
            display: { xs: "flex", md: "grid" },
            gap: 1.5,
            gridTemplateColumns: { md: "repeat(3, minmax(0, 1fr))" },
            // The phone's strip: one row that scrolls on its own, each card snapping to the start.
            overflowX: { xs: "auto", md: "visible" },
            scrollSnapType: { xs: "x mandatory", md: "none" },
            scrollPaddingInline: 0,
            // Room for the cards' shadow inside the strip's own box.
            pb: { xs: 1, md: 0 },
          }}
        >
          {cards.map((card) => (
            <Box
              key={card.key}
              component="li"
              sx={{ flex: { xs: "0 0 82%", sm: "0 0 46%" }, minWidth: 0, scrollSnapAlign: "start" }}
            >
              <Box component="article" sx={HOME_CARD_SX}>
                <Box sx={HOME_CARD_PICTURE_SX}>
                  <HomePicture picture={card.picture} />
                  <RunTag {...card.tag} />
                </Box>
                <Box sx={HOME_CARD_BODY_SX}>
                  <Typography variant="h3" sx={HOME_CARD_TITLE_SX}>
                    <Link href={{ pathname: "/events/[slug]", params: { slug: card.slug } }}>{card.title}</Link>
                  </Typography>
                  <Typography variant="body2">{card.when}</Typography>
                  {card.detail && (
                    <Typography variant="body2" color="text.secondary">
                      {card.detail}
                    </Typography>
                  )}
                  <Box sx={{ display: "flex", justifyContent: "flex-end", mt: "auto", pt: 1 }}>
                    <RoundArrow />
                  </Box>
                </Box>
              </Box>
            </Box>
          ))}
        </Box>
      )}
      {more && (
        <Box sx={{ mt: 2 }}>
          <ArrowButtonLink href="/events" label={more.label} variant="outlined" data-testid={`home-${id}-more`} />
        </Box>
      )}
    </Box>
  );
}
