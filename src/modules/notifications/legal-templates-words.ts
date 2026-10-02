import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import type { LegalDocumentKey } from "@/db/schema/legal-documents";
import { LEGAL_DOCUMENT_KEYS } from "@/modules/legal-documents/domain/keys";

/**
 * The backoffice's own words, as «Șabloanele textelor legale s-au schimbat» quotes them (§NNN): the
 * texts' names from the catalogue `/admin/legal` lists them by, and the buttons the message tells an
 * Administrator to press, read from the catalogue the screens read — so a renamed button renames the
 * email with it, and the message never sends anybody looking for a word no screen says (§441's rule
 * for the guide). Outside a request, like `fallback-notice-words.ts`.
 */
const CATALOGUES = { ro, en } as const;

/** A button's label without its count — «Regenerează toate ({count})» is «Regenerează toate». */
function withoutCount(label: string): string {
  return label.replace(/\s*\(\{[^)]*\)/g, "").trim();
}

/** The first clause of a sentence the screen shows — «O ciornă așteaptă deja: aprob-o…» is «O ciornă așteaptă deja». */
function firstClause(sentence: string): string {
  return sentence.split(":")[0].trim();
}

export type LegalTemplatesWords = {
  /** «Documente legale», the backoffice's menu entry. */
  documents: string;
  /** «Versiune nouă», the button on `/admin/legal` that opens `/admin/legal/new`. */
  newVersion: string;
  /** «Regenerează toate», the one press on «Versiune nouă» that drafts every text whose template moved. */
  regenerateAll: string;
  /** «Aprobă ciornele», the one press on `/admin/legal` that approves every draft ready for it. */
  approveDrafts: string;
  /** «O ciornă așteaptă deja», what a text with a draft waiting says instead of regenerating. */
  draftExists: string;
  /** «Șablon nou», the chip on a text whose template is newer than the text in force (§539). */
  templateNew: string;
  /** «Sarcini», where the same rows stand until the texts are approved. */
  tasks: string;
};

export function legalTemplatesWords(locale: "ro" | "en"): LegalTemplatesWords {
  const admin = CATALOGUES[locale].Admin;
  return {
    documents: admin.nav.legal,
    newVersion: admin.legal.newVersion,
    regenerateAll: withoutCount(admin.legal.startFrom.regenerateAll),
    approveDrafts: withoutCount(admin.legal.batch.approve),
    draftExists: firstClause(admin.legal.kinds.draftExists),
    templateNew: admin.legal.kinds.templateNew,
    tasks: admin.nav.tasks,
  };
}

/** The texts' names in one language, in the order `/admin/legal` lists them; a key the catalogue does not know is dropped. */
export function legalTemplateNames(locale: "ro" | "en", keys: readonly string[]): string[] {
  const names: Record<LegalDocumentKey, string> = CATALOGUES[locale].Admin.legal.keys;
  return LEGAL_DOCUMENT_KEYS.filter((key) => keys.includes(key)).map((key) => names[key]);
}
