import QRCode from "qrcode";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { events } from "@/db/schema/events";
import { participants } from "@/db/schema/participants";
import { registrations } from "@/db/schema/registrations";
import { EMAIL_SAMPLE, EMAIL_SAMPLE_FAMILY_CONFIRMED } from "@/modules/notifications/domain/email-sample";
import { canonicalizeEmail } from "@/modules/participants/domain/canonical-email";
import { isCheckinCode, newCheckinCode, SAMPLE_CHECKIN_CODES } from "@/modules/registrations/checkin-code";
import { env } from "@/shared/config/env";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * BR-REQ-037-08 — the QR a runner shows at the desk, as the picture the emails link to
 * (`GET /api/registrations/qr/<code>.png`), and §946: the made-up runners of the email previews get a picture too.
 *
 * The owner, 2026-11-14, with a picture of «Cum arată emailul» on «Trimite un mesaj participanților», the QR's place
 * holding only its description: «Si aici de ce nu vad un exemplu de QR?» The preview is addressed to a sample runner
 * whose code is nobody's, and the route answered 404 for it.
 *
 * What is protected: a registration's code is drawn as the desk's address for it; a code that is nobody's is a 404, so
 * the route mints no picture for arbitrary text; and exactly the samples' few fixed codes — too short to ever be a
 * registration's — are drawn the same way, with no row read.
 */
const state = vi.hoisted(() => ({ db: undefined as unknown }));

vi.mock("@/db/client", () => ({ getDb: () => state.db }));

const { GET } = await import("@/app/api/registrations/qr/[code]/route");

/** The route as a mail client asks it: the code with `.png`. */
const picture = (name: string) => GET(new Request(`http://localhost/api/registrations/qr/${name}`), { params: Promise.resolve({ code: name }) });

/** The picture of a desk address, drawn with the route's own options. */
async function drawn(code: string): Promise<Uint8Array> {
  return new Uint8Array(await QRCode.toBuffer(`${env.APP_BASE_URL}/ro/admin/checkin/${code}`, { type: "png", width: 480, margin: 2, errorCorrectionLevel: "M" }));
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

let db: TestDatabase;
let close: () => Promise<void>;

/** A confirmed registration with a desk code of its own. */
async function registered(): Promise<string> {
  const [event] = await db
    .insert(events)
    .values({ type: "RACE", startsAt: new Date("2099-11-21T08:00:00.000Z"), registrationMode: "INTERNAL", capacity: 50, editorialStatus: "PUBLISHED", publishedAt: new Date("2026-09-01T10:00:00.000Z") })
    .returning();
  const identity = canonicalizeEmail("ana@example.ro");
  const [participant] = await db
    .insert(participants)
    .values({ deliveryEmail: identity.deliveryEmail, normalizedEmail: identity.normalizedEmail, canonicalEmail: identity.canonicalEmail, canonicalizationVersion: identity.canonicalizationVersion, defaultName: "Ana" })
    .returning();
  const code = newCheckinCode();
  await db.insert(registrations).values({
    eventId: event.id,
    participantId: participant.id,
    status: "CONFIRMED",
    locale: "ro",
    registeredName: "Ana Pop",
    displayName: "Ana",
    privacyNoticeVersion: 1,
    privacyAcknowledgedAt: new Date("2026-09-02T10:00:00.000Z"),
    resultsNameConsent: false,
    resultsConsentVersion: 1,
    checkinCode: code,
  });
  return code;
}

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
});
afterAll(async () => close());
beforeEach(async () => {
  await resetTables(db);
  state.db = db;
});

describe("BR-REQ-037-08 the QR picture of a registration's desk code", () => {
  it("draws the desk's address for a code a registration holds, as a PNG a mail client may keep for a day", async () => {
    const code = await registered();
    const response = await picture(`${code}.png`);
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("image/png");
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=86400");
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect([...bytes.slice(0, 8)]).toEqual(PNG_SIGNATURE);
    expect(response.headers.get("Content-Length")).toBe(String(bytes.byteLength));
    expect(bytes).toEqual(await drawn(code));
  });

  it("answers 404 for a code that is nobody's and for anything that is not a code: no picture for arbitrary text", async () => {
    await registered();
    const nobody = newCheckinCode();
    for (const name of [`${nobody}.png`, nobody, "ZZZZZZZZZZ.png", "hello.png", "EXAMPLE.png", "EXAMP3.png", "exampl.png", `${SAMPLE_CHECKIN_CODES[0]}X.png`, ".png", "admin.png"]) {
      const response = await picture(name);
      expect(response.status, name).toBe(404);
      expect((await response.arrayBuffer()).byteLength, name).toBe(0);
    }
  });
});

describe("§946 the sample runners of the email previews have a QR picture", () => {
  it("names exactly the codes the samples carry, none of which a registration can ever hold", () => {
    const carried = [...new Set([EMAIL_SAMPLE.ro.checkinCode, EMAIL_SAMPLE.en.checkinCode, ...EMAIL_SAMPLE_FAMILY_CONFIRMED.map((person) => person.checkinCode)])];
    expect([...SAMPLE_CHECKIN_CODES].sort()).toEqual(carried.sort());
    for (const code of SAMPLE_CHECKIN_CODES) expect(isCheckinCode(code), code).toBe(false);
  });

  it.each([...SAMPLE_CHECKIN_CODES])("draws %s as it draws a real code — the desk's address for it — and reads no row", async (code) => {
    // A database that refuses every read: the sample's picture needs none.
    state.db = new Proxy({}, { get: () => () => Promise.reject(new Error("the sample's picture read the database")) });
    const response = await picture(`${code}.png`);
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("image/png");
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect([...bytes.slice(0, 8)]).toEqual(PNG_SIGNATURE);
    expect(bytes).toEqual(await drawn(code));
  });
});
