import DrawIcon from "@mui/icons-material/Draw";
import { glyphSx, WITH_GLYPH_SX } from "@/shared/ui/button-glyph";
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
import { notFound } from "next/navigation";
import { getDb } from "@/db/client";
import { CLUB_TIME_ZONE, formatDateInWords } from "@/i18n/dates";
import { getPathname } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { durationPhrase } from "@/modules/deadlines/domain/duration-words";
import { datedOrNull } from "@/modules/events/domain/dated";
import { groupRunMergeValues } from "@/modules/group-run-declarations/facts";
import { signatureCoversSeries } from "@/modules/group-run-declarations/series";
import { GROUP_RUN_DECLARATION_ID_DOCUMENT_DAYS, groupRunAsksBirthDate, groupRunMinimumAge, signingOpen } from "@/modules/group-run-declarations/domain";
import { GROUP_RUN_FORM_FIELDS, parseGroupRunInvalid, refusedTooYoung } from "@/modules/group-run-declarations/form";
import { offeredGroupRunDeclarationKey } from "@/modules/legal-documents/domain/keys";
import { asksForIdDocument, deadlineMergeValues } from "@/modules/legal-documents/domain/merge-fields";
import { findCurrentApprovedDocument } from "@/modules/legal-documents/repository";
import LegalDocumentBody from "@/modules/legal-documents/ui/LegalDocumentBody";
import { cachedBotCheckSiteKey, cachedCurrentApprovedDocument, cachedDeadlines } from "@/modules/public-cache/reads";
import { readOrWhileAway } from "@/modules/resilience/optional-read";
import { formEventBySlug } from "@/modules/resilience/event-copy";
import { membersEventBySlug } from "@/modules/events/members-only";
import { dayIn, latestBirthDateFor, yearsPhrase } from "@/modules/registrations/domain/age";
import { readFormDraft } from "@/modules/registrations/form-draft";
import { DECLARATION_ERROR_SUMMARY_ID } from "@/modules/registrations/form-errors";
import BirthDateField from "@/modules/registrations/ui/BirthDateField";
import IdDocumentFields, { ID_DOCUMENT_TYPES } from "@/modules/registrations/ui/IdDocumentFields";
import SignatureField from "@/modules/registrations/ui/SignatureField";
import BotCheck from "@/modules/registrations/ui/BotCheck";
import UntickedBoxSummary from "@/modules/registrations/ui/UntickedBoxSummary";
import CheckboxField from "@/shared/ui/CheckboxField";
import LegalLink from "@/shared/ui/LegalLink";
import { TAP_TARGET } from "@/shared/ui/tap-target";
import { DENSITY } from "@/theme/density";
import { signGroupRunDeclarationAction } from "./actions";

type Props = {
  params: Promise<{ locale: string; slug: string }>;
  searchParams: Promise<{ done?: string; invalid?: string; changed?: string; limited?: string; closed?: string; away?: string }>;
};

export const dynamic = "force-dynamic";

// A person's signature page: never in a search index.
export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * A group run's optional self-declaration, signed on the club's site (§393).
 *
 * **The race's signing flow, bound to something else.** The text panel (`LegalDocumentBody`, the
 * approved text with its blanks in bold, §225), the identity-document boxes (`IdDocumentFields`,
 * §283), the signature in a hand (`SignatureField`, §86), the one consent box, the focusable refusal
 * summary (§47), and on the server the same PDF renderer and the archive copy — exactly what the
 * race's declaration uses. What differs is only what the signature is bound to: an event and a
 * signer who registered nothing, rather than a registration reached from an emailed link. So the
 * page asks what a registration would have known — the name and the email address. The language
 * is the page's: the runner signs the text they read, and the PDF and the email follow it (§57).
 *
 * **Bound to the text that was read (§57).** The version's id and hash ride in the form; a newer
 * version in force at the press is refused and this page shows the current text with a notice.
 *
 * No account, no registration, no place (§111). The guards are the public forms' (§97).
 */
