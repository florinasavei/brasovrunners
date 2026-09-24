"use client";

import { NextIntlClientProvider, useLocale } from "next-intl";
import { type ReactNode, useMemo } from "react";
import { onIntlError } from "./errors";

/**
 * The client half of `errors.ts` (§353): a missing message in an island throws locally and in
 * tests, and falls back quietly on QA and production.
 *
 * A function cannot cross from a Server Component to a client one, so `onError` is not among what
 * a server-rendered provider passes down; next-intl's answer is a provider of the client's own,
 * nested inside it. It names no messages, formats or zone of its own, so it inherits the parent's
 * (`use-intl`'s `IntlProvider` falls back to its parent for each prop left undefined) and adds
 * only the handler — which the backoffice's nested provider, further down, inherits in turn.
 */
export default function IntlErrorHandling({ loud, children }: { loud: boolean; children: ReactNode }) {
  const locale = useLocale();
  // Memoised: a new function on each render would hand every translating island a new context.
  const onError = useMemo(() => onIntlError(loud), [loud]);
  return (
    <NextIntlClientProvider locale={locale} onError={onError}>
      {children}
    </NextIntlClientProvider>
  );
}
