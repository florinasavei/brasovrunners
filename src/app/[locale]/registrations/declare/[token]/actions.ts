"use server";

import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getDb } from "@/db/client";
import { getPathname } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { currentDeadlines } from "@/modules/deadlines/deadlines";
import { reminderHoursFor } from "@/modules/deadlines/domain/deadlines";
import { findEventForRegistrationById } from "@/modules/events/repository";
import { clearFormDraft, stashDraftValues } from "@/modules/registrations/form-draft";
import { DECLARATION_ERROR_SUMMARY_ID } from "@/modules/registrations/form-errors";
import { NO_WAITLIST, waitlistRefusalOf } from "@/modules/registrations/domain/waitlist";
import { consumeAndSignDeclaration } from "@/modules/registrations/token-actions";
import { isDomainError } from "@/shared/errors/domain-error";
import { idDocumentFrom } from "@/modules/registrations/id-document-input";

export async function signDeclarationAction(form: FormData): Promise<void> {
  const locale = (form.get("locale") === "en" ? "en" : "ro") as Locale;
  const token = String(form.get("token") ?? "");
  const path = getPathname({ locale, href: { pathname: "/registrations/declare/[token]", params: { token } } });

  try {
    const t = await getTranslations({ locale, namespace: "Registrations" });
    const result = await consumeAndSignDeclaration(
      token,
      {
        accepted: form.get("accepted") === "on",
        typedName: String(form.get("typedName") ?? ""),
        /*
          The kind and the number, as one line in the declaration (§283).

          Composed here rather than stored as two columns: `{{idDocument}}` is one merge field in
          a text the club approved, and the signed PDF has to read as a sentence — "Carte de
          identitate BV 123456". The kind is translated at this moment, in the language the
          person is signing in, because that is the language of the document they are signing.
        */
        idDocument: idDocumentFrom(form, t, "idDocument"),
        /*
          A minor's own signature and document (§330), posted only by the page a minor's
          registration renders under a declaration that asks the minor to sign. A box that was on
          the page and left empty is posted as the empty string, which the service refuses on that
          box; a box that was never on the page is absent. Whether it was asked is not read from
          here: the service reads the text itself.
        */
        minorTypedName: form.has("minorTypedName") ? String(form.get("minorTypedName") ?? "") : undefined,
        minorIdDocument: idDocumentFrom(form, t, "minorIdDocument"),
        documentId: String(form.get("documentId") ?? ""),
        contentSha256: String(form.get("contentSha256") ?? ""),
      },
      new Date(),
    );

    if (!result.ok) redirect(`${path}?invalid=1`);
    // Signed: a draft kept by an earlier refused press has nothing left to fill in.
    await clearFormDraft(path);
    /*
      "What is next" says when the reminder comes (§377): this event's own lead, or the club's, as
      whole hours in the address — the page has spent its token and reads nothing else. Only words
      on the runner's own page depend on it; the page bounds it and falls back to the club's number.
    */
    const event = await findEventForRegistrationById(getDb(), result.registration.eventId);
    const reminder = event ? reminderHoursFor(event, await currentDeadlines(getDb())) : null;
    redirect(`${path}?done=${result.registration.status === "WAITLISTED" ? "waitlisted" : "confirmed"}${reminder === null ? "" : `&reminder=${reminder}`}`);
  } catch (error) {
    /*
      The hold had lapsed at the press, its place went on down the waiting list, and the list is
      full (§348): the allocator would not queue this registration again. Its own sentence, first,
      because the refusal is a VALIDATION_ERROR and the generic branch below would call it an
      unticked box. Nothing was recorded and the token was not spent.
    */
    const full = waitlistRefusalOf(error);
    if (full) redirect(`${path}?full=${full === NO_WAITLIST ? "closed" : "1"}`);
    /*
      The signature is not the declarant's name (§314) — its own refusal, never the generic one.

      `?invalid=1` renders "we could not record the signature … your link is fine", written for
      an unticked box; a name refused under it would leave somebody guessing what was wrong. The
      code goes in the URL and nothing else (§14.5: neither the name expected nor the one typed),
      and the page says which name, next to the box, from the registration it already reads.
      Nothing was recorded and the token was not spent: the throw rolled the transaction back.

      What was typed comes back, sealed, for ten minutes (`form-draft.ts`): the tick, the kind of
      document, its series and number, and the signature itself, so the one thing left to do is
      correct the name. The series and number ride along deliberately — keeping them sealed for
      minutes on the person's own browser is a smaller exposure than the declaration keeps them
      for (seven days after the event, §95), and making somebody retype a document number to
      recover from a refusal about their name is friction charged to the wrong field (§286).

      A minor's declaration has two signature boxes (§330), and either refused lands here with the
      same code: the page compares both kept signatures again with the one pure function the
      service used (`mismatchedSignatures`) and marks whichever is wrong, so the URL still carries
      a code and nothing else.
    */
    if (
      isDomainError(error) &&
      error.code === "VALIDATION_ERROR" &&
      (error.fields.includes("typedName") || error.fields.includes("minorTypedName"))
    ) {
      await stashDraftValues(declarationDraftOf(form), path);
      redirect(`${path}?invalid=name#${DECLARATION_ERROR_SUMMARY_ID}`);
    }
    /*
      An identity document the text asks for, left out or not a series and number (§330, found in
      review): its own refusal as well, for the reason the name has one — the generic sentence
      below asks for a tick, and a parent who had ticked would be left guessing that the child's
      document was the missing piece. Reachable only past the browser's own `required` and
      `pattern`, so it is rare; but a minor's declaration has two document boxes, and the page
      says which one. The same draft comes back, so only the missing box is left to fill.

      Not when the tick is missing as well: that is the generic refusal, which says to tick it.
    */
    if (
      isDomainError(error) &&
      error.code === "VALIDATION_ERROR" &&
      !error.fields.includes("accepted") &&
      (error.fields.includes("idDocument") || error.fields.includes("minorIdDocument"))
    ) {
      await stashDraftValues(declarationDraftOf(form), path);
      redirect(`${path}?invalid=document#${DECLARATION_ERROR_SUMMARY_ID}`);
    }
    // The checkbox is HTML-required, so this is only a client that bypassed it — treated the
    // same as an invalid token rather than as a server error, since nothing was consumed (the
    // whole transaction, including the token spend, rolled back with the validation failure).
    if (isDomainError(error) && error.code === "VALIDATION_ERROR") redirect(`${path}?invalid=1`);
    // The text changed between reading and signing (BR-REQ-033-02 criterion 6). Nothing was
    // recorded and the token was not spent, so the same page shows the current text again.
    if (isDomainError(error) && error.code === "CONFLICT" && error.message.startsWith("DECLARATION_CHANGED")) {
      redirect(`${path}?changed=1`);
    }
    /*
      Any other conflict is the registration's state (§NNN): it lapsed, was cancelled, went back to
      the waiting list or was confirmed at the desk while the link stayed live, or it changed under
      a concurrent press. The transaction rolled back and nothing was spent, so the page is simply
      shown again — and it now reads the state and says where the registration stands, in place of
      a form nobody can sign — rather than the error page (AGENTS.md §14.3: translated at the boundary).
    */
    if (isDomainError(error) && error.code === "CONFLICT") redirect(path);
    throw error;
  }
}

/**
 * What a refused signature brings back to the form (§314): these fields and nothing else — the
 * tick, and for each signer the kind of document, its series and number, and the signature (the
 * minor's three only on a minor's declaration, §330). Not `draftValuesOf(form)` — that keeps
 * every posted string, and this form posts the action link's secret, the one value that must
 * never be copied anywhere, sealed or not.
 */
function declarationDraftOf(form: FormData): Record<string, string> {
  const draft: Record<string, string> = {};
  for (const name of [
    "accepted",
    "idDocumentType",
    "idDocument",
    "typedName",
    "minorIdDocumentType",
    "minorIdDocument",
    "minorTypedName",
  ]) {
    const value = form.get(name);
    if (typeof value === "string" && value !== "") draft[name] = value;
  }
  return draft;
}
