import PersonAddIcon from "@mui/icons-material/PersonAdd";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import { getTranslations } from "next-intl/server";
import { minutesPhrase } from "@/modules/deadlines/domain/duration-words";
import { cachedDeadlines } from "@/modules/public-cache/reads";
import SubmitButton from "@/shared/ui/SubmitButton";

type Props = {
  /** The form just sent named another person on the birth date of one typed before (§493), and was not kept. */
  sameBirthDate: { typed: string; kept: string } | null;
  /** The club's window is 0 (§519): there is no sitting, each person's email is their own. */
  atOnce: boolean;
  /**
   * The club's window as the action read it, from the browser's half (§519): the sentence names the
   * window a «Da» holds for, not the public cache's, which may lag a «Termene» save. Null on a half
   * written before it was kept: the cache's then.
   */
  windowMinutes: number | null;
  locale: string;
  slug: string;
  /** «Da, încă o persoană»: holds what has not left yet, and opens the same form with the address fixed. */
  continueAction: (form: FormData) => Promise<void>;
};

/**
 * «Mai înscrii pe cineva cu aceeași adresă?» — one question, with one answer, on the screen that says
 * to open the inbox (§NNN, amending §519; the owner, 2026-09-28: «partea asta e cam ciudata, adica sa
 * inteleg ca nu primesc mailu daca nu apas pe „Nu, gata, trimite mailul”?»).
 *
 * The form's email has left already, or leaves on the club's ordinary timing: nothing waits for a
 * press here, so there is no «Gata» to press and nothing to answer «Nu» with — leaving the page is
 * the no. «Da, încă o persoană» is the one press that holds: what has not left yet waits for the next
 * form, at most the club's window («Termene»), so the family gets one email with one button. The
 * sentence under the button says so, in the club's minutes. At a window of 0 there is no sitting: the
 * next form is offered all the same, and the sentence says each person gets their own email.
 *
 * What it says came from this browser's own forms and nothing else, so it reads the same for a first
 * registration, a family and an address that was registered already (§39, AGENTS.md §19.4). A Server
 * Component: the glyph is a child here, never a prop across the boundary (§370).
 */
export default async function FamilySittingNext({ sameBirthDate, atOnce, windowMinutes, locale, slug, continueAction }: Props) {
  const t = await getTranslations("Registration");
  const windowWords = minutesPhrase(locale, windowMinutes ?? (await cachedDeadlines()).familySittingMinutes);

  return (
    <Box
      component="section"
      aria-labelledby="family-sitting-question"
      data-testid="family-sitting"
      sx={{ border: 1, borderColor: "divider", borderRadius: 1, p: 2 }}
    >
      {/*
        Another name on a birth date typed before (§493): twins, or a corrected name. The form was not
        kept and nobody was replaced, so the screen says so, with what can be done. Both names were
        typed on this browser (§39).
      */}
      {sameBirthDate && (
        <Alert severity="warning" sx={{ mb: 2 }} data-testid="family-sitting-same-birth-date">
          {t("sitting.sameBirthDate", { name: sameBirthDate.typed, kept: sameBirthDate.kept })}
        </Alert>
      )}
      <Typography id="family-sitting-question" component="h3" variant="h3" sx={{ fontSize: "1.25rem", mb: 1.5 }}>
        {t("sitting.question")}
      </Typography>
      {/*
        A press, not a link (§519): «Da» holds what has not left yet and starts the window — the server's
        row, its waiting messages and this browser's half together — so it never lapses under the next form.
      */}
      <Box sx={{ maxWidth: 480 }}>
        <form action={continueAction} data-testid="family-sitting-add">
          <input type="hidden" name="locale" value={locale} />
          <input type="hidden" name="slug" value={slug} />
          <SubmitButton label={t("sitting.add")} pendingLabel={t("sitting.addPending")} variant="outlined" size="large" fullWidth>
            <PersonAddIcon />
          </SubmitButton>
        </form>
      </Box>
      <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }} data-testid="family-sitting-when">
        {atOnce ? t("sitting.addHintAtOnce") : t("sitting.addHint", { window: windowWords })}
      </Typography>
    </Box>
  );
}
