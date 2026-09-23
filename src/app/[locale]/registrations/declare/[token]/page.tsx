import Alert from "@mui/material/Alert";
import AlertTitle from "@mui/material/AlertTitle";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Container from "@mui/material/Container";
import MuiLink from "@mui/material/Link";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import CheckboxField from "@/shared/ui/CheckboxField";
import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { getDb } from "@/db/client";
import { getPathname } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { CLUB_LOCALITY } from "@/modules/events/domain/place";
import { findEventNotificationDetails } from "@/modules/events/repository";
import { findCurrentApprovedDocument } from "@/modules/legal-documents/repository";
import { asksForIdDocument } from "@/modules/legal-documents/domain/merge-fields";
import LegalDocumentBody from "@/modules/legal-documents/ui/LegalDocumentBody";
import { expectedSignatures, mismatchedSignatures, type SignatureBox } from "@/modules/registrations/domain/signature-name";
import LegalLink from "@/shared/ui/LegalLink";
import { readFormDraft } from "@/modules/registrations/form-draft";
import { DECLARATION_ERROR_SUMMARY_ID } from "@/modules/registrations/form-errors";
import { countEligibleWaitlisted, findRegistrationById } from "@/modules/registrations/repository";
import { declarantValues, identityDocumentValues } from "@/modules/registrations/signed-declaration";
import ActionLinkNotice from "@/modules/registrations/ui/ActionLinkNotice";
import RegistrationJourney from "@/modules/registrations/ui/RegistrationJourney";
import SignatureField from "@/modules/registrations/ui/SignatureField";
import { readRegistrationTokenContext, readSpentRegistrationLink } from "@/modules/registrations/token-actions";
import { env } from "@/shared/config/env";
import { TAP_TARGET } from "@/shared/ui/tap-target";
import { signDeclarationAction } from "./actions";

type Props = {
  params: Promise<{ locale: string; token: string }>;
  searchParams: Promise<{ done?: string; invalid?: string; changed?: string }>;
};

/*
  The signature boxes' ids are the names they post (`typedName`, and `minorTypedName` on a minor's
  declaration, §NNN): what the refusal's links point at, so following one focuses its box.
*/

const ID_DOCUMENT_TYPES = ["ID_CARD", "PASSPORT", "RESIDENCE_PERMIT", "OTHER"] as const;

/** A document's series box, by the name it posts: the declarant's, and on a minor's declaration the minor's (§NNN). */
type DocumentBox = "idDocument" | "minorIdDocument";

/**
 * One signer's identity document, as the declaration asks for it (§95, §283): the kind, chosen
 * from a closed list, and the series and number, typed — never scanned. An adult has one; a minor's
 * declaration has two, the minor's (`minorIdDocument`) and the parent's (`idDocument`), each the
 * same two boxes under its own words (§NNN). The action composes each pair into the one line the
 * declaration prints.
 *
 * Rendered on the server with the page: it passes strings to MUI and nothing else
 * (`AGENTS.md` §14.1).
 */
