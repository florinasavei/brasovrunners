import { defineRouting } from "next-intl/routing";

// BR-REQ-040-01: every public route is locale-prefixed, `ro` is the default, and the prefix is
// always present so `/evenimente` never silently means Romanian.
export const routing = defineRouting({
  locales: ["ro", "en"],
  defaultLocale: "ro",
  localePrefix: "always",
  /**
   * The root URL is Romanian for everyone. next-intl would otherwise read `Accept-Language`
   * and a session cookie and send an English-configured browser to `/en` — which is how the
   * owner, on an English machine, kept landing on the English site. The club is Romanian, the
   * default locale is `ro` (BR-REQ-040-01), and the switcher is one tap away for everyone else.
   * No locale cookie either, since 2026-09-18 ("the default language must be Romanian"): a
   * visitor who once switched to English still landed on `/en` from the root on their next
   * visit, and the owner read that as the site defaulting to English. Every page carries its
   * locale in the address, so English survives navigation; only the bare root is always Romanian.
   */
  localeDetection: false,
  localeCookie: false,

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
    /**
     * "Send me that link again" (§19.4's second surface). No token in the path — this is the
     * route somebody reaches precisely because they have no token, so it takes an address and
     * answers the same way whatever that address turns out to mean.
     */
    "/registrations/resend": {
      ro: "/inregistrari/retrimite",
      en: "/registrations/resend",
    },
    /**
     * "My registrations" (BR-REQ-036-04, `DECISIONS.md` §77): the form that takes an address,
     * and the page a `MANAGE_PROFILE` token opens — every active registration of one person.
     */
    "/registrations/mine": { ro: "/inscrieri/ale-mele", en: "/registrations/mine" },
    "/registrations/mine/[token]": { ro: "/inscrieri/ale-mele/[token]", en: "/registrations/mine/[token]" },

    /**
     * Standing pages the club writes for itself — "About Brașov Runners", "Contact"
     * (BR-REQ-050-03). Under their own prefix rather than at the site root: a page slug and an
     * event slug are then two different URLs, so `contact` may be both without either winning.
     */
    "/pages/[slug]": { ro: "/pagini/[slug]", en: "/pages/[slug]" },
    /** The photo gallery (BR-REQ-054-01): albums, then one album's photos. */
    "/gallery": { ro: "/galerie", en: "/gallery" },
    "/gallery/[slug]": { ro: "/galerie/[slug]", en: "/gallery/[slug]" },

    /**
     * "Scrie-ne" (BR-REQ-070-04, `DECISIONS.md` §149): the form that reaches the club's own
     * mailbox. The same word in both languages, and a different prefix from the club's
     * standing pages, so a page the club calls `contact` keeps its address at `/pagini/contact`.
     */
    "/contact": "/contact",

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
    /**
     * What this deployment is configured to do (BR-REQ-090-04). Administrator only, and the
     * same spelling in both locales: it is read by whoever is holding the hosting dashboard.
     */
    "/devs": "/devs",
    "/admin/events/new": "/admin/events/new",
    "/admin/events/[id]": "/admin/events/[id]",
    /** Every bib of the event as a picture (`DECISIONS.md` §94). */
    "/admin/events/[id]/bibs": "/admin/events/[id]/bibs",
    /**
     * The hard delete's own screen: what would be destroyed, and the typed confirmation
     * (BR-REQ-037-06). A page rather than a dialog, so it works with JavaScript switched off
     * and so the refusal has somewhere to land.
     */
    "/admin/events/[id]/erase": "/admin/events/[id]/erase",
    "/admin/staff": "/admin/staff",
    "/admin/registrations": "/admin/registrations",
    "/admin/tasks": "/admin/tasks",
    "/admin/registrations/new": "/admin/registrations/new",
    "/admin/registrations/[id]": "/admin/registrations/[id]",
    "/devs/theme": "/devs/theme",
    /** The repository's documents, rendered for the roles that read `/devs` (`DECISIONS.md` §88). */
    "/devs/docs/[name]": "/devs/docs/[name]",
    "/admin/guide": "/admin/guide",
    /** Every email the platform sends, rendered with sample data (`DECISIONS.md` §91). */
    "/admin/emails": "/admin/emails",
    "/admin/checkin": "/admin/checkin",
    "/admin/checkin/[code]": "/admin/checkin/[code]",
    "/admin/legal": "/admin/legal",
    "/admin/legal/new": "/admin/legal/new",
    "/admin/legal/[id]": "/admin/legal/[id]",
    /**
     * Deleting an approved version outright (`DECISIONS.md` §151): what goes, that the number
     * goes with it, and the phrase to type. A page rather than a dialog, for the reasons
     * `/admin/events/[id]/erase` gives — the consequence does not fit in a `confirm()`, the
     * form must work with JavaScript off, and a mistyped confirmation needs somewhere to land.
     */
    "/admin/legal/[id]/delete": "/admin/legal/[id]/delete",
    "/admin/pages": "/admin/pages",
    "/admin/pages/new": "/admin/pages/new",
    "/admin/pages/[id]": "/admin/pages/[id]",
    "/admin/gallery": "/admin/gallery",
    "/admin/gallery/new": "/admin/gallery/new",
    /** Every stored picture and where it is used (`DECISIONS.md` §73). */
    "/admin/gallery/pictures": "/admin/gallery/pictures",
    "/admin/gallery/[id]": "/admin/gallery/[id]",
    /** The staff-only preview of a draft (BR-REQ-051-02). */
    "/preview/events/[id]": { ro: "/previzualizare/evenimente/[id]", en: "/preview/events/[id]" },
  },
});

export type Locale = (typeof routing.locales)[number];
