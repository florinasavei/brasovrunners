import PersonAddIcon from "@mui/icons-material/PersonAdd";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import SubmitButton from "@/shared/ui/SubmitButton";

type Props = {
  /**
   * The words, read by `CheckYourEmail` from the «Registration» catalogue: the link's label and its
   * pending label, and the one sentence under it (`offerHint` picks which).
   */
  words: { add: string; addPending: string; hint: string };
  locale: string;
  slug: string;
  /** «Înscriu încă o persoană cu această adresă»: opens the sitting, holds what has not left yet, and opens the form with the address fixed. */
  continueAction: (form: FormData) => Promise<void>;
};

/**
 * «Înscriu încă o persoană cu această adresă» — one quiet line after the short screen's main content
 * (§NNN, amending §536; the owner, 2026-09-28, of the bold question and the full-width primary
 * button that stood here: «pare că încurajăm asta… când e doar o excepție»). The screen's point is
 * the email's line above; registering somebody else on the same address is the exception, so it is
 * a text-styled press with its glyph and its one sentence under it, never a question in bold and
 * never the page's primary button. The sentence is a true one, chosen by what the line above says
 * about the email (`offerHint`): while it waits for the scheduled pass, the next form joins the one
 * email; when it leaves now, the next person's email is the one that names everybody; at a window
 * of 0, each person gets their own.
 *
 * There is no «Gata» here and nothing to answer «Nu» with: leaving the page is the no. From the press
 * on, the screen after each form is the sitting's own (`FamilySittingNext`).
 *
 * Nothing here was read from the registrations table, so it reads the same for a first registration,
 * a family and an address registered already (§39, AGENTS.md §19.4). A Server Component: the glyph is
 * a child here, as on the sitting's screen, never a component reference across the boundary (§370).
 */
export default function FamilySittingOffer({ words, locale, slug, continueAction }: Props) {
  return (
    <Box component="section" aria-label={words.add} data-testid="family-sitting-offer">
      {/* A press, not a link (§519): it writes the sitting on the server and this browser's half together. */}
      <form action={continueAction} data-testid="family-sitting-add">
        <input type="hidden" name="locale" value={locale} />
        <input type="hidden" name="slug" value={slug} />
        {/* Text-styled, left-aligned, its 44-pixel height kept by the button (BR-REQ-041-01 criterion 6). */}
        <SubmitButton label={words.add} pendingLabel={words.addPending} variant="text">
          <PersonAddIcon />
        </SubmitButton>
      </form>
      <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }} data-testid="family-sitting-offer-hint">
        {words.hint}
      </Typography>
    </Box>
  );
}
