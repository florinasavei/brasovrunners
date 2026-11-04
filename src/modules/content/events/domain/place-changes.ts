import { lineRoom } from "@/modules/registrations/domain/kept-places";
import { newcomerJoinsLine, offersOnItsOwn } from "@/modules/registrations/domain/waitlist";
import { isWaitlistChoice, waitlistLengthPosted } from "../waitlist-choice";

/**
 * «Controlul înscrierilor e foarte sensibil» (§914; the owner, 2026-11-04, right after a near-save of 175 → 190 places
 * with twenty people waiting): before the event editor's save commits a change to a setting that decides who gets a
 * place, the save says each change «before → after» and what it does, in plain words — and an unchanged save asks
 * nothing. Pure, so it runs in the browser at the press (`notice.ts#resolvePlaceChanges`, inside ActionForm's one
 * confirm mechanism) and in Node in the tests, over the numbers the page read on the server.
 *
 * The effects are the allocator's own rules over those numbers, never a second copy of them: the site's room is
 * `kept-places.ts#lineRoom` (capacity − kept − taken), a newcomer joins the line as `waitlist.ts#newcomerJoinsLine`
 * says (somebody waiting, or «Locurile libere le dau doar eu»), and the line is offered places by itself only as
 * `offersOnItsOwn` says. The taken places are the allocator's count (`computeOccupied`) the page shows under «Ocupate
 * acum», read when the page rendered — a save a minute later is judged under the lock again by the service.
 */
export type PlaceSettings = {
  capacity: number | null;
  placesKeptForClub: number;
  /** `events.waitlist_capacity`: null no limit, 0 no waiting list. */
  waitlistCapacity: number | null;
  waitlistAutoOffer: boolean;
  publicRegistrationOpen: boolean;
  freePlacesByOfferOnly: boolean;
  releaseUnsignedAtDeadline: boolean;
  placesAlertAt: number | null;
  confirmationOpensDaysBefore: number;
  confirmationDeadlineDaysBefore: number;
};

export type PlaceSettingKey = keyof PlaceSettings;

/** The settings the summary lists, in the editor's order — the window's days only when they move the release's deadline. */
export const PLACE_SETTING_KEYS: readonly PlaceSettingKey[] = [
  "capacity",
  "waitlistCapacity",
  "waitlistAutoOffer",
  "freePlacesByOfferOnly",
  "placesKeptForClub",
  "placesAlertAt",
  "publicRegistrationOpen",
  "releaseUnsignedAtDeadline",
];

/** What the page read on the server, as numbers: the places taken, the people waiting, and the instants the words need. */
export type PlaceFacts = {
  /** The places taken now (`computeOccupied`). */
  occupied: number;
  /** The people in the waiting list's line, with no offer yet (`countEligibleWaitlisted`). */
  waiting: number;
  /** Whether the registration period's dates let the public in now (`registrationState` is `OPEN`). */
  datesOpen: boolean;
  /** The event's start, in milliseconds. */
  startsAt: number;
  /** The page's own instant, in milliseconds. */
  now: number;
  /** The deadline the release last ran for, in milliseconds, or null. */
  releasedFor: number | null;
  /** The event's zone and the reader's language, for a deadline said as a date. */
  zone: string;
  locale: string;
};

/** The words, each with its `{name}`s, translated on the server. */
export type PlaceChangeWords = {
  title: string;
  intro: string;
  /** «{label}: {from} → {to}» */
  line: string;
  labels: Readonly<Record<PlaceSettingKey, string>>;
  empty: string;
  unlimited: string;
  ticked: string;
  unticked: string;
  autoYes: string;
  autoNo: string;
  noWaitlist: string;
  /** Each effect's sentence (`PlaceEffect`), with its `{name}`s. */
  effects: Readonly<Record<PlaceEffectKey, string>>;
};

