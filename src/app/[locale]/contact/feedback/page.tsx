import ArrowForwardIcon from "@mui/icons-material/ArrowForward";
import SentimentDissatisfiedIcon from "@mui/icons-material/SentimentDissatisfied";
import SentimentNeutralIcon from "@mui/icons-material/SentimentNeutral";
import SentimentSatisfiedIcon from "@mui/icons-material/SentimentSatisfied";
import SentimentVeryDissatisfiedIcon from "@mui/icons-material/SentimentVeryDissatisfied";
import SentimentVerySatisfiedIcon from "@mui/icons-material/SentimentVerySatisfied";
import Alert from "@mui/material/Alert";
import AlertTitle from "@mui/material/AlertTitle";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Container from "@mui/material/Container";
import MuiLink from "@mui/material/Link";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound, unstable_rethrow } from "next/navigation";
import type { ComponentType } from "react";
import { CLUB_TIME_ZONE, formatDay } from "@/i18n/dates";
import { getPathname, Link } from "@/i18n/navigation";
import { type Locale, routing } from "@/i18n/routing";
import { contactSmtpRoadExists } from "@/modules/contact/delivery";
import {
  BRANCH_SLUG,
  BRANCH_FIELDS,
  FEEDBACK_ERROR_SUMMARY_ID,
  FEEDBACK_LINE_MAX,
  FEEDBACK_QUERY,
  FEEDBACK_TEXT_MAX,
  type FeedbackBranch,
  type FeedbackField,
  offeredBranches,
  parseFeedbackError,
  parseFeedbackErrorFields,
  PICKER_FUTURE_DAYS,
  PICKER_PAST_DAYS,
  pickerOrder,
  RATINGS,
  readFeedbackQuery,
  STOPPED_REASONS,
  wizardStep,
} from "@/modules/feedback/domain/branches";
import { cachedBotCheckSiteKey, cachedFeedbackFormsDescribed, cachedFeedbackOffer, cachedPublishedEventsBetween } from "@/modules/public-cache/reads";
import { parseInterestSince } from "@/modules/registrations/interest-box";
import { readFormDraft } from "@/modules/registrations/form-draft";
import BotCheck from "@/modules/registrations/ui/BotCheck";
import { BOT_CHECK_ERROR_ATTRIBUTE, BOT_CHECK_SLOT_SX } from "@/modules/registrations/domain/turnstile-widget";
import CheckboxField from "@/shared/ui/CheckboxField";
import RadioField from "@/shared/ui/RadioField";
import SubmitButton from "@/shared/ui/SubmitButton";
import { INLINE_TAP_TARGET, TAP_TARGET } from "@/shared/ui/tap-target";
import { glyphSx, WITH_GLYPH_SX } from "@/shared/ui/button-glyph";
import { DENSITY } from "@/theme/density";
import { submitFeedbackAction } from "./actions";

type Search = {
  tip?: string;
  eveniment?: string;
  data?: string;
  sent?: string;
  error?: string;
  fields?: string;
  since?: string;
};

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Search>;
};

/** Per request: the draft cookie, the step in the address and the outcome of a press. */
export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) return {};
  const t = await getTranslations({ locale, namespace: "Tell" });
  // A form, not content: kept out of the index, like the pages a link opens.
  return { title: t("title"), description: t("intro"), robots: { index: false, follow: false } };
}

const fieldId = (name: string) => `f-${name}`;

const FACES: Readonly<Record<(typeof RATINGS)[number], ComponentType<{ "aria-hidden"?: boolean | "true"; sx?: object }>>> = {
  1: SentimentVeryDissatisfiedIcon,
  2: SentimentDissatisfiedIcon,
  3: SentimentNeutralIcon,
  4: SentimentSatisfiedIcon,
  5: SentimentVerySatisfiedIcon,
};

const DAY_MS = 24 * 60 * 60_000;

/** The start of `now`'s UTC day, so the picker's cached range is one key per day, not one per request. */
function dayStart(at: Date): Date {
  return new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
}

