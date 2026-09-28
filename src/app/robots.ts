import type { MetadataRoute } from "next";
import { env } from "@/shared/config/env";

/**
 * BR-REQ-070-03 criterion 4 and BR-REQ-090-01.
 *
 * QA must never be indexed. The disallow list covers admin, API, participant action and
 * manage paths, declarations, preview, and runner profiles in both locales — those routes do
 * not all exist yet, and listing them before they ship is the point: the day a participant
 * action link is deployed it is already excluded, rather than being indexed for however long
 * it takes someone to remember.
 *
 * Criterion 5 concerns the training-crawler policy, which BUSINESS.md §9 still lists as an
 * open owner decision. No AI user-agent is named here in either direction until it is taken —
 * inventing a policy would misrepresent the club.
 */
export default function robots(): MetadataRoute.Robots {
  if (env.APP_ENV !== "production") {
    return { rules: [{ userAgent: "*", disallow: "/" }] };
  }

  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        // Prefixes without a trailing slash: "/ro/admin/" does not cover "/ro/admin" itself,
        // and the backoffice index is the one page of the set a crawler is most likely to
        // find first.
        disallow: [
          "/api/",
          "/ro/admin",
          "/en/admin",
          "/ro/devs",
          "/en/devs",
          "/ro/autentificare",
          "/en/sign-in",
          // The members' zone (§524): behind the sign-in; «Beneficiile membrilor» stays open.
          "/ro/zona-membri",
          "/en/members-area",
          "/ro/inscriere",
          "/en/register",
          "/ro/declaratie",
          "/en/declaration",
          "/ro/gestioneaza",
          "/en/manage",
          "/ro/previzualizare",
          "/en/preview",
          "/ro/alergatori",
          "/en/runners",
          /*
            What a crawler has no business in, and each visit of which starts a function now that
            the public pages are static (§NNN). The canonical addresses stay open: `/ro/evenimente`,
            `/ro/calendar` and every `/ro/evenimente/<slug>` have no `?`, and the sitemap names them.
            - Every query permutation of the listing and the calendar — ten filter groups and a month
              or a year each, which multiply into more addresses than the site has pages, all
              canonical to the bare page (§342, §413) and each the live twin's render (`?` is a
              literal prefix here: `/ro/evenimente?` blocks `/ro/evenimente?type=RACE`, never
              `/ro/evenimente`).
            - An event page with a query: a start list's `?lista=` pages (names, §32), the interest
              box's outcome — `*` is the path wildcard Google and Bing read.
            - The live twins themselves (`/<locale>/live/…`), never linked.
            - The forms and the pages behind an emailed link: registration, the group run's
              declaration, every token page, the newsletter's two.
            - The share picture to download: a function per shape; the Open Graph one stays open.
          */
          "/ro/evenimente?",
          "/en/events?",
          "/ro/calendar?",
          "/en/calendar?",
          "/ro/evenimente/*?",
          "/en/events/*?",
          "/ro/live/",
          "/en/live/",
          "/ro/evenimente/*/inscriere",
          "/en/events/*/register",
          "/ro/evenimente/*/declaratie",
          "/en/events/*/declaration",
          "/ro/inregistrari/",
          "/en/registrations/",
          "/ro/inscrieri/",
          "/ro/noutati/",
          "/en/newsletter/",
          "/*/share-image",
        ],
      },
    ],
    sitemap: `${env.APP_BASE_URL}/sitemap.xml`,
  };
}
