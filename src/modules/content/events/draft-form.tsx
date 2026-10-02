import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import type { Database } from "@/db/types";
import { formatDay } from "@/i18n/dates";
import { type Locale, routing } from "@/i18n/routing";
import type { Deadlines } from "@/modules/deadlines/domain/deadlines";
import { datedOrNull } from "@/modules/events/domain/dated";
import type { RegistrationCta } from "@/modules/events/domain/registration-cta";
import type { PublicEventPage } from "@/modules/events/repository";
import type { RegistrationDoor } from "@/modules/events/ui/registration-door";
import {
  describesListSocials,
  describesListStates,
  describesPromotionalMaterials,
  describesPromotionalMaterialsShared,
} from "@/modules/legal-documents/domain/merge-fields";
import { findCurrentApprovedDocument } from "@/modules/legal-documents/repository";
import { readAddressCap } from "@/modules/registrations/address-cap";
import { NO_WAITLIST, WAITLIST_FULL } from "@/modules/registrations/domain/waitlist";
import { formViewOf } from "@/modules/registrations/form-view";
import EmailDeliveryNotice from "@/modules/registrations/ui/EmailDeliveryNotice";
import { registrationFacts, registrationForm, type RegistrationFormSettings } from "@/modules/registrations/ui/registration-form";
import RegistrationJourney from "@/modules/registrations/ui/RegistrationJourney";
import RegistrationSteps from "@/modules/registrations/ui/RegistrationSteps";

/**
 * What the club's texts in force switch on in the form (§421, §396, §500, §562, §570, §576), read
 * straight from the database — the register page reads the same through the public cache, which a
 * preview neither reads nor fills (§579). The versions in force at the press: while none is
 * approved, the form says so as the real one does. No Turnstile key, ever (§577).
 */
export async function readDraftFormSettings<T extends Record<string, unknown>>(
  db: Database<T>,
  input: { locale: Locale; now: Date; membersOnly: boolean; familyOpen: boolean; refusalOn: boolean },
): Promise<RegistrationFormSettings> {
  const [terms, notices, addressCap] = await Promise.all([
    findCurrentApprovedDocument(db, "TERMS", input.locale, input.now),
    Promise.all(routing.locales.map((locale) => findCurrentApprovedDocument(db, "PRIVACY_NOTICE", locale, input.now))),
    readAddressCap(db),
  ]);
  // The notice in force, in every language, describes it — the public cache's reading (`reads.ts`).
  const everyNotice = (describes: (body: unknown) => boolean) => notices.every((notice) => notice !== undefined && describes(notice.body));
  return {
    termsVersion: terms?.version ?? null,
    // §636: whether the terms in force carry the club's right to refuse — read once by the preview, for the steps and the box.
    refusalOn: input.refusalOn,
    listStatesOn: everyNotice(describesListStates),
    listSocialsOn: everyNotice(describesListSocials),
    promoOn: everyNotice(describesPromotionalMaterials),
    promoShared: everyNotice(describesPromotionalMaterialsShared),
    // A members' event registers one person per account (§552): no family, no limit to say.
    capMax: input.membersOnly ? null : addressCap.cap.registrationsPerAddress,
    familyOpen: input.membersOnly ? false : input.familyOpen,
    siteKey: undefined,
  };
}

/** The door's sentence for a window that takes nobody now, in the event page's own words (`RegistrationCta`). */
function closedDoorSentence(tEvent: (key: string, values?: Record<string, string>) => string, cta: RegistrationCta, locale: Locale, timeZone: string): string | null {
  if (cta.kind === "CANCELLED") return tEvent("cta.cancelled");
  if (cta.kind === "COMPLETED") return tEvent("cta.completed");
  if (cta.kind === "CLOSED") return tEvent("cta.closed");
  if (cta.kind === "NOT_YET_OPEN") {
    return cta.opensAt === null
      ? tEvent("cta.opensSoon")
      : tEvent("cta.opensOn", { date: formatDay(cta.opensAt, { locale, timeZone, style: "long", withTime: true, position: "inline" }) });
  }
  return null;
}

