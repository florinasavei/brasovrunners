import { getDb } from "@/db/client";
import { declarationWords, pdfResponse } from "@/modules/registrations/declaration-labels";
import { findRegistrationById } from "@/modules/registrations/repository";
import { findSignedDeclaration, renderSignedDeclarationPdf } from "@/modules/registrations/signed-declaration";
import { readRegistrationTokenContext } from "@/modules/registrations/token-actions";

/**
 * The runner's own signed declaration as a PDF (`DECISIONS.md` §95), from the same manage
 * link the confirmation email carries — read, never consumed, so the link keeps working. Any
 * other token, or a registration with no signature, answers 404 with nothing else said: the
 * same generic answer every participant token surface gives (BR-REQ-036-02).
 */
export async function GET(_request: Request, context: { params: Promise<{ token: string }> }): Promise<Response> {
  const { token } = await context.params;
  const read = await readRegistrationTokenContext(token, "MANAGE_REGISTRATION");
  if (!read.ok || !read.token.registrationId) return new Response(null, { status: 404 });

  const db = getDb();
  const registration = await findRegistrationById(db, read.token.registrationId);
  const signed = registration ? await findSignedDeclaration(db, registration.id) : undefined;
  if (!registration || !signed) return new Response(null, { status: 404 });

  const now = new Date();
  const pdf = await renderSignedDeclarationPdf(db, signed, registration.eventId, await declarationWords(signed.locale, now), now);
  if (!pdf) return new Response(null, { status: 404 });
  return pdfResponse(pdf, "declaratie-semnata.pdf");
}
