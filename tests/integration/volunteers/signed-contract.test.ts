import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { eventVolunteerDocuments, eventVolunteerDocumentUploads, SIGNED_CONTRACT_MAX_BYTES } from "@/db/schema/event-volunteer-documents";
import { eventVolunteers } from "@/db/schema/event-volunteers";
import { events } from "@/db/schema/events";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { pruneExpiredRows } from "@/modules/jobs/retention";
import type { StaffRole } from "@/modules/staff-identity/domain/roles";
import {
  attachSignedContract,
  attachSignedContractsByName,
  continueSignedContractUpload,
  deleteSignedContract,
  matchSignedContractFiles,
  readSignedContract,
  signedContractsOfOffers,
  startSignedContractUpload,
  takeSignedContractFile,
  volunteersWithSignedContract,
} from "@/modules/volunteers/signed-contract";
import { changeVolunteer } from "@/modules/volunteers/volunteers";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";
import { pdfOfSize, SAMPLE_FILES } from "../../helpers/signed-contract-files";

/**
 * «Contract semnat» (§NNN, amending §758; the owner, 2026-11-19: «trebuie pentru fiecare voluntar să pot atașa „contract
 * semnat”»), BR-REQ-050-02 and BR-REQ-060-01, read from a real database: a volunteer's signed agreement attached, replaced and
 * deleted — one per volunteer, at most 10 MB, a PDF, a Word file or a photograph by its own bytes —, a large one in pieces, the
 * whole event's files matched by name, the role on every function, and the file gone with the person's data. The trail names the
 * volunteer's id, the length and the format, never the file's name. The made-up people here are nobody.
 */

const NOW = new Date("2026-11-19T10:00:00.000Z");
const DAY = 24 * 60 * 60_000;

let db: TestDatabase;
let close: () => Promise<void>;
const staff: Partial<Record<StaffRole, StaffUser>> = {};
let raceId: string;
let otherId: string;
const people = { anais: "", musat: "", tampu: "", ana1: "", ana2: "", gone: "", other: "" };

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
});
afterAll(async () => close());

async function volunteer(eventId: string, name: string, state: "REGISTERED" | "CONFIRMED" | "CANCELLED" = "CONFIRMED"): Promise<string> {
  const [row] = await db
    .insert(eventVolunteers)
    .values({ eventId, name, source: "STAFF", state, createdAt: NOW, updatedAt: NOW })
    .returning({ id: eventVolunteers.id });
  return row.id;
}

beforeEach(async () => {
  await resetTables(db);
  for (const role of ["MEMBER", "CONTRIBUTOR", "COPYWRITER", "MODERATOR", "DEV", "ADMIN", "SUPERADMIN"] as const) {
    [staff[role]] = await db.insert(staffUsers).values({ email: `${role.toLowerCase()}@example.test`, displayName: `Coleg ${role}`, role }).returning();
  }
  const [race, other] = await db
    .insert(events)
    .values([
      { type: "RACE", startsAt: new Date(NOW.getTime() + 2 * DAY), acceptsVolunteers: true },
      { type: "RACE", startsAt: new Date(NOW.getTime() + 30 * DAY), acceptsVolunteers: true },
    ])
    .returning({ id: events.id });
  raceId = race.id;
  otherId = other.id;
  people.anais = await volunteer(raceId, "Anaïs Meyson");
  people.musat = await volunteer(raceId, "Ion Mușat", "REGISTERED");
  people.tampu = await volunteer(raceId, "Țâmpu Elena");
  people.ana1 = await volunteer(raceId, "Ana Pop");
  people.ana2 = await volunteer(raceId, "Ana Pop");
  people.gone = await volunteer(raceId, "Radu Stan", "CANCELLED");
  // Another event's volunteer with a name a file of the race carries: never matched from the race.
  people.other = await volunteer(otherId, "Ilie Vasile");
});

