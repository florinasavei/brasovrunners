"use server";

import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { getPathname } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { findEventForRegistrationById, findPublishedEventBySlug } from "@/modules/events/repository";
import { clearFormDraft, readSubmittedFacts, stashFormDraft, stashSubmittedFacts } from "@/modules/registrations/form-draft";
import { ERROR_SUMMARY_ID } from "@/modules/registrations/form-errors";
import { readRegistrationForm } from "@/modules/registrations/form-mapping";
import { assertEmailTypedTwice } from "@/modules/registrations/fields";
import { publicFormEvent } from "@/modules/registrations/public-form-event";
import { submitRegistration } from "@/modules/registrations/service";
import { botCheckIsOn, honeypotIsOn } from "@/modules/registrations/bot-check";
import { SECOND_ATTEMPT_FIELD } from "@/modules/registrations/fields";
import { BOT_CHECK_SIGNAL_FIELD, botCheckSignalsFrom, TURNSTILE_FIELD } from "@/modules/registrations/domain/turnstile-widget";
import { recordBotCheckSignal } from "@/modules/registrations/bot-check-signals";
import { verifyTurnstile } from "@/modules/registrations/turnstile";
import { headers } from "next/headers";
import { isDomainError } from "@/shared/errors/domain-error";
import { isDatabaseAwayError } from "@/modules/resilience/domain/database-away";
import { canonicalizeEmail } from "@/modules/participants/domain/canonical-email";
import { currentDeadlines } from "@/modules/deadlines/deadlines";
import {
  AUTO_PRESS_FIELD,
  FAMILY_SITTING_FIELD,
  FAMILY_SITTING_PARAM,
  SITTING_SENT_PARAM,
  peopleAfterYes,
  sittingCookieLive,
  sittingCookieMaxAgeSeconds,
  sittingCookieUntil,
  sittingNames,
  sittingSharedValues,
  withSittingPerson,
} from "@/modules/registrations/domain/family-sitting";
import { clearFamilySittingCookie, readFamilySittingCookie, writeFamilySittingCookie } from "@/modules/registrations/family-sitting-cookie";
import { continueFamilySitting, releaseFamilySitting } from "@/modules/registrations/family-sitting";
import type { SittingSeed } from "@/modules/registrations/domain/family-sitting";
import { familySittingHeldUntil } from "@/modules/deadlines/domain/deadlines";
import { cachedEmailLeavesAt } from "@/modules/public-cache/reads";

function toLocale(value: FormDataEntryValue | null): Locale {
  return value === "en" ? "en" : "ro";
}

function text(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}


/**
 * The registration form's submit handler (BR-REQ-030-01, BR-REQ-031-01, BR-REQ-033-01).
 *
 * Always redirects back to the same page — with `submitted=1` on success, an error code
 * otherwise. A malformed form (the privacy box left unchecked) gets a distinct, fixable error;
 * everything past that point answers identically, whatever the submitted address turns out to
 * mean (BR-REQ-031-01 criterion 3).
 */
export async function submitRegistrationAction(form: FormData): Promise<void> {
  try {
    await submitRegistrationOrRefuse(form);
  } catch (error) {
    /*
      The database is away (§447) — a compute that could not start, or Neon refusing on the month's
      quota. Not a bug and nothing the person did: what they typed goes back with them in the
      draft cookie, and the form says so politely instead of the error page eating twenty fields.
      `redirect()` and `notFound()` throw too; they are not away-errors and pass straight through.
      The form carries no family link since the emailed confirmation replaced it, so none is kept.
    */
    if (!isDatabaseAwayError(error)) throw error;
    console.error("[registration] the database is away; the form goes back with its answers", error);
    const locale = toLocale(form.get("locale"));
    const path = getPathname({ locale, href: { pathname: "/events/[slug]/register", params: { slug: text(form, "slug") } } });
    await stashFormDraft(form, path);
    redirect(`${path}?error=DATABASE_AWAY&fields=databaseAway#${ERROR_SUMMARY_ID}`);
  }
}

