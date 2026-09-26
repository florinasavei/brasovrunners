import { eq } from "drizzle-orm";
import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mediaAssets } from "@/db/schema/gallery";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * BR-REQ-054-01 criterion 12, BR-REQ-050-03 criterion 22 (`DECISIONS.md` §414) — the quality
 * beside every upload, through the two routes a browser posts to, and the ladder of files it
 * leaves in the store.
 *
 * The owner, 2026-09-25: "I wanna choose the quality of the image when uploading it — cuz it's
 * super pixelated." What is proven: the route reads the choice and refuses a value that is not
 * one; what it answers is what the person is told; every width the public pages may ask for is
 * in the store; and every one of them goes when the picture does, by any of the three ways a
 * picture goes (a photo removed, a picture deleted from the list, the orphan sweep).
 */
const state = vi.hoisted(() => ({ db: undefined as unknown, actor: undefined as unknown }));

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }) }));
vi.mock("@/auth", () => ({ signOut: async () => {} }));
vi.mock("@/db/client", () => ({ getDb: () => state.db }));
vi.mock("@/modules/staff-identity/session", () => ({
  DEV_STAFF_COOKIE: "dev-staff",
  requireStaff: async () => state.actor,
  requireStaffRole: async () => state.actor,
}));

const { POST: uploadBodyPicture } = await import("@/app/api/admin/media/route");
const { POST: uploadAlbumPhoto } = await import("@/app/api/admin/gallery/[id]/photos/route");
const { createAlbum, deletePhoto } = await import("@/modules/content/gallery/service");
const { deleteMediaAsset, sweepOrphanAssets } = await import("@/modules/media/references");
const { assetObjectKeys, objectKey, readLocalObject } = await import("@/modules/media/storage");
const { isLadderKeyPrefix, LADDER_WIDTHS, ladderWidths } = await import("@/modules/media/ladder");

const T0 = new Date("2026-09-25T10:00:00.000Z");

/** A poster: a flat field and lettering, the case "Înaltă" exists for. */
const poster = () =>
  sharp({ create: { width: 1080, height: 1350, channels: 3, background: "#0b3d91" } })
    .composite([
      {
        input: Buffer.from("<svg xmlns='http://www.w3.org/2000/svg' width='1080' height='300'><text x='40' y='200' font-size='120' fill='#fff'>CROSUL 2026</text></svg>"),
        top: 200,
        left: 0,
      },
    ])
    .png()
    .toBuffer();
const photo = () => sharp({ create: { width: 2000, height: 1500, channels: 3, background: "#2255ee" } }).jpeg().toBuffer();

function form(file: Buffer, name: string, quality?: string): Request {
  const body = new FormData();
  body.append("file", new File([new Uint8Array(file)], name, { type: "image/png" }));
  body.append("originalFilename", name);
  if (quality !== undefined) body.append("quality", quality);
  return new Request("http://localhost/api/admin/media", { method: "POST", body });
}

async function objectsOf(keyPrefix: string): Promise<string[]> {
  const present: string[] = [];
  for (const key of assetObjectKeys(keyPrefix)) if (await readLocalObject(key)) present.push(key.split("/").pop() as string);
  return present;
}