export type PlaceEffectKey =
  | "belowTaken"
  | "keptAbove"
  | "uncapped"
  | "free"
  | "freeSplit"
  | "offers"
  | "nobodyAuto"
  | "doorDirect"
  | "doorWaitlist"
  | "doorFull"
  | "doorListFull"
  | "doorOffersOnly"
  | "doorShut"
  | "datesClosed"
  | "releaseAt"
  | "releasePassed"
  | "releaseNoEffect"
  | "releaseOff"
  | "releaseRan"
  | "alertOn"
  | "alertOff";

export type PlaceEffect = { key: PlaceEffectKey; values: Record<string, string | number> };

/**
 * The settings as the form posts them, read with the form's own rules: an empty capacity is no limit, an empty kept
 * box is 0, the waiting list from its choice and its box (`waitlistLengthPosted`), «Da»/«Nu», a tick posts `on` beside
 * its `.present` marker, an empty alert is off. A setting the form did not carry keeps its loaded value, as the
 * service keeps what a form does not post.
 */
export function placeSettingsFromForm(valueOf: (field: string) => string | null, loaded: PlaceSettings): PlaceSettings {
  const whole = (field: string, fallback: number | null, empty: number | null): number | null => {
    const raw = valueOf(field);
    if (raw === null) return fallback;
    const text = raw.trim();
    if (text === "") return empty;
    const n = Number(text);
    return Number.isInteger(n) && n >= 0 ? n : fallback;
  };
  const tick = (field: string, fallback: boolean): boolean => (valueOf(`${field}.present`) === "1" ? valueOf(field) === "on" : fallback);
  const choice = valueOf("event.waitlistMode");
  const waitlistCapacity =
    choice !== null && isWaitlistChoice(choice)
      ? (() => {
          const posted = waitlistLengthPosted(choice, valueOf("event.waitlistCapacity") ?? "");
          if (posted === "") return null;
          const n = Number(posted);
          return Number.isInteger(n) && n >= 0 ? n : loaded.waitlistCapacity;
        })()
      : loaded.waitlistCapacity;
  const auto = valueOf("event.waitlistAutoOffer");
  const capacity = whole("event.capacity", loaded.capacity, null);
  return {
    capacity,
    // An uncapped event keeps none (the service saves 0 there).
    placesKeptForClub: capacity === null ? 0 : (whole("event.placesKeptForClub", loaded.placesKeptForClub, 0) ?? 0),
    waitlistCapacity,
    waitlistAutoOffer: auto === "true" ? true : auto === "false" ? false : loaded.waitlistAutoOffer,
    publicRegistrationOpen: tick("event.publicRegistrationOpen", loaded.publicRegistrationOpen),
    freePlacesByOfferOnly: tick("event.freePlacesByOfferOnly", loaded.freePlacesByOfferOnly),
    releaseUnsignedAtDeadline: tick("event.releaseUnsignedAtDeadline", loaded.releaseUnsignedAtDeadline),
    placesAlertAt: whole("event.placesAlertAt", loaded.placesAlertAt, null),
    confirmationOpensDaysBefore: whole("event.confirmationOpensDaysBefore", loaded.confirmationOpensDaysBefore, loaded.confirmationOpensDaysBefore) ?? 0,
    confirmationDeadlineDaysBefore: whole("event.confirmationDeadlineDaysBefore", loaded.confirmationDeadlineDaysBefore, loaded.confirmationDeadlineDaysBefore) ?? 0,
  };
}

const DAY = 24 * 60 * 60_000;

/** The release's deadline under these settings — the window's, strictly before the start — or null (`unsigned-release.ts#windowDeadlineOf`). */
function releaseDeadline(settings: PlaceSettings, startsAt: number): number | null {
  const opens = settings.confirmationOpensDaysBefore;
  const due = settings.confirmationDeadlineDaysBefore;
  if (opens <= 0 || due <= 0 || opens <= due) return null;
  return startsAt - due * DAY;
}