async function submitRegistrationOrRefuse(form: FormData): Promise<void> {
  const locale = toLocale(form.get("locale"));
  const slug = text(form, "slug");
  const path = getPathname({ locale, href: { pathname: "/events/[slug]/register", params: { slug } } });

  const db = getDb();
  const publicEvent = await findPublishedEventBySlug(db, locale, slug);
  if (!publicEvent) redirect(getPathname({ locale, href: "/events" }));

  /*
    The bot check, when configured (§97, §216).

    Only a token Cloudflare **looked at and rejected** stops a registration. No token at all —
    a blocked script, a privacy browser, JavaScript off — and Cloudflare not answering are
    "unavailable", and a registration is not refused for either: the honeypot, the timing
    check and the per-identity throttle are still in front of this form, and §205 is explicit
    that people must be able to register at all costs. It is logged so the club can see how
    often the widget does not run, and the line never carries an address.
  */
  const requestHeaders = await headers();
  const remoteIp = requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  const verdict = (await botCheckIsOn(getDb(), new Date()))
    ? await verifyTurnstile(String(form.get(TURNSTILE_FIELD) ?? ""), remoteIp)
    : "not_configured";
  if (verdict === "unavailable") {
    console.warn("[turnstile] unavailable, registration accepted on the other defences", { slug });
  }
  if (verdict === "failed") {
    await stashFormDraft(form, path);
    redirect(`${path}?error=VALIDATION_ERROR&fields=captcha#${ERROR_SUMMARY_ID}`);
  }

  /*
    The family sitting (§519): the form sent from «Încă o persoană» carries the address of the
    sitting's first form, from the browser's sealed half — the boxes are not on that form. A form
    whose sitting has lapsed meanwhile is the ordinary form: it arrives without an address and is
    refused on that box, with what was typed kept, like any other refusal.
  */
  const now = new Date();
  const priorSitting = await readFamilySittingCookie();
  const liveSitting = sittingCookieLive(priorSitting, publicEvent.id, now) ? priorSitting : null;
  const familyMode = text(form, FAMILY_SITTING_FIELD) === "1" && liveSitting !== null;
  const typed = readRegistrationForm(form, locale);
  const input = familyMode && liveSitting ? { ...typed, email: liveSitting.email, emailConfirm: undefined } : typed;
  /*
    The same address as the sitting on this browser continues it, and only on the form «Da, încă o
    persoană» opened (§536: no sitting without a press). A second plain form from the same browser
    is a first form again: its email is its own, nothing of the earlier one is held or merged.
  */
  const continuing = familyMode && liveSitting !== null && liveSitting.joined === true && sameMailbox(liveSitting.email, input.email);
  let sittingId: string | null = null;
  let seed: SittingSeed | null = null;

  try {
    /*
      The address, twice, and the same mailbox both times (§206).

      Before anything else in the try, so a mismatch is a field error on the form rather than
      a registration created for an address nobody can read. It is a property of this form and
      not of a registration, which is why it is asserted here and not in the service's schema.
      Not on a family sitting's next form: the address is the one typed twice on its first.
    */
    assertEmailTypedTwice(input);

    const internalEvent = await findEventForRegistrationById(db, publicEvent.id);
    if (!internalEvent) redirect(getPathname({ locale, href: "/events" }));

    const result = await submitRegistration(
      db,
      // The whole row the allocator needs: the race's own day and minimum age (§321, §329), and the
      // participation window, which a verified runner's restart is held until (§104, §420).
      publicFormEvent(internalEvent, publicEvent.publishedAt),
      input,
      now,
      "REAL",
      {
        source: "PUBLIC",
        createdByStaffUserId: null,
        /*
          What the two guesses are weighed against (§282). Cloudflare's verdict outranks the
          hidden trap, and a submission after a refusal is let through whatever the trap says —
          a password manager refills it every time, and looping a real person forever is the one
          outcome this form must not have.
        */
        turnstile: verdict,
        secondAttempt: String(form.get(SECOND_ATTEMPT_FIELD) ?? "") === "1",
        honeypotOn: await honeypotIsOn(getDb(), new Date()),
        /*
          Every public form may begin a sitting (§519). Before «Da» it is an ordinary form that only
          hands back what «Da» would take in (§536); after it, its messages wait for «Gata» or the window.
        */
        sitting: { id: continuing ? (liveSitting?.sittingId ?? null) : null, joined: continuing },
      },
    );
    sittingId = result.sittingId ?? (continuing ? (liveSitting?.sittingId ?? null) : null);
    seed = continuing ? null : (result.sittingSeed ?? null);
  } catch (error) {
    if (isDomainError(error)) {
      // Field names, never values: nothing a participant typed goes into a URL, which is
      // logged by every proxy between here and them (§14.5).
      const fields = error.fields.length > 0 ? `&fields=${error.fields.join(",")}` : "";
      // What they typed comes back with them — in a cookie, never in the URL (§142).
      await stashFormDraft(form, path);
      // The fragment is what stops a rejection landing somebody at the top of a long form with
      // nothing said: the browser scrolls to the summary and, because it is focusable, focuses
      // it. No JavaScript is involved, which is the point — this path exists for the submission
      // the browser's own validation could not catch.
      /*
        `retry=1` is what makes the next press work (§282). The form renders a hidden field from
        it, the action reads it back, and a person whose browser keeps filling the trap is not
        refused twice for the same reason.
      */
      const retry = error.fields.includes("tooFast") ? "&retry=1" : "";
      // A family sitting's next form comes back as that form, the address still fixed (§519).
      const family = familyMode ? `&${FAMILY_SITTING_PARAM}=1` : "";
      redirect(`${path}?error=${error.code}${fields}${retry}${family}#${ERROR_SUMMARY_ID}`);
    }
    throw error;
  }

  /*
    What the anti-bot check did to this person (§518), counted for `/api/health`: a press the
    valve sent, a widget that failed — the words the form carried (`BOT_CHECK_SIGNAL_FIELD`), and
    only once the registration went through the throttle and the other defences, so the figure
    takes no anonymous write. A count that fails is a smaller figure, never a refused registration.
  */
  if (verdict !== "not_configured") {
    try {
      for (const signal of botCheckSignalsFrom(form.getAll(BOT_CHECK_SIGNAL_FIELD))) {
        await recordBotCheckSignal(db, signal, new Date());
      }
    } catch (error) {
      console.error("[registration] the bot-check signal could not be counted", error);
    }
  }

  await clearFormDraft(path);
  /*
    The sitting's browser half (§519): the address the next form is sent with, the people typed so far
    — this one last, by the rule the server keeps for the sitting (`withSittingPerson`) — the boxes a
    family shares, which the next form starts filled with, and the club's window from now, which the
    server moved to the same instant. Everything from this browser's own forms (§39).
  */
  const prior = continuing && liveSitting ? liveSitting : null;
  const typedPerson = withSittingPerson(prior?.people ?? [], { name: `${input.firstName} ${input.lastName}`, birthDate: input.birthDate });
  const shared = sittingSharedValues(prior?.shared, (name) => text(form, name));
  const names = sittingNames(typedPerson.people);
  const minutes = (await currentDeadlines(db)).familySittingMinutes;
  // At a window of 0 nothing was held (§519): the cookie only keeps the address for the next person.
  const atOnce = minutes <= 0;
  /*
    Always an id of one shape (§39): before «Da» (§536), and a sitting that held nothing — a re-send
    about somebody already registered, the address at its limit — get a random one that names no
    row, and the seed seals to one length whatever it names (`family-sitting-cookie.ts`). A sealed
    cookie one uuid shorter would otherwise tell whoever typed a stranger's address which case it
    was. The server finds nothing under a random id: «Gata» releases nothing, and «Da» opens the
    sitting from the seed or, with none, lets the next form open its own.
  */
  const heldUntil = sittingCookieUntil(now, minutes);
  /*
    When this form's email leaves (§536; the review of 2026-09-28), computed once, here: the short
    screen reads it back from the browser's half and never recomputes it, so a reload after the pass
    says the email left rather than naming the next pass, and stops promising that «Da» holds it.
  */
  const emailLeavesAt = await cachedEmailLeavesAt(now);
  await writeFamilySittingCookie(
    {
      sittingId: sittingId ?? randomUUID(),
      seed,
      joined: continuing,
      eventId: publicEvent.id,
      email: input.email.trim(),
      people: typedPerson.people,
      heldUntil,
      atOnce,
      windowMinutes: minutes,
      emailLeavesAt,
      // Sent by the request itself: when, so a reload later says it left (§540), never «pleacă acum» forever.
      ...(emailLeavesAt === null ? { emailSubmittedAt: now } : {}),
      shared,
      sameBirthDate: typedPerson.sameBirthDate,
    },
    path,
    now,
  );
  // The screen that follows says to go and read an inbox, so it names which one (§224) — and
  // greets the person by first name while it does. Its own short-lived sealed cookie, never
  // the URL: nothing typed goes into one (§14.5).
  // At a window of 0 (§519) each person's email left on its own: the last screen must not promise one.
  // It lives as long as the sitting's cookie (§519), so the screen keeps its facts when «Gata» fires by itself.
  await stashSubmittedFacts(
    { email: input.email.trim(), firstName: input.firstName, names, atOnce },
    path,
    sittingCookieMaxAgeSeconds(heldUntil, now),
  );
  redirect(`${path}?submitted=1`);
}

