import { eq } from "drizzle-orm";
import { createTranslator } from "next-intl";
import { renderToReadableStream } from "react-dom/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { registrations } from "@/db/schema/registrations";
import { staffUsers } from "@/db/schema/staff-users";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";
import { createRace, person, registerRunner } from "../../helpers/results";

/**
 * «Istoric capacitate» (§NNN) on a real database (PGlite), BR-REQ-034-02 — from fixture audit rows only, so it holds
 * whichever release writes them:
 *
 * - the rows of this event and of the actions the screen knows, read by their plain strings, newest first, with the
 *   staff member's name — never another event's, never another action;
 * - a supplementary place written before this screen (`{from, to, registrationId}`, no version) beside the editor's
 *   richer rows (`{from, to, occupied, offered, via, reason, version}`), each line saying who, when, from → to and why;
 * - «Vezi înscrierea» for a registration that still exists, «înscriere ștearsă» for one erased since; «automat» for the
 *   job, «cont șters» for an account removed since; and «Schimbare neînregistrată» where two rows do not join and
 *   against the capacity of now — in both languages.
 */
const state = vi.hoisted(() => ({ locale: "ro" as "ro" | "en" }));

vi.mock("next-intl/server", () => ({
  getTranslations: async (arg: string | { namespace: string }) => {
    const namespace = typeof arg === "string" ? arg : arg.namespace;
    const catalogue = (state.locale === "ro" ? ro : en) as unknown as Record<string, Record<string, unknown>>;
    return createTranslator({ locale: state.locale, messages: catalogue[namespace] as never });
  },
  getLocale: async () => state.locale,
}));
vi.mock("@/i18n/navigation", () => ({
  getPathname: ({ locale, href }: { locale: string; href: { pathname: string; params: Record<string, string> } }) =>
    `/${locale}${href.pathname.replace(/\[(\w+)\]/g, (_, key: string) => href.params[key])}`,
}));

const { listCapacityHistory } = await import("@/modules/registrations/capacity-history");
const { default: CapacityHistory } = await import("@/modules/registrations/ui/CapacityHistory");

let db: TestDatabase;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
});
afterAll(async () => close());
beforeEach(async () => {
  await resetTables(db);
  state.locale = "ro";
});

/** The rows are dated from one reading of the clock, so the suite reads the same under any clock and no two rows tie. */
const BASE = Date.now();
const ago = (minutes: number) => new Date(BASE - minutes * 60_000);

async function audit(eventId: string, action: string, metadata: Record<string, unknown>, minutesAgo: number, actorStaffUserId: string | null) {
  await db.insert(auditLogs).values({ action, entityType: "event", entityId: eventId, actorStaffUserId, metadataJson: metadata, createdAt: ago(minutesAgo) });
}

async function markup(history: Awaited<ReturnType<typeof listCapacityHistory>>): Promise<string> {
  const stream = await renderToReadableStream(await CapacityHistory({ history, locale: state.locale }));
  await stream.allReady;
  return (await new Response(stream).text()).replace(/<style[^>]*>[\s\S]*?<\/style>/g, "");
}
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ");

/**
 * The race's trail: the owner's raise to 190 before the editor wrote rows (a gap), then «Trimite-i oferta» twice — one
 * for a registration erased since — a place for an invitation by an account removed since, the editor's save with its
 * reason and the places kept, the release at the deadline and the tick it set (the job's), and the door closed from
 * «Înscrieri». Beside it, another event's raise and this event's emergency sheet, which the screen never reads.
 */
async function trail() {
  const event = await createRace(db, { capacity: 195 });
  const other = await createRace(db, { capacity: 50 });
  const amalia = await person(db, "ADMIN", "Amalia");
  const leaver = await person(db, "SUPERADMIN", "Plecat");
  const kept = await registerRunner(db, event.id, { name: "Ana Test", bibNumber: null });
  const erased = await registerRunner(db, event.id, { name: "Bogdan Test", bibNumber: null });

  await audit(event.id, "event.capacity_raised_for_offer", { from: 175, to: 176, registrationId: kept.id }, 60, amalia.id);
  await audit(event.id, "event.capacity_raised_for_offer", { from: 176, to: 177, registrationId: erased.id }, 50, amalia.id);
  await audit(event.id, "event.capacity_raised_for_invitation", { from: 190, to: 191, invitationId: "1f0e2d3c-4b5a-4968-8776-655443322110", version: 30 }, 40, leaver.id);
  await audit(event.id, "event.capacity_changed", { from: 191, to: 195, occupied: 188, offered: 2, via: "editor", reason: "Încă patru locuri de la sponsor", version: 31 }, 30, amalia.id);
  // The same save, the same version: the capacity's row first, as it was written.
  await audit(event.id, "event.places_kept_changed", { from: 0, to: 10, via: "editor", version: 31 }, 29.9, amalia.id);
  await audit(event.id, "event.unsigned_released", { deadline: "2026-11-15T08:00:00.000Z", released: 12, test: 0, free: 14, waiting: 20, offerOnlyTicked: true }, 20, null);
  await audit(event.id, "event.free_places_by_offer_only_changed", { from: false, to: true, via: "deadline" }, 19.9, null);
  await audit(event.id, "event.public_registration_changed", { from: true, to: false, via: "registrations" }, 10, amalia.id);
  await audit(other.id, "event.capacity_raised_for_offer", { from: 50, to: 51, registrationId: kept.id }, 5, amalia.id);
  await audit(event.id, "event.emergency_sheet_viewed", { rowCount: 3 }, 5, amalia.id);

  // Erased since, and an account removed since (`ON DELETE SET NULL`).
  await db.delete(registrations).where(eq(registrations.id, erased.id));
  await db.delete(staffUsers).where(eq(staffUsers.id, leaver.id));
  return { event, kept };
}