/**
 * **«Formular» in the editor's «Previzualizare» (§579, amended by §586)** — the owner, 2026-09-30:
 * «adică preview card și pagină ȘI formular de înscriere». The public registration form as a
 * participant would meet it for this draft, drawn by the register page's own parts — the facts
 * above the form, the journey, the five steps, and `registrationForm` itself — in preview state.
 *
 * - **The door.** The public form exists only while the window is open; here it is drawn whatever
 *   the window says, under one line that says what a visitor meets today («Înscrierile se deschid
 *   …», closed, cancelled) in the event page's words. Full, with nothing to join or with a list
 *   that takes people: the real form's own notice. An event that takes no registration on the site, or whose date is still to be
 *   announced, has no form: one line says so.
 * - **Nothing sent, nothing written.** No action, no hidden field the service reads, no Turnstile,
 *   the send button disabled with «previzualizare» (`registrationForm`'s `preview`). The texts in
 *   force and the club's settings are read from their rows (`readDraftFormSettings`), never
 *   through the public cache.
 */
export async function renderDraftForm<T extends Record<string, unknown>>(
  db: Database<T>,
  input: {
    view: PublicEventPage;
    door: RegistrationDoor;
    locale: Locale;
    now: Date;
    word: string;
    steps: { deadlines: Deadlines; familyOpen: boolean; refusalOn: boolean };
  },
): Promise<ReactNode> {
  const { view, door, locale, now, word, steps } = input;
  const t = await getTranslations({ locale, namespace: "Registration" });
  const tEvent = await getTranslations({ locale, namespace: "Event" });
  const groupRunLine = view.offersGroupRunDeclaration ? (
    <Alert severity="info" sx={{ mb: 2 }} data-testid="draft-preview-form-group-run">
      {t("preview.groupRunDeclaration")}
    </Alert>
  ) : null;
  const dated = datedOrNull(view);
  if (view.registrationMode !== "INTERNAL" || !dated) {
    return (
      <Box data-testid="draft-preview-form">
        <Alert severity="info" sx={{ mb: 2 }} data-testid="draft-preview-form-none">
          {view.registrationMode !== "INTERNAL" ? t("preview.noForm") : t("preview.dateLater")}
        </Alert>
        {groupRunLine}
      </Box>
    );
  }

  const formView = formViewOf(dated, now);
  const settings = await readDraftFormSettings(db, { locale, now, membersOnly: view.membersOnly, familyOpen: steps.familyOpen, refusalOn: steps.refusalOn });
  const cta = door.kind === "KNOWN" ? door.cta : null;
  const closed = cta ? closedDoorSentence(tEvent, cta, locale, dated.timezone) : null;
  // No place and nothing to join (§348): the real form's own notice above the first field. No place
  // and a list that takes people (§587): the join form's thank-you, from the draft's own door and the
  // club's «Termene» already read for the steps — nothing more is read.
  const fullNotice = cta?.kind === "FULL_NO_WAITLIST" ? NO_WAITLIST : cta?.kind === "WAITLIST_FULL" ? WAITLIST_FULL : cta?.kind === "FULL" ? "WAITLIST" : null;
  const fullCounts = cta?.kind === "FULL" && door.kind === "KNOWN" && door.fill ? { capacity: door.fill.capacity, waiting: cta.waiting } : null;
  const offerHours = fullNotice === "WAITLIST" ? steps.deadlines.offerHours : null;

  return (
    <Box data-testid="draft-preview-form">
      {await registrationFacts({ view: formView, locale, slug: view.slug, submitted: false })}
      <EmailDeliveryNotice />
      <RegistrationJourney current="details" />
      <Box sx={{ mb: 3 }}>
        <RegistrationSteps folded window={formView.stepsWindow} reminderHoursBefore={dated.reminderHoursBefore} settings={steps} />
      </Box>
      {closed && (
        <Alert severity="warning" sx={{ mb: 2 }} data-testid="draft-preview-form-closed">
          {t("preview.notOpen", { door: closed })}
        </Alert>
      )}
      {groupRunLine}
      {await registrationForm({
        view: formView,
        locale,
        slug: view.slug,
        now,
        settings,
        // A members' event takes the account's address (§552): named, not asked, in the preview too.
        address: view.membersOnly ? { kind: "member", email: t("preview.memberAddress") } : { kind: "typed" },
        invalid: new Set<string>(),
        refusal: { tooYoung: false, emergencySame: false, captchaFailed: false, tooFast: false, retry: false },
        draft: null,
        resting: false,
        fullNotice,
        fullCounts,
        offerHours,
        preview: { word },
      })}
    </Box>
  );
}