/**
 * «Gata — trimite emailul» (§519): the sitting's one email leaves now, and this browser's sitting
 * ends. The screen after it is the one that says to open the inbox. Pressed with no sitting — the
 * window had passed, or the sitting held nothing — it is the same screen: the email left, or is
 * leaving, by itself (§39: the answer never depends on what the address holds). Since §536 it is on
 * the sitting's screen only, after «Da»: the first form's screen has nothing to release.
 */
export async function releaseFamilySittingAction(form: FormData): Promise<void> {
  const locale = toLocale(form.get("locale"));
  const slug = text(form, "slug");
  const path = getPathname({ locale, href: { pathname: "/events/[slug]/register", params: { slug } } });
  const sitting = await readFamilySittingCookie();
  /*
    The open screen's own press at the window's end (`PressWhenWindowEnds`, §519): with the browser's
    half already gone — a phone slower than the cookie's grace — it does nothing and stays where it
    is. The server releases the sitting at its `held_until` anyway; nothing depends on this press.
  */
  if (!sitting && form.get(AUTO_PRESS_FIELD) === "1") return;
  if (sitting?.sittingId) await releaseFamilySitting(getDb(), sitting.sittingId, new Date());
  await clearFamilySittingCookie(path);
  redirect(`${path}?submitted=1&${SITTING_SENT_PARAM}=1`);
}