/** The listed settings that differ, in the editor's order (the window's days are said through the release's deadline, below). */
export function changedPlaceSettings(before: PlaceSettings, after: PlaceSettings): PlaceSettingKey[] {
  return PLACE_SETTING_KEYS.filter((key) => before[key] !== after[key]);
}

/** Whether the release's deadline moves under a save that keeps it on — a change of the window's days the summary must say. */
function releaseDeadlineMoved(before: PlaceSettings, after: PlaceSettings, facts: PlaceFacts): boolean {
  return before.releaseUnsignedAtDeadline && after.releaseUnsignedAtDeadline && releaseDeadline(before, facts.startsAt) !== releaseDeadline(after, facts.startsAt);
}

/**
 * What the save does, in the order a reader asks it: a refusal first (and alone), then the places after it, the offers
 * or why nobody gets one, the site's button, the release at the deadline and the alert — each said once, and only for
 * what the change touches.
 */
export function placeChangeEffects(before: PlaceSettings, after: PlaceSettings, facts: PlaceFacts): PlaceEffect[] {
  const changed = new Set(changedPlaceSettings(before, after));
  const moved = releaseDeadlineMoved(before, after, facts);
  if (changed.size === 0 && !moved) return [];
  const { occupied, waiting } = facts;
  const effect = (key: PlaceEffectKey, values: Record<string, string | number> = {}): PlaceEffect => ({ key, values });

  // The save would be refused: said alone, nothing else of it happens.
  if (after.capacity !== null && after.capacity < occupied && (changed.has("capacity") || changed.has("placesKeptForClub"))) return [effect("belowTaken", { occupied })];
  if (after.capacity !== null && after.placesKeptForClub > after.capacity) return [effect("keptAbove", { capacity: after.capacity })];

  const effects: PlaceEffect[] = [];
  const places = changed.has("capacity") || changed.has("placesKeptForClub");
  const door =
    places || changed.has("waitlistCapacity") || changed.has("freePlacesByOfferOnly") || changed.has("publicRegistrationOpen") || changed.has("waitlistAutoOffer");

  if (places) {
    if (after.capacity === null) effects.push(effect("uncapped"));
    else {
      const free = Math.max(after.capacity - occupied, 0);
      const site = Math.max(lineRoom({ capacity: after.capacity, placesKeptForClub: after.placesKeptForClub, occupied }) ?? 0, 0);
      // What the site announces — the capacity less the kept places (`kept-places.ts#announcedCapacity`) — and the free places after the save.
      const announced = after.capacity - after.placesKeptForClub;
      effects.push(
        after.placesKeptForClub > 0
          ? effect("freeSplit", { announced, capacity: after.capacity, kept: after.placesKeptForClub, free, site, keptFree: free - site })
          : effect("free", { announced, free, capacity: after.capacity }),
      );
    }
  }

  // The line: offered the site's room by itself, or left to the staff.
  const siteRoomAfter = after.capacity === null ? waiting : Math.max(lineRoom({ capacity: after.capacity, placesKeptForClub: after.placesKeptForClub, occupied }) ?? 0, 0);
  if (door && waiting > 0 && siteRoomAfter > 0) {
    if (offersOnItsOwn(after)) effects.push(effect("offers", { count: Math.min(waiting, siteRoomAfter), waiting }));
    else effects.push(effect("nobodyAuto", { waiting }));
  }

  if (door) {
    if (!after.publicRegistrationOpen) effects.push(effect("doorShut"));
    else {
      const siteRoom = after.capacity === null ? 1 : Math.max(lineRoom({ capacity: after.capacity, placesKeptForClub: after.placesKeptForClub, occupied }) ?? 0, 0);
      const joins = newcomerJoinsLine({ waitlisted: waiting, freePlacesByOfferOnly: after.freePlacesByOfferOnly, channel: "public", capacity: after.capacity });
      if (siteRoom > 0 && !joins) effects.push(effect("doorDirect"));
      else if (after.waitlistCapacity === 0) effects.push(effect(siteRoom > 0 ? "doorOffersOnly" : "doorFull"));
      else if (after.waitlistCapacity !== null && waiting >= after.waitlistCapacity) effects.push(effect("doorListFull"));
      else effects.push(effect("doorWaitlist"));
      if (!facts.datesOpen) effects.push(effect("datesClosed"));
    }
  }

  if (changed.has("releaseUnsignedAtDeadline") || moved) {
    if (!after.releaseUnsignedAtDeadline) effects.push(effect("releaseOff"));
    else {
      const deadline = after.capacity === null ? null : releaseDeadline(after, facts.startsAt);
      if (deadline === null) effects.push(effect("releaseNoEffect"));
      else if (deadline <= facts.now) effects.push(effect("releasePassed"));
      else effects.push(effect("releaseAt", { deadline: sayDeadline(deadline, facts) }));
      if (moved && facts.releasedFor !== null) effects.push(effect("releaseRan"));
    }
  }

  if (changed.has("placesAlertAt")) {
    effects.push(
      after.placesAlertAt === null
        ? effect("alertOff")
        : effect("alertOn", { count: after.placesAlertAt, free: after.capacity === null ? 0 : Math.max(after.capacity - occupied, 0) }),
    );
  }
  return effects;
}

