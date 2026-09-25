import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
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
import { readListConsent } from "@/modules/registrations/list-consent";
import ActionLinkNotice from "@/modules/registrations/ui/ActionLinkNotice";
import { TAP_TARGET } from "@/shared/ui/tap-target";
import { setListConsentAction } from "./actions";
import { DENSITY } from "@/theme/density";

type Props = {
  params: Promise<{ locale: string; token: string }>;
  searchParams: Promise<{ changed?: string; invalid?: string }>;
};

export const dynamic = "force-dynamic";

export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * The public participant list, the participant's own switch (BR-REQ-039-01; `DECISIONS.md`
 * §143): the page a `LIST_CONSENT` link from the confirmation email opens.
 *
 * The GET says which way the answer stands for this registration and event, and shows one
 * button that sets the other answer; nothing changes until the POST (BR-REQ-036-02 criterion
 * 4). The POST spends the link and lands here again under a fresh one, so "I changed my mind"
 * is the same button a second time. A used, expired or wrong link gets the one generic notice
 * every token page gives, with the resend path — and a resent confirmation carries a new link.
 */
export default async function ListConsentPage({ params, searchParams }: Props) {
  const { locale, token } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const { changed, invalid } = await searchParams;
  const t = await getTranslations("Registrations");

  // One token read for the page — throttled per presented token. After a refused POST the
  // link is known to be dead, so it is not charged a second attempt for saying so.
  const context = invalid ? null : await readListConsent(getDb(), token, locale, new Date());

  return (
    <Container id="main" component="main" maxWidth="sm" sx={{ py: { xs: DENSITY.pagePadY, sm: 3 } }}>
      <Typography variant="h1" gutterBottom sx={{ fontSize: "1.5rem" }}>
        {t("list.title")}
      </Typography>

      {!context || !context.ok ? (
        <ActionLinkNotice locale={locale} status={null} />
      ) : (
        <Stack spacing={2} sx={{ alignItems: "flex-start" }}>
          {changed && (
            <Alert severity="success" sx={{ alignSelf: "stretch" }}>
              {t("list.changed")}
            </Alert>
          )}

          {context.eventTitle && (
            <Typography variant="body2" color="text.secondary">
              {t("list.event", { event: context.eventTitle })}
            </Typography>
          )}

          <Typography sx={{ fontWeight: 600 }}>{context.listed ? t("list.listed") : t("list.notListed")}</Typography>

          {/* The one button, worded by the row: it sets the other answer, never "toggles". */}
          <form action={setListConsentAction}>
            <input type="hidden" name="locale" value={locale} />
            <input type="hidden" name="token" value={token} />
            <input type="hidden" name="listed" value={context.listed ? "0" : "1"} />
            <Button type="submit" variant={context.listed ? "outlined" : "contained"} sx={TAP_TARGET}>
              {context.listed ? t("list.optOut") : t("list.optIn")}
            </Button>
          </form>

          <Typography variant="body2" color="text.secondary">
            {t("list.help")}
          </Typography>

          {changed && (
            <Typography variant="body2" color="text.secondary">
              {t("list.changedHelp")}
            </Typography>
          )}

          {context.eventSlug && (
            <Typography variant="body2">
              <Link href={{ pathname: "/events/[slug]", params: { slug: context.eventSlug } }}>{t("list.eventPage")}</Link>
            </Typography>
          )}
        </Stack>
      )}
    </Container>
  );
}
