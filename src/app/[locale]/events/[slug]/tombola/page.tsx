import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import GavelIcon from "@mui/icons-material/Gavel";
import RedeemIcon from "@mui/icons-material/Redeem";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Container from "@mui/material/Container";
import MuiLink from "@mui/material/Link";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { getDb } from "@/db/client";
import { getPathname } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import LegalDocumentBody from "@/modules/legal-documents/ui/LegalDocumentBody";
import { cachedBotCheckSiteKey, cachedRaffleEvent, cachedRaffleSignUpOpen } from "@/modules/public-cache/reads";
import { BOT_CHECK_SLOT_SX } from "@/modules/registrations/domain/turnstile-widget";
import { readFormDraft } from "@/modules/registrations/form-draft";
import { parseInterestSince } from "@/modules/registrations/interest-box";
import BotCheck from "@/modules/registrations/ui/BotCheck";
import { formEventBySlug } from "@/modules/resilience/event-copy";
import { readOrWhileAway } from "@/modules/resilience/optional-read";
import { RAFFLE_TYPED_NAME_MAX } from "@/db/schema/event-raffle-entries";
import { RAFFLE_NUMBER_MAX } from "@/modules/volunteers/domain/raffle";
import { readRaffleRules } from "@/modules/volunteers/raffle-roster";
import PublicFlash from "@/shared/feedback/PublicFlash";
import CheckboxField from "@/shared/ui/CheckboxField";
import { FOLD_GLYPH_SX, PUBLIC_FOLD_SX } from "@/shared/ui/disclosure";
import LegalLink from "@/shared/ui/LegalLink";
import SubmitButton from "@/shared/ui/SubmitButton";
import { TAP_TARGET } from "@/shared/ui/tap-target";
import { PAGE_WIDTH } from "@/theme/brand";
import { DENSITY } from "@/theme/density";
import { raffleFormAction } from "./actions";

type Props = {
  params: Promise<{ locale: string; slug: string }>;
  searchParams: Promise<{ tombola?: string | string[]; fields?: string | string[]; since?: string | string[] }>;
};

/** One value of a query key: the first, when the address repeats it. */
const one = (value: string | string[] | undefined): string | undefined => (Array.isArray(value) ? value[0] : value);

/** The answers the address may carry, and the boxes a refusal may name. */
const OUTCOMES = ["done", "nomatch", "limited", "captcha", "invalid"] as const;
type Outcome = (typeof OUTCOMES)[number];
const BOXES = ["number", "name", "accept"] as const;

/** Per request, like the volunteers' page this follows: the render time is the bot check's clock, a refusal's boxes come back sealed. */
export const dynamic = "force-dynamic";

/** A form page is never in a search index (the registration's rule). */
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, slug } = await params;
  const robots = { index: false, follow: false };
  if (!hasLocale(routing.locales, locale)) return { robots };
  const event = await readOrWhileAway(() => formEventBySlug(locale, slug), undefined);
  if (!event) return { robots };
  const t = await getTranslations({ locale, namespace: "Event" });
  return { title: t("raffle.metaTitle", { event: event.title }), robots };
}

/**
 * The raffle's own page (§NNN; the owner, 2026-11-18: «Practic oamenii trebuie să își treacă numărul de concurs și numele, dar trebuie
 * să am și o bifă de „voluntar”»): `/evenimente/<slug>/tombola` and `/en/events/<slug>/raffle` — «Înscrie-te la tombolă»: the race number
 * (digits only), the name as at registration, «Sunt voluntar» while the event's volunteers may take part, «Regulamentul tombolei» in a fold
 * with its blanks filled for the event, the acceptance's tick, the privacy notice's line, the honeypot, the render time and — where the
 * club switched it on — Turnstile. The answer comes back here (`?tombola=`): the thank-you with its toast (the same for a person in already),
 * one neutral sentence for a number and a name that name nobody, the throttle's, the bot check's, or the boxes to fix.
 *
 * **404 while the gate is shut** (`raffleSignUpClosedFor`, through the public cache's twins): no raffle, not the sign-up mode, sign-ups
 * closed, not a published scheduled race, over, no rules or no notice in force — never a form that cannot work. The one exception is the
 * thank-you of a person reading the answer to their own post: the organizers may have closed the sign-ups meanwhile. A members' event is
 * a 404 too: its page is not public. The action asks every condition again, uncached.
 *
 * A public page (§318): the icons are their own files, every control 44 pixels tall, nothing but strings handed to an island.
 */
