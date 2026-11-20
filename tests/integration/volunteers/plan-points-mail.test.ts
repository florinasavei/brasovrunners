import { randomUUID } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { emailOutbox } from "@/db/schema/email-outbox";
import { eventVolunteers } from "@/db/schema/event-volunteers";
import { mediaAssets } from "@/db/schema/gallery";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { mapUrlOf } from "@/modules/event-checkpoints/domain/coordinates";
import { ladderKeyPrefixOf } from "@/modules/media/ladder";
import { OutboxMessageWithdrawn, type OutboxRow } from "@/modules/notifications/outbox";
import { renderOutboxMessage } from "@/modules/notifications/render";
import type { StaffRole } from "@/modules/staff-identity/domain/roles";
import { addVolunteerPlanPicture, readVolunteerPlan } from "@/modules/volunteers/plan";
import { changePlanPoint } from "@/modules/volunteers/plan-points";
import { readVolunteerPointMail, sendVolunteerPoints, volunteerPointAtSend } from "@/modules/volunteers/point-mail";
import { changeVolunteer } from "@/modules/volunteers/volunteers";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";
import { PLAN_CONTACT_WORDS, PLAN_JUNCTION_NOTE, type PlanRace, planAddressOf, seedPlanRace } from "../../helpers/volunteer-plan";

/**
 * §961 (amending §956), BR-REQ-080-02, BR-REQ-050-02 — «Punctul tău de voluntar» once the plan has points of its own (the
 * owner, 2026-11-17: «vreau să pot defini punctele de mână, să pun nume punct și la ce km e și coordonate punct» — «Practic
 * voluntarii sunt de 2 tipuri: start-finish și pe traseu»), from a real database:
 *
 * - a person at a **start–finish** point is told their place with no number and no kilometre — on the band, in the words
 *   under it, in the text and in the HTML, Romanian and English — and everything else of the message is a route point's;
 * - they are counted, told and «already told» exactly as the people at route points are, and so are the people at a route
 *   point of the plan's own;
 * - a point that has **coordinates** adds the two numbers and «Deschide pe hartă», in the HTML and in the plain text, in
 *   each half's language; a point without them sends the message exactly as before;
 * - the message says the point as it stands when it leaves — its kind, its number in the plan's one order, its coordinates;
 * - and who «already knows their point» does not change when the coordinates do: «Trimite din nou tuturor» sends the place.
 */
vi.mock("@/modules/media/storage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/modules/media/storage")>()),
  isStorageConfigured: () => true,
}));

const NOW = new Date("2026-11-16T10:00:00.000Z");
const MINUTE = 60_000;
const at = (minutes: number) => new Date(NOW.getTime() + minutes * MINUTE);
const PIATA = { latitude: 45.64271, longitude: 25.58871 };
const PIATA_TYPED = "45.64271, 25.58871";
const PIATA_MAP = "https://www.google.com/maps/search/?api=1&query=45.64271%2C25.58871";

let db: TestDatabase;
let close: () => Promise<void>;
const staff: Partial<Record<StaffRole, StaffUser>> = {};
let race: PlanRace;
/** The plan's own points of every test: «Kituri și numere» at the start–finish, «Izvor» on the route between the junction and the water. */
const own = { kits: "", spring: "" };

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
});
afterAll(async () => close());

beforeEach(async () => {
  await resetTables(db);
  for (const role of ["MODERATOR", "ADMIN"] as const) {
    [staff[role]] = await db.insert(staffUsers).values({ email: `${role.toLowerCase()}@example.test`, displayName: `Staff ${role}`, role }).returning();
  }
  // Ana at the junction (1.2 km, with a note), Dan at the water (5.5), Ion at the bridge (7.25), Zoe at the junction with no
  // address, Radu at no point, Eva cancelled (`volunteer-plan.ts`).
  race = await seedPlanRace(db, NOW);
  own.kits = (await point({ kind: "add", place: "startFinish", name: "Kituri și numere", km: "", coordinates: "" })).id;
  own.spring = (await point({ kind: "add", place: "route", name: "Izvor", km: "3,4", coordinates: "" })).id;
});

type PointBoxes = { place: string; name: string; km: string; coordinates: string };
/** «Notă pentru voluntari» (§1009), as «Salvează punctul» posts it. */
type NoteBoxes = { volunteerNoteRo?: string; volunteerNoteEn?: string };
function point(request: ({ kind: "add" } & PointBoxes) | ({ kind: "edit"; id: string } & PointBoxes & NoteBoxes) | { kind: "remove"; id: string }) {
  return changePlanPoint(db, staff.MODERATOR!, { ...request, eventId: race.raceId }, NOW);
}
const place = (id: string, checkpointId: string) => changeVolunteer(db, staff.ADMIN!, { kind: "setCheckpoint", eventId: race.raceId, id, checkpointId }, NOW);
const press = (options: { again?: boolean; now?: Date } = {}) => sendVolunteerPoints(db, staff.MODERATOR!, { eventId: race.raceId, again: options.again }, options.now ?? NOW);
/** The question's four numbers, as the page reads them (`readVolunteerPointMail`). */
const preview = async () => (await readVolunteerPointMail(db, staff.MODERATOR!, race.raceId)).counts;

