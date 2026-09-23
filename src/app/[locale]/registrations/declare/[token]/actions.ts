"use server";

import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getPathname } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { clearFormDraft, stashDraftValues } from "@/modules/registrations/form-draft";
import { DECLARATION_ERROR_SUMMARY_ID } from "@/modules/registrations/form-errors";
import { consumeAndSignDeclaration } from "@/modules/registrations/token-actions";
import { isDomainError } from "@/shared/errors/domain-error";

export async function signDeclarationAction(form: FormData): Promise<void> {
  const locale = (form.get("locale") === "en" ? "en" : "ro") as Locale;
  const token = String(form.get("token") ?? "");
  const path = getPathname({ locale, href: { pathname: "/registrations/declare/[token]", params: { token } } });

  try {
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
        idDocument: idDocumentFrom(form, await getTranslations({ locale, namespace: "Registrations" })),
        documentId: String(form.get("documentId") ?? ""),
        contentSha256: String(form.get("contentSha256") ?? ""),
      },
      new Date(),
    );

    if (!result.ok) redirect(`${path}?invalid=1`);
    // Signed: a draft kept by an earlier refused press has nothing left to fill in.
    await clearFormDraft(path);
    redirect(`${path}?done=${result.registration.status === "WAITLISTED" ? "waitlisted" : "confirmed"}`);
  } catch (error) {
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
    */
    if (isDomainError(error) && error.code === "VALIDATION_ERROR" && error.fields.includes("typedName")) {
      await stashDraftValues(declarationDraftOf(form), path);
      redirect(`${path}?invalid=name#${DECLARATION_ERROR_SUMMARY_ID}`);
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
    throw error;
  }
}

/**
 * What a refused signature brings back to the form (§314): these four fields and nothing else.
 * Not `draftValuesOf(form)` — that keeps every posted string, and this form posts the action
 * link's secret, the one value that must never be copied anywhere, sealed or not.
 */
function declarationDraftOf(form: FormData): Record<string, string> {
  const draft: Record<string, string> = {};
  for (const name of ["accepted", "idDocumentType", "idDocument", "typedName"]) {
    const value = form.get(name);
    if (typeof value === "string" && value !== "") draft[name] = value;
  }
  return draft;
}

/** The chosen kind and the typed series, as the one string the declaration carries (§283). */
function idDocumentFrom(form: FormData, t: (key: string) => string): string | undefined {
  const series = String(form.get("idDocument") ?? "").trim();
  if (series === "") return undefined;
  const kind = String(form.get("idDocumentType") ?? "");
  // An unknown kind is nobody's document: the series alone is what was true before §283, and it
  // is better than a declaration naming a document the person did not choose.
  const known = ["ID_CARD", "PASSPORT", "RESIDENCE_PERMIT", "OTHER"].includes(kind);
  return known ? `${t(`declare.idDocumentTypes.${kind}`)} ${series}` : series;
}
