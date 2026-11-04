import { eq } from "drizzle-orm";
import { createTranslator } from "next-intl";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eventEliteEntries } from "@/db/schema/event-elite-entries";
import { eventInvitations } from "@/db/schema/event-invitations";
import { eventVolunteers } from "@/db/schema/event-volunteers";
import { participants } from "@/db/schema/participants";
import { registrations, type RegistrationTshirtSize } from "@/db/schema/registrations";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";
import { createRace, registerRunner, type Runner } from "../../helpers/results";

/**
 * «Kituri de pregătit» (the owner, 2026-10-29): one event's real registrations holding a place now —
 * the special guests among them — by T-shirt size, plus its open invitations before their deadline.
 * Never the waiting list, a cancelled or expired row, a test row, or an answered, withdrawn or lapsed invitation.
 *
 * Said as the runners plus the volunteers (the owner, 2026-11-04: «aș vrea să mă asigur că număr și elitele»): the title
 * «Kituri de pregătit: N = X alergători + Y voluntari», the volunteers being the event's ticked «Are kit», the cancelled
 * left out (§904), or «Kituri de pregătit: X alergători» with none; the runners are the registrations above, the open
 * invitations and the event's separate elite list (§895), the line under the title splitting them, the elites a link to
 * the editor's elite card. A registered runner marked «Elită» is a registration, counted once. `countKits` is unchanged.
 */
const NOW = new Date("2026-11-01T10:00:00.000Z");
const DAY = 24 * 3_600_000;

let db: TestDatabase;
let close: () => Promise<void>;
let locale: "ro" | "en" = "ro";

vi.mock("@/db/client", () => ({ getDb: () => db }));
vi.mock("next-intl/server", () => ({
  getTranslations: async (namespace: string) =>
    createTranslator({ locale, messages: (locale === "ro" ? ro : en) as unknown as Record<string, never>, namespace: namespace as never }),
  getLocale: async () => locale,
}));

const { countKits } = await import("@/modules/registrations/admin-repository");
const { countVolunteersWithKit } = await import("@/modules/volunteers/admin-list");
const { listEliteEntries } = await import("@/modules/registrations/elite-list");
const { default: KitCount } = await import("@/modules/registrations/ui/KitCount");

/** The editor's elite card, as the page hands it in. */
const ELITE_CARD = "/ro/admin/events/race#bib-elite";

async function markup(kits: Awaited<ReturnType<typeof countKits>>, volunteers?: number, elites?: number): Promise<string> {
  return renderToStaticMarkup(await KitCount({ kits, locale, volunteers, elites, eliteHref: ELITE_CARD }));
}
/** The words a reader sees: Emotion's styles out, every tag a space, a space before a full stop gone (an inline link's edge). */
const words = (html: string) =>
  html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .replace(/ ([.,])/g, "$1")
    .trim();
async function drawn(kits: Awaited<ReturnType<typeof countKits>>, volunteers?: number, elites?: number): Promise<string> {
  return words(await markup(kits, volunteers, elites));
}
/** A test's own figures, without a database: the counted words are the subject. */
const figures = (registrations: number, invitations = 0) => ({ kitShirt: false, bySize: {}, registrations, invitations });

/** A volunteer the club typed by name (§865), in a state, ticked «Are kit» or not (§904). */
async function volunteer(eventId: string, state: "REGISTERED" | "CONFIRMED" | "CANCELLED", hasKit: boolean) {
  await db.insert(eventVolunteers).values({ eventId, name: "Vlad Test", source: "STAFF", state, hasKit });
}

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
});
afterAll(async () => close());
beforeEach(async () => {
  locale = "ro";
  await resetTables(db);
});

async function runner(eventId: string, size: RegistrationTshirtSize | null, input: Omit<Runner, "name" | "bibNumber"> = {}) {
  const row = await registerRunner(db, eventId, { name: "Ana Test", bibNumber: null, ...input });
  await db.update(registrations).set({ tshirtSize: size }).where(eq(registrations.id, row.id));
}