export default async function GroupRunDeclarationPage({ params, searchParams }: Props) {
  const { locale, slug } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const { done, invalid, changed, limited, closed, away } = await searchParams;

  const now = new Date();
  // The cached row, or the database's own at a red month's miss (§493): this page reads it anyway.
  // A run for the members alone (§552): read for a members' session only, live, never cached.
  const found = (await formEventBySlug(locale, slug)) ?? (await membersEventBySlug(locale, slug));
  // A group run whose date is to be announced (§533) takes no signature yet: nothing to sign for.
  const event = found ? datedOrNull(found) : null;
  const key = event ? offeredGroupRunDeclarationKey(event) : null;
  if (!event || !key) notFound();

  const t = await getTranslations("Event");
  const tDeclare = await getTranslations("Registrations");
  const formCopy = await getTranslations("Registration");
  const legalCopy = await getTranslations("Legal");
  const eventHref = getPathname({ locale, href: { pathname: "/events/[slug]", params: { slug } } });
  const back = (
    <Typography variant="body2" sx={{ mb: 2 }}>
      <MuiLink href={eventHref}>{t("groupRunDeclaration.page.back", { event: event.title })}</MuiLink>
    </Typography>
  );

  if (done) {
    /*
      "It covers the whole series" only while the text in force says so (§523, `signatureCoversSeries`):
      under an older text a signature covers the date it was signed on. Unknown while the database is
      away — then the words that claim less.
    */
    const inForce = await readOrWhileAway(() => cachedCurrentApprovedDocument(key, locale, now), undefined);
    const doneWords = inForce && signatureCoversSeries(inForce.body) ? "groupRunDeclaration.page.done" : "groupRunDeclaration.page.doneOneDate";
    return (
      <Container id="main" component="main" maxWidth="md" sx={{ py: { xs: DENSITY.pagePadY, sm: 3 } }}>
        {back}
        <Typography variant="h1" gutterBottom sx={{ fontSize: "1.5rem" }}>
          {t("groupRunDeclaration.page.doneTitle")}
        </Typography>
        {/* The same words whether a row was written or the one already kept was sent again (§523):
            the page tells nobody whether the address had signed before. */}
        <Alert severity="success" data-testid="group-run-declaration-done">
          {t(doneWords, { event: event.title })}
        </Alert>
      </Container>
    );
  }

  const db = getDb();
  const open = signingOpen({ ...event, editorialStatus: "PUBLISHED" }, now) && !closed;
  const document = open ? await findCurrentApprovedDocument(db, key, locale, now) : undefined;
  // No approved privacy notice in force, no form: the service refuses the signature then (the rule
  // a registration answers to, BR-REQ-053-01), so the page does not ask for an address first.
  const privacyNotice = document ? await findCurrentApprovedDocument(db, "PRIVACY_NOTICE", locale, now) : undefined;
  if (!open || !document || !privacyNotice) {
    return (
      <Container id="main" component="main" maxWidth="md" sx={{ py: { xs: DENSITY.pagePadY, sm: 3 } }}>
        {back}
        <Typography variant="h1" gutterBottom sx={{ fontSize: "1.5rem" }}>
          {t("groupRunDeclaration.page.title")}
        </Typography>
        <Alert severity="info" data-testid="group-run-declaration-closed">
          {t("groupRunDeclaration.page.closed")}
        </Alert>
      </Container>
    );
  }

  /*
    The text's blanks from the one function the press and the PDF fill them with (§523,
    `groupRunMergeValues`): a series' values under a text that names them — the series sentence kept,
    the one-off sentence dropped — and "" on a one-off run, the reverse. What is read is what is signed.
  */
  const facts = await groupRunMergeValues(db, event.id, locale, document.body);
  const needsDocument = asksForIdDocument(document.body);
  const siteKey = await cachedBotCheckSiteKey();
  // What the refused press had typed, sealed for ten minutes (§142, §314): read only after a refusal.
  const refused = parseGroupRunInvalid(invalid);
  const draft = refused.length > 0 || limited || away ? await readFormDraft() : null;
  const draftKind = ID_DOCUMENT_TYPES.find((kind) => kind === draft?.idDocumentType) ?? "ID_CARD";
  const documentKinds = ID_DOCUMENT_TYPES.map((kind) => ({ kind, label: tDeclare(`declare.idDocumentTypes.${kind}`) }));
  const fieldLabel = (field: (typeof GROUP_RUN_FORM_FIELDS)[number]) => t(`groupRunDeclaration.page.fields.${field}`);
  /*
    The run's own minimum age (§329, §440): the birth date is asked only while it has one, counted
    on the run's day in its zone — the picker's bound is the arithmetic the service refuses with
    (`latestBirthDateFor`, `isUnderMinimumAge`), today a bound as well. A refusal for age says the
    number, in the summary and under the box, rather than "fill it in" (§47, as the race's §321).
  */
  // The age the text states, never under eighteen (`groupRunMinimumAge`, §515); a birth date is
  // asked only above it (`groupRunAsksBirthDate`).
  const minAge = groupRunMinimumAge(event.minAge);
  const hasMinimumAge = groupRunAsksBirthDate(event.minAge);
  const minimumAge = { age: yearsPhrase(minAge, locale) };
  const tooYoung = hasMinimumAge && refusedTooYoung(invalid);
  const today = now.toISOString().slice(0, 10);
  const runDay = dayIn(event.startsAt, event.timezone);
  const youngestAllowed = hasMinimumAge ? latestBirthDateFor(minAge, runDay) : today;
  const latestBirthDate = youngestAllowed < today ? youngestAllowed : today;
  // The oldest bound, the registration form's (§561): a hundred and twenty years back.
  const earliestBirthDate = new Date(Date.UTC(now.getUTCFullYear() - 120, now.getUTCMonth(), now.getUTCDate())).toISOString().slice(0, 10);
  const tooYoungWords = t("groupRunDeclaration.page.tooYoung", minimumAge);
  const birthDateHelp = t("groupRunDeclaration.page.birthDateHelp", minimumAge);

  return (
    <Container id="main" component="main" maxWidth="md" sx={{ py: { xs: DENSITY.pagePadY, sm: 3 } }}>
      {back}
      <Typography variant="h1" gutterBottom sx={{ fontSize: "1.5rem" }}>
        {t("groupRunDeclaration.page.title")}
      </Typography>
      {/* «Once for the whole series» only under a text that says so (§523, `signatureCoversSeries`). */}
      <Typography sx={{ mb: 1 }}>
        {t(signatureCoversSeries(document.body) ? "groupRunDeclaration.page.intro" : "groupRunDeclaration.page.introOneDate", { event: event.title })}
      </Typography>
      {/* For oneself, from the run's age — never under eighteen (§515) — and the text is this page's language:
          what is signed is what is shown (§57); the header's switch brings the other language's text. */}
      <Typography variant="body2" sx={{ mb: 1 }} data-testid="group-run-declaration-adults">
        {t("groupRunDeclaration.page.adultsOnly", minimumAge)}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        {t("groupRunDeclaration.page.languageNote")}
      </Typography>

      {/* Which approved text this is (§499): its version and the day it took effect, as the terms page says its own (§323) —
          «în vigoare din 28 septembrie 2026», the whole date and no weekday (§534). */}
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }} data-testid="declaration-version">
        {legalCopy("inForce", {
          version: document.version,
          date: formatDateInWords(document.effectiveAt, { locale, timeZone: CLUB_TIME_ZONE }),
        })}
      </Typography>
      {/* The approved text, its blanks filled for this run and left dotted for the signer (§95, §225). */}
      <LegalDocumentBody
        body={document.body}
        values={{
          // The run's facts, its minimum age among them (§440): "" on a run with none drops that sentence.
          ...(facts?.values ?? {}),
          guardian: "—",
          guardianIdDocument: "—",
          ...deadlineMergeValues(locale, await cachedDeadlines()),
        }}
      />

      {changed && (
        <Alert severity="warning" role="alert" sx={{ mb: 3 }}>
          {tDeclare("declare.changed")}
        </Alert>
      )}
      {limited && (
        <Alert severity="warning" role="alert" sx={{ mb: 3 }} data-testid="group-run-declaration-limited">
          {t("groupRunDeclaration.page.limited")}
        </Alert>
      )}
      {/* The database was away when it was sent (§447): nothing signed, the boxes filled again. */}
      {away && (
        <Alert severity="warning" role="alert" sx={{ mb: 3 }} data-testid="group-run-declaration-away">
          {t("groupRunDeclaration.page.away")}
        </Alert>
      )}
      {/*
        The refusal summary (§47): where the redirect lands, above the form, focusable and announced,
        a link to each box it names. Nothing was recorded.
      */}
      {refused.length > 0 && (
        <Alert severity="error" id={DECLARATION_ERROR_SUMMARY_ID} role="alert" tabIndex={-1} sx={{ mb: 3 }} data-testid="group-run-declaration-errors">
          <AlertTitle>{t("groupRunDeclaration.page.refusedTitle")}</AlertTitle>
          <Box>{t("groupRunDeclaration.page.refusedNothingRecorded")}</Box>
          {refused.map((field) => (
            <Box key={field} sx={{ mt: 0.5 }}>
              <MuiLink href={`#${field}`}>{fieldLabel(field)}</MuiLink>
              {field === "birthDate" && tooYoung && <>: {tooYoungWords}</>}
            </Box>
          ))}
        </Alert>
      )}

      {/* The unticked box, said before the press where a script runs (§616); after a server refusal the summary above names it. */}
      {!refused.includes("accepted") && (
        <UntickedBoxSummary boxId="accepted" summaryId="accepted-summary" message={t("groupRunDeclaration.page.acceptSummary")} />
      )}
      <form action={signGroupRunDeclarationAction}>
        <Stack spacing={2} sx={{ mt: 3 }}>
          <input type="hidden" name="locale" value={locale} />
          <input type="hidden" name="slug" value={slug} />
          <input type="hidden" name="eventId" value={event.id} />
          {/* The version being read, so the signature is refused against any other text (§57). */}
          <input type="hidden" name="documentId" value={document.id} />
          <input type="hidden" name="contentSha256" value={document.contentSha256} />
          {/* Bots fill every field; a human never sees or fills this one (§19.4). */}
          <input
            type="text"
            name="honeypot"
            autoComplete="off"
            tabIndex={-1}
            aria-hidden="true"
            style={{ position: "absolute", left: "-9999px", width: 1, height: 1 }}
          />
          <input type="hidden" name="renderedAt" value={now.toISOString()} />

          {needsDocument && (
            <IdDocumentFields
              name="idDocument"
              typeLabel={tDeclare("declare.idDocumentType")}
              typeHelp={tDeclare("declare.idDocumentTypeHelp")}
              label={fieldLabel("idDocument")}
              help={t("groupRunDeclaration.page.idDocumentHelp", { days: durationPhrase(locale, GROUP_RUN_DECLARATION_ID_DOCUMENT_DAYS, "days") })}
              placeholder={tDeclare("declare.idDocumentPlaceholder")}
              kinds={documentKinds}
              defaultKind={draftKind}
              defaultValue={draft?.idDocument ?? ""}
              refused={refused.includes("idDocument")}
            />
          )}
          {/*
            The registration form's own box (§573, applying §561): typed day first, «11.05.1990»,
            never the browser's date box, which an English phone drew month first. The same
            placeholder, the date in words with the age on the run's day as its helper, and the
            run's minimum age refused live under it; the action reads the typed text with the same
            `normalizeTypedDate`, and the service still refuses what the box let through.
          */}
          {hasMinimumAge && (
            <BirthDateField
              id="birthDate"
              name="birthDate"
              label={fieldLabel("birthDate")}
              defaultValue={draft?.birthDate ?? ""}
              required
              autoComplete="bday"
              error={refused.includes("birthDate")}
              errorText={tooYoung ? tooYoungWords : birthDateHelp}
              help={birthDateHelp}
              min={earliestBirthDate}
              max={latestBirthDate}
              eventDay={runDay}
              locale={locale}
              echoTemplate={formCopy("birthDateEcho", { date: "{date}", age: "{age}" })}
              placeholder={formCopy("birthDatePlaceholder")}
              unreadable={formCopy("birthDateUnreadable")}
              tooYoung={tooYoungWords}
            />
          )}
          <TextField
            id="email"
            name="email"
            type="email"
            label={fieldLabel("email")}
            helperText={t("groupRunDeclaration.page.emailHelp")}
            defaultValue={draft?.email ?? ""}
            error={refused.includes("email")}
            required
            autoComplete="email"
          />
          {/* The consent box repeats the run's age, the one the text states through {{minimumAge}} (§515). */}
          <CheckboxField
            id="accepted"
            name="accepted"
            required
            defaultChecked={draft?.accepted === "on"}
            error={refused.includes("accepted") ? t("groupRunDeclaration.page.acceptInline") : undefined}
            requiredMessage={t("groupRunDeclaration.page.acceptInline")}
          >
            {t("groupRunDeclaration.page.accept", minimumAge)}
          </CheckboxField>
          {/* The signature in a hand (§86): the name typed is the signature itself. */}
          <SignatureField
            id="typedName"
            name="typedName"
            signer="self"
            label={fieldLabel("typedName")}
            expectedName={null}
            participantName={null}
            contactHref={getPathname({ locale, href: "/contact" })}
            myRegistrationsHref={getPathname({ locale, href: "/registrations/mine" })}
            canReply={false}
            defaultValue={draft?.typedName}
            refused={refused.includes("typedName")}
            help={t("groupRunDeclaration.page.typedNameHelp")}
          />
          {/* Cloudflare Turnstile, when the club switched it on (§97). */}
          {siteKey && (
            <Box id="captcha">
              <BotCheck siteKey={siteKey} locale={locale} attempt={now.toISOString()} />
              {refused.includes("captcha") && (
                <Typography variant="body2" color="error" sx={{ mt: 1 }}>
                  {t("groupRunDeclaration.page.captcha")}
                </Typography>
              )}
            </Box>
          )}
          <Button type="submit" variant="contained" sx={{ ...TAP_TARGET, ...WITH_GLYPH_SX }} data-testid="group-run-declaration-submit">
            <DrawIcon aria-hidden="true" sx={glyphSx("medium")} />
            {t("groupRunDeclaration.page.action")}
          </Button>
          <Box>
            <LegalLink href="/legal/privacy" newTabLabel={formCopy("opensInNewTab")} style={{ minHeight: TAP_TARGET.minHeight }}>
              {tDeclare("declare.privacyLink")}
            </LegalLink>
          </Box>
        </Stack>
      </form>
    </Container>
  );
}
