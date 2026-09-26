import Alert from "@mui/material/Alert";
import AlertTitle from "@mui/material/AlertTitle";
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
import { readNewsletterConfirmation } from "@/modules/newsletter/service";
import SubmitButton from "@/shared/ui/SubmitButton";
import { TAP_TARGET } from "@/shared/ui/tap-target";
import { DENSITY } from "@/theme/density";
import { confirmNewsletterAction } from "./actions";

type Props = {
  params: Promise<{ locale: string; token: string }>;
  searchParams: Promise<{ done?: string; invalid?: string }>;
};

export const dynamic = "force-dynamic";

export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * The newsletter's double opt-in (§NNN): the page the confirmation link opens.
 *
 * The GET changes nothing (AGENTS.md §12.8: a link scanner's prefetch must not subscribe anybody);
 * it names the address and the topics and shows one button. The POST spends the link and turns the
 * subscription on, and lands here again saying so. A used, expired or superseded link gets one
 * sentence and the way to ask for a new one — the pop-up again.
 */
export default async function NewsletterConfirmPage({ params, searchParams }: Props) {
  const { locale, token } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const { done, invalid } = await searchParams;
  const t = await getTranslations("Newsletter");

  const pending = done || invalid ? null : await readNewsletterConfirmation(getDb(), token, new Date());
  const inlineLink = { display: "inline-flex", alignItems: "center", minHeight: TAP_TARGET.minHeight } as const;

  return (
    <Container id="main" component="main" maxWidth="sm" sx={{ py: { xs: DENSITY.pagePadY, sm: 3 } }}>
      <Typography variant="h1" gutterBottom sx={{ fontSize: "1.5rem" }}>
        {t("confirm.title")}
      </Typography>

      {done ? (
        <Alert severity="success" role="status" data-testid="newsletter-confirmed">
          <AlertTitle>{t("confirm.done")}</AlertTitle>
          {t("confirm.doneBody")}
        </Alert>
      ) : !pending ? (
        <Stack spacing={1.5} data-testid="newsletter-link-invalid">
          <Alert severity="warning">
            <AlertTitle>{t("linkInvalid")}</AlertTitle>
            {t("confirm.invalidBody")}
          </Alert>
          <Typography variant="body2">
            <Link href="/contact" style={inlineLink}>
              {t("contactLink")}
            </Link>
          </Typography>
        </Stack>
      ) : (
        <Stack spacing={2} sx={{ alignItems: "flex-start" }}>
          <Typography>{t("confirm.intro", { email: pending.email })}</Typography>
          <Typography variant="body2" color="text.secondary">
            {t("confirm.topics", { topics: pending.topics.map((topic) => t(`topics.${topic}`)).join(" · ") })}
          </Typography>
          <form action={confirmNewsletterAction}>
            <input type="hidden" name="locale" value={locale} />
            <input type="hidden" name="token" value={token} />
            <SubmitButton label={t("confirm.button")} pendingLabel={t("confirm.pending")} size="large" />
          </form>
        </Stack>
      )}
    </Container>
  );
}
