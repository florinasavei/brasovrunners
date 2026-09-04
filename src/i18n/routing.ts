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

    /**
     * Staff routes. Localized like everything else (AGENTS.md §9.2) but never in public
     * navigation, never in the sitemap, and disallowed in `robots.txt`.
     *
     * `/admin` keeps its English spelling in both locales: §9.2 maps it that way, and it is
     * the word the club already uses for the backoffice.
     */
    "/sign-in": { ro: "/autentificare", en: "/sign-in" },
    "/admin": "/admin",
    "/admin/events/[id]": "/admin/events/[id]",
    "/admin/staff": "/admin/staff",
    /** The staff-only preview of a draft (BR-REQ-051-02). */
    "/preview/events/[id]": { ro: "/previzualizare/evenimente/[id]", en: "/preview/events/[id]" },
  },
});

export type Locale = (typeof routing.locales)[number];