const documents = () => db.select().from(eventVolunteerDocuments);
const uploads = () => db.select().from(eventVolunteerDocumentUploads);
const trail = () => db.select().from(auditLogs).where(inArray(auditLogs.action, ["volunteer.signed_contract_uploaded", "volunteer.signed_contract_replaced", "volunteer.signed_contract_deleted", "volunteer.signed_contract_downloaded"]));
const attach = (actor: StaffUser, volunteerId: string, fileName: string, bytes: Uint8Array, eventId = raceId) => attachSignedContract(db, actor, { eventId, volunteerId, fileName, bytes }, NOW);

describe("§NNN one signed agreement per volunteer: attach, replace, delete", () => {
  it("attaches the file as uploaded — its name, its format by its bytes, its length, who and when — and records the id, the length and the format, never the name", async () => {
    const bytes = SAMPLE_FILES.docx();
    expect(await attach(staff.MODERATOR!, people.anais, "Contract-voluntariat-Anais-Meyson.docx", bytes)).toEqual({ replaced: false, format: "DOCX", size: bytes.length });
    const [row] = await documents();
    expect(row).toMatchObject({ volunteerId: people.anais, fileName: "Contract-voluntariat-Anais-Meyson.docx", format: "DOCX", size: bytes.length, uploadedByStaffUserId: staff.MODERATOR!.id, uploadedAt: NOW });
    expect(Buffer.compare(row.bytes, bytes)).toBe(0);
    const [audit] = await trail();
    expect(audit).toMatchObject({ action: "volunteer.signed_contract_uploaded", actorStaffUserId: staff.MODERATOR!.id, entityType: "event", entityId: raceId, metadataJson: { volunteerId: people.anais, size: bytes.length, format: "DOCX" } });
    expect(await readSignedContract(db, staff.ADMIN!, people.anais)).toEqual({ fileName: "Contract-voluntariat-Anais-Meyson.docx", format: "DOCX", size: bytes.length, uploadedAt: NOW, uploadedByName: "Coleg MODERATOR" });
  });

  it("replaces the copy in place — still one row — and records the old length and format beside the new", async () => {
    await attach(staff.ADMIN!, people.anais, "Contract-voluntariat-Anais-Meyson.docx", SAMPLE_FILES.docx());
    const scan = SAMPLE_FILES.jpeg();
    expect(await attach(staff.MODERATOR!, people.anais, "IMG_2001.jpg", scan)).toEqual({ replaced: true, format: "JPEG", size: scan.length });
    const rows = await documents();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ fileName: "IMG_2001.jpg", format: "JPEG", size: scan.length, uploadedByStaffUserId: staff.MODERATOR!.id });
    expect(Buffer.compare(rows[0].bytes, scan)).toBe(0);
    const replaced = (await trail()).find((row) => row.action === "volunteer.signed_contract_replaced");
    expect(replaced?.metadataJson).toEqual({ volunteerId: people.anais, size: scan.length, format: "JPEG", previousSize: SAMPLE_FILES.docx().length, previousFormat: "DOCX" });
  });

  it("deletes it, with one trail row, and answers a second delete with nothing to do and no row", async () => {
    await attach(staff.ADMIN!, people.tampu, "Contract-voluntariat-Tampu-Elena.pdf", SAMPLE_FILES.pdf());
    expect(await deleteSignedContract(db, staff.MODERATOR!, { eventId: raceId, volunteerId: people.tampu }, NOW)).toEqual({ deleted: true });
    expect(await documents()).toEqual([]);
    expect(await readSignedContract(db, staff.ADMIN!, people.tampu)).toBeNull();
    expect(await deleteSignedContract(db, staff.ADMIN!, { eventId: raceId, volunteerId: people.tampu }, NOW)).toEqual({ deleted: false });
    const deletes = (await trail()).filter((row) => row.action === "volunteer.signed_contract_deleted");
    expect(deletes).toHaveLength(1);
    expect(deletes[0].metadataJson).toEqual({ volunteerId: people.tampu, size: SAMPLE_FILES.pdf().length, format: "PDF" });
  });

  it("hands the download its bytes, name and format, with a trail row; nothing and no row while there is none", async () => {
    expect(await takeSignedContractFile(db, staff.ADMIN!, { eventId: raceId, volunteerId: people.anais }, NOW)).toBeNull();
    expect(await trail()).toEqual([]);
    const bytes = SAMPLE_FILES.png();
    await attach(staff.ADMIN!, people.anais, "Contract Anaïs.png", bytes);
    const file = await takeSignedContractFile(db, staff.MODERATOR!, { eventId: raceId, volunteerId: people.anais }, NOW);
    expect(file).toMatchObject({ fileName: "Contract Anaïs.png", format: "PNG", size: bytes.length });
    expect(Buffer.compare(file!.bytes, bytes)).toBe(0);
    // Another event's address for the same person finds nothing.
    expect(await takeSignedContractFile(db, staff.ADMIN!, { eventId: otherId, volunteerId: people.anais }, NOW)).toBeNull();
    const downloads = (await trail()).filter((row) => row.action === "volunteer.signed_contract_downloaded");
    expect(downloads).toHaveLength(1);
    expect(downloads[0]).toMatchObject({ actorStaffUserId: staff.MODERATOR!.id, metadataJson: { volunteerId: people.anais, size: bytes.length, format: "PNG" } });
  });

  it("names the list's chips and the person's data by existence and facts only", async () => {
    await attach(staff.ADMIN!, people.anais, "a.pdf", SAMPLE_FILES.pdf());
    await attach(staff.ADMIN!, people.tampu, "b.docx", SAMPLE_FILES.docx());
    expect(await volunteersWithSignedContract(db, staff.MODERATOR!, [people.anais, people.musat, people.tampu, "not-an-id"])).toEqual(new Set([people.anais, people.tampu]));
    const offers = await signedContractsOfOffers(db, [people.anais, people.musat]);
    expect([...offers.keys()]).toEqual([people.anais]);
    expect(offers.get(people.anais)).toEqual({ fileName: "a.pdf", format: "PDF", size: SAMPLE_FILES.pdf().length, uploadedAt: NOW });
  });
});