/**
 * «Da, încă o persoană» (§519; §536: the press that opens the sitting). A press, never a link. The
 * first time, it opens the sitting from the first form's seed and holds that form's email when it has
 * not left yet; after that, it starts the club's window again from now (the review of 2026-09-27: the
 * window lapsed under the parent's hands while the next form was open) — on the server's row and
 * every message it holds (`continueFamilySitting`) and on this browser's half, which from now on
 * marks the forms as the sitting's (`joined`). Then the same form opens with the address fixed; its
 * page says how long is left. A sitting whose email has already left opens the ordinary form, as a
 * lapsed one always did (§39: the same screens).
 */
export async function continueFamilySittingAction(form: FormData): Promise<void> {
  const locale = toLocale(form.get("locale"));
  const slug = text(form, "slug");
  const path = getPathname({ locale, href: { pathname: "/events/[slug]/register", params: { slug } } });
  const db = getDb();
  const now = new Date();
  const sitting = await readFamilySittingCookie();
  const event = await findPublishedEventBySlug(db, locale, slug);
  if (sitting && event && sittingCookieLive(sitting, event.id, now)) {
    const deadlines = await currentDeadlines(db);
    const holding = !sitting.atOnce && deadlines.familySittingMinutes > 0;
    const opened = holding
        ? await continueFamilySitting(
            db,
            { sittingId: sitting.sittingId, seed: sitting.seed, eventId: event.id, locale },
            familySittingHeldUntil(now, deadlines),
            now,
          )
        : null;
    // The names this browser lists name only the people the sitting's email covers (`peopleAfterYes`).
    const { people, seedSpent } = peopleAfterYes({ holding, seed: sitting.seed, opened, people: sitting.people });
    const heldUntil = sittingCookieUntil(now, deadlines.familySittingMinutes);
    await writeFamilySittingCookie(
      {
        ...sitting,
        // One shape whatever happened (§39): the sitting, or a random id; the seed spent either way.
        sittingId: opened ?? sitting.sittingId ?? randomUUID(),
        seed: null,
        joined: true,
        people,
        heldUntil,
        // Read afresh with the window (§519): a «Termene» change mid-sitting leaves no stale flag.
        atOnce: deadlines.familySittingMinutes <= 0,
        windowMinutes: deadlines.familySittingMinutes,
        sameBirthDate: null,
      },
      path,
      now,
    );
    // The screen's facts live as long as the sitting, refreshed with it (§519).
    const facts = await readSubmittedFacts();
    if (facts?.email) {
      await stashSubmittedFacts(
        {
          email: facts.email,
          firstName: facts.firstName ?? "",
          names: seedSpent ? sittingNames(people) : facts.names,
          atOnce: deadlines.familySittingMinutes <= 0,
        },
        path,
        sittingCookieMaxAgeSeconds(heldUntil, now),
      );
    }
  }
  redirect(`${path}?${FAMILY_SITTING_PARAM}=1`);
}

/** The same mailbox, as the address's identity compares them (§10.4); a typo is simply another address. */
function sameMailbox(a: string, b: string): boolean {
  try {
    return canonicalizeEmail(a).canonicalEmail === canonicalizeEmail(b).canonicalEmail;
  } catch {
    return false;
  }
}