export default async function RafflePage({ params, searchParams }: Props) {
  const { locale, slug } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const asked = await searchParams;

  const now = new Date();
  const event = await formEventBySlug(locale, slug);
  if (!event) notFound();
  const answer = one(asked.tombola);
  const outcome: Outcome | null = (OUTCOMES as readonly string[]).includes(answer ?? "") ? (answer as Outcome) : null;
  const [open, raffle] = await Promise.all([readOrWhileAway(() => cachedRaffleSignUpOpen(event.id, now), false), readOrWhileAway(() => cachedRaffleEvent(event.id), null)]);
  if (!raffle || (!open && outcome !== "done")) notFound();

  const t = await getTranslations("Event");
  const tForm = await getTranslations("Registration");
  const rules = outcome === "done" ? null : await readRaffleRules(getDb(), event.id, raffle.settings, locale, now);
  if (outcome !== "done" && !rules) notFound();
  const volunteersMay = raffle.settings.groups.VOLUNTEER;
  const typed = outcome !== null && outcome !== "done" ? ((await readFormDraft()) ?? {}) : {};
  const refused = new Set((one(asked.fields) ?? "").split(",").filter((box): box is (typeof BOXES)[number] => (BOXES as readonly string[]).includes(box)));
  // The widget as the other public forms draw it (§254, §675): only while the Administrator's switch is on and its keys are set.
  const siteKey = await cachedBotCheckSiteKey();
  // A corrected form is timed from the render it corrects (§146), as the volunteers' page times it: a second press seconds after a
  // refusal is a person trying again, never a post the timing check would take for a script's and quietly keep nothing of.
  const renderedAt = ((outcome !== null && outcome !== "done" && parseInterestSince(one(asked.since), now)) || now).toISOString();
  // The bot check's own attempt is this render's, so a second try draws a fresh widget.
  const attempt = now.toISOString();
  const eventHref = getPathname({ locale, href: { pathname: "/events/[slug]", params: { slug } } });

  return (
    <Container id="main" component="main" maxWidth={PAGE_WIDTH} sx={{ py: { xs: DENSITY.pagePadY, sm: 3 } }}>
      <Typography variant="body2" sx={{ mb: 2 }}>
        {/* The house's back link (§469): a left arrow before the words, 44 pixels tall. */}
        <MuiLink href={eventHref} data-testid="raffle-back" sx={{ display: "inline-flex", alignItems: "center", gap: 0.5, ...TAP_TARGET }}>
          <ArrowBackIcon aria-hidden="true" sx={{ fontSize: 18 }} />
          {t("raffle.back")}
        </MuiLink>
      </Typography>
      <Typography variant="h1" gutterBottom sx={{ fontSize: "1.5rem" }} data-testid="raffle-title">
        {t("raffle.title")}
      </Typography>

      <Box id="raffle-form" sx={{ scrollMarginTop: 16 }}>
        {outcome === "done" ? (
          <>
            <Alert severity="success" role="status" data-testid="raffle-done">
              {t("raffle.done")}
            </Alert>
            {/* The toast the sign-up flashed (§427), here and on no other state of this page. */}
            <PublicFlash accept={["raffleEntered"]} />
          </>
        ) : rules ? (
          <Stack component="form" action={raffleFormAction} spacing={2} data-testid="raffle-form-fields">
            <input type="hidden" name="locale" value={locale} />
            <input type="hidden" name="slug" value={slug} />
            {/* Bots fill every field; a human never sees or fills this one. */}
            <input type="text" name="honeypot" autoComplete="off" tabIndex={-1} aria-hidden="true" style={{ position: "absolute", left: "-9999px", width: 1, height: 1 }} />
            <input type="hidden" name="renderedAt" value={renderedAt} />

            {outcome === "nomatch" && (
              <Alert severity="warning" role="alert" data-testid="raffle-no-match">
                {t("raffle.noMatch")}
              </Alert>
            )}
            {outcome === "limited" && (
              <Alert severity="warning" role="alert" data-testid="raffle-limited">
                {t("raffle.limited")}
              </Alert>
            )}
            {outcome === "captcha" && (
              <Alert severity="warning" role="alert" data-testid="raffle-captcha">
                {t("raffle.captcha")}
              </Alert>
            )}
            {outcome === "invalid" && (
              <Alert severity="warning" role="alert" data-testid="raffle-invalid">
                {t("raffle.fix")}
              </Alert>
            )}

            <Typography>{t("raffle.intro", { event: event.title })}</Typography>
            {volunteersMay && <Typography variant="body2" color="text.secondary">{t("raffle.introVolunteer")}</Typography>}

            <TextField
              name="number"
              label={t("raffle.number")}
              helperText={refused.has("number") ? t("raffle.errors.number") : t("raffle.numberHelp")}
              error={refused.has("number")}
              defaultValue={typed.number ?? ""}
              required
              autoComplete="off"
              slotProps={{ htmlInput: { inputMode: "numeric", pattern: "[0-9]*", maxLength: String(RAFFLE_NUMBER_MAX).length, "data-testid": "raffle-number" } }}
              sx={{ maxWidth: 320 }}
            />
            <TextField
              name="name"
              label={t("raffle.name")}
              helperText={refused.has("name") ? t("raffle.errors.name") : t("raffle.nameHelp")}
              error={refused.has("name")}
              defaultValue={typed.name ?? ""}
              required
              autoComplete="name"
              slotProps={{ htmlInput: { maxLength: RAFFLE_TYPED_NAME_MAX, "data-testid": "raffle-name" } }}
            />
            {/* «Sunt voluntar» (§NNN): only while the event's volunteers may take part; the number is then the volunteer's own. */}
            {volunteersMay && (
              <CheckboxField name="volunteer" defaultChecked={typed.volunteer === "on"} help={t("raffle.volunteerHelp")}>
                {t("raffle.volunteer")}
              </CheckboxField>
            )}

            {/* «Regulamentul tombolei», in force, its blanks filled for this event: read here, before the tick that accepts it. */}
            <Box component="details" sx={PUBLIC_FOLD_SX} data-testid="raffle-rules">
              <Typography component="summary" variant="subtitle2">
                <GavelIcon aria-hidden sx={FOLD_GLYPH_SX} />
                {t("raffle.rules")}
              </Typography>
              <Box sx={{ mt: 1 }}>
                <Typography variant="h2" sx={{ fontSize: "1.125rem", mb: 1 }}>
                  {rules.title}
                </Typography>
                <LegalDocumentBody body={rules.body} values={rules.values} anchorPrefix="raffle-s" />
              </Box>
            </Box>

            <CheckboxField
              name="accept"
              required
              error={refused.has("accept") ? t("raffle.errors.accept") : undefined}
              requiredMessage={t("raffle.errors.accept")}
            >
              {t("raffle.accept")}
            </CheckboxField>

            <Typography variant="body2" color="text.secondary" data-testid="raffle-notice">
              {t.rich("raffle.notice", {
                privacy: (chunks) => (
                  <LegalLink href="/legal/privacy" newTabLabel={tForm("opensInNewTab")}>
                    {chunks}
                  </LegalLink>
                ),
              })}
            </Typography>

            {siteKey && (
              <Box sx={BOT_CHECK_SLOT_SX}>
                <BotCheck siteKey={siteKey} locale={locale} attempt={attempt} notice />
              </Box>
            )}

            <Box>
              <SubmitButton label={t("raffle.submit")} pendingLabel={t("raffle.submitting")} size="large">
                <RedeemIcon />
              </SubmitButton>
            </Box>
          </Stack>
        ) : null}
      </Box>
    </Container>
  );
}