describe("§NNN what a signed agreement may be: 10 MB at most, and a PDF, a Word file or a photograph by its own bytes", () => {
  it("refuses an empty file, and one byte past ten megabytes, writing nothing", async () => {
    await expect(attach(staff.ADMIN!, people.anais, "gol.pdf", new Uint8Array())).rejects.toMatchObject({ code: "VOLUNTEER_CONTRACT_EMPTY" });
    await expect(attach(staff.ADMIN!, people.anais, "mare.pdf", pdfOfSize(SIGNED_CONTRACT_MAX_BYTES + 1))).rejects.toMatchObject({ code: "VOLUNTEER_CONTRACT_TOO_LARGE" });
    expect(await documents()).toEqual([]);
    expect(await trail()).toEqual([]);
  });

  it("takes a file of exactly ten megabytes", async () => {
    expect(await attach(staff.ADMIN!, people.anais, "exact.pdf", pdfOfSize(SIGNED_CONTRACT_MAX_BYTES))).toMatchObject({ format: "PDF", size: SIGNED_CONTRACT_MAX_BYTES });
    expect((await documents())[0].size).toBe(SIGNED_CONTRACT_MAX_BYTES);
  });

  it("refuses by content whatever the name says — a program named .pdf, a page named .pdf, an Excel named .docx, an old Excel named .doc, an AVIF named .heic", async () => {
    for (const [name, bytes] of [
      ["Contract-voluntariat-Anais-Meyson.pdf", SAMPLE_FILES.exe()],
      ["contract.pdf", SAMPLE_FILES.html()],
      ["contract.docx", SAMPLE_FILES.xlsx()],
      ["contract.doc", SAMPLE_FILES.xls()],
      ["poza.heic", SAMPLE_FILES.avif()],
      ["contract.txt", SAMPLE_FILES.text()],
    ] as const) {
      await expect(attach(staff.ADMIN!, people.anais, name, bytes), name).rejects.toMatchObject({ code: "VOLUNTEER_CONTRACT_TYPE" });
    }
    expect(await documents()).toEqual([]);
    expect(await trail()).toEqual([]);
  });

  it("takes a file by its bytes when its name says another format, and keeps the name it came with", async () => {
    expect(await attach(staff.ADMIN!, people.anais, "contract.pdf", SAMPLE_FILES.jpeg())).toMatchObject({ format: "JPEG" });
    expect((await documents())[0]).toMatchObject({ fileName: "contract.pdf", format: "JPEG" });
  });

  it("keeps a name cleaned of its path and its control characters, and names a file that had none left", async () => {
    await attach(staff.ADMIN!, people.anais, "C:\\fakepath\\Contract\u202E Anaïs.pdf", SAMPLE_FILES.pdf());
    expect((await documents())[0].fileName).toBe("Contract Anaïs.pdf");
    await attach(staff.ADMIN!, people.tampu, "   ", SAMPLE_FILES.docx());
    expect((await db.select().from(eventVolunteerDocuments).where(eq(eventVolunteerDocuments.volunteerId, people.tampu)))[0].fileName).toBe("contract.docx");
  });
});

