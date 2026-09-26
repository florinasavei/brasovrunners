import MarkEmailUnreadOutlinedIcon from "@mui/icons-material/MarkEmailUnreadOutlined";
import Alert from "@mui/material/Alert";
import AlertTitle from "@mui/material/AlertTitle";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { getTranslations } from "next-intl/server";
import { submitNewsletterAction } from "@/app/[locale]/contact/actions";
import { getPathname, Link } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import TurnstileWidget from "@/modules/registrations/ui/TurnstileWidget";
import SubmitButton from "@/shared/ui/SubmitButton";
import { TAP_TARGET } from "@/shared/ui/tap-target";
import { DENSITY } from "@/theme/density";
import { NEWSLETTER_TOPICS } from "../domain/topics";
import NewsletterDialogButton from "./NewsletterDialogButton";
import {
  NEWSLETTER_DIALOG_ID,
  NEWSLETTER_ERROR_SUMMARY_ID,
  NEWSLETTER_SECTION_ID,
  NEWSLETTER_TRIGGER_ID,
  newsletterDialogOpen,
  type NewsletterOutcome,
} from "./newsletter-box";

type Props = {
  locale: Locale;
  outcome: NewsletterOutcome | null;
  /** The boxes a refusal named (`?fields=`). */
  refused: readonly ("email" | "topics")[];
  /** What was typed before a refusal, from the sealed draft (§142): the address and the ticked topics. */
  typed: { email?: string; topics?: readonly string[] };
  /** Cloudflare Turnstile's site key when the club's check is on (§97), or nothing. */
  siteKey: string | undefined;
  /** When the form was first drawn — the corrected form is timed from the render it corrects (§146's `since`). */
  renderedAt: string;
};

/**
 * "Noutățile clubului" on the contact page (§NNN; the owner: "a button for a pop-up and people can
 * opt in on what to receive").
 *
 * A Server Component: a heading, one sentence, the button, and the pop-up — a native `<dialog>`
 * drawn here with the whole form in it: the address, the topics as plain checkboxes (each a
 * 44-pixel row), the anti-bot defences of every public form, and the sentence and the link to the
 * privacy notice that describes what happens to the address. The one island is the button that
 * opens it modally (`NewsletterDialogButton`); with no script the button is a link to the page with
 * the dialog open, and every guard is on the server.
 *
 * The page draws this only while the privacy notice in force describes the newsletter
 * (`cachedNewsletterOffered`): nothing is collected before the club's approved text says why.
 */
