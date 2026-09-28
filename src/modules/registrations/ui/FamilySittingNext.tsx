import FamilyRestroomIcon from "@mui/icons-material/FamilyRestroom";
import GroupAddIcon from "@mui/icons-material/GroupAdd";
import MarkEmailReadIcon from "@mui/icons-material/MarkEmailRead";
import PersonAddIcon from "@mui/icons-material/PersonAdd";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { getTranslations } from "next-intl/server";
import { minutesPhrase } from "@/modules/deadlines/domain/duration-words";
import { cachedDeadlines } from "@/modules/public-cache/reads";
import SubmitButton from "@/shared/ui/SubmitButton";
import { countForm } from "@/i18n/count-form";
import { AUTO_PRESS_FIELD, type SittingPerson, sittingMinutesLeft, sittingReservationFacts } from "../domain/family-sitting";
import { reservedUntilWords } from "../domain/family-reservation";
import PressWhenWindowEnds from "./PressWhenWindowEnds";

type Props = {
  /** The address the sitting's forms are sent with, as typed on its first form. */
  email: string;
  /** Everybody the sitting sent the form for so far, as typed, the latest last. */
  names: readonly string[];
  /**
   * The family's reserved places (§NNN; the owner, 2026-09-28: «să rezerv 3 locuri și așa să se
   * calculeze pe site»): each person with the place their form got, and until when the places are
   * reserved — both from the browser's half, facts about the event and the club's settings (§39).
   * Absent, or `until` null (before «Da», a window of 0, an older half): the screen names no place.
   */
  reservation?: { people: readonly SittingPerson[]; until: Date | null };
  /** The form just sent named another person on the birth date of one typed before (§493), and was not kept. */
  sameBirthDate: { typed: string; kept: string } | null;
  /** How long until the window ends, by the server's clock: the open screen presses «Gata» then. */
  releaseInMs: number;
  /** The first name of the form just sent (§224), for the heading; null once its cookie is gone. */
  firstName: string | null;
  eventTitle: string;
  /** The club's window is 0 (§519): nothing was held, the email has already left. */
  atOnce: boolean;
  /**
   * The club's window as the action read it, from the browser's half (§519): the sentence names the
   * window the email is actually held for, not the public cache's, which may lag a «Termene» save.
   * Null on a half written before it was kept: the cache's then.
   */
  windowMinutes: number | null;
  locale: string;
  slug: string;
  /** «Da, încă o persoană»: the window starts again, and the same form opens with the address fixed. */
  continueAction: (form: FormData) => Promise<void>;
  /** «Gata»: the sitting's one email leaves now (`releaseFamilySittingAction`). */
  releaseAction: (form: FormData) => Promise<void>;
};

/**
 * «Mai înscrii pe cineva cu aceeași adresă?» — the sitting's screen, after «Da, încă o persoană» (§519;
 * the owner, 2026-09-27: «asta cu wizzardul de confirmare si claritate e top prio!»). Since §536 it
 * follows every form sent after «Da», and «Da» pressed and come back; the first form's screen is the
 * inbox's own, with the one question (`FamilySittingOffer`), because nothing waits before «Da».
 *
 * First one honest sentence (the review of 2026-09-27: the screen said «nothing until you press
 * „Gata”» and, two lines later, that the email leaves by itself): the email leaves on «Gata» or by
 * itself after the club's window («Termene») from the last form, and how long is left of it. Then the
 * two answers, big: «Da, încă o persoană» starts the window again and opens the form with the address
 * fixed; «Gata — trimite-mi emailul» sends the one email, for everybody, with one button in it. Then,
 * one fact a line: one email for all, the declarations one after the other, and that with the page
 * closed the email waits for the outbox job's next run (`PressWhenWindowEnds` presses «Gata» while it
 * is open), up to an hour at night. At a window of 0 nothing was held: the sentence says the email has
 * already left, and the screen still offers the next person.
 *
 * What it lists came from this browser's own forms and nothing else, so it reads the same for a first
 * registration, a family and an address that was registered already (§39, AGENTS.md §19.4). A Server
 * Component: the glyphs are children here, never props across the boundary (§370).
 */