describe("§NNN a file larger than one request carries goes up in pieces", () => {
  const PART = 1024;
  const pieces = (bytes: Buffer) => Array.from({ length: Math.ceil(bytes.length / PART) }, (_, index) => bytes.subarray(index * PART, (index + 1) * PART));

  it("appends the pieces in order and moves the whole file into the volunteer's copy with the last one", async () => {
    const whole = pdfOfSize(3 * PART - 100);
    const [first, second, third] = pieces(whole);
    const started = await startSignedContractUpload(db, staff.MODERATOR!, { eventId: raceId, volunteerId: people.anais, fileName: "Contract-voluntariat-Anais-Meyson.pdf", size: whole.length, part: first }, NOW);
    expect(started).toMatchObject({ done: false, received: PART });
    if (started.done) throw new Error("not done yet");
    expect(await documents()).toEqual([]);
    expect(await continueSignedContractUpload(db, staff.MODERATOR!, { eventId: raceId, volunteerId: people.anais, uploadId: started.uploadId, offset: PART, part: second }, NOW)).toMatchObject({ done: false, received: 2 * PART });
    expect(await continueSignedContractUpload(db, staff.MODERATOR!, { eventId: raceId, volunteerId: people.anais, uploadId: started.uploadId, offset: 2 * PART, part: third }, NOW)).toEqual({ done: true, replaced: false, format: "PDF", size: whole.length });
    const [row] = await documents();
    expect(row).toMatchObject({ fileName: "Contract-voluntariat-Anais-Meyson.pdf", size: whole.length, format: "PDF" });
    expect(Buffer.compare(row.bytes, whole)).toBe(0);
    expect(await uploads()).toEqual([]);
    expect((await trail()).map((audit) => audit.action)).toEqual(["volunteer.signed_contract_uploaded"]);
  });

  it("refuses a piece out of turn or sent twice, an upload a newer one replaced, and a declared length past the limit", async () => {
    const whole = pdfOfSize(3 * PART);
    const [first, second] = pieces(whole);
    const started = await startSignedContractUpload(db, staff.ADMIN!, { eventId: raceId, volunteerId: people.anais, fileName: "a.pdf", size: whole.length, part: first }, NOW);
    if (started.done) throw new Error("not done yet");
    await expect(continueSignedContractUpload(db, staff.ADMIN!, { eventId: raceId, volunteerId: people.anais, uploadId: started.uploadId, offset: 2 * PART, part: second }, NOW)).rejects.toMatchObject({ code: "VOLUNTEER_CONTRACT_UPLOAD_GONE" });
    await continueSignedContractUpload(db, staff.ADMIN!, { eventId: raceId, volunteerId: people.anais, uploadId: started.uploadId, offset: PART, part: second }, NOW);
    await expect(continueSignedContractUpload(db, staff.ADMIN!, { eventId: raceId, volunteerId: people.anais, uploadId: started.uploadId, offset: PART, part: second }, NOW)).rejects.toMatchObject({ code: "VOLUNTEER_CONTRACT_UPLOAD_GONE" });
    // A newer start for the same person replaces the half-sent one.
    const again = await startSignedContractUpload(db, staff.ADMIN!, { eventId: raceId, volunteerId: people.anais, fileName: "b.pdf", size: whole.length, part: first }, NOW);
    if (again.done) throw new Error("not done yet");
    expect(await uploads()).toHaveLength(1);
    await expect(continueSignedContractUpload(db, staff.ADMIN!, { eventId: raceId, volunteerId: people.anais, uploadId: started.uploadId, offset: 2 * PART, part: second }, NOW)).rejects.toMatchObject({ code: "VOLUNTEER_CONTRACT_UPLOAD_GONE" });
    // Another volunteer's address for the upload finds nothing either.
    await expect(continueSignedContractUpload(db, staff.ADMIN!, { eventId: raceId, volunteerId: people.tampu, uploadId: again.uploadId, offset: PART, part: second }, NOW)).rejects.toMatchObject({ code: "VOLUNTEER_CONTRACT_UPLOAD_GONE" });
    await expect(startSignedContractUpload(db, staff.ADMIN!, { eventId: raceId, volunteerId: people.anais, fileName: "a.pdf", size: SIGNED_CONTRACT_MAX_BYTES + 1, part: first }, NOW)).rejects.toMatchObject({ code: "VOLUNTEER_CONTRACT_TOO_LARGE" });
    expect(await documents()).toEqual([]);
  });

  it("refuses a first piece that opens like no format at once, and a whole file that is none at the end, deleting its pieces", async () => {
    await expect(startSignedContractUpload(db, staff.ADMIN!, { eventId: raceId, volunteerId: people.anais, fileName: "a.pdf", size: 5000, part: SAMPLE_FILES.exe() }, NOW)).rejects.toMatchObject({ code: "VOLUNTEER_CONTRACT_TYPE" });
    expect(await uploads()).toEqual([]);
    // A ZIP that is no Word file: its first piece may be one, the whole is not.
    const zip = Buffer.concat([SAMPLE_FILES.zip(), Buffer.alloc(2 * PART)]);
    const [first, ...rest] = pieces(zip);
    const started = await startSignedContractUpload(db, staff.ADMIN!, { eventId: raceId, volunteerId: people.anais, fileName: "a.docx", size: zip.length, part: first }, NOW);
    if (started.done) throw new Error("not done yet");
    let offset = first.length;
    for (const [index, piece] of rest.entries()) {
      const next = continueSignedContractUpload(db, staff.ADMIN!, { eventId: raceId, volunteerId: people.anais, uploadId: started.uploadId, offset, part: piece }, NOW);
      if (index === rest.length - 1) await expect(next).rejects.toMatchObject({ code: "VOLUNTEER_CONTRACT_TYPE" });
      else await next;
      offset += piece.length;
    }
    expect(await uploads()).toEqual([]);
    expect(await documents()).toEqual([]);
    expect(await trail()).toEqual([]);
  });

  it("attaches at once a first piece that is already the whole file", async () => {
    const whole = SAMPLE_FILES.heic();
    expect(await startSignedContractUpload(db, staff.ADMIN!, { eventId: raceId, volunteerId: people.anais, fileName: "IMG_0001.HEIC", size: whole.length, part: whole }, NOW)).toEqual({ done: true, replaced: false, format: "HEIC", size: whole.length });
    expect(await uploads()).toEqual([]);
  });
});

