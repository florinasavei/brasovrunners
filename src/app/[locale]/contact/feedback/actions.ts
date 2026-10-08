"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { createEmailSenderForEnvironment } from "@/infrastructure/email/sender";
import { getPathname } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { contactSmtpRoad } from "@/modules/contact/delivery";
import { BRANCH_SLUG, FEEDBACK_BRANCHES, FEEDBACK_ERROR_SUMMARY_ID, FEEDBACK_QUERY, type FeedbackBranch } from "@/modules/feedback/domain/branches";
import { type FeedbackOutcome, submitFeedback } from "@/modules/feedback/service";
import { readFeedbackSettingsMemo } from "@/modules/feedback/settings";
import { noticeDescribesFeedbackForms } from "@/modules/legal-documents/repository";
import { cachedPublishedEventBySlug } from "@/modules/public-cache/reads";
import { botCheckIsOn } from "@/modules/registrations/bot-check";
import { TURNSTILE_FIELD } from "@/modules/registrations/domain/turnstile-widget";
import { clearFormDraft, stashDraftValues } from "@/modules/registrations/form-draft";
import { verifyTurnstile } from "@/modules/registrations/turnstile";
import { isDatabaseAwayError } from "@/modules/resilience/domain/database-away";
import { env } from "@/shared/config/env";
import { isDomainError } from "@/shared/errors/domain-error";

function text(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}

/** What a refusal keeps, sealed (§142): the boxes, the ticks joined — never the trap, the clock or the token. */
function keepTyped(form: FormData, path: string): Promise<void> {
  const values: Record<string, string> = {};
  for (const name of ["event", "date", "rating", "message", "reasonOther", "whereWhen", "contact", "email"]) {
    const value = text(form, name);
    if (value !== "") values[name] = value;
  }
  const reasons = form.getAll("reasons").filter((value): value is string => typeof value === "string");
  if (reasons.length > 0) values.reasons = reasons.join(",");
  return stashDraftValues(values, path);
}

/**
 * «Spune-ne ceva»'s one submit handler (§NNN; BR-REQ-070-04). Always a redirect back to the wizard:
 * `?sent=<branch>` when the message left (or was a bot's on an ordinary branch, answered the same),
 * `?error=<code>` otherwise — `VALIDATION_ERROR` with the box names (never a value, §14.5; what was
 * typed rides in the draft cookie, path-scoped to the wizard), `LIMITED` or `UNAVAILABLE`, each one
 * sentence on the page. The branch is `?tip=`, so a refusal lands on the form it came from.
 */
export async function submitFeedbackAction(form: FormData): Promise<void> {
  const locale: Locale = form.get("locale") === "en" ? "en" : "ro";
  const path = getPathname({ locale, href: "/contact/feedback" });
  const branch: FeedbackBranch | null = FEEDBACK_BRANCHES.find((name) => name === form.get("branch")) ?? null;
  const tip = branch ? `${FEEDBACK_QUERY.branch}=${BRANCH_SLUG[branch]}` : "";
  const renderedAt = text(form, "renderedAt");
  // The corrected form is timed from the render it corrects (§146's `since`), or a quick fix reads as a bot.
  const since = renderedAt ? `&since=${encodeURIComponent(renderedAt)}` : "";
  const back = (code: string, fields = "") => `${path}?${tip}${tip ? "&" : ""}error=${code}${fields}${since}#${FEEDBACK_ERROR_SUMMARY_ID}`;

  let outcome: FeedbackOutcome;
  try {
    const now = new Date();
    const db = getDb();
    // The IP goes to Cloudflare with the token and nowhere else (AGENTS.md §19.4).
    const requestHeaders = await headers();
    const remoteIp = requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
    const token = String(form.get(TURNSTILE_FIELD) ?? "");
    const verdict = (await botCheckIsOn(db, now)) ? await verifyTurnstile(token, remoteIp) : "not_configured";

    const [settings, noticeDescribes] = await Promise.all([readFeedbackSettingsMemo(db, now), noticeDescribesFeedbackForms(db, now)]);
    outcome = await submitFeedback(
      db,
      {
        settings,
        noticeDescribes,
        smtp: contactSmtpRoad(),
        // Mailgun's road alone for the safety branch: the environment's sender with no Gmail road at all.
        mailgun: createEmailSenderForEnvironment(env).sender,
        appEnv: env.APP_ENV,
        screening: {
          botCheckOn: verdict !== "not_configured",
          tokenPresent: token.length > 0,
          turnstileVerdict: verdict,
          clubHost: new URL(env.APP_BASE_URL).hostname,
        },
        eventTitle: async (slug, formLocale) => (await cachedPublishedEventBySlug(formLocale, slug))?.title ?? null,
      },
      {
        branch: text(form, "branch"),
        locale,
        event: text(form, "event"),
        date: text(form, "date"),
        rating: text(form, "rating"),
        message: text(form, "message"),
        reasons: form.getAll("reasons").filter((value): value is string => typeof value === "string"),
        reasonOther: text(form, "reasonOther"),
        whereWhen: text(form, "whereWhen"),
        contact: text(form, "contact"),
        email: text(form, "email"),
        honeypot: text(form, "honeypot") || undefined,
        renderedAt: renderedAt || undefined,
      },
      now,
    );
  } catch (error) {
    if (isDomainError(error) && error.code === "VALIDATION_ERROR") {
      await keepTyped(form, path);
      redirect(back("VALIDATION_ERROR", error.fields.length > 0 ? `&fields=${error.fields.join(",")}` : ""));
    }
    // The database is away (§447): the bucket and the settings need it. The text is kept.
    if (isDatabaseAwayError(error)) {
      console.error("[feedback] the database is away; the message goes back with the form");
      await keepTyped(form, path);
      redirect(back("UNAVAILABLE"));
    }
    throw error;
  }

  if (outcome.outcome === "sent" || outcome.outcome === "ignored") {
    await clearFormDraft(path);
    redirect(`${path}?sent=${branch ? BRANCH_SLUG[branch] : ""}`);
  }
  await keepTyped(form, path);
  if (outcome.outcome === "captcha") redirect(back("VALIDATION_ERROR", "&fields=captcha"));
  redirect(back(outcome.outcome === "limited" ? "LIMITED" : "UNAVAILABLE"));
}
