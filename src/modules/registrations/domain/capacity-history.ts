/**
 * «Istoric capacitate» (§NNN; the owner, 2026-11-03, choosing the capacity's history among four place controls for the
 * 21 November race): every change of an event's places — who, when, from how many to how many, and why — read back from
 * the audit trail, never from a table of its own.
 *
 * Pure: the audit rows in, the lines out (`capacity-history.ts#listCapacityHistory` reads them). **Tolerant by design**:
 * the rows are read by their plain action strings — `audit_logs.action` is `text` — and their metadata is parsed field
 * by field, so a row written before this screen existed (a supplementary place's `{from, to, registrationId}`, §642),
 * a row in the richer shape the editor's writers add (`{from, to, occupied, offered, via, reason, version}`), and a field
 * nobody wrote all render: a value that cannot be read is said as unknown, never guessed.
 *
 * - **Order.** By the time each row was written, then — among the rows that carry the event's `version` — by that
 *   version: a row's time is the clock reading taken before its transaction waited for the event's lock, so two
 *   writes a moment apart can be stamped in the other order than they took effect; the version is the order they took
 *   effect in. A row without one keeps its place by time.
 * - **Gaps.** Where a capacity row's `from` is not the previous capacity row's `to`, the capacity changed without a
 *   row — before the trail recorded the editor's changes, or by a path that wrote none — and a line says so between
 *   them («Schimbare neînregistrată: 175 → 190»); the last row's `to` is compared with the capacity of now the same way.
 *   Nothing is backfilled.
 * - **Who.** The staff member's name; with none, «automat» for what the job did (the release at the deadline, a date a
 *   series made by itself) and «cont șters» for a staff account removed since (`ON DELETE SET NULL`).
 * - **Which registration.** A supplementary place names the registration it was added for (an id, never a person,
 *   §12.12); «Vezi înscrierea» when it still exists, «înscriere ștearsă» when it was erased since.
 */

/** The capacity's own rows: the editor's writers (`event.capacity_changed`) and the three supplementary places (§642). */
export const CAPACITY_ROW_ACTIONS = [
  "event.capacity_changed",
  "event.capacity_raised_for_offer",
  "event.capacity_raised_for_place_now",
  "event.capacity_raised_for_invitation",
] as const;

/** The switches that decide who a place goes to, each read as `{from, to}` (§615, §906, and the deadline release's tick). */
const SETTING_OF = {
  "event.public_registration_changed": "publicRegistration",
  "event.free_places_by_offer_only_changed": "offersOnly",
  "event.places_alert_changed": "placesAlert",
  "event.waitlist_auto_offer_changed": "autoOffer",
  "event.release_unsigned_changed": "releaseUnsigned",
} as const;

export type SettingKey = (typeof SETTING_OF)[keyof typeof SETTING_OF];

/** Every action «Istoric capacitate» reads, by its plain string. */
export const CAPACITY_HISTORY_ACTIONS = [
  ...CAPACITY_ROW_ACTIONS,
  "event.places_kept_changed",
  "event.unsigned_released",
  "event.public_registration_changed",
  "event.free_places_by_offer_only_changed",
  "event.places_alert_changed",
  "event.waitlist_auto_offer_changed",
  "event.release_unsigned_changed",
] as const;

/** How many rows the screen reads, newest first: a race's season of changes many times over. */
export const CAPACITY_HISTORY_LIMIT = 300;

/** One audit row as the reader hands it over. */
export type CapacityAuditRow = {
  id: string;
  action: string;
  at: Date;
  /** The staff member's display name; null for the job, or for an account removed since. */
  actorName: string | null;
  metadata: unknown;
};

/** A number of places as a row wrote it: a whole number, null for «fără limită», undefined when the row says nothing readable. */
export type Places = number | null | undefined;

/** A switch's value: a tick, the places alert's N (null is off), or undefined when unreadable. */
export type SettingValue = boolean | number | null | undefined;

/** Why the places changed, as the row says it; each is `Admin.capacityHistory.why.<key>`. */
export const WHY_KEYS = [
  "editor",
  "series",
  "import",
  "create",
  "duplicate",
  "seriesGenerated",
  "offer",
  "offerNow",
  "moveAndOffer",
  "anyOffer",
  "placeNow",
  "invitation",
  "deadline",
  "registrations",
] as const;

export type WhyKey = (typeof WHY_KEYS)[number];

/** A row's `via`, as the writers spell it, to the words' key. */
const VIA: Record<string, WhyKey> = {
  editor: "editor",
  series: "series",
  import: "import",
  create: "create",
  duplicate: "duplicate",
  series_generated: "seriesGenerated",
  offer: "offer",
  offerNow: "offerNow",
  moveAndOffer: "moveAndOffer",
  deadline: "deadline",
  registrations: "registrations",
};

