import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import Container from "@mui/material/Container";
import FormControlLabel from "@mui/material/FormControlLabel";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { getDb } from "@/db/client";
import { routing } from "@/i18n/routing";
import { findCurrentApprovedDocument } from "@/modules/legal-documents/repository";
import LegalDocumentBody from "@/modules/legal-documents/ui/LegalDocumentBody";
import { readRegistrationTokenContext } from "@/modules/registrations/token-actions";
import { signDeclarationAction } from "./actions";

type Props = {
  params: Promise<{ locale: string; token: string }>;
  searchParams: Promise<{ done?: string; invalid?: string }>;
};

export const dynamic = "force-dynamic";

export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * The declaration-signing landing page (AGENTS.md §10.8, §13.2). Shows the exact approved
 * declaration text the participant is about to accept — never a summary — before the explicit
 * checkbox-and-typed-name POST.
 */
export default async function DeclarePage({ params, searchParams }: Props) {
  const { locale, token } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const { done, invalid } = await searchParams;
  const t = await getTranslations("Registrations");

  if (done) {
    return (
      <Container id="main" component="main" maxWidth="sm" sx={{ py: { xs: 3, sm: 6 } }}>
        <Alert severity="success">{done === "waitlisted" ? t("declare.doneWaitlisted") : t("declare.doneConfirmed")}</Alert>
      </Container>
    );
  }

  let context = invalid ? { ok: false as const } : await readRegistrationTokenContext(token, "COMPLETE_DECLARATION");
  if (!context.ok) {
    context = invalid ? { ok: false as const } : await readRegistrationTokenContext(token, "WAITLIST_OFFER");
  }

  const declaration = context.ok
    ? await findCurrentApprovedDocument(getDb(), "EVENT_DECLARATION", locale, new Date())
    : undefined;

  return (
    <Container id="main" component="main" maxWidth="md" sx={{ py: { xs: 3, sm: 6 } }}>
      <Typography variant="h1" gutterBottom sx={{ fontSize: "1.5rem" }}>
        {t("declare.title")}
      </Typography>

      {!context.ok || !declaration ? (
        <Alert severity="warning">{t("invalidOrExpired")}</Alert>
      ) : (
        <>
          <LegalDocumentBody body={declaration.body} />
          <form action={signDeclarationAction}>
            <Stack spacing={2} sx={{ mt: 3 }}>
              <input type="hidden" name="locale" value={locale} />
              <input type="hidden" name="token" value={token} />
              <FormControlLabel
                control={<Checkbox name="accepted" required />}
                label={t("declare.accept")}
              />
              <TextField name="typedName" label={t("declare.typedName")} required />
              <Button type="submit" variant="contained">
                {t("declare.action")}
              </Button>
            </Stack>
          </form>
        </>
      )}
    </Container>
  );
}
