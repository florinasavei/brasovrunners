import { createTranslator } from "next-intl";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import type { StaffUser } from "@/db/schema/staff-users";
import { parseResultsCsv } from "@/modules/results/domain/import-csv";
import type { StaffRole } from "@/modules/staff-identity/domain/roles";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";
import { AFTER_THE_RACE, createRace, person, registerRunner, resetNoticeCounter } from "../../helpers/results";

/**
 * §808 — «Descarcă clasamentul (CSV)» (BR-REQ-050-02, BR-REQ-060-01): the file in the reader's language, the sex in that language's word beside the
 * category's, and — what the file promises — a download in either language that the page's own import reads back, every state's word included
 * («Dropped out» as much as «Abandon»).
 */
const messages = { ro, en } as const;
const state = vi.hoisted(() => ({ db: undefined as unknown, actor: undefined as unknown }));

vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {}, unstable_cache: (fn: unknown) => fn }));
vi.mock("@/db/client", () => ({ getDb: () => state.db }));
vi.mock("@/modules/staff-identity/session", () => ({
  DEV_STAFF_COOKIE: "dev-staff",
  requireStaff: async () => state.actor,
  requireStaffCapability: async () => state.actor,
}));
vi.mock("next-intl/server", () => ({
  getTranslations: async (arg: { locale: "ro" | "en"; namespace: string }) => createTranslator({ locale: arg.locale, messages: messages[arg.locale] as never, namespace: arg.namespace as never }),
}));

const { GET } = await import("@/app/api/admin/events/[id]/results/route");
const { saveEventResults } = await import("@/modules/results/results");

let db: TestDatabase;
let close: () => Promise<void>;
let raceId: string;
const staff: Partial<Record<StaffRole, StaffUser>> = {};

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
  state.db = db;
});
afterAll(async () => close());

beforeEach(async () => {
  await resetTables(db);
  resetNoticeCounter();
  for (const [role, name] of [["ADMIN", "Ana Admin"], ["MODERATOR", "Oana Organizator"], ["DEV", "Tudor Tehnic"]] as const) staff[role] = await person(db, role, name);
  state.actor = staff.ADMIN;
  raceId = (await createRace(db)).id;
  await registerRunner(db, raceId, { name: "Ana Popescu", bibNumber: 101, sex: "FEMALE", birthDate: "1996-05-01" });
  await registerRunner(db, raceId, { name: "Dan Ionescu", bibNumber: 103, sex: "MALE", birthDate: "1985-11-21" });
  await registerRunner(db, raceId, { name: "Eli Vasile", bibNumber: 104, sex: "MALE" });
  await registerRunner(db, raceId, { name: "Fane Radu", bibNumber: 105, sex: "MALE" });
  const row = (bib: number, over: Record<string, string>) => ({ key: `r[${bib}]`, bib: String(bib), name: "", sex: "", birthDate: "", time: "", status: "", chip: "", note: "", ...over });
  await saveEventResults(db, staff.ADMIN!, { eventId: raceId, rows: [row(101, { time: "50:00" }), row(103, { time: "45:00" }), row(104, { status: "DNF" }), row(105, { status: "DSQ" })] }, AFTER_THE_RACE);
});

const download = async (lang: string) => {
  const response = await GET(new Request(`http://localhost/api/admin/events/${raceId}/results?lang=${lang}`), { params: Promise.resolve({ id: raceId }) });
  return { response, body: (await response.text()).replace(/^﻿/, "") };
};

describe("§808 the results download", () => {
  it("writes the sex in the reader's own words in Romanian, beside the category's «Feminin, 30-39 ani»", async () => {
    const { response, body } = await download("ro");
    expect(response.status).toBe(200);
    const rows = body.split("\r\n");
    expect(rows[0]).toContain("Stare");
    const ana = rows.find((line) => line.includes("Ana Popescu")) as string;
    expect(ana).toContain(",Feminin,");
    expect(ana).toContain("Feminin, 30-39 ani");
    expect(ana).not.toContain("Female");
    expect(rows.find((line) => line.includes("Dan Ionescu"))).toContain(",Masculin,");
    // A man is «Masculin» whichever way the file is read, never the Excel's machine word.
    expect((rows.find((line) => line.includes("Eli Vasile")) as string).split(",")[5]).toBe("Masculin");
  });

  it("writes the English words in English: Female, Male", async () => {
    const { body } = await download("en");
    const rows = body.split("\r\n");
    expect(rows.find((line) => line.includes("Ana Popescu"))).toContain(",Female,");
    expect(rows.find((line) => line.includes("Dan Ionescu"))).toContain(",Male,");
  });

  it("can be imported again, in either language: the state's word as the page writes it, «Dropped out» and «Abandon» alike", async () => {
    for (const lang of ["en", "ro"]) {
      const { body } = await download(lang);
      const rows = parseResultsCsv(body);
      expect(rows.map((row) => [row.bibNumber, row.status] as const).sort((a, b) => a[0] - b[0]), lang).toEqual([[101, "FINISHED"], [103, "FINISHED"], [104, "DNF"], [105, "DSQ"]]);
      expect(rows.find((row) => row.bibNumber === 103)?.gunTimeMs).toBe(45 * 60_000);
    }
  });

  it("is refused to the Tehnic role and an unknown event", async () => {
    state.actor = staff.DEV;
    expect((await download("ro")).response.status).toBe(403);
    state.actor = staff.ADMIN;
    const unknown = await GET(new Request("http://localhost/x?lang=ro"), { params: Promise.resolve({ id: "7b2c1f0e-3d4a-4b5c-8d6e-0f1a2b3c4d5e" }) });
    expect(unknown.status).toBe(404);
  });
});