/** The `via` values the job writes with no actor: the line says «automat», not «cont șters». */
const AUTOMATIC_VIA = new Set(["deadline", "series_generated"]);

export type Who = { kind: "staff"; name: string } | { kind: "automatic" } | { kind: "removed" };

type Base = { id: string; at: Date; who: Who; version: number | null };

/** A change of the capacity, or of the places kept for the club. */
export type PlacesEntry = Base & {
  kind: "places";
  field: "capacity" | "kept";
  from: Places;
  to: Places;
  why: WhyKey | null;
  /** What the Administrator typed under «De ce schimbi locurile?», if anything. */
  reason: string | null;
  /** The places taken at that moment, when the row says. */
  occupied: number | null;
  /** The offers the change sent to the waiting list, when the row says. */
  offered: number | null;
  /** The registration a supplementary place was added for; null when the row names none. */
  registrationId: string | null;
  /** Whether that registration still exists; null when the row names none. */
  registrationExists: boolean | null;
  /** Whether the place was added for an invitation (§647): a place for somebody not registered yet. */
  forInvitation: boolean;
};

/** The unsigned places released at the declaration's deadline, by the job. */
export type ReleasedEntry = Base & {
  kind: "released";
  deadline: Date | null;
  released: number | null;
  test: number | null;
  free: number | null;
  waiting: number | null;
  offerOnlyTicked: boolean;
};

/** One of the switches that decide who a place goes to. */
export type SettingEntry = Base & { kind: "setting"; setting: SettingKey; from: SettingValue; to: SettingValue; why: WhyKey | null };

/** A change of the capacity nobody recorded: between two rows that do not join, or between the last row and now. */
export type GapEntry = { kind: "gap"; from: number | null; to: number | null };

export type HistoryEntry = PlacesEntry | ReleasedEntry | SettingEntry;
export type HistoryLine = HistoryEntry | GapEntry;

export type CapacityHistory = {
  /** Newest first, the gap lines between the rows they sit between. */
  lines: HistoryLine[];
  /** The recorded changes, gap lines not counted. */
  count: number;
  /** When the most recent recorded change was written. */
  lastAt: Date | null;
  /** The capacity of now; null for an event with no limit. */
  current: number | null;
  /** Whether the read stopped at `CAPACITY_HISTORY_LIMIT` rows: older ones exist and are not shown. */
  limited: boolean;
};

type Meta = Record<string, unknown>;

function metaOf(value: unknown): Meta {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Meta) : {};
}