let counter = 0;
async function invite(eventId: string, patch: Partial<typeof eventInvitations.$inferInsert> = {}) {
  counter += 1;
  const email = `kit.${counter}@example.invalid`;
  const [person] = await db
    .insert(participants)
    .values({ deliveryEmail: email, normalizedEmail: email, canonicalEmail: email, canonicalizationVersion: 2, defaultName: "Ana Test", preferredLocale: "ro" })
    .returning({ id: participants.id });
  await db.insert(eventInvitations).values({ eventId, participantId: person.id, name: "Ana Test", email, canonicalEmail: email, sentAt: NOW, lastSentAt: NOW, expiresAt: new Date(NOW.getTime() + 7 * DAY), ...patch });
}

describe("«Kituri de pregătit»", () => {
  it("counts everyone holding a place, by size, and the open invitations", async () => {
    const race = await createRace(db, { kitShirt: true });
    const other = await createRace(db, { kitShirt: true });
    await runner(race.id, "M");
    await runner(race.id, "M", { status: "PENDING_DECLARATION" });
    await runner(race.id, "L", { status: "WAITLIST_OFFERED" });
    await runner(race.id, "S", { status: "PENDING_EMAIL_CONFIRMATION" });
    await runner(race.id, "NONE", { outsideCapacity: true });
    await runner(race.id, null);
    // Not in it: the waiting list, cancelled and expired rows, a test row, another event.
    await runner(race.id, "XL", { status: "WAITLISTED" });
    await runner(race.id, "XL", { status: "CANCELLED" });
    await runner(race.id, "XL", { status: "EXPIRED" });
    await runner(race.id, "XL", { kind: "TEST" });
    await runner(other.id, "XL");
    await invite(race.id);
    await invite(race.id, { outsideCapacity: true });
    await invite(race.id, { acceptedAt: NOW });
    await invite(race.id, { withdrawnAt: NOW });
    await invite(race.id, { expiresAt: new Date(NOW.getTime() - DAY) });

    const kits = await countKits(db, race.id, NOW);
    expect(kits).toEqual({ kitShirt: true, bySize: { M: 2, L: 1, S: 1, NONE: 2 }, registrations: 6, invitations: 2 });
    const text = await drawn(kits);
    expect(text).toContain("Kituri de pregătit: 8 alergători");
    expect(text).toContain("Alergători: 6 au acum un loc, cu invitați speciali · 2 invitații fără răspuns. Lista de așteptare nu intră.");
    // The sizes in the form's order, then no T-shirt, then the invited whose size is not known yet.
    expect(text).toContain("Tricouri — S: 1 · M: 2 · L: 1 · fără tricou: 2 · mărime încă necunoscută (invitații): 2");
  });

  it("says the event gives no T-shirt, and counts nothing for an empty one", async () => {
    const race = await createRace(db);
    const kits = await countKits(db, race.id, NOW);
    expect(kits).toEqual({ kitShirt: false, bySize: {}, registrations: 0, invitations: 0 });
    const text = await drawn(kits);
    expect(text).toContain("Kituri de pregătit: 0 alergători");
    expect(text).not.toContain("Tricouri");
  });

  it("§904's volunteers in the title: «N = X alergători + Y voluntari» — the event's ticked «Are kit», not cancelled — and countKits without them", async () => {
    const race = await createRace(db, { kitShirt: true });
    const other = await createRace(db, { kitShirt: true });
    await runner(race.id, "M");
    await volunteer(race.id, "CONFIRMED", true);
    await volunteer(race.id, "REGISTERED", true);
    // Not in it: a cancelled volunteer, one nobody ticked, another event's.
    await volunteer(race.id, "CANCELLED", true);
    await volunteer(race.id, "REGISTERED", false);
    await volunteer(other.id, "CONFIRMED", true);

    // The kits' own figure, as before: the registrations and the invitations alone.
    const kits = await countKits(db, race.id, NOW);
    expect(kits).toEqual({ kitShirt: true, bySize: { M: 1 }, registrations: 1, invitations: 0 });
    const volunteers = await countVolunteersWithKit(db, race.id);
    expect(volunteers).toBe(2);
    const text = await drawn(kits, volunteers);
    expect(text).toContain("Kituri de pregătit: 3 = 1 alergător + 2 voluntari");
    expect(text).not.toContain("Plus voluntari");
    // Nobody ticked: the runners alone, no word of volunteers.
    expect(await drawn(kits, 0)).toContain("Kituri de pregătit: 1 alergător");
    expect(await drawn(kits, 0)).not.toContain("voluntar");
    expect(await drawn(kits)).not.toContain("voluntar");
  });

  it("counts the separate elite list among the runners, a link to the editor's elite card, and a registered elite once (2026-11-04)", async () => {
    const race = await createRace(db, { kitShirt: true });
    const other = await createRace(db, { kitShirt: true });
    await runner(race.id, "M");
    await runner(race.id, "L");
    // Silviu: registered and marked «Elită» — a registration, in the kits once.
    const silviu = await registerRunner(db, race.id, { name: "Silviu Elita", bibNumber: null });
    await db.update(registrations).set({ elite: true }).where(eq(registrations.id, silviu.id));
    await volunteer(race.id, "CONFIRMED", true);
    // Ingrid: on the separate list — no registration, no place, a kit. Another event's line is not this one's.
    await db.insert(eventEliteEntries).values([
      { eventId: race.id, name: "Ingrid Elita" },
      { eventId: other.id, name: "Alt Eveniment" },
    ]);

    // `countKits` stays the registrations' and the invitations'.
    const kits = await countKits(db, race.id, NOW);
    expect(kits.registrations).toBe(3);
    // The page's figure: the lines its «Elite» fold reads, for whoever reads the list.
    const elites = (await listEliteEntries(db, { id: "00000000-0000-4000-8000-000000000001", role: "MODERATOR" }, race.id)).length;
    expect(elites).toBe(1);
    const text = await drawn(kits, 1, elites);
    expect(text).toContain("Kituri de pregătit: 5 = 4 alergători + 1 voluntar");
    expect(text).toContain("Alergători: 3 au acum un loc, cu invitați speciali · 0 invitații fără răspuns · 1 elită din lista separată. Lista de așteptare nu intră.");
    // The elites' words link to the editor's elite card, a plain anchor.
    expect(await markup(kits, 1, elites)).toMatch(new RegExp(`<a[^>]*href="${ELITE_CARD}"[^>]*>1 elită din lista separată</a>`));
    // No volunteer: the runners alone, the elites among them.
    expect(await drawn(kits, 0, elites)).toContain("Kituri de pregătit: 4 alergători");
    // No elite: no word of them, and no link.
    const plain = await markup(kits, 0, 0);
    expect(words(plain)).toContain("Kituri de pregătit: 3 alergători");
    expect(words(plain)).not.toContain("elit");
    expect(plain).not.toContain("bib-elite");
    // None of the lines this replaced.
    expect(text).not.toContain("Plus");
    expect(text).not.toContain("Total de pregătit");
  });

  it("says each count in its own form, in Romanian and in English", async () => {
    expect(await drawn(figures(1), 1)).toContain("Kituri de pregătit: 2 = 1 alergător + 1 voluntar");
    expect(await drawn(figures(19), 20, 1)).toContain("Kituri de pregătit: 40 = 20 de alergători + 20 de voluntari");
    expect(await drawn(figures(1, 1), 0, 1)).toContain("Alergători: 1 are acum un loc, cu invitați speciali · 1 invitație fără răspuns · 1 elită din lista separată.");
    expect(await drawn(figures(20, 20), 0, 20)).toContain("Alergători: 20 au acum un loc, cu invitați speciali · 20 de invitații fără răspuns · 20 de elite din lista separată.");

    locale = "en";
    expect(await drawn(figures(1), 1)).toContain("Kits to prepare: 2 = 1 runner + 1 volunteer");
    expect(await drawn(figures(19), 20, 1)).toContain("Kits to prepare: 40 = 20 runners + 20 volunteers");
    expect(await drawn(figures(2))).toContain("Kits to prepare: 2 runners");
    expect(await drawn(figures(1, 1), 0, 1)).toContain(
      "Runners: 1 holding a place now, special guests included · 1 invitation unanswered · 1 elite on the separate list. The waiting list is not counted.",
    );
    expect(await drawn(figures(3, 2), 0, 2)).toContain("2 invitations unanswered · 2 elites on the separate list.");
  });
});