describe("§414 the quality beside the upload, and the ladder it leaves", () => {
  let db: TestDatabase;
  let close: () => Promise<void>;
  let editor: StaffUser;

  beforeAll(async () => {
    ({ db, close } = await createTestDatabase());
    state.db = db;
  });
  afterAll(async () => close());

  beforeEach(async () => {
    await resetTables(db);
    [editor] = await db.insert(staffUsers).values({ email: "mod@dev.test", displayName: "Mod", role: "ADMIN" }).returning();
    state.actor = editor;
  });

  it("stores a picture from the editor at «Înaltă» near-lossless, with every rung, and says so", async () => {
    const response = await uploadBodyPicture(form(await poster(), "afis.png", "high"));
    expect(response.status).toBe(201);
    const answer = (await response.json()) as {
      src: string;
      width: number;
      stored: {
        quality: string;
        encoding: string;
        width: number;
        height: number;
        files: number;
        bytes: number;
        totalBytes: number;
        topRung: { width: number; bytes: number } | null;
      };
    };
    expect(answer.stored).toMatchObject({ quality: "high", encoding: "nearLossless", width: 1080, height: 1350, files: 5 });
    // The widest smaller copy is told too (§NNN): 960 under a 1080-pixel master, with its weight.
    expect(answer.stored.topRung?.width).toBe(960);
    expect(answer.stored.topRung?.bytes).toBeGreaterThan(0);
    expect(answer.stored.totalBytes).toBeGreaterThan(answer.stored.bytes);

    // The address a body carries is the master, as it always was, under a prefix marked as laddered.
    const prefix = /\/([0-9a-f-]{36})\/web\.webp$/.exec(answer.src)?.[1] as string;
    expect(isLadderKeyPrefix(prefix)).toBe(true);
    expect(await objectsOf(prefix)).toEqual(["web.webp", "thumb.webp", ...ladderWidths(1080).map((w) => `${w}w.webp`)]);
    const rung = await readLocalObject(objectKey(prefix, 960));
    expect(rung?.contentType).toBe("image/webp");
    expect((await sharp(rung!.body).metadata()).width).toBe(960);
  });

  it("takes «Minimă» and «Originală» as the two new words, and says which was stored (§NNN)", async () => {
    for (const quality of ["low", "original"] as const) {
      const response = await uploadBodyPicture(form(await photo(), "start.jpg", quality));
      expect(response.status, quality).toBe(201);
      const { stored } = (await response.json()) as { stored: { quality: string; files: number; width: number } };
      expect(stored.quality).toBe(quality);
      expect(stored.files).toBe(2 + ladderWidths(stored.width).length);
    }
    expect(await db.select().from(mediaAssets)).toHaveLength(2);
  });

  it("reads no choice as «Normală», and refuses a value that is neither, writing nothing", async () => {
    const plain = await uploadBodyPicture(form(await photo(), "start.jpg"));
    expect(plain.status).toBe(201);
    expect(((await plain.json()) as { stored: { quality: string; encoding: string } }).stored).toMatchObject({ quality: "normal", encoding: "lossy" });

    for (const refused of ["max", "HIGH", "0"]) {
      const response = await uploadBodyPicture(form(await photo(), "start.jpg", refused));
      expect(response.status, refused).toBe(400);
      expect(await response.json()).toEqual({ error: "VALIDATION_ERROR", detail: "quality" });
    }
    expect(await db.select().from(mediaAssets)).toHaveLength(1);
  });

  it("takes an album's photo at the chosen quality, and a removed photo takes its whole ladder with it", async () => {
    const album = await createAlbum(db, {
      actor: editor,
      fields: {
        takenOn: "2026-10-11",
        eventId: "",
        translations: {
          ro: { slug: "crosul", title: "Crosul", description: "" },
          en: { slug: "cross", title: "Cross", description: "" },
        },
      },
    });
    const context = { params: Promise.resolve({ id: album.id }) };
    const refused = await uploadAlbumPhoto(form(await photo(), "IMG_1.JPG", "ultra"), context);
    expect(refused.status).toBe(400);

    const response = await uploadAlbumPhoto(form(await photo(), "IMG_1.JPG", "normal"), context);
    expect(response.status).toBe(201);
    const { itemId, assetId, stored } = (await response.json()) as { itemId: string; assetId: string; stored: { files: number; quality: string } };
    expect(stored).toMatchObject({ quality: "normal", files: 2 + ladderWidths(2000).length });
    const [asset] = await db.select().from(mediaAssets).where(eq(mediaAssets.id, assetId));
    expect(await objectsOf(asset.keyPrefix)).toHaveLength(stored.files);

    await deletePhoto(db, { actor: editor, itemId });
    expect(await objectsOf(asset.keyPrefix)).toEqual([]);
  });

  it("deletes every rung of a picture removed from the list, and of one the sweep takes", async () => {
    const listed = (await (await uploadBodyPicture(form(await photo(), "loose.jpg"))).json()) as { assetId: string };
    const swept = (await (await uploadBodyPicture(form(await poster(), "orphan.png", "high"))).json()) as { assetId: string };
    const prefixOf = async (id: string) => (await db.select().from(mediaAssets).where(eq(mediaAssets.id, id)))[0].keyPrefix;
    const listedPrefix = await prefixOf(listed.assetId);
    const sweptPrefix = await prefixOf(swept.assetId);
    expect(await objectsOf(listedPrefix)).toHaveLength(2 + LADDER_WIDTHS.filter((w) => w < 1800).length);

    await deleteMediaAsset(db, { actor: editor, assetId: listed.assetId });
    expect(await objectsOf(listedPrefix)).toEqual([]);

    // Uploaded now; nothing references it; a week and a day later the sweep takes all of it.
    await db.update(mediaAssets).set({ createdAt: T0, lastReferencedAt: T0 }).where(eq(mediaAssets.id, swept.assetId));
    expect(await sweepOrphanAssets(db, new Date(T0.getTime() + 8 * 24 * 60 * 60_000))).toBe(1);
    expect(await objectsOf(sweptPrefix)).toEqual([]);
  });
});