/** A count as written: a whole number, never negative; anything else is not read. */
function countIn(meta: Meta, key: string): number | null {
  const value = meta[key];
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

/** A capacity as written: a whole number, null for «fără limită» (a key written as null), undefined for anything else. */
function placesIn(meta: Meta, key: string): Places {
  const value = meta[key];
  if (value === null) return null;
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : undefined;
}

function settingIn(meta: Meta, key: string, setting: SettingKey): SettingValue {
  const value = meta[key];
  if (setting === "placesAlert") return value === null ? null : typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : undefined;
  return typeof value === "boolean" ? value : undefined;
}

/** The typed reason, as a line shows it: trimmed, at most the 200 characters the editor takes. */
function reasonIn(meta: Meta): string | null {
  const value = meta.reason;
  if (typeof value !== "string") return null;
  const text = value.replace(/\s+/g, " ").trim();
  return text === "" ? null : text.slice(0, 200);
}

function versionIn(meta: Meta): number | null {
  const value = meta.version;
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The registration a row names, when it names a well-formed id: the reader looks it up, and a malformed one is no id. */
export function registrationIdOf(metadata: unknown): string | null {
  const value = metaOf(metadata).registrationId;
  return typeof value === "string" && UUID.test(value) ? value.toLowerCase() : null;
}

function whyOf(meta: Meta): WhyKey | null {
  const via = meta.via;
  return typeof via === "string" ? (VIA[via] ?? null) : null;
}

/** Why a supplementary place was added: the row's `via` when it names the press, else the action's own verb. */
function raiseWhy(action: string, meta: Meta): WhyKey {
  const via = whyOf(meta);
  if (via === "offer" || via === "offerNow" || via === "moveAndOffer") return via;
  if (action === "event.capacity_raised_for_place_now") return "placeNow";
  if (action === "event.capacity_raised_for_invitation") return "invitation";
  // «Trimite-i oferta» and «Oferă-i un loc acum» both wrote this action before rows said which (§888).
  return "anyOffer";
}

function whoOf(row: CapacityAuditRow, meta: Meta): Who {
  if (row.actorName !== null && row.actorName.trim() !== "") return { kind: "staff", name: row.actorName };
  const via = meta.via;
  if (row.action === "event.unsigned_released" || (typeof via === "string" && AUTOMATIC_VIA.has(via))) return { kind: "automatic" };
  return { kind: "removed" };
}

function dateIn(meta: Meta, key: string): Date | null {
  const value = meta[key];
  if (typeof value !== "string") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** One row read, or null for an action this screen does not draw. */
export function parseCapacityRow(row: CapacityAuditRow, existingRegistrations: ReadonlySet<string>): HistoryEntry | null {
  const meta = metaOf(row.metadata);
  const base: Base = { id: row.id, at: row.at, who: whoOf(row, meta), version: versionIn(meta) };
  const isCapacity = (CAPACITY_ROW_ACTIONS as readonly string[]).includes(row.action);
  if (isCapacity || row.action === "event.places_kept_changed") {
    const raise = isCapacity && row.action !== "event.capacity_changed";
    const registrationId = registrationIdOf(meta);
    return {
      ...base,
      kind: "places",
      field: isCapacity ? "capacity" : "kept",
      from: placesIn(meta, "from"),
      to: placesIn(meta, "to"),
      why: raise ? raiseWhy(row.action, meta) : whyOf(meta),
      reason: reasonIn(meta),
      occupied: countIn(meta, "occupied"),
      offered: countIn(meta, "offered"),
      registrationId,
      registrationExists: registrationId === null ? null : existingRegistrations.has(registrationId),
      forInvitation: row.action === "event.capacity_raised_for_invitation",
    };
  }
  if (row.action === "event.unsigned_released") {
    return {
      ...base,
      kind: "released",
      deadline: dateIn(meta, "deadline"),
      released: countIn(meta, "released"),
      test: countIn(meta, "test"),
      free: countIn(meta, "free"),
      waiting: countIn(meta, "waiting"),
      offerOnlyTicked: meta.offerOnlyTicked === true,
    };
  }
  const setting = (SETTING_OF as Record<string, SettingKey | undefined>)[row.action];
  if (!setting) return null;
  return { ...base, kind: "setting", setting, from: settingIn(meta, "from", setting), to: settingIn(meta, "to", setting), why: whyOf(meta) };
}

/**
 * The rows in the order they took effect: by time and id, then the rows that carry a `version` put in version order in
 * the places such rows hold — so a row without one never moves, and two versioned rows never pass each other by a clock
 * read before the lock. Stable: rows of one version (a save that changed the capacity and the kept places) keep their
 * order by time.
 */
export function inOrder<E extends { id: string; at: Date; version: number | null }>(entries: readonly E[]): E[] {
  const byTime = [...entries].sort((a, b) => a.at.getTime() - b.at.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const slots = byTime.flatMap((entry, index) => (entry.version !== null ? [index] : []));
  const versioned = slots.map((index) => byTime[index]).sort((a, b) => (a.version as number) - (b.version as number));
  slots.forEach((slot, k) => {
    byTime[slot] = versioned[k];
  });
  return byTime;
}

/**
 * The gap lines, oldest first: one before a capacity row whose `from` is not the previous capacity row's `to`, and one
 * after the last against the capacity of now. A row whose values cannot be read joins nothing: no gap is claimed across it.
 */
export function withGaps(entries: readonly HistoryEntry[], current: number | null): HistoryLine[] {
  const lines: HistoryLine[] = [];
  let last: Places = undefined;
  for (const entry of entries) {
    if (entry.kind === "places" && entry.field === "capacity") {
      if (last !== undefined && entry.from !== undefined && entry.from !== last) lines.push({ kind: "gap", from: last, to: entry.from });
      last = entry.to;
    }
    lines.push(entry);
  }
  if (last !== undefined && last !== current) lines.push({ kind: "gap", from: last, to: current });
  return lines;
}

/** The history of one event's places, newest first, from its audit rows (any order) and the capacity of now. */
export function capacityHistory(
  rows: readonly CapacityAuditRow[],
  options: { current: number | null; existingRegistrations?: ReadonlySet<string>; limited?: boolean },
): CapacityHistory {
  const existing = options.existingRegistrations ?? new Set<string>();
  const entries = inOrder(rows.flatMap((row) => parseCapacityRow(row, existing) ?? []));
  const lastAt = entries.reduce<Date | null>((latest, entry) => (latest === null || entry.at.getTime() > latest.getTime() ? entry.at : latest), null);
  return {
    lines: withGaps(entries, options.current).reverse(),
    count: entries.length,
    lastAt,
    current: options.current,
    limited: options.limited ?? false,
  };
}