type Payload = { volunteerId: string; checkpointId: string; round: number };
const payloadOf = (row: OutboxRow) => row.payloadJson as Payload;
async function mailOf(volunteerId: string, round = 1): Promise<OutboxRow> {
  const rows = (await db.select().from(emailOutbox).where(eq(emailOutbox.messageType, "VOLUNTEER_POINT")).orderBy(asc(emailOutbox.createdAt))) as OutboxRow[];
  return rows.find((row) => payloadOf(row).volunteerId === volunteerId && payloadOf(row).round === round)!;
}
const render = (row: OutboxRow, now = at(2)) => renderOutboxMessage({ ...row, status: "PROCESSING", lockedAt: now }, db, now);
const halves = (text: string) => text.split("\n— — —\n");
/** The highlighted band of each half, as words. */
const bandsOf = (html: string) => [...html.matchAll(/<div data-email-part="highlight"[^>]*>([^]*?)<\/div>/g)].map((match) => match[1].replace(/<[^>]+>/g, ""));
/** «Unde e punctul» of each half, as the HTML carries it. */
const whereOf = (html: string) => [...html.matchAll(/<p data-email-part="volunteer-point-where"[^>]*>([^]*?)<\/p>/g)].map((match) => match[1]);
const markSent = (id: string) => db.update(emailOutbox).set({ status: "SENT", sentAt: at(1), attemptCount: 1 }).where(eq(emailOutbox.id, id));

describe("§961 a person at the start–finish, and at a route point of the plan's own, is counted and told like anybody at a point", () => {
  it("counts them among the people at a point, writes to them once, and to everybody again only when asked", async () => {
    // Before anybody stands at the plan's own points: the three at the editor's points, Zoe with no address, Radu at none.
    expect(await preview()).toEqual({ toWrite: 3, told: 0, noAddress: 1, unplaced: 1 });
    await place(race.people.radu, own.kits);
    await place(race.people.ion, own.spring);
    // Zoe, who has no address, at the start–finish: at a point with no address, as at any point.
    await place(race.people.zoe, own.kits);
    expect(await preview()).toEqual({ toWrite: 4, told: 0, noAddress: 1, unplaced: 0 });

    expect(await press()).toEqual({ toWrite: 4, told: 0, noAddress: 1, unplaced: 0, queued: 4, again: false });
    expect(payloadOf(await mailOf(race.people.radu))).toMatchObject({ checkpointId: own.kits, round: 1 });
    expect(payloadOf(await mailOf(race.people.ion))).toMatchObject({ checkpointId: own.spring, round: 1 });
    expect((await mailOf(race.people.radu)).recipientEmail).toBe(planAddressOf("Radu Liber"));

    // On their way: all four already told — a second press writes to nobody, «din nou tuturor» to all four.
    expect(await preview()).toEqual({ toWrite: 0, told: 4, noAddress: 1, unplaced: 0 });
    await expect(press()).rejects.toMatchObject({ code: "VOLUNTEER_POINTS_ALL_TOLD" });
    expect(await press({ again: true, now: at(1) })).toMatchObject({ queued: 4, again: true });
    expect(payloadOf(await mailOf(race.people.radu, 2))).toMatchObject({ checkpointId: own.kits, round: 2 });
  });

  it("writes to nobody at a point of another event, whichever kind it is", async () => {
    const elsewhere = (await changePlanPoint(db, staff.ADMIN!, { kind: "add", eventId: race.otherId, place: "startFinish", name: "Kituri", km: "", coordinates: "" }, NOW)).id;
    // The column's foreign key is to any point; the plan's list is what holds a point to its event.
    await db.update(eventVolunteers).set({ checkpointId: elsewhere }).where(eq(eventVolunteers.id, race.people.radu));
    expect(await preview()).toEqual({ toWrite: 3, told: 0, noAddress: 1, unplaced: 1 });
    await press();
    expect(await mailOf(race.people.radu)).toBeUndefined();
  });
});

