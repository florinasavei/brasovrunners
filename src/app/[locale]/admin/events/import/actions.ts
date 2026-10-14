"use server";

import { hasLocale } from "next-intl";
import { z } from "zod";
import { getDb } from "@/db/client";
import { formatDay } from "@/i18n/dates";
import { getPathname } from "@/i18n/navigation";
import { type Locale, routing } from "@/i18n/routing";
import { countRegistrationsByEvent, listEventsForBackoffice } from "@/modules/content/events/repository";
import { type EventFile, type FileNote, readEventFile } from "@/modules/content/events/transfer/file-format";
import { diffEventImport, importEventAsNew, importEventOver, slugsForNewEvent } from "@/modules/content/events/transfer/import";
import type { AsNewOutcome, DiffOutcome, ImportRefusal, ImportTarget, OverOutcome, PreviewOutcome } from "@/modules/content/events/transfer/outcomes";
import { typedStartShape } from "@/modules/events/domain/provisional-start";
import { canTransferEvents } from "@/modules/staff-identity/domain/roles";
import { requireStaff } from "@/modules/staff-identity/session";
import { DomainError, isDomainError } from "@/shared/errors/domain-error";

/**
 * The import page's Server Actions (§751): each asks the session who is calling and the service
 * whether that person may — an Administrator, asserted here and again in the service — and none of
 * them trusts the page that called it. The file arrives as text, is read again from scratch by
 * `readEventFile` (the browser's reading of it is a courtesy), and the confirmation of an import over
 * an event arrives with the versions the diff was shown for, so what is applied is what was shown.
 *
 * A refusal is data, not an exception: the island draws it where the reader is looking
 * (`transfer/outcomes.ts`). Anything that is not a domain error is a bug and is rethrown.
 */

const localeOf = (value: unknown): Locale => (typeof value === "string" && hasLocale(routing.locales, value) ? value : routing.defaultLocale);

const editorPath = (locale: Locale, eventId: string) => getPathname({ locale, href: { pathname: "/admin/events/[id]", params: { id: eventId } } });

function refusal(error: unknown): ImportRefusal {
  if (!isDomainError(error)) throw error;
  return { ok: false, kind: "domain", code: error.code, fields: [...error.fields], detail: error.message };
}

/** The file's text read again — with what reading left out of it, said in words (§769) — or the refusal that says why it is not an event file. */
function readFile(json: unknown): { file: EventFile; notes: FileNote[] } | ImportRefusal {
  if (typeof json !== "string") return { ok: false, kind: "file", refusal: "notJson" };
  const read = readEventFile(json);
  return read.ok ? { file: read.file, notes: read.notes } : { ok: false, kind: "file", refusal: read.refusal, detail: read.detail };
}

/** Whoever is calling, or the refusal: not signed in, or not an Administrator. */
async function administrator() {
  try {
    const actor = await requireStaff();
    if (!canTransferEvents(actor.role)) throw new DomainError("FORBIDDEN", `role ${actor.role} may not import an event`);
    return { actor };
  } catch (error) {
    return refusal(error);
  }
}

/** The events an import can be written over, newest first, with how many people are registered for each. */
async function targetsFor(locale: Locale): Promise<ImportTarget[]> {
  const db = getDb();
  const [rows, counts] = await Promise.all([listEventsForBackoffice(db), countRegistrationsByEvent(db)]);
  return rows
    .sort((a, b) => b.event.startsAt.getTime() - a.event.startsAt.getTime())
    .slice(0, 300)
    .map(({ event, translations }) => {
      const own = translations.find((row) => row.locale === locale) ?? translations[0];
      const start = typedStartShape({ startsAt: event.startsAt, timezone: event.timezone });
      return {
        id: event.id,
        title: own?.title ?? event.id,
        day: start ? formatDay(start.at, { locale, timeZone: event.timezone, style: "short", withTime: start.hour, position: "inline" }) : "",
        editorialStatus: event.editorialStatus,
        registrations: counts.get(event.id)?.total ?? 0,
      };
    });
}

