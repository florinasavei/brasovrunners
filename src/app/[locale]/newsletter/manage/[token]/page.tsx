import Alert from "@mui/material/Alert";
import AlertTitle from "@mui/material/AlertTitle";
import Box from "@mui/material/Box";
import Container from "@mui/material/Container";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { getDb } from "@/db/client";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { NEWSLETTER_TOPICS } from "@/modules/newsletter/domain/topics";
import { readNewsletterSubscription } from "@/modules/newsletter/service";
import SubmitButton from "@/shared/ui/SubmitButton";
import { TAP_TARGET } from "@/shared/ui/tap-target";
import { DENSITY } from "@/theme/density";
import { unsubscribeNewsletterAction, updateNewsletterTopicsAction } from "./actions";

type Props = {
  params: Promise<{ locale: string; token: string }>;
  searchParams: Promise<{ saved?: string; gone?: string; invalid?: string; topics?: string }>;
};

export const dynamic = "force-dynamic";

export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * The subscriber's own page (§445): the link under every newsletter and every new-event alert.
 *
 * The GET shows the address and the topics as they stand, and changes nothing. Two forms: the
 * topics, saved as ticked; and "unsubscribe from everything", which deletes the subscription and
 * the address with it — as easy as subscribing was (GDPR art. 7(3); Legea 506/2004 art. 12(2)).
 * Either POST spends the link (AGENTS.md §12.8); saving the topics lands on its successor, so the
 * page keeps working for the rest of the visit. Every message carries a fresh link of its own.
 */
export default async function NewsletterManagePage({ params, searchParams }: Props) {
  const { locale, token } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const { saved, gone, invalid, topics: topicsRefused } = await searchParams;
  const t = await getTranslations("Newsletter");
  const inlineLink = { display: "inline-flex", alignItems: "center", minHeight: TAP_TARGET.minHeight } as const;

  if (gone) {
    return (
      <Container id="main" component="main" maxWidth="sm" sx={{ py: { xs: DENSITY.pagePadY, sm: 3 } }}>
        <Typography variant="h1" gutterBottom sx={{ fontSize: "1.5rem" }}>
          {t("manage.title")}
        </Typography>
        <Alert severity="success" role="status" data-testid="newsletter-gone">
          <AlertTitle>{t("manage.gone")}</AlertTitle>
          {t("manage.goneBody")}
        </Alert>
      </Container>
    );
  }

  const subscription = invalid ? null : await readNewsletterSubscription(getDb(), token, new Date());

  return (
    <Container id="main" component="main" maxWidth="sm" sx={{ py: { xs: DENSITY.pagePadY, sm: 3 } }}>
      <Typography variant="h1" gutterBottom sx={{ fontSize: "1.5rem" }}>
        {t("manage.title")}
      </Typography>

      {!subscription ? (
        <Stack spacing={1.5} data-testid="newsletter-link-invalid">
          <Alert severity="warning">
            <AlertTitle>{t("linkInvalid")}</AlertTitle>
            {t("manage.invalidBody")}
          </Alert>
          <Typography variant="body2">
            <Link href="/contact" style={inlineLink}>
              {t("contactLink")}
            </Link>
          </Typography>
        </Stack>
      ) : (
        <Stack spacing={3}>
          {saved && (
            <Alert severity="success" role="status" data-testid="newsletter-saved">
              {t("manage.saved")}
            </Alert>
          )}
          <Typography>{t("manage.intro", { email: subscription.email })}</Typography>

          <form action={updateNewsletterTopicsAction} data-testid="newsletter-topics-form">
            <input type="hidden" name="locale" value={locale} />
            <input type="hidden" name="token" value={token} />
            <Box component="fieldset" sx={{ m: 0, p: 0, border: 0, minWidth: 0 }}>
              <Typography component="legend" variant="subtitle1" sx={{ fontWeight: 600, mb: 0.5 }}>
                {t("topicsLegend")}
              </Typography>
              <Typography variant="body2" color={topicsRefused ? "error" : "text.secondary"} sx={{ mb: 1 }}>
                {topicsRefused ? t("manage.topicsRefused") : t("topicsHelp")}
              </Typography>
              <Stack spacing={0.5} sx={{ mb: 2 }}>
                {NEWSLETTER_TOPICS.map((topic) => (
                  <Box
                    component="label"
                    key={topic}
                    sx={{
                      display: "flex",
                      alignItems: "flex-start",
                      gap: 1.5,
                      minHeight: TAP_TARGET.minHeight,
                      py: 0.75,
                      cursor: "pointer",
                      "& input": { width: 22, height: 22, mt: 0.25, flexShrink: 0, accentColor: "var(--mui-palette-primary-main)" },
                    }}
                  >
                    <input type="checkbox" name="topics" value={topic} defaultChecked={subscription.topics.includes(topic)} />
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
            <SubmitButton label={t("manage.save")} pendingLabel={t("manage.saving")} />
          </form>

          <Box component="section" aria-labelledby="newsletter-unsubscribe" sx={{ borderTop: 1, borderColor: "divider", pt: 2 }}>
            <Typography id="newsletter-unsubscribe" variant="h2" sx={{ fontSize: "1.15rem", mb: 1 }}>
              {t("manage.unsubscribeTitle")}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
              {t("manage.unsubscribeBody")}
            </Typography>
            <form action={unsubscribeNewsletterAction} data-testid="newsletter-unsubscribe-form">
              <input type="hidden" name="locale" value={locale} />
              <input type="hidden" name="token" value={token} />
              <SubmitButton label={t("manage.unsubscribe")} pendingLabel={t("manage.unsubscribing")} color="error" variant="outlined" />
            </form>
          </Box>
        </Stack>
      )}
    </Container>
  );
}
