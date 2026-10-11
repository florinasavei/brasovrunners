import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import { CARD_GRID_SX } from "@/modules/events/ui/card-layout";
import ListingCard, { type ListingCardProps } from "@/modules/events/ui/ListingCard";
import ArrowButtonLink from "@/shared/ui/ArrowButtonLink";

/** One card of a section: the listing's own (`ListingCard`), with the key the list renders it under. */
export type RunSectionCard = Omit<ListingCardProps, "index" | "now"> & { key: string };

export type RunSectionProps = {
  /** The section's anchor, its heading's id prefix and its test id: `next-run`, `weekly`, `special`. */
  id: string;
  title: string;
  /** The line under the heading; null for none («Următoarea alergare» needs none). */
  intro: string | null;
  cards: readonly RunSectionCard[];
  /** The page's one timestamp, so two cards cannot disagree about a door or a countdown. */
  now: Date;
  /** «Vezi toate alergările»: the listing, which holds every card the section leaves out. */
  more: { label: string } | null;
};

/**
 * A section of the home page's runs — «Următoarea alergare», «Alergările săptămânale», «Evenimente
 * speciale» (the facelift's phase 3, §717) — drawn with **the listing's own cards** (§NNN, amending
 * §717 and the plan's decision 10). The owner, comparing the two on QA: «totuși aici pe homepage ar
 * trebui să văd fix tipul de carduri din alergări, ca să reutilizăm». So a card here is `ListingCard`
 * — `SeriesCard` for a series, `EventCard` for a date — in the listing's own grid (`CARD_GRID_SX`):
 * the chips, the title as the link over the card, the summary with its picture, the facts, the
 * weather, «Următoarele date», the registration button and «Descrierea completă a evenimentului»,
 * exactly as «Alergări» draws them. The home page's own cover slot, kind tag and round arrow are gone.
 *
 * A heading, a line, the cards, and the link to the listing; a section with no card draws nothing —
 * no heading over an empty row, no sentence about none. A Server Component with typed props: the
 * cards get the listing's rows and no element crosses into a client component (§370).
 */
export default function RunSection({ id, title, intro, cards, now, more }: RunSectionProps) {
  if (cards.length === 0) return null;
  return (
    <Box component="section" aria-labelledby={`home-${id}-title`} id={id} data-testid={`home-${id}`}>
      <Typography variant="h2" id={`home-${id}-title`} sx={{ fontSize: { xs: "1.375rem", sm: "1.625rem" }, mb: intro ? 0 : 1.5 }}>
        {title}
      </Typography>
      {intro && (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, mb: 1.5 }}>
          {intro}
        </Typography>
      )}
      <Box component="ul" sx={CARD_GRID_SX} data-testid={`home-${id}-cards`}>
        {cards.map(({ key, ...card }, index) => (
          <ListingCard key={key} {...card} index={index} now={now} titleAs="h3" />
        ))}
      </Box>
      {more && (
        <Box sx={{ mt: 2 }}>
          <ArrowButtonLink href="/events" label={more.label} variant="outlined" data-testid={`home-${id}-more`} />
        </Box>
      )}
    </Box>
  );
}
