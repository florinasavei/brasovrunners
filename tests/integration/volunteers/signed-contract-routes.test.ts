import { createElement, type ReactNode } from "react";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { eventVolunteerDocuments } from "@/db/schema/event-volunteer-documents";
import { eventVolunteers } from "@/db/schema/event-volunteers";
import { events } from "@/db/schema/events";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import type { StaffRole } from "@/modules/staff-identity/domain/roles";
import { DomainError } from "@/shared/errors/domain-error";
import { decodeFlash, FLASH_COOKIE } from "@/shared/feedback/notice";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";
import { SAMPLE_FILES } from "../../helpers/signed-contract-files";

/**
 * «Contract semnat» (§NNN), the two routes, BR-REQ-060-01 and BR-REQ-050-02: the volunteer's own — `GET` the download, `POST` the
 * upload, whole or in pieces — and the event's «Încarcă contractele semnate». Every route asks the session and the role again
 * (401 without one, 403 for every role but the Organizer's and the Administrators'), answers 404 for another event's person or a
 * malformed id, and writes nothing when it refuses. The download is an attachment under the file's name made safe, typed by its
 * format, never sniffed and never cached. With scripts off a form comes back to its page (303) with the toast in the flash cookie
 * — counts, never a name — and a refusal's code in the address.
 */
const state = vi.hoisted(() => ({ db: undefined as unknown, actor: undefined as unknown, cookies: [] as Array<[string, string]> }));

vi.mock("@/db/client", () => ({ getDb: () => state.db }));
vi.mock("@/modules/staff-identity/session", () => ({
  DEV_STAFF_COOKIE: "dev-staff",
  requireStaff: async () => {
    if (!state.actor) throw new DomainError("UNAUTHENTICATED", "no staff session");
    return state.actor;
  },
  requireStaffCapability: async () => state.actor,
}));
// The jar keeps what a route writes: the flash is how a form that comes back says what it did.
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, set: (name: string, value: string) => void state.cookies.push([name, value]), delete: () => {} }),
  headers: async () => new Headers(),
}));
vi.mock("@/i18n/navigation", () => {
  type Href = string | { pathname: string; params?: Record<string, string> };
  const hrefOf = (locale: string, href: Href) => {
    if (typeof href === "string") return `/${locale}${href}`;
    let path = href.pathname;
    for (const [key, value] of Object.entries(href.params ?? {})) path = path.replace(`[${key}]`, value);
    return `/${locale}${path}`;
  };
  return {
    getPathname: ({ locale, href }: { locale: string; href: Href }) => hrefOf(locale, href),
    Link: ({ href, children }: { href: Href; children?: ReactNode }) => createElement("a", { href: hrefOf("ro", href) }, children),
  };
});

const one = await import("@/app/api/admin/events/[id]/volunteers/[volunteerId]/signed-contract/route");
const many = await import("@/app/api/admin/events/[id]/volunteers/signed-contracts/route");

const NOW = new Date("2026-11-19T10:00:00.000Z");
const DAY = 24 * 60 * 60_000;

let db: TestDatabase;
let close: () => Promise<void>;
const staff: Partial<Record<StaffRole, StaffUser>> = {};
let raceId: string;
let otherId: string;
let anais: string;
let tampu: string;
let other: string;

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
  state.db = db;
});
afterAll(async () => close());

beforeEach(async () => {
  await resetTables(db);
  state.actor = undefined;
  state.cookies.length = 0;
  for (const role of ["MEMBER", "CONTRIBUTOR", "COPYWRITER", "MODERATOR", "DEV", "ADMIN", "SUPERADMIN"] as const) {
    [staff[role]] = await db.insert(staffUsers).values({ email: `${role.toLowerCase()}@example.test`, displayName: `Coleg ${role}`, role }).returning();
  }
  const [race, second] = await db
    .insert(events)
    .values([
      { type: "RACE", startsAt: new Date(NOW.getTime() + 2 * DAY), acceptsVolunteers: true },
      { type: "RACE", startsAt: new Date(NOW.getTime() + 9 * DAY), acceptsVolunteers: true },
    ])
    .returning({ id: events.id });
  raceId = race.id;
  otherId = second.id;
  const person = async (eventId: string, name: string) =>
    (await db.insert(eventVolunteers).values({ eventId, name, source: "STAFF", state: "CONFIRMED", createdAt: NOW, updatedAt: NOW }).returning({ id: eventVolunteers.id }))[0].id;
  anais = await person(raceId, "Anaïs Meyson");
  tampu = await person(raceId, "Țâmpu Elena");
  other = await person(otherId, "Ilie Vasile");
});