/**
 * «Spune-ne ceva» / "Tell us something" (§NNN; BR-REQ-070-04) — one door from `/contact`, one
 * server-rendered wizard with no client state beyond the form.
 *
 * Step 1 «Despre ce e vorba?» is a `GET` form: native radios, one per branch the club switched on,
 * and «Continuă» — the branch is `?tip=` in the address, so the back button works. One branch on is
 * that branch's form straight away; none on, or the privacy notice in force not describing the forms,
 * is a 404 (and no door on `/contact`). Each form posts to `submitFeedbackAction`; a refusal comes
 * back here with the boxes named in `?fields=` and what was typed in the sealed draft (§142), never
 * in the address (AGENTS.md §14.5).
 */
export default async function FeedbackPage({ params, searchParams }: Props) {
  const { locale: raw } = await params;
  if (!hasLocale(routing.locales, raw)) notFound();
  const locale: Locale = raw;
  setRequestLocale(locale);

  const search = await searchParams;
  const now = new Date();
  const t = await getTranslations("Tell");

  // Tolerant of an outage like every read on the contact page (§281): no answer is no door.
  const [offer, described] = await Promise.all([orNull(() => cachedFeedbackOffer()), orNull(() => cachedFeedbackFormsDescribed(now))]);
  // The three ordinary branches only where the SMTP road exists (`CONTACT_FORM_MODE`), as «Scrie-ne» draws no form without one.
  const offered = offer ? offeredBranches(offer, described === true, contactSmtpRoadExists()) : [];
  const query = readFeedbackQuery(search);
  const sentBranch = Object.entries(BRANCH_SLUG).find(([, slug]) => slug === search.sent)?.[0] as FeedbackBranch | undefined;
  const step = wizardStep(offered, sentBranch ?? query.branch);
  if (step.kind === "none") notFound();

  const path = getPathname({ locale, href: "/contact/feedback" });
  const contactPath = getPathname({ locale, href: "/contact" });
  const safetyName = offer?.safety.name ?? "";

  return (
    <Container id="main" component="main" maxWidth="sm" sx={{ py: { xs: DENSITY.pagePadY, sm: 3 } }}>
      <Typography variant="body2" sx={{ mb: 1 }}>
        <Link href="/contact" style={INLINE_TAP_TARGET}>
          {t("backToContact")}
        </Link>
      </Typography>
      <Typography variant="h1" gutterBottom>
        {t("title")}
      </Typography>

      {sentBranch && offered.includes(sentBranch) ? (
        <Alert severity="success" role="status" data-testid="feedback-sent">
          <AlertTitle>{t("sent.title")}</AlertTitle>
          {sentBranch === "safety" ? t("sent.safety", { name: safetyName }) : t("sent.body")}
        </Alert>
      ) : step.kind === "choose" ? (
        <ChooseStep branches={step.branches} path={path} query={query} t={t} />
      ) : (
        <BranchForm branch={step.branch} single={step.single} locale={locale} search={search} query={query} now={now} safetyName={safetyName} contactPath={contactPath} />
      )}
    </Container>
  );
}

type T = Awaited<ReturnType<typeof getTranslations<"Tell">>>;