describe("BR-REQ-034-02 «Istoric capacitate» from the audit trail (§NNN)", () => {
  it("reads this event's rows of the places, newest first, and says where the capacity changed without one", async () => {
    const { event, kept } = await trail();
    const history = await listCapacityHistory(db, event.id, 195);
    expect(history.count).toBe(8);
    expect(history.current).toBe(195);
    expect(history.limited).toBe(false);
    const shape = history.lines.map((line) => (line.kind === "gap" ? `gap ${line.from}→${line.to}` : line.kind === "places" ? `${line.field} ${line.from}→${line.to}` : line.kind === "setting" ? line.setting : line.kind));
    expect(shape).toEqual(["publicRegistration", "offersOnly", "released", "kept 0→10", "capacity 191→195", "capacity 190→191", "gap 177→190", "capacity 176→177", "capacity 175→176"]);
    const oldest = history.lines.at(-1);
    expect(oldest).toMatchObject({ kind: "places", registrationId: kept.id, registrationExists: true, version: null, who: { kind: "staff", name: "Amalia" } });
    expect(history.lines.at(-2)).toMatchObject({ kind: "places", registrationExists: false });
    expect(history.lines.find((line) => line.kind === "places" && line.forInvitation)).toMatchObject({ who: { kind: "removed" } });
    expect(history.lines.find((line) => line.kind === "released")).toMatchObject({ who: { kind: "automatic" }, released: 12 });

    // Against the capacity of now: an unrecorded change after the last row.
    expect((await listCapacityHistory(db, event.id, 200)).lines[0]).toEqual({ kind: "gap", from: 195, to: 200 });
    // At most the newest rows asked for, and said so.
    const short = await listCapacityHistory(db, event.id, 195, 3);
    expect(short.count).toBe(3);
    expect(short.limited).toBe(true);
  });

  it("draws who, when, from → to and why on each line, with the registration's door or its absence", async () => {
    const { event, kept } = await trail();
    const html = await markup(await listCapacityHistory(db, event.id, 195));
    const words = text(html);
    expect(words).toContain("Capacitatea de acum: 195");
    expect(words).toContain("Amalia · Locuri: 175 → 176 · un loc în plus pentru o ofertă");
    expect(words).toContain("Amalia · Locuri: 176 → 177 · un loc în plus pentru o ofertă · înscriere ștearsă");
    expect(words).toContain("Schimbare neînregistrată: 177 → 190");
    expect(words).toContain("cont șters · Locuri: 190 → 191 · un loc în plus pentru o invitație");
    expect(words).toContain("Amalia · Locuri: 191 → 195 · din editor · „Încă patru locuri de la sponsor” · ocupate 188 · oferte trimise 2");
    expect(words).toContain("Amalia · Locuri păstrate pentru club: 0 → 10 · din editor");
    expect(words).toContain("automat · Eliberate la termen: 12");
    expect(words).toContain("libere după 14 · pe lista de așteptare 20 · s-a bifat «Locurile libere le dau doar eu»");
    expect(words).toContain("automat · «Locurile libere le dau doar eu»: nebifat → bifat · la termenul declarației");
    expect(words).toContain("Amalia · «Înscrieri publice deschise»: bifat → nebifat · din pagina «Înscrieri»");
    // One door, to the registration that still exists; nothing about another event or another action.
    expect(html.match(/data-testid="capacity-history-registration"/g)).toHaveLength(1);
    expect(html).toContain(`href="/ro/admin/registrations/${kept.id}"`);
    expect(words).not.toContain("50 → 51");
    expect(html.match(/data-testid="capacity-history-line"/g)).toHaveLength(8);
    expect(html.match(/data-testid="capacity-history-gap"/g)).toHaveLength(1);
  });

  it("speaks English, and says so when nothing was recorded", async () => {
    const { event } = await trail();
    state.locale = "en";
    const words = text(await markup(await listCapacityHistory(db, event.id, 195)));
    expect(words).toContain("Capacity now: 195");
    expect(words).toContain("Amalia · Places: 191 → 195 · from the editor · “Încă patru locuri de la sponsor” · taken 188 · offers sent 2");
    expect(words).toContain("Unrecorded change: 177 → 190");
    expect(words).toContain("account deleted · Places: 190 → 191 · one more place for an invitation");
    expect(words).toContain("automatic · Released at the deadline: 12");

    const quiet = await createRace(db, { capacity: null });
    const none = text(await markup(await listCapacityHistory(db, quiet.id, null)));
    expect(none).toContain("Capacity now: no limit");
    expect(none).toContain("No change of the places recorded yet.");
  });
});