const documents = () => db.select().from(eventVolunteerDocuments);
const trail = () => db.select().from(auditLogs);
const params = (id: string, volunteerId: string) => ({ params: Promise.resolve({ id, volunteerId }) });

function upload(fields: Record<string, string | File>, actor: StaffUser | undefined, at: { id?: string; volunteerId?: string } = {}) {
  state.actor = actor;
  const body = new FormData();
  for (const [name, value] of Object.entries(fields)) body.append(name, value);
  const id = at.id ?? raceId;
  const volunteerId = at.volunteerId ?? anais;
  return one.POST(new Request(`https://example.test/api/admin/events/${id}/volunteers/${volunteerId}/signed-contract`, { method: "POST", body }), params(id, volunteerId));
}
const file = (bytes: Uint8Array, name: string) => new File([new Uint8Array(bytes)], name);
function download(actor: StaffUser | undefined, at: { id?: string; volunteerId?: string } = {}) {
  state.actor = actor;
  const id = at.id ?? raceId;
  const volunteerId = at.volunteerId ?? anais;
  return one.GET(new Request(`https://example.test/api/admin/events/${id}/volunteers/${volunteerId}/signed-contract`), params(id, volunteerId));
}
function bulk(fields: Array<[string, string | File]>, actor: StaffUser | undefined, id = raceId) {
  state.actor = actor;
  const body = new FormData();
  for (const [name, value] of fields) body.append(name, value);
  return many.POST(new Request(`https://example.test/api/admin/events/${id}/volunteers/signed-contracts`, { method: "POST", body }), { params: Promise.resolve({ id }) });
}
const toast = () => decodeFlash(state.cookies.find(([name]) => name === FLASH_COOKIE)?.[1]);

describe("§NNN the volunteer's route: the download", () => {
  it("sends the file as an attachment under its own name made safe, typed by its format, never sniffed, never cached", async () => {
    const bytes = SAMPLE_FILES.docx();
    await upload({ answer: "json", file: file(bytes, "Contract-voluntariat-Anaïs-Meyson.docx") }, staff.ADMIN);
    for (const role of ["MODERATOR", "ADMIN", "SUPERADMIN"] as const) {
      const response = await download(staff[role]);
      expect(response.status, role).toBe(200);
      expect(response.headers.get("content-type")).toBe("application/vnd.openxmlformats-officedocument.wordprocessingml.document");
      const disposition = response.headers.get("content-disposition") ?? "";
      expect(disposition.startsWith("attachment;")).toBe(true);
      expect(disposition).toContain('filename="Contract-voluntariat-Anais-Meyson.docx"');
      expect(disposition).toContain(`filename*=UTF-8''${encodeURIComponent("Contract-voluntariat-Anaïs-Meyson.docx")}`);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(response.headers.get("x-content-type-options")).toBe("nosniff");
      expect(response.headers.get("content-length")).toBe(String(bytes.length));
      expect(Buffer.compare(Buffer.from(await response.arrayBuffer()), bytes)).toBe(0);
    }
    const downloads = (await trail()).filter((row) => row.action === "volunteer.signed_contract_downloaded");
    expect(downloads).toHaveLength(3);
    expect(JSON.stringify(downloads.map((row) => row.metadataJson))).not.toContain("Meyson");
  });

  it("adds the format's extension when the name does not say what the bytes are", async () => {
    await upload({ answer: "json", file: file(SAMPLE_FILES.jpeg(), "contract.pdf") }, staff.ADMIN);
    const response = await download(staff.ADMIN);
    expect(response.headers.get("content-type")).toBe("image/jpeg");
    expect(response.headers.get("content-disposition")).toContain('filename="contract.pdf.jpg"');
  });

  it("refuses a stranger (401), every other role (403), and answers 404 for no file, another event's person and a malformed id — writing nothing", async () => {
    expect((await download(staff.ADMIN)).status).toBe(404);
    await upload({ answer: "json", file: file(SAMPLE_FILES.pdf(), "a.pdf") }, staff.ADMIN);
    const before = (await trail()).length;
    expect((await download(undefined)).status).toBe(401);
    for (const role of ["DEV", "COPYWRITER", "CONTRIBUTOR", "MEMBER"] as const) expect((await download(staff[role])).status, role).toBe(403);
    expect((await download(staff.ADMIN, { id: otherId })).status).toBe(404);
    expect((await download(staff.ADMIN, { volunteerId: "not-an-id" })).status).toBe(404);
    expect((await download(staff.ADMIN, { id: "not-an-id" })).status).toBe(404);
    expect((await trail()).length).toBe(before);
  });
});