export default async function FamilySittingNext({
  email,
  names,
  reservation,
  sameBirthDate,
  releaseInMs,
  firstName,
  eventTitle,
  atOnce,
  windowMinutes,
  locale,
  slug,
  continueAction,
  releaseAction,
}: Props) {
  const t = await getTranslations("Registration");
  const windowWords = minutesPhrase(locale, windowMinutes ?? (await cachedDeadlines()).familySittingMinutes);
  // The time left, not the whole window (the review's nit): the screen may be opened again later.
  const left = minutesPhrase(locale, Math.max(1, sittingMinutesLeft(releaseInMs)));
  // A form that was not kept (§493) is not «the form for …» that arrived: the plain lead then.
  const latest = sameBirthDate ? null : (names.at(-1) ?? null);
  /*
    The family marker (§NNN; the owner, 2026-09-28: «trebuie un marker pentru familie... nu e clar cum
    rezervăm»): «Înscriere de familie: Ana, Mihai, Ioana — 3 locuri rezervate până la 12:40», and beside
    each name the place its form got. Only once a place was reserved at all (`until`).
  */
  const until = reservation?.until ?? null;
  const facts = reservation ? sittingReservationFacts(reservation.people) : null;
  const places: string[] = [];
  if (facts && until) {
    const words = reservedUntilWords(until, new Date(), locale);
    const untilWords = t(words.key === "reservedToday" ? "sitting.untilToday" : "sitting.untilOn", { at: words.at });
    if (facts.reserved > 0) places.push(`${t(`sitting.reserved.${countForm(facts.reserved, locale)}`, { count: facts.reserved })} ${untilWords}`);
    if (facts.waiting > 0) places.push(t(`sitting.waiting.${countForm(facts.waiting, locale)}`, { count: facts.waiting }));
  }
  const marker =
    facts && facts.firstNames.length > 0
      ? places.length > 0
        ? t("sitting.markerPlaces", { names: facts.firstNames.join(", "), places: places.join(", ") })
        : t("sitting.marker", { names: facts.firstNames.join(", ") })
      : null;
  const placeOf = (index: number): string | null => {
    const person = until ? reservation?.people[index] : undefined;
    // A form that wrote no registration names no place (§NNN): the public count took none.
    if (!person || person.noPlace) return null;
    return person.waitlist ? t("sitting.placeWaitlist") : t("sitting.placeReserved");
  };

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
        {/*
          When the email leaves, in one honest sentence (the review of 2026-09-27): on «Gata», or by
          itself after the club's window from the last form — and how long is left of it now. At a
          window of 0 nothing waited: the email has already left.
        */}
        <Typography variant="body1" sx={{ fontWeight: 700, mt: 1 }} data-testid="family-sitting-when">
          {atOnce ? t("sitting.alreadySent") : t("sitting.when", { window: windowWords, left })}
        </Typography>
      </Box>

      {/*
        Another name on a birth date typed before (§493): twins, or a corrected name. The form was not
        kept and nobody was replaced — the list below is what the email will name — so the screen says
        so, with what can be done. Both names were typed on this browser (§39).
      */}
      {sameBirthDate && (
        <Alert severity="warning" data-testid="family-sitting-same-birth-date">
          {t("sitting.sameBirthDate", { name: sameBirthDate.typed, kept: sameBirthDate.kept })}
        </Alert>
      )}

      <Box component="section" aria-labelledby="family-sitting-so-far" sx={{ border: 1, borderColor: "divider", borderRadius: 1, p: 2 }}>
        <Typography id="family-sitting-so-far" variant="body2" color="text.secondary">
          {t("sitting.soFar")}{" "}
          <Box component="strong" sx={{ color: "text.primary", wordBreak: "break-all" }}>
            {email}
          </Box>
        </Typography>
        {marker && (
          <Typography variant="body1" sx={{ mt: 1, fontWeight: 700, display: "flex", alignItems: "flex-start", gap: 0.75 }} data-testid="family-sitting-marker">
            <FamilyRestroomIcon fontSize="small" aria-hidden="true" sx={{ mt: 0.25 }} />
            <span>{marker}</span>
          </Typography>
        )}
        <Box component="ol" sx={{ m: 0, mt: 1, pl: 3 }} data-testid="family-sitting-names">
          {names.map((name, index) => (
            <Typography component="li" key={`${index}-${name}`}>
              <Box component="span" sx={{ fontWeight: 700 }}>
                {name}
              </Box>
              {placeOf(index) && <Box component="span" color="text.secondary">{` — ${placeOf(index)}`}</Box>}
            </Typography>
          ))}
        </Box>
        {places.length > 0 && (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            {t("sitting.reservedHelp")}
          </Typography>
        )}
      </Box>

      <Box>
        <Typography component="h3" variant="h3" sx={{ fontSize: "1.25rem", mb: 1.5 }}>
          {t("sitting.question")}
        </Typography>
        <Stack spacing={1.5} sx={{ alignItems: "stretch", maxWidth: 480 }}>
          {/*
            A press, not a link (§519): «Da» starts the window again — the server's row, its held
            messages and this browser's half together — so it never lapses while the next form is open.
          */}
          <form action={continueAction} data-testid="family-sitting-add">
            <input type="hidden" name="locale" value={locale} />
            <input type="hidden" name="slug" value={slug} />
            <SubmitButton label={t("sitting.add")} pendingLabel={t("sitting.addPending")} variant="outlined" size="large" fullWidth>
              <PersonAddIcon />
            </SubmitButton>
          </form>
          <form action={releaseAction} data-testid="family-sitting-done">
            <input type="hidden" name="locale" value={locale} />
            <input type="hidden" name="slug" value={slug} />
            {/* The window's end, while this screen is open: the same press, by itself. Nothing waits at 0. */}
            {!atOnce && <PressWhenWindowEnds delayMs={releaseInMs} field={AUTO_PRESS_FIELD} />}
            <SubmitButton label={atOnce ? t("sitting.doneAtOnce") : t("sitting.done")} pendingLabel={t("sitting.donePending")} size="large" fullWidth>
              <MarkEmailReadIcon />
            </SubmitButton>
          </form>
        </Stack>
      </Box>

      {/*
        What happens next, one fact a line and none said twice — the clarity the owner asked for first.
        At a window of 0 each person's email has left on its own, so there is no «one email» to explain.
      */}
      {!atOnce && (
        <Box sx={{ borderLeft: 3, borderColor: "primary.main", pl: 2 }}>
          <Typography variant="body2">{t("sitting.oneEmail")}</Typography>
          <Typography variant="body2">{t("sitting.wizard")}</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            {t("sitting.pageClosed")}
          </Typography>
        </Box>
      )}
    </Stack>
  );
}