describe("§961 the message of a person at the start–finish", () => {
  it("says the place by its name, with no number and no kilometre — on the band, under it, in the text and in the HTML, in both languages", async () => {
    await place(race.people.radu, own.kits);
    await press();
    const message = await render(await mailOf(race.people.radu));
    expect(message.to).toBe(planAddressOf("Radu Liber"));
    // The subject names the event and no point: the same as for a point on the route.
    expect(message.subject).toBe("Punctul tău de voluntar la Crosul / Your volunteer point at The cross");

    const [ro, en] = halves(message.text);
    expect(ro).toContain("Salut, Radu Liber,");
    expect(ro).toContain("▶ Ești la start–finish: Kituri și numere");
    expect(ro).toContain("Mulțumim că ne ajuți la Crosul! Organizatorii te-au pus la start–finish: locul tău e cel scris mai sus.");
    // The organizers' own word for the place, as typed: the English half says the same name.
    expect(en).toContain("▶ You are at the start–finish: Kituri și numere");
    expect(en).toContain("Thank you for helping at The cross! The organizers have put you at the start–finish: your place is the one written above.");
    expect(bandsOf(message.html)).toEqual(["Ești la start–finish: Kituri și numere", "You are at the start–finish: Kituri și numere"]);

    for (const whole of [message.text, message.html.replace(/<[^>]+>/g, " ")]) {
      // No number before the name, no kilometre anywhere, and never the route's words.
      expect(whole).not.toMatch(/\d+\.\s*\d+(?:[.,]\d+)?\s*km/);
      expect(whole).not.toMatch(/\bkm\b/);
      expect(whole).not.toMatch(/Punctul tău la Crosul:|Your point at The cross:/);
      expect(whole).not.toMatch(/un punct de pe traseu|a point of the route/);
      expect(whole).not.toMatch(/null|undefined|NaN/);
    }
  });

  it("says everything else as for a point on the route: the event's day and place, the role given and what it asks, the event's page, the plan's picture", async () => {
    await place(race.people.radu, own.kits);
    await place(race.people.ana, own.kits);
    await press();
    const radu = await render(await mailOf(race.people.radu));
    const [ro, en] = halves(radu.text);
    expect(ro).toMatch(/Sâmbătă, 21 nov\. 2026, la 10:00 · Parcul central/);
    expect(en).toMatch(/Saturday, 21 Nov 2026, at 10:00 · Central park/);
    // Radu was given «Punct de hidratare», a role under no category: said, with what it asks, and no contact person.
    expect(ro).toContain("Rolul tău: Punct de hidratare.");
    expect(ro).toContain("Ce presupune rolul: Dai apă alergătorilor.");
    expect(en).toContain("Your role: Water point.");
    expect(radu.text).not.toMatch(/Întrebări despre voluntariat|Questions about volunteering/);
    // Ana's role sits under «Traseu», whose contact person is whom to ask — at the start–finish as on the route.
    const ana = await render(await mailOf(race.people.ana));
    expect(ana.text).toContain("▶ Ești la start–finish: Kituri și numere");
    expect(ana.text).toContain(`Întrebări despre voluntariat? ${PLAN_CONTACT_WORDS}`);
    // She stands with Radu: neither is named to the other.
    expect(ana.text).not.toContain("Radu");
    expect(radu.text).not.toContain("Ana");
    // No picture yet, no coordinates: neither part.
    expect(radu.html).not.toContain('data-email-part="volunteer-plan-picture"');
    expect(whereOf(radu.html)).toEqual([]);

    const [stored] = await db
      .insert(mediaAssets)
      .values({ keyPrefix: ladderKeyPrefixOf(randomUUID()), originalFilename: "harta-cu-puncte.png", width: 2400, height: 1600, byteSize: 1000, createdAt: NOW, lastReferencedAt: NOW })
      .returning();
    await addVolunteerPlanPicture(db, staff.MODERATOR!, { eventId: race.raceId, assetId: stored.id }, at(1));
    const [picture] = (await readVolunteerPlan(db, staff.MODERATOR!, race.raceId)).pictures;
    const withPicture = await render(await mailOf(race.people.radu));
    expect(withPicture.html).toContain(`<img src="${picture!.displayUrl}" alt="Planul voluntarilor desenat pe traseu"`);
    expect(withPicture.text).toContain(`Planul voluntarilor pe traseu, ca poză: ${picture!.fullUrl}`);
  });
});

