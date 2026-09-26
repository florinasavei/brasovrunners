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
import { getPathname } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { durationPhrase } from "@/modules/deadlines/domain/duration-words";
import { GROUP_RUN_DECLARATION_RETENTION_DAYS, signingOpen } from "@/modules/group-run-declarations/domain";
import { GROUP_RUN_FORM_FIELDS, parseGroupRunInvalid } from "@/modules/group-run-declarations/form";
import { offeredGroupRunDeclarationKey } from "@/modules/legal-documents/domain/keys";
import { asksForIdDocument, deadlineMergeValues } from "@/modules/legal-documents/domain/merge-fields";
import { findCurrentApprovedDocument } from "@/modules/legal-documents/repository";
import LegalDocumentBody from "@/modules/legal-documents/ui/LegalDocumentBody";
import { cachedBotCheckSiteKey, cachedDeadlines, cachedPublishedEventBySlug } from "@/modules/public-cache/reads";
import { readFormDraft } from "@/modules/registrations/form-draft";
import { DECLARATION_ERROR_SUMMARY_ID } from "@/modules/registrations/form-errors";
import { eventMergeValues } from "@/modules/registrations/signed-declaration";
import IdDocumentFields, { ID_DOCUMENT_TYPES } from "@/modules/registrations/ui/IdDocumentFields";
import SignatureField from "@/modules/registrations/ui/SignatureField";
import TurnstileWidget from "@/modules/registrations/ui/TurnstileWidget";
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
  const event = await cachedPublishedEventBySlug(locale, slug);
  const key = event ? offeredGroupRunDeclarationKey(event) : null;
  if (!event || !key) notFound();

  const t = await getTranslations("Event");
  const tDeclare = await getTranslations("Registrations");
  const formCopy = await getTranslations("Registration");
  const eventHref = getPathname({ locale, href: { pathname: "/events/[slug]", params: { slug } } });
  const back = (
    <Typography variant="body2" sx={{ mb: 2 }}>
      <MuiLink href={eventHref}>{t("groupRunDeclaration.page.back", { event: event.title })}</MuiLink>
    </Typography>
  );

  if (done) {
    return (
      <Container id="main" component="main" maxWidth="md" sx={{ py: { xs: DENSITY.pagePadY, sm: 3 } }}>
        {back}
        <Typography variant="h1" gutterBottom sx={{ fontSize: "1.5rem" }}>
          {t("groupRunDeclaration.page.doneTitle")}
        </Typography>
        <Alert severity="success" data-testid="group-run-declaration-done">
          {t("groupRunDeclaration.page.done")}
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

  const facts = await eventMergeValues(db, event.id, locale);
  const needsDocument = asksForIdDocument(document.body);
  const siteKey = await cachedBotCheckSiteKey();
  // What the refused press had typed, sealed for ten minutes (§142, §314): read only after a refusal.
  const refused = parseGroupRunInvalid(invalid);
  const draft = refused.length > 0 || limited || away ? await readFormDraft() : null;
  const draftKind = ID_DOCUMENT_TYPES.find((kind) => kind === draft?.idDocumentType) ?? "ID_CARD";
  const documentKinds = ID_DOCUMENT_TYPES.map((kind) => ({ kind, label: tDeclare(`declare.idDocumentTypes.${kind}`) }));
  const fieldLabel = (field: (typeof GROUP_RUN_FORM_FIELDS)[number]) => t(`groupRunDeclaration.page.fields.${field}`);

  return (
    <Container id="main" component="main" maxWidth="md" sx={{ py: { xs: DENSITY.pagePadY, sm: 3 } }}>
      {back}
      <Typography variant="h1" gutterBottom sx={{ fontSize: "1.5rem" }}>
        {t("groupRunDeclaration.page.title")}
      </Typography>
      <Typography sx={{ mb: 1 }}>{t("groupRunDeclaration.page.intro", { event: event.title })}</Typography>
      {/* Adults only (the text says so in its first sentence), and the text is this page's language:
          what is signed is what is shown (§57); the header's switch brings the other language's text. */}
      <Typography variant="body2" sx={{ mb: 1 }} data-testid="group-run-declaration-adults">
        {t("groupRunDeclaration.page.adultsOnly")}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        {t("groupRunDeclaration.page.languageNote")}
      </Typography>

      {/* The approved text, its blanks filled for this run and left dotted for the signer (§95, §225). */}
      <LegalDocumentBody
        body={document.body}
        values={{
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
      {/* The database was away when it was sent (§NNN): nothing signed, the boxes filled again. */}
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
            </Box>
          ))}
        </Alert>
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
              help={t("groupRunDeclaration.page.idDocumentHelp", { days: durationPhrase(locale, GROUP_RUN_DECLARATION_RETENTION_DAYS, "days") })}
              placeholder={tDeclare("declare.idDocumentPlaceholder")}
              kinds={documentKinds}
              defaultKind={draftKind}
              defaultValue={draft?.idDocument ?? ""}
              refused={refused.includes("idDocument")}
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
          {/* The consent box carries the age statement the text opens with: adults only, for now. */}
          <CheckboxField id="accepted" name="accepted" required defaultChecked={draft?.accepted === "on"}>
            {t("groupRunDeclaration.page.accept")}
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
              <TurnstileWidget siteKey={siteKey} locale={locale} attempt={now.toISOString()} />
              {refused.includes("captcha") && (
                <Typography variant="body2" color="error" sx={{ mt: 1 }}>
                  {t("groupRunDeclaration.page.captcha")}
                </Typography>
              )}
            </Box>
          )}
          <Button type="submit" variant="contained" sx={TAP_TARGET} data-testid="group-run-declaration-submit">
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
