import PersonAddIcon from "@mui/icons-material/PersonAdd";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import SubmitButton from "@/shared/ui/SubmitButton";

type Props = {
  /**
   * The words, read by `CheckYourEmail` from the «Registration» catalogue: the question, the button
   * and its pending label, and the one sentence under it (`offerHint` picks which).
   */
  words: { question: string; add: string; addPending: string; hint: string };
  locale: string;
  slug: string;
  /** «Da, încă o persoană»: opens the sitting, holds what has not left yet, and opens the form with the address fixed. */
  continueAction: (form: FormData) => Promise<void>;
};

/**
 * «Mai înscrii pe cineva cu aceeași adresă?» — the third line of the short screen after the first
 * form (§536, amending §519; the owner, 2026-09-28: «partea asta e cam ciudata, adica sa inteleg ca
 * nu primesc mailu daca nu apas pe „Nu, gata, trimite mailul”?», and later: the screen must be
 * clearer), with its one button and one sentence under it — a true one, chosen by what the line
 * above says about the email (`offerHint`; the review's nit F0): while it waits for the scheduled
 * pass, «Da» holds it and the address gets one email for everybody; when it leaves now, the next
 * person's email is the one that names everybody; at a window of 0, each person gets their own.
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
    <Box component="section" aria-labelledby="family-sitting-question" data-testid="family-sitting-offer">
      <Typography id="family-sitting-question" component="h3" variant="body1" sx={{ fontWeight: 700, mb: 1.5 }}>
        {words.question}
      </Typography>
      {/* A press, not a link (§519): it writes the sitting on the server and this browser's half together. */}
      <Box sx={{ maxWidth: 480 }}>
        <form action={continueAction} data-testid="family-sitting-add">
          <input type="hidden" name="locale" value={locale} />
          <input type="hidden" name="slug" value={slug} />
          <SubmitButton label={words.add} pendingLabel={words.addPending} variant="contained" size="large" fullWidth>
            <PersonAddIcon />
          </SubmitButton>
        </form>
      </Box>
      <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }} data-testid="family-sitting-offer-hint">
        {words.hint}
      </Typography>
    </Box>
  );
}
