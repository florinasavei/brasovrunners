import type { events } from "@/db/schema/events";
import type { Database } from "@/db/types";
import { type Locale, routing } from "@/i18n/routing";
import { VOLUNTEER_AGREEMENT_KEY } from "@/modules/legal-documents/domain/keys";
import {
  findCurrentApprovedDocument,
  noticeDescribesVolunteerAgreement,
  noticeDescribesVolunteerProfile,
  noticeDescribesVolunteersList,
  volunteerAgreementInForce,
  volunteerMinorsOpen,
} from "@/modules/legal-documents/repository";
import { eventMergeValues } from "@/modules/registrations/signed-declaration";
import { volunteerEventDay } from "./domain/volunteer";
import type { VolunteerPersonContext } from "./ui/VolunteerPerson";
import { listVolunteerCategories, listVolunteerRoles, listVolunteers, volunteerStandings } from "./volunteers";

/**
 * What one event's people share on the «Voluntari» screen (§839): the event's roles under their categories, how each stands
 * today, the event's switches, the texts in force in each language and the clock — the same reads the event editor's card makes
 * (`admin/events/[id]/page.tsx`), gathered once so a person's page draws exactly what the card draws for them. `returnTo` is
 * where the person's verbs come back to: their own page.
 */
export async function volunteerPersonContextOf<T extends Record<string, unknown>>(
  db: Database<T>,
  event: typeof events.$inferSelect,
  locale: Locale,
  now: Date,
  returnTo: string,
): Promise<VolunteerPersonContext> {
  const [roles, categories, people, agreementInForce, agreementNoticeDescribes, profileDescribed, listDescribed, minorsOpen] = await Promise.all([
    listVolunteerRoles(db, event.id),
    listVolunteerCategories(db, event.id),
    // Every person of the event, for the standings alone: «N din M» counts the whole event, not the one row on the page.
    listVolunteers(db, event.id),
    volunteerAgreementInForce(db, now),
    noticeDescribesVolunteerAgreement(db, now),
    noticeDescribesVolunteerProfile(db, now),
    noticeDescribesVolunteersList(db, now),
    volunteerMinorsOpen(db, now),
  ]);
  const agreementDocumentIds: Partial<Record<Locale, string>> = {};
  const agreementEvent: Partial<Record<Locale, { eventDate: string; eventLocation: string }>> = {};
  for (const language of routing.locales) {
    const version = await findCurrentApprovedDocument(db, VOLUNTEER_AGREEMENT_KEY, language, now);
    if (version) agreementDocumentIds[language] = version.id;
    const facts = await eventMergeValues(db, event.id, language);
    if (facts) agreementEvent[language] = { eventDate: facts.values.eventDate ?? "", eventLocation: facts.values.eventLocation ?? "" };
  }
  return {
    locale,
    eventId: event.id,
    roles,
    categories,
    standings: volunteerStandings(roles, people),
    volunteersShirts: event.volunteersShirts,
    profileDescribed,
    minorsOpen,
    listDescribed,
    eventDay: volunteerEventDay(event, now),
    agreementInForce,
    agreementNoticeDescribes,
    agreementDocumentIds,
    agreementEvent,
    now,
    returnTo,
  };
}
