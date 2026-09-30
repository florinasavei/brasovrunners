import Box from "@mui/material/Box";
import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import type { StaffUser } from "@/db/schema/staff-users";
import type { Database } from "@/db/types";
import { type Locale, routing } from "@/i18n/routing";
import { readDeadlines } from "@/modules/deadlines/deadlines";
import { DEFAULT_DEADLINES } from "@/modules/deadlines/domain/deadlines";
import { familyRegistrationOpen } from "@/modules/registrations/family-gate";
import { CARD_GRID_SX } from "@/modules/events/ui/card-layout";
import EventCard from "@/modules/events/ui/EventCard";
import EventPageView from "@/modules/events/ui/EventPageView";
import { draftRegistrationDoor } from "@/modules/events/ui/registration-door";
import { canPreviewEventDraft } from "@/modules/staff-identity/domain/roles";
import { isDomainError } from "@/shared/errors/domain-error";
import { eventFormFieldName } from "./form-names";
import { previewPageOf } from "./preview-view";
import { findEventForEditing, listSeriesDates } from "./repository";
import { draftEvent, textsOwedInOneLanguage } from "./service";
import { missingForPublish, storedPublishReader } from "./ui/publish-check";

export type DraftPreviewInput = {
  actor: Pick<StaffUser, "id" | "role">;
  /** The event the editor edits, or null on the create page. */
  eventId: string | null;
  /** The event's fields as posted, or undefined when the form carried none (`service.ts#draftEvent`). */
  fields?: unknown;
  /** Each language's words as posted; a language absent keeps its stored row. */
  translations: Partial<Record<Locale, unknown>>;
  placeNamesAsTyped?: boolean;
  /** The language the page and the card are drawn in. */
  locale: Locale;
  now?: Date;
};

/**
 * What the preview answers. `refused` is the save's refusal, by the boxes the form posts (§47): the
 * editor names them as the save's summary does. `missing` is what publication still needs in each
 * language (§28's rule, `missingForPublish`) and every optional text written in the other language
 * only (§352) — the «English incomplet» mark; a language may be drawn while it is incomplete.
 */
export type DraftPreview =
  | { outcome: "forbidden" }
  | { outcome: "notFound" }
  | { outcome: "refused"; error: string; fields: string[] }
  | { outcome: "ready"; locale: Locale; card: ReactNode; page: ReactNode; missing: Record<Locale, string[]> };

/**
 * **«Previzualizare» before saving (§NNN, amending §406 and §371).** The listing card and the event
 * page of what the save would store, in one language, drawn by the components the listing and the
 * page draw — `EventCard` in the listing's own grid (`CARD_GRID_SX`), `EventPageView` for the page —
 * from `service.ts#draftEvent`'s rows through `previewPageOf`, the saved-draft preview's mapping.
 *
 * Authorization first, before a row is read (BR-REQ-060-01): the roles `canPreviewEventDraft` names.
 *
 * Nothing is written and no cache is read or filled: the draft is in memory, the door is counted
 * from the allocator's formula against the draft's numbers (`draftRegistrationDoor`) and drawn
 * disabled, the race week from the club's deadlines row read directly, and there is no forecast —
 * Open-Meteo is read through the data cache, and a preview is not worth an entry in it.
 */
export async function renderEventDraftPreview<T extends Record<string, unknown>>(db: Database<T>, input: DraftPreviewInput): Promise<DraftPreview> {
  if (!canPreviewEventDraft(input.actor.role)) return { outcome: "forbidden" };
  const now = input.now ?? new Date();
  const stored = input.eventId ? await findEventForEditing(db, input.eventId) : null;
  if (input.eventId && !stored) return { outcome: "notFound" };

  let draft;
  try {
    draft = await draftEvent(db, {
      current: stored?.event ?? null,
      storedTranslations: stored?.translations ?? [],
      // The create page posts every box; the editor posts the settings only for a role that may change them.
      fields: input.fields,
      translations: input.translations,
      placeNamesAsTyped: input.placeNamesAsTyped,
      now,
    });
  } catch (error) {
    if (!isDomainError(error)) throw error;
    return { outcome: "refused", error: error.code, fields: error.fields.map((field) => eventFormFieldName(field)) };
  }
  const refusedHere = draft.refused[input.locale];
  if (refusedHere) return { outcome: "refused", error: refusedHere.code, fields: refusedHere.fields.map((field) => eventFormFieldName(field)) };

  const rows = routing.locales.map((locale) => draft.translations[locale]);
  const gaps = missingForPublish(storedPublishReader(draft.event, rows), routing.locales);
  const owed = textsOwedInOneLanguage(draft.translations);
  const missing = Object.fromEntries(
    routing.locales.map((locale) => [
      locale,
      [...gaps.filter((gap) => gap.locale === locale).map((gap) => gap.name), ...owed.filter((name) => name.startsWith(`translations.${locale}.`))],
    ]),
  ) as Record<Locale, string[]>;

  const view = previewPageOf(draft.event, draft.translations[input.locale]);
  const tEvent = await getTranslations({ locale: input.locale, namespace: "Event" });
  const previewDoor = {
    door: await draftRegistrationDoor(db, view, { capacity: draft.event.capacity, waitlistCapacity: draft.event.waitlistCapacity }, now),
    word: tEvent("previewDoor"),
  };
  // The club's deadlines and family switch, from their rows (the page reads them through the cache).
  const { deadlines } = await readDeadlines(db);
  const steps = { deadlines: { ...DEFAULT_DEADLINES, ...deadlines }, familyOpen: await familyRegistrationOpen(db) };
  // The lead event's frame and, in race week, its countdown (§470) — as the listing draws it.
  const featured = view.featured ? { raceWeekDays: steps.deadlines.raceWeekDays } : undefined;
  // A date of a repeated event wears its rhythm on its card (§486): the series as stored.
  const current = stored?.event;
  const series = current && (current.repeatOf !== null || current.repeatRule !== null) ? await listSeriesDates(db, current.repeatOf ?? current.id) : [];
  const seriesDates = series.length > 1 ? series.map((date) => ({ startsAt: date.id === current?.id && view.startsAt ? view.startsAt : date.startsAt })) : undefined;

  return {
    outcome: "ready",
    locale: input.locale,
    card: (
      <Box component="ul" sx={CARD_GRID_SX} data-testid="draft-preview-card">
        <EventCard event={view} index={0} now={now} featured={featured} seriesDates={seriesDates} previewDoor={previewDoor} />
      </Box>
    ),
    page: (
      <Box data-testid="draft-preview-page">
        <EventPageView event={view} locale={input.locale} slug={view.slug} now={now} weather={null} membersOnly={view.membersOnly} preview={{ door: previewDoor, steps }} />
      </Box>
    ),
    missing,
  };
}