describe("§NNN BR-REQ-060-01 whoever works the volunteers, and nobody else, on every function", () => {
  it("lets the Organizer, the Administrator and the Superadministrator attach, read, download and delete", async () => {
    for (const role of ["MODERATOR", "ADMIN", "SUPERADMIN"] as const) {
      await attach(staff[role]!, people.anais, `${role}.pdf`, SAMPLE_FILES.pdf());
      expect(await readSignedContract(db, staff[role]!, people.anais), role).toMatchObject({ fileName: `${role}.pdf` });
      expect(await takeSignedContractFile(db, staff[role]!, { eventId: raceId, volunteerId: people.anais }, NOW), role).not.toBeNull();
      expect(await deleteSignedContract(db, staff[role]!, { eventId: raceId, volunteerId: people.anais }, NOW), role).toEqual({ deleted: true });
    }
  });

  it("refuses the Tehnic role, the Redactor, the volunteer and a member every function, FORBIDDEN, writing nothing", async () => {
    await attach(staff.ADMIN!, people.tampu, "kept.pdf", SAMPLE_FILES.pdf());
    const before = (await trail()).length;
    for (const role of ["DEV", "COPYWRITER", "CONTRIBUTOR", "MEMBER"] as const) {
      const actor = staff[role]!;
      for (const [verb, call] of [
        ["attach", () => attach(actor, people.anais, "x.pdf", SAMPLE_FILES.pdf())],
        ["start", () => startSignedContractUpload(db, actor, { eventId: raceId, volunteerId: people.anais, fileName: "x.pdf", size: 5000, part: SAMPLE_FILES.pdf() }, NOW)],
        ["continue", () => continueSignedContractUpload(db, actor, { eventId: raceId, volunteerId: people.anais, uploadId: people.anais, offset: 1, part: SAMPLE_FILES.pdf() }, NOW)],
        ["delete", () => deleteSignedContract(db, actor, { eventId: raceId, volunteerId: people.tampu }, NOW)],
        ["read", () => readSignedContract(db, actor, people.tampu)],
        ["download", () => takeSignedContractFile(db, actor, { eventId: raceId, volunteerId: people.tampu }, NOW)],
        ["chips", () => volunteersWithSignedContract(db, actor, [people.tampu])],
        ["match", () => matchSignedContractFiles(db, actor, raceId, ["Contract-voluntariat-Tampu-Elena.pdf"])],
        ["bulk", () => attachSignedContractsByName(db, actor, raceId, [{ fileName: "Contract-voluntariat-Anais-Meyson.pdf", bytes: SAMPLE_FILES.pdf() }], NOW)],
      ] as const) {
        await expect(call(), `${role} ${verb}`).rejects.toMatchObject({ code: "FORBIDDEN" });
      }
    }
    expect(await documents()).toHaveLength(1);
    expect((await trail()).length).toBe(before);
  });

  it("answers NOT_FOUND for another event's volunteer, a malformed id and nobody, writing nothing", async () => {
    await expect(attach(staff.ADMIN!, people.other, "x.pdf", SAMPLE_FILES.pdf())).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(attach(staff.ADMIN!, "not-an-id", "x.pdf", SAMPLE_FILES.pdf())).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(attach(staff.ADMIN!, "00000000-0000-4000-8000-000000000000", "x.pdf", SAMPLE_FILES.pdf())).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(deleteSignedContract(db, staff.ADMIN!, { eventId: otherId, volunteerId: people.anais }, NOW)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(matchSignedContractFiles(db, staff.ADMIN!, "00000000-0000-4000-8000-000000000000", [])).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await documents()).toEqual([]);
  });
});