export default async function NewsletterSignup({ locale, outcome, refused, typed, siteKey, renderedAt }: Props) {
  const t = await getTranslations("Newsletter");
  const contactPath = getPathname({ locale, href: "/contact" });
  const open = newsletterDialogOpen(outcome);
  const ticked = new Set(typed.topics ?? []);
  const invalid = new Set<string>(refused);
  const inlineLink = { display: "inline-flex", alignItems: "center", minHeight: TAP_TARGET.minHeight } as const;
  const errorText =
    outcome === "invalid"
      ? null
      : outcome === "captcha"
        ? t("errors.captcha")
        : outcome === "limited"
          ? t("errors.limited")
          : null;

  return (
    <Box
      component="section"
      id={NEWSLETTER_SECTION_ID}
      aria-labelledby="newsletter-heading"
      data-testid="newsletter-section"
      sx={{ mt: { xs: DENSITY.sectionGapLg, sm: 4 }, pt: { xs: DENSITY.sectionGap, sm: 3 }, borderTop: 1, borderColor: "divider", scrollMarginTop: 16 }}
    >
      <Typography id="newsletter-heading" variant="h2" sx={{ fontSize: "1.35rem", mb: 1 }}>
        {t("heading")}
      </Typography>
      <Typography variant="body1" color="text.secondary" sx={{ mb: 2 }}>
        {t("intro")}
      </Typography>

      {outcome === "sent" && (
        <Alert severity="success" role="status" sx={{ mb: 2 }} data-testid="newsletter-sent">
          <AlertTitle>{t("sent.title")}</AlertTitle>
          {t("sent.body")}
        </Alert>
      )}
      {outcome === "unavailable" && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          {t("errors.unavailable")}
        </Alert>
      )}

      {/*
        The button is a link the server draws, so a press before the script arrives still opens the
        pop-up — on the page it links to. The island gives it `showModal()` once the script is here.
      */}
      <Box
        component="a"
        id={NEWSLETTER_TRIGGER_ID}
        href={`${contactPath}?newsletter=open#${NEWSLETTER_DIALOG_ID}`}
        aria-haspopup="dialog"
        aria-controls={NEWSLETTER_DIALOG_ID}
        data-testid="newsletter-open"
        sx={{
          display: "inline-flex",
          alignItems: "center",
          gap: 1,
          minHeight: TAP_TARGET.minHeight,
          px: 2.5,
          py: 1,
          borderRadius: 1,
          bgcolor: "primary.main",
          color: "primary.contrastText",
          fontWeight: 600,
          fontSize: "1rem",
          textDecoration: "none",
          boxShadow: 2,
          "&:hover": { bgcolor: "primary.dark" },
          "&:focus-visible": { outline: "3px solid", outlineColor: "primary.light", outlineOffset: 2 },
        }}
      >
        <MarkEmailUnreadOutlinedIcon aria-hidden="true" sx={{ fontSize: 22 }} />
        {t("open")}
      </Box>
      <NewsletterDialogButton
        triggerId={NEWSLETTER_TRIGGER_ID}
        dialogId={NEWSLETTER_DIALOG_ID}
        arrival={open ? "modal" : outcome === "sent" || outcome === "unavailable" ? "closed" : "none"}
        stamp={renderedAt}
      />

      <Box
        component="dialog"
        id={NEWSLETTER_DIALOG_ID}
        open={open}
        aria-labelledby="newsletter-dialog-title"
        data-testid="newsletter-dialog"
        sx={{
          // The browser's own modal: centred, over a dimmed page, focus kept inside, Escape closes.
          width: "min(560px, calc(100vw - 32px))",
          maxHeight: "calc(100dvh - 32px)",
          boxSizing: "border-box",
          overflowY: "auto",
          p: { xs: 2, sm: 3 },
          border: 0,
          borderRadius: 2,
          bgcolor: "background.paper",
          color: "text.primary",
          boxShadow: 12,
          "&::backdrop": { backgroundColor: "rgba(0, 0, 0, 0.5)" },
          // Without a script the dialog opens in the page's flow, not over it.
          "&[open]:not(:modal)": { position: "relative", my: 2, mx: 0, boxShadow: 3 },
        }}
      >
        <Stack direction="row" spacing={1} sx={{ alignItems: "flex-start", justifyContent: "space-between", mb: 1 }}>
          <Typography id="newsletter-dialog-title" variant="h2" sx={{ fontSize: "1.25rem", pt: 1 }}>
            {t("dialogTitle")}
          </Typography>
          {/* Closed by the browser itself, script or not: a `method="dialog"` form. */}
          <form method="dialog">
            <Button type="submit" sx={TAP_TARGET} data-testid="newsletter-close">
              {t("close")}
            </Button>
          </form>
        </Stack>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {t("dialogIntro")}
        </Typography>

        {(outcome === "invalid" || errorText) && (
          <Alert severity="error" id={NEWSLETTER_ERROR_SUMMARY_ID} role="alert" tabIndex={-1} sx={{ mb: 2 }}>
            <AlertTitle>{t("errors.title")}</AlertTitle>
            {errorText ?? (
              <Box component="ul" sx={{ m: 0, pl: 3 }}>
                {(refused.length > 0 ? refused : (["email"] as const)).map((name) => (
                  <li key={name}>
                    <a href={`#newsletter-${name}`}>{t(`errors.${name}`)}</a>
                  </li>
                ))}
              </Box>
            )}
          </Alert>
        )}

        <form action={submitNewsletterAction} data-testid="newsletter-form">
          <Stack spacing={2}>
            <input type="hidden" name="locale" value={locale} />
            {/* Bots fill every field; a human never sees or fills this one. */}
            <input
              type="text"
              name="honeypot"
              autoComplete="off"
              tabIndex={-1}
              aria-hidden="true"
              style={{ position: "absolute", left: "-9999px", width: 1, height: 1 }}
            />
            <input type="hidden" name="renderedAt" value={renderedAt} />

            <TextField
              id="newsletter-email"
              // Its own name: the contact form above posts an `email` of its own on the same page.
              name="newsletterEmail"
              type="email"
              label={t("email")}
              required
              autoComplete="email"
              fullWidth
              defaultValue={typed.email}
              error={invalid.has("email")}
              helperText={invalid.has("email") ? t("errors.email") : t("emailHelp")}
            />

            <Box
              component="fieldset"
              id="newsletter-topics"
              aria-describedby="newsletter-topics-help"
              sx={{ m: 0, p: 0, border: 0, minWidth: 0 }}
            >
              <Typography component="legend" variant="subtitle2" sx={{ mb: 0.5 }}>
                {t("topicsLegend")}
              </Typography>
              <Typography id="newsletter-topics-help" variant="body2" color={invalid.has("topics") ? "error" : "text.secondary"} sx={{ mb: 1 }}>
                {invalid.has("topics") ? t("errors.topics") : t("topicsHelp")}
              </Typography>
              <Stack spacing={0.5}>
                {NEWSLETTER_TOPICS.map((topic) => (
                  <Box
                    component="label"
                    key={topic}
                    data-testid={`newsletter-topic-${topic}`}
                    sx={{
                      display: "flex",
                      alignItems: "flex-start",
                      gap: 1.5,
                      minHeight: TAP_TARGET.minHeight,
                      py: 0.75,
                      cursor: "pointer",
                      // The club's blue in either scheme: the theme's own variable (`theme.ts` sets `cssVariables`).
                      "& input": { width: 22, height: 22, mt: 0.25, flexShrink: 0, accentColor: "var(--mui-palette-primary-main)" },
                    }}
                  >
                    <input type="checkbox" name="topics" value={topic} defaultChecked={ticked.has(topic)} />
                    <Box component="span">
                      <Box component="span" sx={{ display: "block", fontWeight: topic === "ALL" ? 700 : 500 }}>
                        {t(`topics.${topic}`)}
                      </Box>
                      <Typography component="span" variant="body2" color="text.secondary" sx={{ display: "block" }}>
                        {t(`topicHints.${topic}`)}
                      </Typography>
                    </Box>
                  </Box>
                ))}
              </Stack>
            </Box>

            {siteKey && (
              <Box id="newsletter-captcha">
                <TurnstileWidget siteKey={siteKey} locale={locale} attempt={renderedAt} />
              </Box>
            )}

            {/* What happens to the address, and the notice that says it — a sentence, not a bare link. */}
            <Typography variant="body2" color="text.secondary">
              {t("privacy")}{" "}
              <Link href="/legal/privacy" style={inlineLink}>
                {t("privacyLinkLabel")}
              </Link>
              .
            </Typography>

            <SubmitButton label={t("submit")} pendingLabel={t("submitting")} size="large" fullWidth />
          </Stack>
        </form>
      </Box>
    </Box>
  );
}
