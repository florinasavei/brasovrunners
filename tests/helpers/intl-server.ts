import { createTranslator } from "next-intl";
import en from "../../messages/en.json";
import ro from "../../messages/ro.json";

/**
 * `next-intl/server` for the tests that call a route handler or a page outside Next (§NNN): `getTranslations`
 * answers from the real catalogues, in the language the caller names — `getTranslations({ locale, namespace })`
 * as the export route and the sponsor list ask, or `getTranslations("Admin")` as a page does, in Română.
 *
 * Use it as `vi.mock("next-intl/server", async () => (await import("../../helpers/intl-server")).intlServerMock)`.
 */
export const intlServerMock = {
  setRequestLocale: () => {},
  getLocale: async () => "ro",
  getMessages: async () => ro,
  getTranslations: async (arg: string | { locale?: string; namespace: string }) => {
    const namespace = typeof arg === "string" ? arg : arg.namespace;
    const locale = typeof arg === "string" ? "ro" : (arg.locale ?? "ro");
    const catalogue = (locale === "en" ? en : ro) as unknown as Record<string, Record<string, unknown>>;
    return createTranslator({ locale, messages: catalogue[namespace] as never });
  },
};
