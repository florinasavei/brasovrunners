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
        disallow: [
          "/api/",
          "/ro/admin/",
          "/en/admin/",
          "/ro/inscriere/",
          "/en/register/",
          "/ro/declaratie/",
          "/en/declaration/",
          "/ro/gestioneaza/",
          "/en/manage/",
          "/ro/previzualizare/",
          "/en/preview/",
          "/ro/alergatori/",
          "/en/runners/",
        ],
      },
    ],
    sitemap: `${env.APP_BASE_URL}/sitemap.xml`,
  };
}
