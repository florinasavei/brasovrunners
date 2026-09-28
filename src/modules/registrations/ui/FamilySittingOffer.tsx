import PersonAddIcon from "@mui/icons-material/PersonAdd";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import { getTranslations } from "next-intl/server";
import SubmitButton from "@/shared/ui/SubmitButton";

type Props = {
  /** The club's window is 0 (§519): nothing is held, each person's email is their own. */
  atOnce: boolean;
  locale: string;
  slug: string;
  /** «Da, încă o persoană»: opens the sitting, holds what has not left yet, and opens the form with the address fixed. */
  continueAction: (form: FormData) => Promise<void>;
};

/**
 * «Mai înscrii pe cineva cu aceeași adresă?» — one question, with one answer, on the screen after the
 * first form, which says to open the inbox (§NNN, amending §519; the owner, 2026-09-28: «partea asta
 * e cam ciudata, adica sa inteleg ca nu primesc mailu daca nu apas pe „Nu, gata, trimite mailul”?»).
 *
 * The form's email leaves on the club's ordinary timing — the line above the question says when — so
 * there is no «Gata» here and nothing to answer «Nu» with: leaving the page is the no. «Da, încă o
 * persoană» is the press that opens the sitting: the email that has not left yet is held and sent
 * once, for everybody, as the sentence under the button says. From that press on, the screen after
 * each form is the sitting's own (`FamilySittingNext`). At a window of 0 nothing is held: the next
 * form is offered all the same, and the sentence says each person gets their own email.
 *
 * Nothing here was read from the registrations table, so it reads the same for a first registration,
 * a family and an address registered already (§39, AGENTS.md §19.4). A Server Component: the glyph is
 * a child here, never a prop across the boundary (§370).
 */
export default async function FamilySittingOffer({ atOnce, locale, slug, continueAction }: Props) {
  const t = await getTranslations("Registration");

  return (
    <Box
      component="section"
      aria-labelledby="family-sitting-question"
      data-testid="family-sitting-offer"
      sx={{ border: 1, borderColor: "divider", borderRadius: 1, p: 2 }}
    >
      <Typography id="family-sitting-question" component="h3" variant="h3" sx={{ fontSize: "1.25rem", mb: 1.5 }}>
        {t("sitting.question")}
      </Typography>
      {/* A press, not a link (§519): it writes the sitting on the server and this browser's half together. */}
      <Box sx={{ maxWidth: 480 }}>
        <form action={continueAction} data-testid="family-sitting-add">
          <input type="hidden" name="locale" value={locale} />
          <input type="hidden" name="slug" value={slug} />
          <SubmitButton label={t("sitting.add")} pendingLabel={t("sitting.addPending")} variant="outlined" size="large" fullWidth>
            <PersonAddIcon />
          </SubmitButton>
        </form>
      </Box>
      <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }} data-testid="family-sitting-offer-hint">
        {atOnce ? t("sitting.addHintAtOnce") : t("sitting.addHint")}
      </Typography>
    </Box>
  );
}