/** Step 1: one native radio per branch on, and «Continuă» — a `GET`, so `?tip=` is the step. */
function ChooseStep({ branches, path, query, t }: { branches: FeedbackBranch[]; path: string; query: ReturnType<typeof readFeedbackQuery>; t: T }) {
  return (
    <>
      <Typography variant="body1" color="text.secondary" sx={{ mb: 2 }}>
        {t("intro")}
      </Typography>
      <form method="get" action={path} data-testid="feedback-choose">
        {/* The event and the day a link chose ride on to the form, unread until it draws. */}
        {query.eventSlug && <input type="hidden" name={FEEDBACK_QUERY.event} value={query.eventSlug} />}
        {query.date && <input type="hidden" name={FEEDBACK_QUERY.date} value={query.date} />}
        <Box component="fieldset" sx={{ border: 0, m: 0, p: 0 }}>
          <Typography component="legend" variant="h2" sx={{ fontSize: "1.25rem", mb: 1 }}>
            {t("choose.legend")}
          </Typography>
          <Stack spacing={0.5}>
            {branches.map((branch, index) => (
              <Box key={branch}>
                <RadioField name={FEEDBACK_QUERY.branch} value={BRANCH_SLUG[branch]} defaultChecked={query.branch && branches.includes(query.branch) ? query.branch === branch : index === 0}>
                  {t(`branches.${branch}.label`)}
                </RadioField>
                <Typography variant="body2" color="text.secondary" sx={{ ml: 6, mt: -0.5 }}>
                  {t(`branches.${branch}.hint`)}
                </Typography>
              </Box>
            ))}
          </Stack>
        </Box>
        <Button type="submit" variant="contained" size="large" fullWidth sx={{ ...TAP_TARGET, ...WITH_GLYPH_SX, mt: 3 }}>
          {t("choose.next")}
          <ArrowForwardIcon aria-hidden="true" sx={glyphSx("large")} />
        </Button>
      </form>
    </>
  );
}

