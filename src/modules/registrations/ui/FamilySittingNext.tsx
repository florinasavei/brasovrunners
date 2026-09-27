import GroupAddIcon from "@mui/icons-material/GroupAdd";
import MarkEmailReadIcon from "@mui/icons-material/MarkEmailRead";
import PersonAddIcon from "@mui/icons-material/PersonAdd";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { getTranslations } from "next-intl/server";
import { minutesPhrase } from "@/modules/deadlines/domain/duration-words";
import { cachedDeadlines } from "@/modules/public-cache/reads";
import { glyphSx, WITH_GLYPH_SX } from "@/shared/ui/button-glyph";
import SubmitButton from "@/shared/ui/SubmitButton";
import { TAP_TARGET } from "@/shared/ui/tap-target";

type Props = {
  /** The address the sitting's forms are sent with, as typed on its first form. */
  email: string;
  /** Everybody the sitting sent the form for so far, as typed, the latest last. */
  names: readonly string[];
  /** The first name of the form just sent (§224), for the heading; null once its cookie is gone. */
  firstName: string | null;
  eventTitle: string;
  /** The same form with the address fixed — `?family=1`, resolved by the caller: a string across the boundary. */
  addHref: string;
  locale: string;
  slug: string;
  /** «Gata»: the sitting's one email leaves now (`releaseFamilySittingAction`). */
  releaseAction: (form: FormData) => Promise<void>;
};

/**
 * «Mai înscrii pe cineva cu aceeași adresă?» — the screen after the form, before anything is mailed
 * (§NNN; the owner, 2026-09-27: «asta cu wizzardul de confirmare si claritate e top prio!»).
 *
 * Two answers, one each, big: «Încă o persoană» opens the form again with the address fixed, and
 * «Gata — trimite-mi emailul» sends the one email, for everybody, with one button in it. Between
 * them, in plain words, what happens: nothing has been mailed yet, one email comes for all, the
 * declarations are signed one after the other, and — for a page closed without an answer — the email
 * leaves by itself after the club's window («Termene»).
 *
 * What it lists came from this browser's own forms and nothing else, so it reads the same for a first
 * registration, a family and an address that was registered already (§39, AGENTS.md §19.4). A Server
 * Component: the glyphs are children here, never props across the boundary (§370).
 */
export default async function FamilySittingNext({ email, names, firstName, eventTitle, addHref, locale, slug, releaseAction }: Props) {
  const t = await getTranslations("Registration");
  const minutes = minutesPhrase(locale, (await cachedDeadlines()).familySittingMinutes);
  const latest = names.at(-1) ?? null;

  return (
    <Stack spacing={3} data-testid="family-sitting">
      <Box>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, mb: 1 }}>
          <Box
            aria-hidden="true"
            sx={{
              width: 48,
              height: 48,
              flexShrink: 0,
              borderRadius: "50%",
              bgcolor: "success.main",
              color: "success.contrastText",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <GroupAddIcon />
          </Box>
          {/* The heading the screen after the form always had (§224): the first name just typed. */}
          <Typography component="h2" variant="h2" sx={{ fontSize: { xs: "1.5rem", sm: "1.75rem" } }}>
            {firstName ? t("done.headingNamed", { name: firstName }) : t("done.heading")}
          </Typography>
        </Box>
        <Typography variant="body1">
          {latest ? t("sitting.leadNamed", { name: latest, event: eventTitle }) : t("sitting.lead", { event: eventTitle })}
        </Typography>
      </Box>

      <Box component="section" aria-labelledby="family-sitting-so-far" sx={{ border: 1, borderColor: "divider", borderRadius: 1, p: 2 }}>
        <Typography id="family-sitting-so-far" variant="body2" color="text.secondary">
          {t("sitting.soFar")}{" "}
          <Box component="strong" sx={{ color: "text.primary", wordBreak: "break-all" }}>
            {email}
          </Box>
        </Typography>
        <Box component="ol" sx={{ m: 0, mt: 1, pl: 3 }} data-testid="family-sitting-names">
          {names.map((name, index) => (
            <Typography component="li" key={`${index}-${name}`} sx={{ fontWeight: 700 }}>
              {name}
            </Typography>
          ))}
        </Box>
      </Box>

      <Box>
        <Typography component="h3" variant="h3" sx={{ fontSize: "1.25rem", mb: 1.5 }}>
          {t("sitting.question")}
        </Typography>
        <Stack spacing={1.5} sx={{ alignItems: "stretch", maxWidth: 480 }}>
          {/* `component="a"` with a resolved path, never `component={Link}` (§370). */}
          <Button component="a" href={addHref} variant="outlined" size="large" sx={{ ...TAP_TARGET, ...WITH_GLYPH_SX }} data-testid="family-sitting-add">
            <PersonAddIcon aria-hidden="true" sx={glyphSx("medium")} />
            {t("sitting.add")}
          </Button>
          <form action={releaseAction} data-testid="family-sitting-done">
            <input type="hidden" name="locale" value={locale} />
            <input type="hidden" name="slug" value={slug} />
            <SubmitButton label={t("sitting.done")} pendingLabel={t("sitting.donePending")} size="large" fullWidth>
              <MarkEmailReadIcon />
            </SubmitButton>
          </form>
        </Stack>
      </Box>

      {/* What happens, in the order it happens — the clarity the owner asked for first. */}
      <Box sx={{ borderLeft: 3, borderColor: "primary.main", pl: 2 }}>
        <Typography variant="body2" sx={{ fontWeight: 700 }}>
          {t("sitting.nothingYet")}
        </Typography>
        <Typography variant="body2">{t("sitting.oneEmail")}</Typography>
        <Typography variant="body2">{t("sitting.wizard")}</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          {t("sitting.byItself", { minutes })}
        </Typography>
      </Box>
    </Stack>
  );
}