describe("§NNN the volunteer's route: the upload", () => {
  it("with scripts off, attaches and comes back to the person's card with the toast; a replace says so", async () => {
    const first = await upload({ locale: "ro", file: file(SAMPLE_FILES.pdf(), "Contract-voluntariat-Anais-Meyson.pdf") }, staff.MODERATOR);
    expect(first.status).toBe(303);
    expect(first.headers.get("location")).toBe(`/ro/admin/volunteers/${anais}#contract-semnat`);
    expect(toast()).toMatchObject({ kind: "success", key: "volunteerContractUploaded" });
    state.cookies.length = 0;
    const again = await upload({ locale: "en", file: file(SAMPLE_FILES.png(), "scan.png") }, staff.MODERATOR);
    expect(again.headers.get("location")).toBe(`/en/admin/volunteers/${anais}#contract-semnat`);
    expect(toast()).toMatchObject({ key: "volunteerContractReplaced" });
    expect(await documents()).toHaveLength(1);
    // The flash carries a key and no name.
    expect(JSON.stringify(state.cookies)).not.toContain("scan");
  });

  it("with scripts off, a refusal comes back with its code in the address, and nothing written", async () => {
    const refused = await upload({ locale: "ro", file: file(SAMPLE_FILES.exe(), "Contract-voluntariat-Anais-Meyson.pdf") }, staff.ADMIN);
    expect(refused.status).toBe(303);
    expect(refused.headers.get("location")).toBe(`/ro/admin/volunteers/${anais}?volunteerError=VOLUNTEER_CONTRACT_TYPE`);
    const nothing = await upload({ locale: "ro", file: file(new Uint8Array(), "") }, staff.ADMIN);
    expect(nothing.headers.get("location")).toBe(`/ro/admin/volunteers/${anais}?volunteerError=VOLUNTEER_CONTRACT_EMPTY`);
    expect(await documents()).toEqual([]);
    expect(toast()).toBeNull();
  });

  it("answers a script in JSON: the stored facts, or the refusal's code with its status", async () => {
    const stored = await upload({ answer: "json", file: file(SAMPLE_FILES.heic(), "IMG_0001.HEIC") }, staff.ADMIN);
    expect(stored.status).toBe(201);
    expect(stored.headers.get("cache-control")).toBe("private, no-store");
    expect(await stored.json()).toEqual({ done: true, replaced: false, format: "HEIC", size: SAMPLE_FILES.heic().length });
    const type = await upload({ answer: "json", file: file(SAMPLE_FILES.html(), "contract.pdf") }, staff.ADMIN);
    expect([type.status, await type.json()]).toEqual([415, { error: "VOLUNTEER_CONTRACT_TYPE" }]);
    const elsewhere = await upload({ answer: "json", file: file(SAMPLE_FILES.pdf(), "a.pdf") }, staff.ADMIN, { volunteerId: other });
    expect([elsewhere.status, await elsewhere.json()]).toEqual([404, { error: "NOT_FOUND" }]);
  });

  it("takes a large file in pieces through the same route: the first answers the upload's id, the last the stored facts", async () => {
    const whole = Buffer.concat([SAMPLE_FILES.pdf(), Buffer.alloc(3000, 0x20)]);
    const name = "Contract-voluntariat-Anais-Meyson.pdf";
    const piece = (from: number, to: number) => file(whole.subarray(from, to), name);
    const first = await upload({ answer: "json", size: String(whole.length), offset: "0", name, file: piece(0, 1500) }, staff.MODERATOR);
    expect(first.status).toBe(202);
    const started = (await first.json()) as { done: boolean; uploadId: string; received: number };
    expect(started).toMatchObject({ done: false, received: 1500 });
    const second = await upload({ answer: "json", size: String(whole.length), offset: "1500", name, upload: started.uploadId, file: piece(1500, whole.length) }, staff.MODERATOR);
    expect(second.status).toBe(201);
    expect(await second.json()).toEqual({ done: true, replaced: false, format: "PDF", size: whole.length });
    const [row] = await documents();
    expect(row.fileName).toBe(name);
    expect(Buffer.compare(row.bytes, whole)).toBe(0);
    // A piece sent again once the file is whole: its upload is gone.
    const late = await upload({ answer: "json", size: String(whole.length), offset: "1500", name, upload: started.uploadId, file: piece(1500, whole.length) }, staff.MODERATOR);
    expect([late.status, await late.json()]).toEqual([409, { error: "VOLUNTEER_CONTRACT_UPLOAD_GONE" }]);
  });

  it("refuses a stranger and every other role before reading a byte, and a body past one file at the limit unread", async () => {
    expect((await upload({ answer: "json", file: file(SAMPLE_FILES.pdf(), "a.pdf") }, undefined)).status).toBe(401);
    for (const role of ["DEV", "COPYWRITER", "CONTRIBUTOR", "MEMBER"] as const) expect((await upload({ answer: "json", file: file(SAMPLE_FILES.pdf(), "a.pdf") }, staff[role])).status, role).toBe(403);
    state.actor = staff.ADMIN;
    const huge = await one.POST(
      new Request(`https://example.test/api/admin/events/${raceId}/volunteers/${anais}/signed-contract`, { method: "POST", headers: { "content-length": String(64 * 1024 * 1024), "content-type": "multipart/form-data; boundary=x" }, body: "--x--" }),
      params(raceId, anais),
    );
    expect(huge.status).toBe(413);
    expect(await documents()).toEqual([]);
    expect(await trail()).toEqual([]);
  });
});

