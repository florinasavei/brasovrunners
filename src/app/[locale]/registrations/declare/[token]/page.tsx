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
import { findEventNotificationDetails } from "@/modules/events/repository";
import { findCurrentApprovedDocument } from "@/modules/legal-documents/repository";
import LegalDocumentBody from "@/modules/legal-documents/ui/LegalDocumentBody";
import { findRegistrationById } from "@/modules/registrations/repository";
import RegistrationJourney from "@/modules/registrations/ui/RegistrationJourney";
import { readRegistrationTokenContext } from "@/modules/registrations/token-actions";
import { CHECKBOX_TAP_TARGET, TAP_TARGET } from "@/shared/ui/tap-target";
import { signDeclarationAction } from "./actions";

type Props = {
  params: Promise<{ locale: string; token: string }>;
  searchParams: Promise<{ done?: string; invalid?: string }>;
};

export const dynamic = "force-dynamic";

export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * The declaration-signing landing page (AGENTS.md §10.8, §13.2, §18.5). Shows the exact
 * approved declaration text the participant is about to accept — never a summary — before the
 * explicit checkbox-and-typed-name POST.
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
        <Typography variant="h1" gutterBottom sx={{ fontSize: "1.5rem" }}>
          {t("declare.doneTitle")}
        </Typography>
        {/* Waitlisted is not the end of the journey — it is a place in a queue, and the
            declaration is already signed — so both outcomes render the finished stepper. */}
        <RegistrationJourney current="done" />
        <Alert severity="success">{done === "waitlisted" ? t("declare.doneWaitlisted") : t("declare.doneConfirmed")}</Alert>
      </Container>
    );
  }

  let context = invalid ? { ok: false as const } : await readRegistrationTokenContext(token, "COMPLETE_DECLARATION");
  if (!context.ok) {
    context = invalid ? { ok: false as const } : await readRegistrationTokenContext(token, "WAITLIST_OFFER");
  }

  const db = getDb();
  const declaration = context.ok
    ? await findCurrentApprovedDocument(db, "EVENT_DECLARATION", locale, new Date())
    : undefined;

  /**
   * Which event, and by when — the two facts BR-REQ-041-01 criterion 3 and AGENTS.md §18.5
   * require in the first screen of this page, and neither of which it showed.
   *
   * The deadline is read from the registration rather than from the token that opened this
   * page. The two are normally the same instant — `notifications/render.ts` gives an action
   * token the hold's own expiry — but only while the hold is still ahead of the send, and a
   * message rendered by a late batch falls back to a fourteen-day default. Printing that as
   * "your place is held until" would be a wrong deadline on a page whose whole subject is a
   * deadline, so the row is asked instead. Two reads, on a page that is one participant's one
   * click, against a fact `service.ts` refuses to be wrong about anyway.
   */
  const registration = context.ok && context.token.registrationId
    ? await findRegistrationById(db, context.token.registrationId)
    : undefined;
  const eventDetails = registration
    ? await findEventNotificationDetails(db, registration.eventId, locale)
    : undefined;

  /**
   * An absolute local time, and deliberately no countdown.
   *
   * `docs/PRACTICES.md` § Accessibility: a countdown alone is unusable for somebody who has
   * stepped away from the screen, and a server-rendered "29 minutes left" is stale before it
   * is read. The event's own timezone is what the club and the runner are both standing in.
   */
  const deadline =
    registration?.holdExpiresAt && eventDetails
      ? new Intl.DateTimeFormat(locale === "ro" ? "ro-RO" : "en-GB", {
          dateStyle: "medium",
          timeStyle: "short",
          timeZone: eventDetails.timezone,
        }).format(registration.holdExpiresAt)
      : undefined;

  return (
    <Container id="main" component="main" maxWidth="md" sx={{ py: { xs: 3, sm: 6 } }}>
      <Typography variant="h1" gutterBottom sx={{ fontSize: "1.5rem" }}>
        {t("declare.title")}
      </Typography>

      <RegistrationJourney current="declare" />

      {!context.ok || !declaration ? (
        <Alert severity="warning">{t("invalidOrExpired")}</Alert>
      ) : (
        <>
          {/*
            Above the declaration body, because a person scrolling a wall of legal text must
            not have to reach the end of it to learn how long they have. `role="status"` marks
            it as a status rather than an alert: polite, never interrupting somebody mid-form.
          */}
          {(eventDetails || deadline) && (
            <Alert severity="info" role="status" sx={{ mb: 3 }}>
              {eventDetails && <div>{t("declare.event", { event: eventDetails.title })}</div>}
              {deadline && <div>{t("declare.deadline", { deadline })}</div>}
            </Alert>
          )}

          <LegalDocumentBody body={declaration.body} />
          <form action={signDeclarationAction}>
            <Stack spacing={2} sx={{ mt: 3 }}>
              <input type="hidden" name="locale" value={locale} />
              <input type="hidden" name="token" value={token} />
              <FormControlLabel
                control={<Checkbox name="accepted" required sx={CHECKBOX_TAP_TARGET} />}
                label={t("declare.accept")}
              />
              {/*
                BR-REQ-031-04 criterion 6: the declaration is signed against the legal name,
                not the display name, so the field says which one it wants. `autoComplete` is
                off — a phone offering a saved name here would be filled in by reflex, and this
                is the one field on the site where typing it is the act itself.
              */}
              <TextField
                name="typedName"
                label={t("declare.typedName")}
                helperText={t("declare.typedNameHelp")}
                required
                autoComplete="off"
              />
              <Button type="submit" variant="contained" sx={TAP_TARGET}>
                {t("declare.action")}
              </Button>
            </Stack>
          </form>
        </>
      )}
    </Container>
  );
}