/** One branch's form, posted to the action; a refusal's boxes and words come back from the draft. */
async function BranchForm({
  branch,
  single,
  locale,
  search,
  query,
  now,
  safetyName,
  contactPath,
}: {
  branch: FeedbackBranch;
  single: boolean;
  locale: Locale;
  search: Search;
  query: ReturnType<typeof readFeedbackQuery>;
  now: Date;
  safetyName: string;
  contactPath: string;
}) {
  const t = await getTranslations("Tell");
  const error = parseFeedbackError(search.error);
  const rejected = parseFeedbackErrorFields(search.fields);
  const invalid = new Set<FeedbackField>(rejected);
  const draft = error ? await readFormDraft() : null;
  const kept = (name: string): string | undefined => draft?.[name];
  const siteKey = await orNull(() => cachedBotCheckSiteKey());
  // The corrected form is timed from the render it corrects (§146's `since`); a first render from now.
  const renderedAt = (error ? parseInterestSince(search.since, now) : null) ?? now;
  const fields = BRANCH_FIELDS[branch];

  // The picker (§NNN): published events of every kind, the last 90 days and the next 30, the held ones first.
  const withEvent = fields.includes("event");
  const from = new Date(dayStart(now).getTime() - PICKER_PAST_DAYS * DAY_MS);
  const to = new Date(dayStart(now).getTime() + (PICKER_FUTURE_DAYS + 1) * DAY_MS);
  const events = withEvent ? pickerOrder((await orNull(() => cachedPublishedEventsBetween(locale, from, to))) ?? [], now) : [];
  // A slug the club does not publish simply leaves «Altceva» selected — no 404, no error.
  const chosenEvent = kept("event") ?? (query.eventSlug && events.some((event) => event.slug === query.eventSlug) ? query.eventSlug : "");
  const ratingTyped = kept("rating") ?? "";
  const reasonsTyped = new Set((kept("reasons") ?? "").split(",").filter(Boolean));

  const box = (name: FeedbackField, help?: string) => ({
    id: fieldId(name),
    name,
    error: invalid.has(name),
    helperText: invalid.has(name) ? t("errors.field") : help,
    defaultValue: kept(name) ?? "",
  });
  const otherBranches = single ? null : getPathname({ locale, href: { pathname: "/contact/feedback", query: { ...(query.eventSlug ? { [FEEDBACK_QUERY.event]: query.eventSlug } : {}), ...(query.date ? { [FEEDBACK_QUERY.date]: query.date } : {}) } } });

  return (
    <>
      <Typography variant="h2" sx={{ fontSize: "1.35rem", mb: 1 }}>
        {t(`branches.${branch}.label`)}
      </Typography>
      {branch === "safety" ? (
        // Above the form, in the person's language (§NNN): who reads it, and that the site keeps nothing.
        <Alert severity="info" icon={false} sx={{ mb: 2 }} data-testid="feedback-safety-reader">
          {t("safety.reader", { name: safetyName })}
        </Alert>
      ) : (
        <Typography variant="body1" color="text.secondary" sx={{ mb: 2 }}>
          {t(`branches.${branch}.intro`)}
        </Typography>
      )}

      {error && (
        <Alert severity="error" id={FEEDBACK_ERROR_SUMMARY_ID} role="alert" tabIndex={-1} sx={{ mb: 2 }}>
          <AlertTitle>{t("errors.title")}</AlertTitle>
          {error === "VALIDATION_ERROR" && rejected.length > 0 ? (
            <>
              {t("errors.fieldsIntro")}
              <Box component="ul" sx={{ m: 0, mt: 1, pl: 3 }}>
                {rejected.map((name) => (
                  <li key={name}>
                    <MuiLink href={`#${fieldId(name)}`}>{t(`fieldNames.${name}`)}</MuiLink>
                  </li>
                ))}
              </Box>
            </>
          ) : error === "LIMITED" ? (
            t("errors.limited")
          ) : error === "UNAVAILABLE" ? (
            t("errors.unavailable")
          ) : (
            t("errors.generic")
          )}
        </Alert>
      )}

      <form action={submitFeedbackAction} data-testid={`feedback-form-${BRANCH_SLUG[branch]}`}>
        <input type="hidden" name="locale" value={locale} />
        <input type="hidden" name="branch" value={branch} />
        {/* Bots fill every field; a human never sees or fills this one. */}
        <input
          type="text"
          name="honeypot"
          autoComplete="off"
          tabIndex={-1}
          aria-hidden="true"
          style={{ position: "absolute", left: "-9999px", width: 1, height: 1 }}
        />
        <input type="hidden" name="renderedAt" value={renderedAt.toISOString()} />
        <Stack spacing={2}>
          {withEvent && (
            <TextField
              {...box("event")}
              defaultValue={chosenEvent}
              select
              label={t("event")}
              fullWidth
              slotProps={{ select: { native: true }, inputLabel: { shrink: true } }}
            >
              <option value="">{t("eventGeneral")}</option>
              {events.map((event) => (
                <option key={event.id} value={event.slug}>
                  {event.startsAt
                    ? `${event.title} — ${formatDay(event.startsAt, { locale, timeZone: event.timezone ?? CLUB_TIME_ZONE, style: "short", position: "continues" })}`
                    : event.title}
                </option>
              ))}
            </TextField>
          )}
          {fields.includes("date") && (
            <TextField
              {...box("date", t("dateHelp"))}
              defaultValue={kept("date") ?? query.date ?? ""}
              type="date"
              label={t("date")}
              fullWidth
              slotProps={{ inputLabel: { shrink: true } }}
            />
          )}
          {fields.includes("rating") && (
            <Box component="fieldset" id={fieldId("rating")} sx={{ border: 0, m: 0, p: 0 }}>
              <Typography component="legend" variant="body1" sx={{ mb: 1 }}>
                {t("rating.legend")}
              </Typography>
              <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1 }}>
                {RATINGS.map((rating) => {
                  const Face = FACES[rating];
                  return (
                    <Box
                      key={rating}
                      component="label"
                      sx={{
                        ...TAP_TARGET,
                        minWidth: 56,
                        display: "inline-flex",
                        flexDirection: "column",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: 0.25,
                        px: 1,
                        py: 0.5,
                        border: 1,
                        borderColor: "divider",
                        borderRadius: 1,
                        cursor: "pointer",
                        "&:has(input:checked)": { borderColor: "primary.main", bgcolor: "action.selected" },
                        "&:has(input:focus-visible)": { outline: 2, outlineColor: "primary.main", outlineStyle: "solid" },
                      }}
                    >
                      <input
                        type="radio"
                        name="rating"
                        value={String(rating)}
                        defaultChecked={ratingTyped === String(rating)}
                        style={{ position: "absolute", opacity: 0, width: 1, height: 1 }}
                      />
                      <Face aria-hidden="true" sx={{ fontSize: 28 }} />
                      <Typography component="span" variant="caption">
                        {t(`rating.faces.${rating}`)}
                      </Typography>
                    </Box>
                  );
                })}
              </Box>
            </Box>
          )}
          <TextField
            {...box("message", t(`messageHelp.${branch}`))}
            label={t(`message.${branch}`)}
            required
            multiline
            minRows={5}
            fullWidth
            slotProps={{ htmlInput: { maxLength: FEEDBACK_TEXT_MAX } }}
          />
          {fields.includes("reasons") && (
            <Box component="fieldset" id={fieldId("reasons")} sx={{ border: 0, m: 0, p: 0 }}>
              <Typography component="legend" variant="body1">
                {t("reasons.legend")}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {t("reasons.help")}
              </Typography>
              {STOPPED_REASONS.map((reason) => (
                <Box key={reason}>
                  <CheckboxField name="reasons" value={reason} defaultChecked={reasonsTyped.has(reason)}>
                    {t(`reasons.items.${reason}`)}
                  </CheckboxField>
                </Box>
              ))}
            </Box>
          )}
          {fields.includes("reasonOther") && (
            <TextField {...box("reasonOther")} label={t("reasonOther")} fullWidth slotProps={{ htmlInput: { maxLength: FEEDBACK_LINE_MAX } }} />
          )}
          {fields.includes("whereWhen") && (
            <TextField {...box("whereWhen")} label={t("safety.whereWhen")} fullWidth slotProps={{ htmlInput: { maxLength: FEEDBACK_LINE_MAX } }} />
          )}
          {fields.includes("contact") && (
            <TextField
              {...box("contact", t("safety.contactHelp"))}
              label={t("safety.contact", { name: safetyName })}
              fullWidth
              slotProps={{ htmlInput: { maxLength: FEEDBACK_LINE_MAX } }}
            />
          )}
          {fields.includes("email") && (
            <TextField {...box("email", t("emailHelp"))} type="email" label={t("email")} autoComplete="email" fullWidth />
          )}

          {/* Cloudflare Turnstile, when the club switched it on (§97); the render's own time resets it (§185). */}
          {siteKey && (
            <Box id={fieldId("captcha")} sx={BOT_CHECK_SLOT_SX}>
              <BotCheck siteKey={siteKey} locale={locale} attempt={now.toISOString()} notice />
              {invalid.has("captcha") && (
                <Typography variant="body2" color="error" sx={{ mt: 1 }} {...{ [BOT_CHECK_ERROR_ATTRIBUTE]: "true" }}>
                  {t("errors.captcha")}
                </Typography>
              )}
            </Box>
          )}

          <Typography variant="body2" color="text.secondary">
            {branch === "safety" ? t("privacySafety") : t("privacy")}{" "}
            <Link href="/legal/privacy" style={INLINE_TAP_TARGET}>
              {t("privacyLinkLabel")}
            </Link>
          </Typography>

          <SubmitButton label={t("submit")} pendingLabel={t("submitting")} runner incompleteHint={t("incompleteHint")} size="large" fullWidth />
        </Stack>
      </form>

      <Typography variant="body2" sx={{ mt: 3 }}>
        {otherBranches ? (
          <MuiLink href={otherBranches} sx={INLINE_TAP_TARGET}>
            {t("otherBranches")}
          </MuiLink>
        ) : (
          <MuiLink href={contactPath} sx={INLINE_TAP_TARGET}>
            {t("backToContact")}
          </MuiLink>
        )}
      </Typography>
    </>
  );
}

/** One read that may simply not answer (§281): `null` is a state every caller here has a rendering for. */
async function orNull<T>(read: () => Promise<T>): Promise<T | null> {
  try {
    return await read();
  } catch (error) {
    unstable_rethrow(error);
    console.error("[feedback] a lookup did not answer; the page stands without it");
    return null;
  }
}