describe("§NNN «Încarcă contractele semnate»: each file to one volunteer of the event, the rest reported", () => {
  it("matches the owner's file names — «Anaïs», «Mușat», «Țâmpu» — and reports the ambiguous, the unknown, the cancelled and another event's name", async () => {
    expect(
      await matchSignedContractFiles(db, staff.MODERATOR!, raceId, [
        "Contract-voluntariat-Anais-Meyson.docx",
        "Contract-voluntariat-Ion-Musat.docx",
        "Contract-voluntariat-Tampu-Elena.docx",
        "Contract-voluntariat-Ana-Pop.docx",
        "Contract-voluntariat-Radu-Stan.docx",
        "Contract-voluntariat-Ilie-Vasile.docx",
      ]),
    ).toEqual([
      { kind: "matched", volunteerId: people.anais },
      { kind: "matched", volunteerId: people.musat },
      { kind: "matched", volunteerId: people.tampu },
      { kind: "refused", reason: "ambiguous" },
      { kind: "refused", reason: "cancelledOnly" },
      { kind: "refused", reason: "noMatch" },
    ]);
  });

  it("attaches every matched file in a transaction of its own, so one bad file never stops the others", async () => {
    const outcomes = await attachSignedContractsByName(
      db,
      staff.MODERATOR!,
      raceId,
      [
        { fileName: "Contract-voluntariat-Anais-Meyson.docx", bytes: SAMPLE_FILES.docx() },
        // Matched by name, refused by its bytes: the next file still goes.
        { fileName: "Contract-voluntariat-Ion-Musat.pdf", bytes: SAMPLE_FILES.exe() },
        { fileName: "Contract-voluntariat-Tampu-Elena.pdf", bytes: SAMPLE_FILES.pdf() },
        { fileName: "Contract-voluntariat-Ana-Pop.docx", bytes: SAMPLE_FILES.docx() },
        { fileName: "Contract-voluntariat-Ilie-Vasile.docx", bytes: SAMPLE_FILES.docx() },
        { fileName: "Contract-voluntariat-Anais-Meyson.pdf", bytes: SAMPLE_FILES.pdf() },
        { fileName: "Contract-voluntariat-Radu-Stan.docx", bytes: new Uint8Array() },
        // Ion's second file: his first was refused by its bytes, so this one takes its turn; a third is one too many.
        { fileName: "Contract-voluntariat-Ion-Musat.docx", bytes: SAMPLE_FILES.docx() },
        { fileName: "Contract-voluntariat-Ion-Musat (1).docx", bytes: SAMPLE_FILES.docx() },
      ],
      NOW,
    );
    expect(outcomes).toEqual([
      { fileName: "Contract-voluntariat-Anais-Meyson.docx", outcome: "attached", replaced: false },
      { fileName: "Contract-voluntariat-Ion-Musat.pdf", outcome: "refused", reason: "type" },
      { fileName: "Contract-voluntariat-Tampu-Elena.pdf", outcome: "attached", replaced: false },
      { fileName: "Contract-voluntariat-Ana-Pop.docx", outcome: "refused", reason: "ambiguous" },
      { fileName: "Contract-voluntariat-Ilie-Vasile.docx", outcome: "refused", reason: "noMatch" },
      { fileName: "Contract-voluntariat-Anais-Meyson.pdf", outcome: "refused", reason: "twice" },
      { fileName: "Contract-voluntariat-Radu-Stan.docx", outcome: "refused", reason: "cancelledOnly" },
      { fileName: "Contract-voluntariat-Ion-Musat.docx", outcome: "attached", replaced: false },
      { fileName: "Contract-voluntariat-Ion-Musat (1).docx", outcome: "refused", reason: "twice" },
    ]);
    const rows = await documents();
    expect(rows.map((row) => row.volunteerId).sort()).toEqual([people.anais, people.musat, people.tampu].sort());
    // The upload never replaced its own file: Anaïs keeps her first, Ion the one that passed.
    expect(rows.find((row) => row.volunteerId === people.anais)?.fileName).toBe("Contract-voluntariat-Anais-Meyson.docx");
    expect(rows.find((row) => row.volunteerId === people.musat)?.fileName).toBe("Contract-voluntariat-Ion-Musat.docx");
    // Nothing went to the other event's volunteer of the same name.
    expect(rows.some((row) => row.volunteerId === people.other)).toBe(false);
  });

  it("refuses an upload of no file at all, after the role and the event, writing nothing", async () => {
    await expect(attachSignedContractsByName(db, staff.MODERATOR!, raceId, [], NOW)).rejects.toMatchObject({ code: "VOLUNTEER_CONTRACTS_NONE_CHOSEN" });
    await expect(attachSignedContractsByName(db, staff.DEV!, raceId, [], NOW)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(attachSignedContractsByName(db, staff.ADMIN!, "00000000-0000-4000-8000-000000000000", [], NOW)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await documents()).toEqual([]);
    expect(await trail()).toEqual([]);
  });
});

describe("§NNN the file goes with the person's data, at the same moment", () => {
  it("«Șterge voluntarul» takes the signed copy and a half-sent upload with the row", async () => {
    await attach(staff.ADMIN!, people.anais, "a.pdf", SAMPLE_FILES.pdf());
    await startSignedContractUpload(db, staff.ADMIN!, { eventId: raceId, volunteerId: people.anais, fileName: "b.pdf", size: 5000, part: SAMPLE_FILES.pdf() }, NOW);
    expect(await uploads()).toHaveLength(1);
    await changeVolunteer(db, staff.ADMIN!, { kind: "delete", eventId: raceId, id: people.anais }, NOW);
    expect(await documents()).toEqual([]);
    expect(await uploads()).toEqual([]);
  });

  it("the thirty-day retention sweep takes it with the volunteer, and keeps an event's still ahead", async () => {
    const [past] = await db.insert(events).values({ type: "RACE", startsAt: new Date(NOW.getTime() - 31 * DAY), acceptsVolunteers: true }).returning({ id: events.id });
    const [old] = await db
      .insert(eventVolunteers)
      .values({ eventId: past.id, name: "Vechi Voluntar", source: "STAFF", state: "CONFIRMED", createdAt: new Date(NOW.getTime() - 40 * DAY), updatedAt: NOW })
      .returning({ id: eventVolunteers.id });
    await attach(staff.ADMIN!, old.id, "vechi.pdf", SAMPLE_FILES.pdf(), past.id);
    await attach(staff.ADMIN!, people.tampu, "nou.pdf", SAMPLE_FILES.pdf());
    const result = await pruneExpiredRows(db, NOW);
    expect(result.failures).toEqual([]);
    expect((await documents()).map((row) => row.volunteerId)).toEqual([people.tampu]);
  });

  it("an event's hard delete takes its volunteers' signed copies", async () => {
    await attach(staff.ADMIN!, people.anais, "a.pdf", SAMPLE_FILES.pdf());
    await db.delete(events).where(eq(events.id, raceId));
    expect(await documents()).toEqual([]);
  });
});

describe("§NNN the trail never carries a file's name or its bytes", () => {
  it("names no file and no person in any row it writes, through every verb", async () => {
    const name = "Contract-voluntariat-Anais-Meyson.docx";
    await attach(staff.ADMIN!, people.anais, name, SAMPLE_FILES.docx());
    await attach(staff.ADMIN!, people.anais, "Anaïs Meyson scan.pdf", SAMPLE_FILES.pdf());
    await takeSignedContractFile(db, staff.ADMIN!, { eventId: raceId, volunteerId: people.anais }, NOW);
    await deleteSignedContract(db, staff.ADMIN!, { eventId: raceId, volunteerId: people.anais }, NOW);
    await attachSignedContractsByName(db, staff.ADMIN!, raceId, [{ fileName: "Contract-voluntariat-Tampu-Elena.pdf", bytes: SAMPLE_FILES.pdf() }], NOW);
    const rows = await trail();
    expect(rows.map((row) => row.action).sort()).toEqual(
      ["volunteer.signed_contract_deleted", "volunteer.signed_contract_downloaded", "volunteer.signed_contract_replaced", "volunteer.signed_contract_uploaded", "volunteer.signed_contract_uploaded"].sort(),
    );
    const written = JSON.stringify(rows.map((row) => row.metadataJson));
    for (const word of ["Contract", "voluntariat", "Anais", "Anaïs", "Meyson", "Tampu", "Țâmpu", ".docx", ".pdf", "PK", "%PDF"]) expect(written, word).not.toContain(word);
    for (const row of rows) expect(Object.keys(row.metadataJson as object).sort()).toEqual(expect.arrayContaining(["format", "size", "volunteerId"]));
  });
});
