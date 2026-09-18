import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Container from "@mui/material/Container";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import CheckboxField from "@/shared/ui/CheckboxField";
import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { getDb } from "@/db/client";
import { routing } from "@/i18n/routing";
import { findEventNotificationDetails } from "@/modules/events/repository";
import { findCurrentApprovedDocument } from "@/modules/legal-documents/repository";
import { mergeFieldsIn, mergeLegalBody } from "@/modules/legal-documents/domain/merge-fields";
import LegalDocumentBody from "@/modules/legal-documents/ui/LegalDocumentBody";
import { findRegistrationById } from "@/modules/registrations/repository";
import RegistrationJourney from "@/modules/registrations/ui/RegistrationJourney";
import { readRegistrationTokenContext } from "@/modules/registrations/token-actions";
import { TAP_TARGET } from "@/shared/ui/tap-target";
import { signDeclarationAction } from "./actions";

type Props = {
  params: Promise<{ locale: string; token: string }>;
  searchParams: Promise<{ done?: string; invalid?: string; changed?: string }>;
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

  const { done, invalid, changed } = await searchParams;
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
        {/* "What is next?" — asked the first time somebody got here (§86): said in three lines. */}
        <Typography variant="h2" sx={{ fontSize: "1.125rem", mt: 3, mb: 1 }}>
          {t("declare.nextTitle")}
        </Typography>
        <Box component="ol" sx={{ m: 0, pl: 2.5, "& li": { mb: 0.75 } }}>
          {(t.raw(done === "waitlisted" ? "declare.nextWaitlisted" : "declare.nextConfirmed") as string[]).map((line, index) => (
            <Typography component="li" key={index}>
              {line}
            </Typography>
          ))}
        </Box>
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

          {/*
            The text with its blanks filled for this person and this event (§95): the name they
            registered with, the event, its date and place. The identity document stays a
            blank until they type it below — the form is where it is asked, the text is where
            it lands when printed. What is signed is the template, by id and hash.
          */}
          <LegalDocumentBody
            body={mergeLegalBody(declaration.body, {
              participant: registration?.registeredName,
              event: eventDetails?.title,
              eventDate: eventDetails
                ? new Intl.DateTimeFormat(locale === "ro" ? "ro-RO" : "en-GB", { dateStyle: "long", timeZone: eventDetails.timezone }).format(eventDetails.startsAt)
                : undefined,
              eventLocation: eventDetails?.locationName,
            })}
          />

          {changed && (
            <Alert severity="warning" role="alert" sx={{ mb: 3 }}>
              {t("declare.changed")}
            </Alert>
          )}
          <form action={signDeclarationAction}>
            <Stack spacing={2} sx={{ mt: 3 }}>
              <input type="hidden" name="locale" value={locale} />

              <input type="hidden" name="token" value={token} />
              {/* The version being read, so the signature is refused against any other text

                  (BR-REQ-033-02 criterion 6). */}
              <input type="hidden" name="documentId" value={declaration?.id ?? ""} />
              <input type="hidden" name="contentSha256" value={declaration?.contentSha256 ?? ""} />
              <CheckboxField name="accepted" required>
                {t("declare.accept")}
              </CheckboxField>
              {/*
                BR-REQ-031-04 criterion 6: the declaration is signed against the legal name,
                not the display name, so the field says which one it wants. `autoComplete` is
                off — a phone offering a saved name here would be filled in by reflex, and this
                is the one field on the site where typing it is the act itself.
              */}
              {/* The name appears in a hand as it is typed (§86): the act of signing looks like
                  one. Presentation only — what makes it a signature is the record beneath. */}
              {/* The identity document the text names — asked only when it does (§95). */}
              {mergeFieldsIn(declaration.body).has("idDocument") && (
                <TextField
                  name="idDocument"
                  label={t("declare.idDocument")}
                  helperText={t("declare.idDocumentHelp")}
                  placeholder={t("declare.idDocumentPlaceholder")}
                  required
                  autoComplete="off"
                  slotProps={{ htmlInput: { maxLength: 30, pattern: "[A-Za-z0-9][A-Za-z0-9 .\\-/]{2,28}[A-Za-z0-9]" } }}
                />
              )}
              <TextField
                name="typedName"
                label={t("declare.typedName")}
                helperText={t("declare.typedNameHelp")}
                required
                autoComplete="off"
                slotProps={{ htmlInput: { maxLength: 200 } }}
                sx={{ "& input": { fontFamily: "var(--font-signature), cursive", fontSize: "1.75rem", py: 1 } }}
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
