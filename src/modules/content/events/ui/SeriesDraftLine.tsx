import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Link from "next/link";
import Hint from "@/shared/ui/Hint";

/**
 * "1 dată în ciornă — nu apare pe site: lun. 16 nov. (?)" — the series row's line for the dates
 * the site is missing (`DECISIONS.md` §341), in place of the bare "Ciornă · 1 date" chip that
 * made the owner ask "ce înseamnă această 1 ciornă?".
 *
 * Each date is its own link into its editor, where it is published; the "?" says what a draft
 * date is, how to publish it and — when the list can tell (`seriesDrafts`) — why this series
 * makes them. A Server Component: the words and the addresses arrive as strings, and the one
 * island is `Hint`, which is handed a string too.
 *
 * The mark is a warning-coloured rule down the left, not warning-coloured text: MUI's orange on
 * white is about 3:1, under what small body text needs, and the words are the part to read.
 */
export type SeriesDraftLineProps = {
  /** "2 date în ciornă — nu apar pe site:", already counted and translated. */
  text: string;
  /** The drafts to link, in the order `seriesDrafts` gave them; the page caps how many. */
  dates: ReadonlyArray<{ id: string; label: string; href: string }>;
  /** "și încă 3", for the drafts past the cap — the folded list below has every date. */
  more: string | null;
  /** What sits behind the "?": `draftExplanation`'s text. */
  explanation: string;
};

export default function SeriesDraftLine({ text, dates, more, explanation }: SeriesDraftLineProps) {
  return (
    <Box
      data-testid="series-drafts"
      sx={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        columnGap: 1,
        borderLeft: 3,
        borderColor: "warning.main",
        pl: 1,
      }}
    >
      <Typography component="span" variant="body2" sx={{ fontWeight: 600 }}>
        {text}
      </Typography>
      {dates.map((date) => (
        <Typography key={date.id} component="span" variant="body2">
          <Link href={date.href}>
            {/* The span sizes the link: 44 px tall on a phone, where a thumb presses it, and a
                line's height on a desktop, where the row should stay a row. */}
            <Box component="span" sx={{ display: "inline-flex", alignItems: "center", minHeight: { xs: 44, md: 0 } }}>
              {date.label}
            </Box>
          </Link>
        </Typography>
      ))}
      {more && (
        <Typography component="span" variant="body2" color="text.secondary">
          {more}
        </Typography>
      )}
      <Hint text={explanation} />
    </Box>
  );
}