function IdDocumentFields({
  name,
  typeLabel,
  typeHelp,
  label,
  help,
  placeholder,
  kinds,
  defaultKind,
  defaultValue,
  refused,
}: {
  name: DocumentBox;
  typeLabel: string;
  typeHelp: string;
  label: string;
  help: string;
  placeholder: string;
  kinds: ReadonlyArray<{ kind: string; label: string }>;
  defaultKind: string;
  defaultValue: string;
  /** The server refused the press for this box (`?invalid=document`, §NNN): shown in its red state. */
  refused: boolean;
}) {
  return (
    <>
      {/*
        Which document, chosen rather than described (§283; Amalia: "we must give some hints on
        the ID document or select ID doc type"). A native select, like the telephone's country
        (§198): it works before hydration and it is the control a phone knows how to open.
      */}
      <TextField
        name={`${name}Type`}
        label={typeLabel}
        helperText={typeHelp}
        select
        required
        defaultValue={defaultKind}
        slotProps={{ select: { native: true } }}
      >
        {kinds.map((entry) => (
          <option key={entry.kind} value={entry.kind}>
            {entry.label}
          </option>
        ))}
      </TextField>
      {/* The id is the name it posts, like the signature boxes': what the refusal's link points at. */}
      <TextField
        id={name}
        name={name}
        error={refused}
        label={label}
        helperText={help}
        placeholder={placeholder}
        defaultValue={defaultValue}
        required
        autoComplete="off"
        slotProps={{ htmlInput: { maxLength: 30, pattern: "[A-Za-z0-9][A-Za-z0-9 .\\-/]{2,28}[A-Za-z0-9]" } }}
      />
    </>
  );
}

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
  // "Opens in a new tab", said once for every legal link, in the form's own catalogue.
  const formCopy = await getTranslations("Registration");

  if (done) {
    return (
      <Container id="main" component="main" maxWidth="sm" sx={{ py: { xs: 2, sm: 3 } }}>
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

  /**
   * One link, two purposes (§15.7), and the token is read even after a failed POST.
   *
   * `invalid=1` used to skip the read entirely, which is why somebody who signed and then
   * pressed the same email again was told the link was dead rather than that the declaration
   * was already signed. Both refusals are kept: whichever of them is `ALREADY_USED` is the
   * token's real purpose, and the other is the `PURPOSE_MISMATCH` that proves it.
   */
  const declarationRead = await readRegistrationTokenContext(token, "COMPLETE_DECLARATION");
  const offerRead = declarationRead.ok
    ? undefined
    // The same secret, already presented in this request: it costs no further attempt (§202).
    : await readRegistrationTokenContext(token, "WAITLIST_OFFER", { charge: false });
  const context = declarationRead.ok ? declarationRead : (offerRead ?? declarationRead);

  const refusals = [
    declarationRead.ok ? null : { purpose: "COMPLETE_DECLARATION" as const, reason: declarationRead.reason },
    offerRead && !offerRead.ok ? { purpose: "WAITLIST_OFFER" as const, reason: offerRead.reason } : null,
  ].filter((refusal) => refusal !== null);

  const spent = context.ok ? null : await readSpentRegistrationLink(token, refusals, locale, new Date());

  /**
   * A live token plus `invalid=1` means the press failed for a reason that is **not** the token
   * — an unticked box bypassed on the client, which rolls the whole transaction back and spends
   * nothing.
   *
   * That is not a dead link, and it must not be reported as one (§202, found in review): the
   * notice for a dead link carries "we can send you a new one", and sending a new link to
   * somebody whose link works would be an instruction to wait for an email they do not need.
   * The form is refused — the press genuinely failed — and the reason is said where the press
   * happened.
   */
  const blocked = !context.ok;
  /*
    `invalid=name` is the signature that was not the declarant's name (§314): its own refusal,
    said beside the box with the name it wants — never the generic sentence above, which was
    written for an unticked box, and never anything that reads as a broken link.
  */
  const nameRefused = context.ok && invalid === "name";
  /*
    `invalid=document` is an identity document the text asks for and the press left out, or typed
    as something that is not a series and number (§NNN, found in review) — past the browser's own
    check. Its own refusal for the same reason: the generic sentence asks for a tick.
  */
  const documentRefused = context.ok && invalid === "document";
  const pressFailed = context.ok && Boolean(invalid) && !nameRefused && !documentRefused;
  const journeyStep = spent ? spent.step : ("declare" as const);

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
          timeStyle: "short", hourCycle: "h23",
          timeZone: eventDetails.timezone,
        }).format(registration.holdExpiresAt)
      : undefined;
  /**
   * "The deadline has passed, but the place is still yours" — and only where that is true.
   *
   * A hold past its deadline is kept while nobody waits for the place (§160), so the sentence
   * asks the same two questions the allocator asks: is this a declaration hold rather than a
   * waiting-list offer, whose deadline is always enforced because it was promised to the
   * queue; and is anybody waiting. With a queue behind them the POST may well hand them the
   * waiting list, and this page must not have promised otherwise.
   */
  const deadlinePassed =
    registration?.holdExpiresAt !== null &&
    registration?.holdExpiresAt !== undefined &&
    registration.status === "PENDING_DECLARATION" &&
    registration.holdExpiresAt <= new Date() &&
    (await countEligibleWaitlisted(db, registration.eventId)) === 0;

  /*
    Who signs, and under which name (§314, §108, §NNN): an adult once, with their registered name;
    a minor's declaration twice at one press — the minor with the name they were registered under,
    and the parent or guardian with theirs, the declarant the text names. `minorName` is null for
    an adult, and it is the one question every part of this page asks: one signer or two.
  */
  const expected = registration ? expectedSignatures(registration) : null;
  const expectedName = expected?.typedName ?? null;
  const minorName = expected?.minorTypedName ?? null;
  const contactHref = getPathname({ locale, href: "/contact" });
  /*
    Where a parent whose own name was mistyped goes (§314, found in review): "Înscrierile mele",
    to cancel and register again. The club's "Corectează numele" changes the participant's name
    and nothing else, so the minor's sentence must not promise the correction the adult's does.
  */
  const myRegistrationsHref = getPathname({ locale, href: "/registrations/mine" });
  // "Reply to the email" only where a reply reaches somebody (the emails' own footer, §96).
  const canReply = Boolean(env.EMAIL_REPLY_TO);
  /*
    What the refused press had typed, brought back sealed by the action (§314) and read only for
    the refusals that keep it, a name's or a document's (§NNN) — a stale draft never fills a form
    it was not kept for.

    Read, not consumed: a Server Component cannot delete a cookie, exactly as for the registration
    form's draft (§142). It lives its ten minutes on the token's own path, and a signature that
    succeeds clears it (`signDeclarationAction`); whoever can open this path holds the link that
    signs anyway, so an island whose only job is deleting it would not earn its JavaScript.
  */
  const draft = nameRefused || documentRefused ? await readFormDraft() : null;
  const draftKind = (value: string | undefined) => ID_DOCUMENT_TYPES.find((kind) => kind === value) ?? "ID_CARD";
  const documentKinds = ID_DOCUMENT_TYPES.map((kind) => ({ kind, label: t(`declare.idDocumentTypes.${kind}`) }));
  const contact = (chunks: ReactNode) => <MuiLink href={contactHref}>{chunks}</MuiLink>;
  const mine = (chunks: ReactNode) => <MuiLink href={myRegistrationsHref}>{chunks}</MuiLink>;
  /*
    Which boxes the server refused (§NNN). The URL carries the code and nothing else (§14.5), so
    the page asks again, of what the refused press typed, with the one function the service
    refused it with — the red boxes and the refusal cannot name different ones. Without the kept
    draft (its ten minutes are over) every box is named: the page cannot know which, and each box
    turns red only if what it holds is wrong anyway.
  */
  const everyBox: SignatureBox[] = minorName !== null ? ["minorTypedName", "typedName"] : ["typedName"];
  const judged =
    nameRefused && expected && draft
      ? mismatchedSignatures({ typedName: draft.typedName ?? "", minorTypedName: draft.minorTypedName ?? "" }, expected)
      : [];
  const refusedBoxes: SignatureBox[] = !nameRefused ? [] : judged.length > 0 ? judged : everyBox;
  // Whether the text names an identity document, so the form asks for one — or two (§95, §NNN).
  const needsDocuments = declaration ? asksForIdDocument(declaration.body) : false;
  const boxLabel = (box: SignatureBox) =>
    box === "minorTypedName" ? t("declare.minorTypedName") : minorName !== null ? t("declare.guardianTypedName") : t("declare.typedName");
  /*
    Which document boxes the server refused (§NNN): the ones the kept draft left empty — the draft
    keeps only what was typed. A box typed but refused (not a series and number) leaves none
    empty, and neither does a draft whose ten minutes are over; then every document box is named,
    as for the signatures.
  */
  const everyDocument: DocumentBox[] = minorName !== null ? ["minorIdDocument", "idDocument"] : ["idDocument"];
  const emptyDocuments = documentRefused && draft ? everyDocument.filter((box) => !draft[box]) : [];
  const refusedDocuments: DocumentBox[] = !documentRefused ? [] : emptyDocuments.length > 0 ? emptyDocuments : everyDocument;
  const documentLabel = (box: DocumentBox) =>
    box === "minorIdDocument" ? t("declare.minorIdDocument") : minorName !== null ? t("declare.guardianIdDocument") : t("declare.idDocument");

  return (
    <Container id="main" component="main" maxWidth="md" sx={{ py: { xs: 2, sm: 3 } }}>
      <Typography variant="h1" gutterBottom sx={{ fontSize: "1.5rem" }}>
        {t("declare.title")}
      </Typography>

      {/* Where the registration actually is when the link is spent; the declaration step
          otherwise. Cancelled and lapsed get no stepper: there is no journey left. */}
      {journeyStep && <RegistrationJourney current={journeyStep} />}

      {blocked || !declaration ? (
        <ActionLinkNotice locale={locale} status={spent} />
      ) : (
        <>
          {/*
            The press failed and the link did not (§202): the box was not ticked, or the server
            refused the form for a reason of its own. Said here, above the text, rather than by
            replacing the page with "this link is no longer valid" — which would send somebody
            whose link works to wait for an email they do not need.
          */}
          {pressFailed && (
            <Alert severity="error" sx={{ mb: 3 }}>
              {t("declare.pressFailed")}
            </Alert>
          )}
          {/*
            Above the declaration body, because a person scrolling a wall of legal text must
            not have to reach the end of it to learn how long they have. `role="status"` marks
            it as a status rather than an alert: polite, never interrupting somebody mid-form.
          */}
          {(eventDetails || deadline) && (
            <Alert severity="info" role="status" sx={{ mb: 3 }}>
              {eventDetails && <div>{t("declare.event", { event: eventDetails.title })}</div>}
              {deadline && <div>{t(deadlinePassed ? "declare.deadlinePassed" : "declare.deadline", { deadline })}</div>}
            </Alert>
          )}

          {/*
            The text with its blanks filled for this person and this event (§95): the name they
            registered with, the event, its date and place. The identity documents stay blanks
            until they are typed below — the form is where they are asked, the text is where they
            land when printed — except a guardian's on an adult's declaration, which is the em
            dash `{{guardian}}` reads too (§NNN). What is signed is the template, by id and hash.
          */}
          <LegalDocumentBody
            body={declaration.body}
            /* The blanks, passed rather than pre-merged, so the filled-in parts render bold (§225). */
            values={{
              participant: registration?.registeredName,
              ...(registration ? declarantValues(registration.registeredName, registration.guardianName, locale) : {}),
              ...(registration ? identityDocumentValues(registration.guardianName, {}) : {}),
              event: eventDetails?.title,
              eventDate: eventDetails
                ? new Intl.DateTimeFormat(locale === "ro" ? "ro-RO" : "en-GB", { dateStyle: "long", timeZone: eventDetails.timezone }).format(eventDetails.startsAt)
                : undefined,
              // The city while the place is to be announced (§NNN), as in the PDF — never the typed place.
              eventLocation: eventDetails?.locationToBeAnnounced ? CLUB_LOCALITY : eventDetails?.locationName,
            }}
          />

          {changed && (
            <Alert severity="warning" role="alert" sx={{ mb: 3 }}>
              {t("declare.changed")}
            </Alert>
          )}
          {/*
            The signature was refused on the server (§314) — reached with JavaScript off, or past
            the browser's own check. Where the redirect lands (`#declaration-errors`), right above
            the form rather than above a page of legal text, focusable and announced like the
            registration form's summary (§47): what was wrong, that nothing was recorded and the
            link still works, a link that puts focus in the box, and what to do when the
            registered name is itself the mistake.

            Which name is wanted is said once, under the box, in bold (`SignatureField`) — where
            the eye goes to retype it, and where it stays while the box is still wrong. Said here
            as well it was the same sentence twice, a screen apart (found in review).

            A minor's declaration has two boxes (§NNN): a link to each one refused, and for each its
            own way out — the club corrects the minor's registered name, and nobody corrects a
            guardian's, so that one is cancel and register again.
          */}
          {nameRefused && (
            <Alert severity="error" id={DECLARATION_ERROR_SUMMARY_ID} role="alert" tabIndex={-1} sx={{ mb: 3 }}>
              <AlertTitle>{t("declare.nameRefusedTitle")}</AlertTitle>
              <Box>{t("declare.nameRefusedNothingRecorded")}</Box>
              {refusedBoxes.map((box) => (
                <Box key={box} sx={{ mt: 0.5 }}>
                  <MuiLink href={`#${box}`}>{boxLabel(box)}</MuiLink>
                </Box>
              ))}
              {refusedBoxes.includes("minorTypedName") && (
                <Box sx={{ mt: 0.5 }}>{t.rich(canReply ? "declare.minorNameWrongReply" : "declare.minorNameWrong", { contact })}</Box>
              )}
              {refusedBoxes.includes("typedName") && (
                <Box sx={{ mt: 0.5 }}>
                  {minorName !== null
                    ? t.rich(canReply ? "declare.signatureNameWrongForMinorReply" : "declare.signatureNameWrongForMinor", { contact, mine })
                    : t.rich(canReply ? "declare.signatureNameWrongReply" : "declare.signatureNameWrong", { contact })}
                </Box>
              )}
            </Alert>
          )}
          {/*
            An identity document refused on the server (§NNN): the same place, the same focusable
            summary, a link to each box it names. Never both summaries at once — the URL carries
            one code — so the id they share stays unique.
          */}
          {documentRefused && (
            <Alert severity="error" id={DECLARATION_ERROR_SUMMARY_ID} role="alert" tabIndex={-1} sx={{ mb: 3 }}>
              <AlertTitle>{t("declare.documentRefusedTitle")}</AlertTitle>
              <Box>{t("declare.documentRefusedNothingRecorded")}</Box>
              {refusedDocuments.map((box) => (
                <Box key={box} sx={{ mt: 0.5 }}>
                  <MuiLink href={`#${box}`}>{documentLabel(box)}</MuiLink>
                </Box>
              ))}
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
              <CheckboxField name="accepted" required defaultChecked={draft?.accepted === "on"}>
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
              {/*
                The name they registered with — or the parent's, for a minor (§108) — shown in bold,
                and since §314 required: the owner, of a signature reading "Florin Munca2", "can I
                also have this validation here? So I have to type the exact name?" This reverses
                the "hint, not a validation" half of §283; the island refuses a mismatch before
                the press and `signDeclaration` refuses it regardless. Strings in, never elements
                (`AGENTS.md` §14.1).

                The identity document the text names — asked only when it does (§95): any of
                `{{idDocument}}`, `{{participantIdDocument}}`, `{{guardianIdDocument}}`.
              */}
              {minorName === null ? (
                <>
                  {needsDocuments && (
                    <IdDocumentFields
                      name="idDocument"
                      typeLabel={t("declare.idDocumentType")}
                      typeHelp={t("declare.idDocumentTypeHelp")}
                      label={t("declare.idDocument")}
                      help={t("declare.idDocumentHelp")}
                      placeholder={t("declare.idDocumentPlaceholder")}
                      kinds={documentKinds}
                      defaultKind={draftKind(draft?.idDocumentType)}
                      defaultValue={draft?.idDocument ?? ""}
                      refused={refusedDocuments.includes("idDocument")}
                    />
                  )}
                  <SignatureField
                    id="typedName"
                    name="typedName"
                    signer="self"
                    expectedName={expectedName}
                    participantName={null}
                    contactHref={contactHref}
                    myRegistrationsHref={myRegistrationsHref}
                    canReply={canReply}
                    defaultValue={draft?.typedName}
                    refused={nameRefused}
                  />
                </>
              ) : (
                <>
                  {/*
                    A minor's declaration is signed by two people at one press (§NNN; the owner: "I
                    wanna have the ID document of the minor and the parent, and also 2 signatures!"):
                    the minor, then the parent or guardian, each with their own document and their
                    own name, each box checked against its own name. Two headed groups rather than
                    four look-alike boxes in a row, so nobody types the child's number under the
                    parent's name.
                  */}
                  <Typography>{t("declare.twoSignersIntro")}</Typography>
                  <Typography variant="h2" sx={{ fontSize: "1.125rem", pt: 1 }}>
                    {t("declare.minorSection", { name: minorName })}
                  </Typography>
                  {needsDocuments && (
                    <IdDocumentFields
                      name="minorIdDocument"
                      typeLabel={t("declare.minorIdDocumentType")}
                      typeHelp={t("declare.idDocumentTypeHelp")}
                      label={t("declare.minorIdDocument")}
                      help={t("declare.minorIdDocumentHelp")}
                      placeholder={t("declare.idDocumentPlaceholder")}
                      kinds={documentKinds}
                      defaultKind={draftKind(draft?.minorIdDocumentType)}
                      defaultValue={draft?.minorIdDocument ?? ""}
                      refused={refusedDocuments.includes("minorIdDocument")}
                    />
                  )}
                  <SignatureField
                    id="minorTypedName"
                    name="minorTypedName"
                    signer="minor"
                    expectedName={minorName}
                    participantName={null}
                    contactHref={contactHref}
                    myRegistrationsHref={myRegistrationsHref}
                    canReply={canReply}
                    defaultValue={draft?.minorTypedName}
                    refused={nameRefused}
                  />
                  <Typography variant="h2" sx={{ fontSize: "1.125rem", pt: 1 }}>
                    {t("declare.guardianSection", { name: expectedName ?? "" })}
                  </Typography>
                  {needsDocuments && (
                    <IdDocumentFields
                      name="idDocument"
                      typeLabel={t("declare.guardianIdDocumentType")}
                      typeHelp={t("declare.idDocumentTypeHelp")}
                      label={t("declare.guardianIdDocument")}
                      help={t("declare.idDocumentHelp")}
                      placeholder={t("declare.idDocumentPlaceholder")}
                      kinds={documentKinds}
                      defaultKind={draftKind(draft?.idDocumentType)}
                      defaultValue={draft?.idDocument ?? ""}
                      refused={refusedDocuments.includes("idDocument")}
                    />
                  )}
                  <SignatureField
                    id="typedName"
                    name="typedName"
                    signer="guardian"
                    expectedName={expectedName}
                    participantName={minorName}
                    contactHref={contactHref}
                    myRegistrationsHref={myRegistrationsHref}
                    canReply={canReply}
                    defaultValue={draft?.typedName}
                    refused={nameRefused}
                  />
                </>
              )}
              <Button type="submit" variant="contained" sx={TAP_TARGET}>
                {t("declare.action")}
              </Button>
              {/*
                The notice, under the button that hands over the identity document (§323): what
                happens to the number is a sentence in the box above and the whole of it here.
                A tab of its own, like the form's links (§197): the page is a half-done signature.
              */}
              <Box>
                <LegalLink href="/legal/privacy" newTabLabel={formCopy("opensInNewTab")} style={{ minHeight: TAP_TARGET.minHeight }}>
                  {t("declare.privacyLink")}
                </LegalLink>
              </Box>
            </Stack>
          </form>
        </>
      )}
    </Container>
  );
}
