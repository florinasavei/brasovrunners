import type { AbstractIntlMessages } from "next-intl";

/**
 * The words a client island reads for itself, and nothing else (§353).
 *
 * A `NextIntlClientProvider` rendered from a Server Component inherits the whole request
 * configuration in next-intl 4 — every message included — and the root layout rendered one with
 * no `messages` prop. So every public page carried the entire catalogue in its RSC payload: the
 * backoffice's `Admin` namespace alone is three quarters of it, sent to a visitor reading the
 * listing. A Server Component translates on the server and ships only the sentence it rendered;
 * the catalogue has to cross the wire only for what runs `useTranslations` in the browser, and
 * that is a handful of keys.
 *
 * Two lists, one per provider, and a test that keeps them honest
 * (`tests/unit/i18n/client-messages.test.ts`): it walks the import graph from every route to each
 * `"use client"` file, reads which keys that file asks for, and fails if a key a public route's
 * island reads is missing from `PUBLIC_CLIENT_MESSAGES`, if one an island only the backoffice
 * reaches is missing from both lists, or if an entry here is needed by no island at all. A key
 * an island builds at runtime (`t(section.segment)`, `` t(`languageCode.${locale}`) ``) needs its
 * whole sub-tree, which is why some entries below stop above the leaves.
 *
 * An entry is a dotted path into the catalogue: a namespace, a sub-tree or one message.
 */
export const PUBLIC_CLIENT_MESSAGES = [
  // SiteNav — labels looked up by route segment at runtime, so the whole sub-tree.
  "Site.nav",
  // LocaleSwitcher — its label, and each locale's code and name (built from the locale).
  "Site.language",
  "Site.languageCode",
  "Site.languageName",
  // ThemeModeToggle.
  "Site.themeDark",
  "Site.themeLight",
  // NewBuildNotice, in the header of every page.
  "Site.newBuild",
  // `[locale]/error.tsx` — the boundary every route's failure reaches, the backoffice's included.
  "Error",
  // SignatureField, on the declaration page: the hint, the refusal and the wrong-name sentence,
  // for each of the three signers (an adult, a minor's parent, the minor).
  "Registrations.declare.typedNameHelp",
  "Registrations.declare.typedNameHelpWithName",
  "Registrations.declare.typedNameHelpForMinor",
  "Registrations.declare.minorTypedNameHelp",
  "Registrations.declare.signatureMismatch",
  "Registrations.declare.signatureMismatchRich",
  "Registrations.declare.signatureMismatchForMinor",
  "Registrations.declare.signatureMismatchForMinorRich",
  "Registrations.declare.minorSignatureMismatch",
  "Registrations.declare.minorSignatureMismatchRich",
  "Registrations.declare.signatureNameWrong",
  "Registrations.declare.signatureNameWrongReply",
  "Registrations.declare.signatureNameWrongForMinor",
  "Registrations.declare.signatureNameWrongForMinorReply",
  "Registrations.declare.minorNameWrong",
  "Registrations.declare.minorNameWrongReply",
] as const;

/**
 * What only the backoffice's islands read — `/admin` and `/devs`, whose layouts nest a second
 * provider with these added.
 */
export const STAFF_CLIENT_MESSAGES = [
  // DateField and TimeField (`shared/forms/pickers`): the typed format and its refusal.
  "Admin.pickers",
  // SeriesScope, in the event editor: which dates of a series a save reaches.
  "Admin.editor.scope",
  "Admin.editor.boxes.pickDates.title",
  "Event.series.count",
] as const;

/**
 * What a backoffice layout hands its nested provider. A provider's `messages` replace the
 * parent's rather than merging with them, so the public list travels again beside the staff one —
 * a couple of kilobytes, on pages only staff open.
 */
export const BACKOFFICE_CLIENT_MESSAGES = [...PUBLIC_CLIENT_MESSAGES, ...STAFF_CLIENT_MESSAGES] as const;

function isMessages(value: unknown): value is AbstractIntlMessages {
  return typeof value === "object" && value !== null;
}

/**
 * The part of `messages` the dotted `paths` name, nested as in the catalogue. A path the
 * catalogue does not have is left out rather than invented — the test above is what fails on it,
 * and an island then shows next-intl's own fallback (loudly, outside production: `errors.ts`).
 *
 * `messages` is never written to: a sub-tree is shared by reference only once it is picked whole,
 * and a later path inside it is then already covered.
 */
export function pickMessages(messages: AbstractIntlMessages, paths: readonly string[]): AbstractIntlMessages {
  const picked: AbstractIntlMessages = {};
  for (const path of paths) {
    const segments = path.split(".");
    let source: AbstractIntlMessages | string | undefined = messages;
    for (const segment of segments) source = isMessages(source) ? source[segment] : undefined;
    if (source === undefined) continue;

    let into = picked;
    let from: AbstractIntlMessages = messages;
    let covered = false;
    for (const segment of segments.slice(0, -1)) {
      from = from[segment] as AbstractIntlMessages;
      const existing = into[segment];
      // An ancestor already picked whole: this path is inside it.
      if (existing === from) {
        covered = true;
        break;
      }
      if (!isMessages(existing)) into[segment] = {};
      into = into[segment] as AbstractIntlMessages;
    }
    if (!covered) into[segments[segments.length - 1]] = source;
  }
  return picked;
}