/** A deadline as a sentence says it, in the event's zone and the reader's language: «15 noiembrie, 10:00». */
function sayDeadline(at: number, facts: PlaceFacts): string {
  try {
    return new Intl.DateTimeFormat(facts.locale, { timeZone: facts.zone, day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(at));
  } catch {
    return new Date(at).toISOString();
  }
}

/** One value as the summary says it. */
function sayValue(key: PlaceSettingKey, value: PlaceSettings[PlaceSettingKey], words: PlaceChangeWords): string {
  if (key === "capacity") return value === null ? words.unlimited : String(value);
  if (key === "waitlistCapacity") return value === null ? words.unlimited : value === 0 ? words.noWaitlist : String(value);
  if (key === "waitlistAutoOffer") return value ? words.autoYes : words.autoNo;
  if (key === "placesAlertAt") return value === null ? words.empty : String(value);
  if (typeof value === "boolean") return value ? words.ticked : words.unticked;
  return String(value);
}

function fill(template: string, values: Record<string, string | number>): string {
  let out = template;
  for (const [name, value] of Object.entries(values)) out = out.split(`{${name}}`).join(String(value));
  return out;
}

/**
 * The summary's lines — each change «before → after», then each effect — or null when the save changes no place
 * setting (and moves no release's deadline): then nothing is asked.
 */
export function placeChangeLines(before: PlaceSettings, after: PlaceSettings, facts: PlaceFacts, words: PlaceChangeWords): string[] | null {
  const changed = changedPlaceSettings(before, after);
  const moved = releaseDeadlineMoved(before, after, facts);
  if (changed.length === 0 && !moved) return null;
  const lines = changed.map((key) => fill(words.line, { label: words.labels[key], from: sayValue(key, before[key], words), to: sayValue(key, after[key], words) }));
  for (const item of placeChangeEffects(before, after, facts)) lines.push(fill(words.effects[item.key], item.values));
  return lines;
}

/** The loaded settings of a saved event, as the editor rendered them. */
export function placeSettingsOf(event: PlaceSettings): PlaceSettings {
  return {
    capacity: event.capacity,
    placesKeptForClub: event.capacity === null ? 0 : event.placesKeptForClub,
    waitlistCapacity: event.waitlistCapacity,
    waitlistAutoOffer: event.waitlistAutoOffer,
    publicRegistrationOpen: event.publicRegistrationOpen,
    freePlacesByOfferOnly: event.freePlacesByOfferOnly,
    releaseUnsignedAtDeadline: event.releaseUnsignedAtDeadline,
    placesAlertAt: event.placesAlertAt,
    confirmationOpensDaysBefore: event.confirmationOpensDaysBefore,
    confirmationDeadlineDaysBefore: event.confirmationDeadlineDaysBefore,
  };
}
