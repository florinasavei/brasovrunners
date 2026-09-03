import { defineRouting } from "next-intl/routing";

// BR-REQ-040-01: every public route is locale-prefixed, `ro` is the default, and the prefix is
// always present so `/evenimente` never silently means Romanian.
export const routing = defineRouting({
  locales: ["ro", "en"],
  defaultLocale: "ro",
  localePrefix: "always",

  /**
   * Localized pathnames, per AGENTS.md §9.2. The key is the internal route — the folder under
   * `src/app/[locale]/` — and the value is what a visitor sees per locale. Romanian and
   * English differ, so `/ro/evenimente` and `/en/events` are the same page.
   *
   * Never build one of these URLs by hand. Use the helpers in `navigation.ts`, which resolve
   * the right external path for the active locale; concatenating them is what produces an
   * `hreflang` pointing at a URL that does not exist.
   */
  pathnames: {
    "/": "/",
    "/events": { ro: "/evenimente", en: "/events" },
    "/events/[slug]": { ro: "/evenimente/[slug]", en: "/events/[slug]" },
  },
});

export type Locale = (typeof routing.locales)[number];
