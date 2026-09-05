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
    "/events/[slug]/register": { ro: "/evenimente/[slug]/inscriere", en: "/events/[slug]/register" },

    /**
     * The three email-token landing pages (AGENTS.md §13.2, §13.3 scopes verify/complete/
     * manage). Three routes rather than one generic one, because a token's own purpose lives
     * in the database row and reading a GET link must not require guessing it — matching the
     * scope names the token itself carries.
     */
    "/registrations/confirm/[token]": {
      ro: "/inregistrari/confirmare/[token]",
      en: "/registrations/confirm/[token]",
    },
    "/registrations/declare/[token]": {
      ro: "/inregistrari/declaratie/[token]",
      en: "/registrations/declare/[token]",
    },
    "/registrations/manage/[token]": {
      ro: "/inregistrari/gestionare/[token]",
      en: "/registrations/manage/[token]",
    },

    /** The two public legal routes (§9.2), linked from the footer in both locales. */
    "/legal/privacy": { ro: "/confidentialitate", en: "/privacy" },
    "/legal/terms": { ro: "/termeni", en: "/terms" },

    /**
     * Staff routes. Localized like everything else (AGENTS.md §9.2) but never in public
     * navigation, never in the sitemap, and disallowed in `robots.txt`.
     *
     * `/admin` keeps its English spelling in both locales: §9.2 maps it that way, and it is
     * the word the club already uses for the backoffice.
     */
    "/sign-in": { ro: "/autentificare", en: "/sign-in" },
    "/admin": "/admin",
    "/admin/events/new": "/admin/events/new",
    "/admin/events/[id]": "/admin/events/[id]",
    "/admin/staff": "/admin/staff",
    "/admin/registrations": "/admin/registrations",
    "/admin/registrations/new": "/admin/registrations/new",
    "/admin/registrations/[id]": "/admin/registrations/[id]",
    "/admin/legal": "/admin/legal",
    "/admin/legal/[id]": "/admin/legal/[id]",
    /** The staff-only preview of a draft (BR-REQ-051-02). */
    "/preview/events/[id]": { ro: "/previzualizare/evenimente/[id]", en: "/preview/events/[id]" },
  },
});

export type Locale = (typeof routing.locales)[number];