describe("§961 a point that has coordinates says where it is", () => {
  it("adds the numbers and «Deschide pe hartă» for a start–finish point — in the HTML and in the text, each half in its language", async () => {
    await point({ kind: "edit", id: own.kits, place: "startFinish", name: "Kituri și numere", km: "", coordinates: PIATA_TYPED });
    await place(race.people.radu, own.kits);
    await press();
    const message = await render(await mailOf(race.people.radu));
    expect(mapUrlOf(PIATA)).toBe(PIATA_MAP);

    const [ro, en] = halves(message.text);
    expect(ro).toContain(`Unde e punctul\n45.64271, 25.58871 — Deschide pe hartă: ${PIATA_MAP}`);
    expect(en).toContain(`Where the point is\n45.64271, 25.58871 — Open on the map: ${PIATA_MAP}`);
    // Each half its own words: the Romanian label is not in the English half, nor the English in the Romanian.
    expect(ro).not.toMatch(/Where the point is|Open on the map/);
    expect(en).not.toMatch(/Unde e punctul|Deschide pe hartă/);

    const parts = whereOf(message.html);
    expect(parts).toHaveLength(2);
    const href = PIATA_MAP.replace("&", "&amp;");
    expect(parts[0]).toMatch(new RegExp(`^<strong>Unde e punctul</strong><br>45\\.64271, 25\\.58871 · <a href="${href.replace(/[.?]/g, "\\$&")}" style="color:[^"]+">Deschide pe hartă</a>$`));
    expect(parts[1]).toMatch(new RegExp(`^<strong>Where the point is</strong><br>45\\.64271, 25\\.58871 · <a href="${href.replace(/[.?]/g, "\\$&")}" style="color:[^"]+">Open on the map</a>$`));
    // Under the band that names the place, before the roles.
    expect(ro.indexOf("▶ Ești la start–finish")).toBeLessThan(ro.indexOf("Unde e punctul"));
    expect(ro.indexOf("Unde e punctul")).toBeLessThan(ro.indexOf("Rolul tău"));
    // The link carries the two numbers and nothing of a person.
    for (const personal of ["Radu", "Liber", planAddressOf("Radu Liber"), race.people.radu]) expect(PIATA_MAP).not.toContain(personal);
    expect(message.html.match(/https:\/\/www\.google\.com\/maps\/[^"]*/g)).toEqual([href, href]);
  });

  it("adds them for an editor's point given coordinates on the plan, and for a route point of the plan's own — after the band, before the point's note", async () => {
    // The junction is the event's own public point: its coordinates are typed on the plan's page, and only the plan and the message see them.
    await point({ kind: "edit", id: race.points.junction, place: "route", name: "", km: "", coordinates: "45°38'33.8\"N 25°35'19.4\"E" });
    await point({ kind: "edit", id: own.spring, place: "route", name: "Izvor", km: "3,4", coordinates: "-33.86882, 151.2093" });
    await place(race.people.ion, own.spring);
    await press();

    const ana = await render(await mailOf(race.people.ana));
    const [ro] = halves(ana.text);
    const map = "https://www.google.com/maps/search/?api=1&query=45.642722%2C25.588722";
    expect(ro).toContain("▶ Punctul tău la Crosul: 1. 1,2 km — Intersecția Stejeriș");
    expect(ro).toContain(`Unde e punctul\n45.642722, 25.588722 — Deschide pe hartă: ${map}`);
    expect(ro.indexOf("▶ Punctul tău la Crosul")).toBeLessThan(ro.indexOf("Unde e punctul"));
    expect(ro.indexOf("Unde e punctul")).toBeLessThan(ro.indexOf(`De știut la acest punct\n${PLAN_JUNCTION_NOTE.ro}`));
    expect(ro.indexOf("De știut la acest punct")).toBeLessThan(ro.indexOf("Rolul tău: Direcționare (Traseu)."));
    expect(whereOf(ana.html)).toHaveLength(2);

    // Ion at the plan's own point on the route: numbered in the route's one order, with a place in the southern half.
    const ion = await render(await mailOf(race.people.ion));
    expect(ion.text).toContain("▶ Punctul tău la Crosul: 2. 3,4 km — Izvor");
    expect(ion.text).toContain("▶ Your point at The cross: 2. 3.4 km — Izvor");
    expect(ion.text).toContain("Unde e punctul\n-33.86882, 151.2093 — Deschide pe hartă: https://www.google.com/maps/search/?api=1&query=-33.86882%2C151.2093");
    expect(ion.text).toContain("Mulțumim că ne ajuți la Crosul! Organizatorii te-au pus la un punct de pe traseu: e cel scris mai sus.");
  });

  it("sends the message of a point without coordinates exactly as before: not a word about where, and nothing changed by another point's coordinates", async () => {
    await press();
    const row = await mailOf(race.people.ana);
    const before = await render(row);
    // Nothing of «Unde e punctul» in either half, in the text or the HTML.
    expect(whereOf(before.html)).toEqual([]);
    for (const whole of [before.text, before.html]) expect(whole).not.toMatch(/Unde e punctul|Where the point is|Deschide pe hartă|Open on the map|google\.com\/maps|45\.64271/);
    // What it said before this change, word for word — the band, the note, the role, the words under them.
    const [ro, en] = halves(before.text);
    expect(ro).toContain("▶ Punctul tău la Crosul: 1. 1,2 km — Intersecția Stejeriș");
    expect(ro).toContain(`De știut la acest punct\n${PLAN_JUNCTION_NOTE.ro}`);
    expect(ro).toContain("Rolul tău: Direcționare (Traseu).");
    expect(ro).toContain("Mulțumim că ne ajuți la Crosul! Organizatorii te-au pus la un punct de pe traseu: e cel scris mai sus.");
    expect(ro).toContain("Ora de întâlnire și ce mai e de știut le afli de la organizatori, înainte de eveniment. Dacă nu mai poți veni sau nu găsești punctul, scrie-ne din pagina de contact.");
    expect(en).toContain("▶ Your point at The cross: 1. 1.2 km — Stejeriș junction");
    expect(en).toContain("Thank you for helping at The cross! The organizers have put you at a point of the route: the one written above.");

    // Coordinates typed on other points — the water, the start–finish — leave her message as it was, to the byte.
    await point({ kind: "edit", id: race.points.water, place: "route", name: "", km: "", coordinates: PIATA_TYPED });
    await point({ kind: "edit", id: own.kits, place: "startFinish", name: "Kituri și numere", km: "", coordinates: PIATA_TYPED });
    expect(await render(row)).toEqual(before);
    // Typed on her own point they are said; taken off again, the message is the one it was.
    await point({ kind: "edit", id: race.points.junction, place: "route", name: "", km: "", coordinates: PIATA_TYPED });
    expect(whereOf((await render(row)).html)).toHaveLength(2);
    await point({ kind: "edit", id: race.points.junction, place: "route", name: "", km: "", coordinates: "" });
    expect(await render(row)).toEqual(before);
  });
});

/*
  §1009, BR-REQ-080-02, BR-REQ-050-02 — «Notă pentru voluntari» in «Punctul tău de voluntar» (the owner, 2026-11-19: «si am nevoie de
  un nou field "noua pentru voluntari"»): the point's note for the people standing at it, its own paragraph right under the band
  that names the point, each half in its own language — and nothing at all for a point that has none.
*/
describe("§1009 the message says the point's «Notă pentru voluntari»", () => {
  const NOTE = { ro: "Direcționați spre stânga la intersecție.\nPurtați vesta reflectorizantă.", en: "Send the runners left at the junction.\nWear the reflective vest." };
  /** «Notă pentru voluntari» of each half, as the HTML carries it. */
  const notesOf = (html: string) => [...html.matchAll(/<p data-email-part="volunteer-point-note"[^>]*>([^]*?)<\/p>/g)].map((match) => match[1]);
  const writeNote = (id: string, note: { ro: string; en: string } = NOTE) =>
    point({ kind: "edit", id, place: "route", name: "", km: "", coordinates: "", volunteerNoteRo: note.ro, volunteerNoteEn: note.en });

  it("says it as its own paragraph under the band, in both halves — the person's language first —, its line breaks kept, in the text and in the HTML", async () => {
    await writeNote(race.points.junction);
    await press();
    // Ana, Romanian: the Romanian half first.
    const ana = await render(await mailOf(race.people.ana));
    const [ro, en] = halves(ana.text);
    expect(ro).toContain(`Notă pentru voluntari: ${NOTE.ro}`);
    expect(en).toContain(`Note for the volunteers: ${NOTE.en}`);
    // Each half its own words alone.
    expect(ro).not.toMatch(/Note for the volunteers|Send the runners/);
    expect(en).not.toMatch(/Notă pentru voluntari|Direcționați/);
    // Right under the band, before where the point is said, the point's own public note and the roles.
    expect(ro.indexOf("▶ Punctul tău la Crosul: 1. 1,2 km — Intersecția Stejeriș")).toBeLessThan(ro.indexOf("Notă pentru voluntari"));
    expect(ro.indexOf("Notă pentru voluntari")).toBeLessThan(ro.indexOf(`De știut la acest punct\n${PLAN_JUNCTION_NOTE.ro}`));
    expect(ro.indexOf("Notă pentru voluntari")).toBeLessThan(ro.indexOf("Rolul tău: Direcționare (Traseu)."));
    expect(en.indexOf("▶ Your point at The cross")).toBeLessThan(en.indexOf("Note for the volunteers"));
    // The HTML: one paragraph a half, the label in bold, the line break a <br>.
    expect(notesOf(ana.html)).toEqual([
      "<strong>Notă pentru voluntari:</strong> Direcționați spre stânga la intersecție.<br>Purtați vesta reflectorizantă.",
      "<strong>Note for the volunteers:</strong> Send the runners left at the junction.<br>Wear the reflective vest.",
    ]);
    // Dan, English, at another point with no note — and Radu nowhere: his message says nothing of one.
    const dan = await render(await mailOf(race.people.dan));
    expect(notesOf(dan.html)).toEqual([]);
    for (const whole of [dan.text, dan.html]) expect(whole).not.toMatch(/Notă pentru voluntari|Note for the volunteers|Direcționați|Send the runners/);
  });

  it("puts an English volunteer's half first, says the note of a start–finish point and a route point of the plan's own, and escapes what was typed", async () => {
    await place(race.people.dan, own.kits);
    await place(race.people.ion, own.spring);
    await point({ kind: "edit", id: own.kits, place: "startFinish", name: "Kituri și numere", km: "", coordinates: PIATA_TYPED, volunteerNoteRo: "Kiturile sunt în cutii <albastre> & numerotate.", volunteerNoteEn: "The kits are in <blue> boxes & numbered." });
    await point({ kind: "edit", id: own.spring, place: "route", name: "Izvor", km: "3,4", coordinates: "", volunteerNoteRo: "Apă la izvor.", volunteerNoteEn: "Water at the spring." });
    await press();
    const dan = await render(await mailOf(race.people.dan));
    const [first, second] = halves(dan.text);
    expect(first).toContain("Note for the volunteers: The kits are in <blue> boxes & numbered.");
    expect(second).toContain("Notă pentru voluntari: Kiturile sunt în cutii <albastre> & numerotate.");
    // Under the band, before «Unde e punctul».
    expect(first.indexOf("▶ You are at the start–finish: Kituri și numere")).toBeLessThan(first.indexOf("Note for the volunteers"));
    expect(first.indexOf("Note for the volunteers")).toBeLessThan(first.indexOf("Where the point is"));
    // Plain text in the HTML, never markup: what was typed is escaped.
    expect(notesOf(dan.html)).toEqual([
      "<strong>Note for the volunteers:</strong> The kits are in &lt;blue&gt; boxes &amp; numbered.",
      "<strong>Notă pentru voluntari:</strong> Kiturile sunt în cutii &lt;albastre&gt; &amp; numerotate.",
    ]);
    const ion = await render(await mailOf(race.people.ion));
    expect(ion.text).toContain("Notă pentru voluntari: Apă la izvor.");
    expect(ion.text).toContain("Note for the volunteers: Water at the spring.");
  });

  it("says the note as it stands when the message leaves: written, changed or taken off since the press", async () => {
    await press();
    const row = await mailOf(race.people.ana);
    const before = await render(row);
    expect(notesOf(before.html)).toEqual([]);
    // Written after the press, before the send: the message carries it.
    await writeNote(race.points.junction);
    expect(halves((await render(row)).text)[0]).toContain(`Notă pentru voluntari: ${NOTE.ro}`);
    // Changed: the new words.
    await writeNote(race.points.junction, { ro: "Altă notă.", en: "Another note." });
    const changed = await render(row);
    expect(changed.text).toContain("Notă pentru voluntari: Altă notă.");
    expect(changed.text).not.toContain("Direcționați");
    // Taken off: the message is the one it was, to the byte.
    await writeNote(race.points.junction, { ro: "", en: "" });
    expect(await render(row)).toEqual(before);
    // Changed since §NNN: a changed note un-tells whoever was told by a message that LEFT before it — but these still wait, and
    // say the note as it is when they leave, so nobody is to write again.
    expect(await preview()).toMatchObject({ toWrite: 0, told: 3 });
  });
});

describe("§961 the point as it stands when the message leaves", () => {
  it("hands the template the plan's own number — or none —, the kind and the coordinates, read from the plan's one list", async () => {
    await point({ kind: "edit", id: own.kits, place: "startFinish", name: "Kituri și numere", km: "", coordinates: PIATA_TYPED });
    await place(race.people.radu, own.kits);
    await place(race.people.ion, own.spring);
    await press();
    const plan = await readVolunteerPlan(db, staff.MODERATOR!, race.raceId);
    const numberOf = (id: string) => plan.points.find(({ point: one }) => one.id === id)!.number;

    expect(await volunteerPointAtSend(db, await mailOf(race.people.radu))).toMatchObject({ number: null, nameRo: "Kituri și numere", nameEn: "Kituri și numere", startFinish: true, coordinates: PIATA, noteRo: null, noteEn: null });
    expect(numberOf(own.kits)).toBeNull();
    // «Izvor» at 3.4 stands between the junction and the water: the route's second point, and the water its third.
    expect(await volunteerPointAtSend(db, await mailOf(race.people.ion))).toMatchObject({ number: 2, nameRo: "Izvor", km: 3.4, startFinish: false, coordinates: null });
    expect(numberOf(own.spring)).toBe(2);
    expect(await volunteerPointAtSend(db, await mailOf(race.people.dan))).toMatchObject({ number: 3, nameRo: "Apă la cabană", km: 5.5, startFinish: false, coordinates: null });
    expect(numberOf(race.points.water)).toBe(3);
    expect((await render(await mailOf(race.people.dan))).text).toContain("▶ Your point at The cross: 3. 5.5 km — Water at the hut");
  });

  it("says a point moved between the kinds, renamed or given coordinates since the press as it is when the message leaves", async () => {
    await place(race.people.radu, own.spring);
    await press();
    const row = await mailOf(race.people.radu);
    expect((await render(row)).text).toContain("▶ Punctul tău la Crosul: 2. 3,4 km — Izvor");

    // Moved to the start–finish, renamed and given coordinates before the send: the message says what is true when it leaves.
    await point({ kind: "edit", id: own.spring, place: "startFinish", name: "Linia de sosire", km: "3,4", coordinates: PIATA_TYPED });
    const moved = await render(row);
    expect(moved.text).toContain("▶ Ești la start–finish: Linia de sosire");
    expect(moved.text).toContain(`Unde e punctul\n45.64271, 25.58871 — Deschide pe hartă: ${PIATA_MAP}`);
    expect(moved.text).not.toMatch(/Izvor|3,4 km|Punctul tău la Crosul:/);

    // Back on the route, further along: numbered where it stands now.
    await point({ kind: "edit", id: own.spring, place: "route", name: "Linia de sosire", km: "9,9", coordinates: "" });
    const back = await render(row);
    expect(back.text).toContain("▶ Punctul tău la Crosul: 4. 9,9 km — Linia de sosire");
    expect(whereOf(back.html)).toEqual([]);
  });

  it("withdraws the message of a person whose point of the plan's own was deleted: they stand at no point", async () => {
    await place(race.people.radu, own.kits);
    await press();
    const row = await mailOf(race.people.radu);
    expect(await point({ kind: "remove", id: own.kits })).toMatchObject({ outcome: "removed", freed: 1 });
    await expect(render(row)).rejects.toBeInstanceOf(OutboxMessageWithdrawn);
    // Nobody is told by the point going: the next press finds Radu at no point, and writes him nothing.
    expect(await preview()).toMatchObject({ unplaced: 1 });
  });
});

describe("§961 who already knows their point is not changed by its coordinates", () => {
  it("keeps a person told before the coordinates were typed as told; «Trimite din nou tuturor» is how the place is sent", async () => {
    await place(race.people.radu, own.kits);
    await press();
    for (const person of [race.people.ana, race.people.dan, race.people.ion, race.people.radu]) await markSent((await mailOf(person)).id);
    expect(await preview()).toEqual({ toWrite: 0, told: 4, noAddress: 1, unplaced: 0 });

    // The place typed afterwards, on a point of each kind — and a point renamed and moved along the route.
    await point({ kind: "edit", id: own.kits, place: "startFinish", name: "Kituri și numere", km: "", coordinates: PIATA_TYPED });
    await point({ kind: "edit", id: race.points.junction, place: "route", name: "", km: "", coordinates: PIATA_TYPED });
    await point({ kind: "edit", id: own.spring, place: "route", name: "Izvorul rece", km: "4", coordinates: PIATA_TYPED });
    expect(await preview()).toEqual({ toWrite: 0, told: 4, noAddress: 1, unplaced: 0 });
    await expect(press({ now: at(3) })).rejects.toMatchObject({ code: "VOLUNTEER_POINTS_ALL_TOLD" });

    // «Din nou tuturor»: everybody at a point is written to again, and this time the message says where.
    expect(await press({ again: true, now: at(4) })).toMatchObject({ queued: 4, again: true });
    const again = await render(await mailOf(race.people.radu, 2), at(5));
    expect(again.text).toContain(`Unde e punctul\n45.64271, 25.58871 — Deschide pe hartă: ${PIATA_MAP}`);
    expect((await render(await mailOf(race.people.ana, 2), at(5))).text).toContain(`Unde e punctul\n45.64271, 25.58871 — Deschide pe hartă: ${PIATA_MAP}`);
  });

  it("is said where the organizers read it: the page's line when everybody is told names the coordinates, and the message's «?» that one text goes to both kinds", () => {
    // «Trimite» shipped before the coordinates did: an organizer who types them after a first send reads that it is worth sending again.
    expect(ro.Admin.volunteers.plan.mail.allTold).toContain("coordonatele");
    expect(en.Admin.volunteers.plan.mail.allTold).toContain("coordinates");
    // A text the club writes for «Punctul tău» under «Emailuri» goes to the start–finish and to the route alike: its «?» says so.
    expect(ro.Admin.emails.whenMore.VOLUNTEER_POINT).toContain("Textul e același la start–finish și pe traseu");
    expect(en.Admin.emails.whenMore.VOLUNTEER_POINT).toContain("The text is the same at the start–finish and on the route");
  });
});

/*
  §NNN (amending §1009 and §961's rule for the note), BR-REQ-080-02 — a changed «Notă pentru voluntari» re-tells that point's people at
  the next ordinary press: whoever was told the point by a message that left before the note last changed — written, changed in
  either language, taken off — is «de anunțat» again, and «Trimite fiecăruia punctul lui» writes to them (and to whoever was not told
  anyway), each with their next telling. A message still waiting, a save that leaves the words as they were, a name, a kilometre or
  coordinates changed, and another point's note change nobody.
*/
describe("§NNN a changed note is told again at the next ordinary press", () => {
  const NOTE = { ro: "Direcționați spre stânga la intersecție.", en: "Send the runners left at the junction." };
  /** A note written on a point at an instant of the test's clock (the save's own `now`). */
  const noteAt = (id: string, minutes: number, note: { ro: string; en: string } = NOTE, boxes: Partial<PointBoxes> = {}) =>
    changePlanPoint(db, staff.MODERATOR!, { kind: "edit", eventId: race.raceId, id, place: "route", name: "", km: "", coordinates: "", volunteerNoteRo: note.ro, volunteerNoteEn: note.en, ...boxes }, at(minutes));
  /** Every queued message marked as left, at an instant of the test's clock. */
  const allSentAt = async (minutes: number) =>
    db.update(emailOutbox).set({ status: "SENT", sentAt: at(minutes), attemptCount: 1 }).where(and(eq(emailOutbox.messageType, "VOLUNTEER_POINT"), eq(emailOutbox.status, "PENDING")));
  const pointMail = () => readVolunteerPointMail(db, staff.MODERATOR!, race.raceId);
  /** Every telling queued, as «ana:2» — the person, the round, and «:resend» for a resend by hand —, sorted: rows of one instant have no order. */
  const rounds = async () => {
    const names = new Map(Object.entries(race.people).map(([name, id]) => [id, name]));
    return (await db.select().from(emailOutbox).where(eq(emailOutbox.messageType, "VOLUNTEER_POINT")))
      .map((row) => `${names.get(payloadOf(row as OutboxRow).volunteerId)}:${payloadOf(row as OutboxRow).round}${row.isManualResend ? ":resend" : ""}`)
      .sort();
  };

  it("makes whoever was told the point before its note changed «de anunțat» again, and the next ordinary press writes to them alone", async () => {
    // Ana at the junction, Dan at the water, Ion at the bridge: told, the messages gone at minute 1.
    await press();
    await allSentAt(1);
    expect(await preview()).toEqual({ toWrite: 0, told: 3, noAddress: 1, unplaced: 1 });
    expect((await pointMail()).toldBeforeTheNote).toEqual(new Map());

    // The junction's note written at minute 5: Ana was told before it; Zoe, there with no address, is the organizers' as ever.
    await noteAt(race.points.junction, 5);
    expect(await preview()).toEqual({ toWrite: 1, told: 2, noAddress: 1, unplaced: 1 });
    expect((await pointMail()).toldBeforeTheNote).toEqual(new Map([[race.points.junction, 1]]));

    // The ordinary press: Ana's second telling, and nobody else's — no «din nou tuturor» asked.
    expect(await press({ now: at(6) })).toEqual({ toWrite: 1, told: 2, noAddress: 1, unplaced: 1, queued: 1, again: false });
    expect(await rounds()).toEqual(["ana:1", "ana:2", "dan:1", "ion:1"]);
    // On its way, she is told; and what leaves says the new note.
    expect(await preview()).toEqual({ toWrite: 0, told: 3, noAddress: 1, unplaced: 1 });
    expect((await pointMail()).toldBeforeTheNote).toEqual(new Map());
    expect((await render(await mailOf(race.people.ana, 2), at(7))).text).toContain(`Notă pentru voluntari: ${NOTE.ro}`);
    // Gone too, at minute 7, after the note: told, and a press writes to nobody.
    await allSentAt(7);
    await expect(press({ now: at(8) })).rejects.toMatchObject({ code: "VOLUNTEER_POINTS_ALL_TOLD" });
  });

  it("re-tells for a note changed in either language and for a note taken off, each a telling of its own", async () => {
    await noteAt(race.points.junction, 0);
    await press({ now: at(1) });
    await allSentAt(2);
    expect(await preview()).toMatchObject({ toWrite: 0, told: 3 });
    // The English half alone.
    await noteAt(race.points.junction, 3, { ro: NOTE.ro, en: "Send the runners right at the junction." });
    expect((await pointMail()).toldBeforeTheNote).toEqual(new Map([[race.points.junction, 1]]));
    expect(await press({ now: at(4) })).toMatchObject({ queued: 1 });
    await allSentAt(5);
    expect(await preview()).toMatchObject({ toWrite: 0, told: 3 });
    // Taken off: told it again too — the point, with no note now.
    await noteAt(race.points.junction, 6, { ro: "", en: "" });
    expect(await preview()).toMatchObject({ toWrite: 1, told: 2 });
    expect((await pointMail()).toldBeforeTheNote).toEqual(new Map([[race.points.junction, 1]]));
    expect(await press({ now: at(7) })).toMatchObject({ queued: 1 });
    expect((await rounds()).filter((one) => one.startsWith("ana:"))).toEqual(["ana:1", "ana:2", "ana:3"]);
    expect(notesOfMail((await render(await mailOf(race.people.ana, 3), at(8))).text)).toEqual([]);
  });

  it("keeps told whoever was told after the note changed, and whoever has a message still waiting — it says the note as it leaves", async () => {
    // Written first, told after: told.
    await noteAt(race.points.junction, 0);
    await press({ now: at(1) });
    await allSentAt(2);
    expect(await preview()).toMatchObject({ toWrite: 0, told: 3 });
    // Pressed, not gone yet, and the note changed meanwhile: still told — the message is drawn when it leaves.
    await noteAt(race.points.water, 3);
    expect(await preview()).toMatchObject({ toWrite: 1, told: 2 });
    await press({ now: at(4) });
    await noteAt(race.points.water, 5, { ro: "Paharele pe masa a doua.", en: "The cups on the second table." });
    expect(await preview()).toMatchObject({ toWrite: 0, told: 3 });
    expect((await pointMail()).toldBeforeTheNote).toEqual(new Map());
    expect((await render(await mailOf(race.people.dan, 2), at(6))).text).toContain("Notă pentru voluntari: Paharele pe masa a doua.");
    // …and gone after the change: told.
    await allSentAt(6);
    expect(await preview()).toMatchObject({ toWrite: 0, told: 3 });
  });

  it("changes nobody for a save that leaves the words as they were, for a name, a kilometre or coordinates — and another point's people are not touched", async () => {
    await place(race.people.radu, own.spring);
    await noteAt(race.points.junction, 0);
    await noteAt(own.spring, 0, NOTE, { name: "Izvor", km: "3,4" });
    await press({ now: at(1) });
    await allSentAt(2);
    expect(await preview()).toEqual({ toWrite: 0, told: 4, noAddress: 1, unplaced: 0 });
    // The same words, as a browser posts them; then the point's name, kilometre and coordinates.
    await noteAt(race.points.junction, 3, { ro: ` ${NOTE.ro} `, en: NOTE.en });
    await noteAt(own.spring, 4, NOTE, { name: "Izvorul rece", km: "4,5", coordinates: PIATA_TYPED });
    await changePlanPoint(db, staff.MODERATOR!, { kind: "edit", eventId: race.raceId, id: race.points.water, place: "route", name: "", km: "", coordinates: PIATA_TYPED }, at(5));
    expect(await preview()).toEqual({ toWrite: 0, told: 4, noAddress: 1, unplaced: 0 });
    // The water's note changed: Dan alone is to write — Ana at the junction, Ion at the bridge and Radu at the spring stay told.
    await noteAt(race.points.water, 6);
    expect(await preview()).toEqual({ toWrite: 1, told: 3, noAddress: 1, unplaced: 0 });
    expect((await pointMail()).toldBeforeTheNote).toEqual(new Map([[race.points.water, 1]]));
    expect(await press({ now: at(7) })).toMatchObject({ queued: 1 });
    expect((await rounds()).filter((one) => !one.endsWith(":1"))).toEqual(["dan:2"]);
  });

  it("counts a point's people told before its note apart from those never told, and «Trimite din nou tuturor» still writes to everybody", async () => {
    await press();
    await allSentAt(1);
    // Radu placed at the junction after the send: never told. Then the junction's note changes.
    await place(race.people.radu, race.points.junction);
    await noteAt(race.points.junction, 2);
    expect(await preview()).toEqual({ toWrite: 2, told: 2, noAddress: 1, unplaced: 0 });
    // The line under the note counts Ana alone: Radu was told nothing, old or new.
    expect((await pointMail()).toldBeforeTheNote).toEqual(new Map([[race.points.junction, 1]]));
    // «Din nou tuturor»: everybody at a point, those still to write as first-hand messages, those told as resends.
    expect(await press({ now: at(3), again: true })).toMatchObject({ queued: 4, again: true });
    expect(await rounds()).toEqual(["ana:1", "ana:2", "dan:1", "dan:2:resend", "ion:1", "ion:2:resend", "radu:1"]);
  });

  it("is refused to anybody who does not work the volunteers, like the four numbers", async () => {
    for (const role of ["MEMBER", "CONTRIBUTOR", "COPYWRITER", "DEV"] as const) {
      await expect(readVolunteerPointMail(db, { role }, race.raceId), role).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    await expect(readVolunteerPointMail(db, staff.MODERATOR!, "not-an-id")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

/** «Notă pentru voluntari» lines of a message's plain text. */
const notesOfMail = (text: string) => text.split("\n").filter((line) => /^(Notă pentru voluntari|Note for the volunteers):/.test(line));