describe("§NNN the event's route: «Încarcă contractele semnate»", () => {
  it("with scripts, matches the names alone to this event's volunteers and answers each one's match or reason", async () => {
    const response = await bulk(
      [
        ["answer", "json"],
        ["names", "Contract-voluntariat-Anais-Meyson.docx"],
        ["names", "Contract-voluntariat-Tampu-Elena.docx"],
        ["names", "Contract-voluntariat-Ilie-Vasile.docx"],
      ],
      staff.MODERATOR,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      matches: [
        { kind: "matched", volunteerId: anais },
        { kind: "matched", volunteerId: tampu },
        { kind: "refused", reason: "noMatch" },
      ],
    });
    expect(await documents()).toEqual([]);
  });

  it("with scripts off, attaches every matched file, comes back to the list it came from, and says how many with counts only", async () => {
    const response = await bulk(
      [
        ["locale", "ro"],
        ["returnTo", `/ro/admin/volunteers?eventId=${raceId}&sort=name`],
        ["files", file(SAMPLE_FILES.docx(), "Contract-voluntariat-Anais-Meyson.docx")],
        ["files", file(SAMPLE_FILES.exe(), "Contract-voluntariat-Tampu-Elena.pdf")],
        ["files", file(SAMPLE_FILES.docx(), "Contract-voluntariat-Ilie-Vasile.docx")],
      ],
      staff.ADMIN,
    );
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(`/ro/admin/volunteers?eventId=${raceId}&sort=name`);
    expect(toast()).toEqual({ kind: "success", key: "volunteerContractsAttachedSome", values: { count: "1", left: "2" } });
    expect((await documents()).map((row) => row.volunteerId)).toEqual([anais]);
    expect(JSON.stringify(state.cookies)).not.toContain("Ilie");
  });

  it("with scripts off and no file chosen, comes back to the list with the refusal in the address — never «0 attached»", async () => {
    // A box left empty posts one nameless, empty file.
    const response = await bulk(
      [
        ["locale", "ro"],
        ["returnTo", `/ro/admin/volunteers?eventId=${raceId}`],
        ["files", new File([], "")],
      ],
      staff.MODERATOR,
    );
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(`/ro/admin/volunteers?eventId=${raceId}&volunteerError=VOLUNTEER_CONTRACTS_NONE_CHOSEN`);
    expect(toast()).toBeNull();
    expect(await documents()).toEqual([]);
  });

  it("goes back to the event's list and never to a forged address", async () => {
    const response = await bulk(
      [
        ["locale", "ro"],
        ["returnTo", "https://elsewhere.example/phish"],
        ["files", file(SAMPLE_FILES.docx(), "Contract-voluntariat-Anais-Meyson.docx")],
      ],
      staff.ADMIN,
    );
    expect(response.headers.get("location")).toBe(`/ro/admin/volunteers?eventId=${raceId}`);
    expect(toast()).toMatchObject({ key: "volunteerContractsAttached", values: { count: "1" } });
  });

  it("refuses a stranger and every other role, and answers 404 for an event nobody has, writing nothing", async () => {
    const names: Array<[string, string]> = [
      ["answer", "json"],
      ["names", "Contract-voluntariat-Anais-Meyson.docx"],
    ];
    expect((await bulk(names, undefined)).status).toBe(401);
    for (const role of ["DEV", "COPYWRITER", "CONTRIBUTOR", "MEMBER"] as const) expect((await bulk(names, staff[role])).status, role).toBe(403);
    expect((await bulk(names, staff.ADMIN, "00000000-0000-4000-8000-000000000000")).status).toBe(404);
    expect((await bulk(names, staff.ADMIN, "not-an-id")).status).toBe(404);
    for (const role of ["DEV", "MEMBER"] as const) expect((await bulk([["files", file(SAMPLE_FILES.docx(), "Contract-voluntariat-Anais-Meyson.docx")]], staff[role])).status, role).toBe(403);
    expect(await documents()).toEqual([]);
    expect(await db.select().from(auditLogs).where(eq(auditLogs.entityId, raceId))).toEqual([]);
  });
});
