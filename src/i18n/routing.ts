import { defineRouting } from "next-intl/routing";

// BR-REQ-040-01: every public route is locale-prefixed, `ro` is the default, and the prefix is
// always present so `/evenimente` never silently means Romanian.
export const routing = defineRouting({
  locales: ["ro", "en"],
  defaultLocale: "ro",
  localePrefix: "always",
});

export type Locale = (typeof routing.locales)[number];