/** The file read, what it holds, the slugs a new event would get, and the events it could go over. */
export async function previewEventImportAction(json: string, localeArgument: string): Promise<PreviewOutcome> {
  const asked = await administrator();
  if ("ok" in asked) return asked;
  const read = readFile(json);
  if ("ok" in read) return read;
  const locale = localeOf(localeArgument);
  const { file } = read;
  try {
    const start = file.event.start;
    const day = start.date ? `${start.date}${start.time ? ` ${start.time}` : ""}` : "";
    const slugs = await slugsForNewEvent(getDb(), file.event);
    return {
      ok: true,
      summary: {
        titles: { ro: file.event.translations.ro.title, en: file.event.translations.en.title },
        type: file.event.type,
        day,
        timezone: file.event.timezone,
        exportedAt: file.exportedAt,
        environment: file.exportedFrom.environment,
        baseline: file.exportedFrom.baseline,
        media: file.media.length,
        seriesNotApplied: file.series.partOfASeries || file.series.rule !== null,
        fileNotes: read.notes,
      },
      newEvent: { slugs, suffixed: routing.locales.some((language) => slugs[language] !== file.event.translations[language].slug) },
      targets: await targetsFor(locale),
    };
  } catch (error) {
    return refusal(error);
  }
}

const eventId = z.string().uuid();

/** The file against one event: every field that would change, with both sides. Writes nothing. */
export async function diffEventImportAction(json: string, targetId: string): Promise<DiffOutcome> {
  const asked = await administrator();
  if ("ok" in asked) return asked;
  const read = readFile(json);
  if ("ok" in read) return read;
  const id = eventId.safeParse(targetId);
  if (!id.success) return refusal(new DomainError("NOT_FOUND", "no such event"));
  try {
    const diff = await diffEventImport(getDb(), { actor: asked.actor, file: read.file, eventId: id.data });
    return { ok: true, ...diff, fileNotes: read.notes };
  } catch (error) {
    return refusal(error);
  }
}

/** «Ca eveniment nou»: a draft, with the pictures copied. */
export async function importEventAsNewAction(json: string, localeArgument: string): Promise<AsNewOutcome> {
  const asked = await administrator();
  if ("ok" in asked) return asked;
  const read = readFile(json);
  if ("ok" in read) return read;
  try {
    const result = await importEventAsNew(getDb(), { actor: asked.actor, file: read.file });
    return { ok: true, eventId: result.eventId, path: editorPath(localeOf(localeArgument), result.eventId), slugs: result.slugs, media: result.media, notes: [...read.notes, ...result.notes] };
  } catch (error) {
    return refusal(error);
  }
}

const overInput = z.object({
  json: z.string(),
  eventId,
  expectedVersion: z.number().int().min(1),
  translationVersions: z.object({ ro: z.number().int().min(1), en: z.number().int().min(1) }),
  /** The production confirmation: the title typed and the registrations the diff showed. */
  typedTitle: z.string().max(300).optional(),
  registrations: z.number().int().min(0).optional(),
  locale: z.string(),
});

/** «Peste un eveniment existent»: after the diff was shown and confirmed, through the editor's own save. */
export async function importEventOverAction(input: z.input<typeof overInput>): Promise<OverOutcome> {
  const asked = await administrator();
  if ("ok" in asked) return asked;
  const parsed = overInput.safeParse(input);
  if (!parsed.success) return refusal(new DomainError("VALIDATION_ERROR", "the confirmation is not complete", []));
  const read = readFile(parsed.data.json);
  if ("ok" in read) return read;
  try {
    const result = await importEventOver(getDb(), {
      actor: asked.actor,
      file: read.file,
      eventId: parsed.data.eventId,
      expectedVersion: parsed.data.expectedVersion,
      translationVersions: parsed.data.translationVersions,
      confirmation: parsed.data.typedTitle === undefined || parsed.data.registrations === undefined ? undefined : { typedTitle: parsed.data.typedTitle, registrations: parsed.data.registrations },
    });
    return { ok: true, eventId: parsed.data.eventId, path: editorPath(localeOf(parsed.data.locale), parsed.data.eventId), changed: result.changed, media: result.media, offered: result.offered };
  } catch (error) {
    return refusal(error);
  }
}
