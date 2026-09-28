import type { LegalDocumentKey } from "@/db/schema/legal-documents";
import { computeContentHash } from "../domain/content-hash";
import { LEGAL_TEMPLATES } from "./catalogue";

/**
 * The fingerprint of a key's platform template as the platform ships it (§NNN): both languages,
 * the titles and the bodies, **before** the club's facts are written in — the same canonical hash
 * a version's own words get (`computeContentHash`).
 *
 * Before the facts, on purpose. A deployment's facts change (a new seat, «Adresa de contact
 * afișată» on /admin/emails), and the question this answers is only "did the template change";
 * a fingerprint that moved with the facts would say «Șablon nou» about a template nobody touched.
 *
 * Stored on a version made from the template (`legal_documents.template_sha256`) and compared
 * with this, so the list and «Versiune nouă» can say which texts in force are older than their
 * template (`templateIsNewer`). A module of its own, apart from the catalogue, because this one
 * needs `node:crypto` and the catalogue is plain data.
 */
export function templateSha256(key: LegalDocumentKey): string {
  const template = LEGAL_TEMPLATES[key];
  return computeContentHash([
    { locale: "ro", title: template.ro.title, body: template.ro.body },
    { locale: "en", title: template.en.title, body: template.en.body },
  ]);
}
