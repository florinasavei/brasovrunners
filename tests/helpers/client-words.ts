import { NextIntlClientProvider } from "next-intl";
import { type ComponentProps, createElement, type ReactNode } from "react";
import en from "../../messages/en.json";
import ro from "../../messages/ro.json";

/**
 * A server render with the words a client island reads for itself, as the root layout gives them
 * (§353). Since §NNN a picture in a rich text is an island (`PictureLightbox`) that names its button
 * through `useTranslations`, so a test that renders a body with a picture renders it inside this.
 */
export function withClientWords(node: ReactNode, locale: "ro" | "en" = "ro") {
  return createElement(
    NextIntlClientProvider,
    { locale, messages: locale === "ro" ? ro : en } as unknown as ComponentProps<typeof NextIntlClientProvider>,
    node,
  );
}
