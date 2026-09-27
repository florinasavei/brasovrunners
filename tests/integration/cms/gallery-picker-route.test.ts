import { eq } from "drizzle-orm";
import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mediaAssets } from "@/db/schema/gallery";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * BR-REQ-050-03, BR-REQ-060-01, `DECISIONS.md` §NNN — the list every «Din galerie» reads,
 * through the route a browser asks: newest first; narrowed by name (accents and case ignored)
 * and by where a picture is used before the cap; a film's automatic poster only when asked for;
 * the stored size and weight for the caption under each thumbnail; and only for the roles that
 * may put a picture somewhere — a volunteer's backoffice is the desk.
 */
const state = vi.hoisted(() => ({ db: undefined as unknown, actor: undefined as unknown }));

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }) }));
vi.mock("@/auth", () => ({ signOut: async () => {} }));
vi.mock("@/db/client", () => ({ getDb: () => state.db }));
vi.mock("@/modules/staff-identity/session", () => ({
  DEV_STAFF_COOKIE: "dev-staff",
  requireStaff: async () => state.actor,
  requireStaffCapability: async () => state.actor,
}));

const { GET } = await import("@/app/api/admin/media/route");
const { uploadBodyImage } = await import("@/modules/media/service");
const { createPage } = await import("@/modules/content/pages/service");
const { ensureYoutubePoster } = await import("@/modules/media/video-poster");

type Listed = { id: string; name: string; width: number; height: number; bytes: number; uses: string[]; poster: boolean };

async function list(query = ""): Promise<{ status: number; assets: Listed[] }> {
  const response = await GET(new Request(`http://localhost/api/admin/media${query}`));
  const body = (await response.json()) as { assets?: Listed[] };
  return { status: response.status, assets: body.assets ?? [] };
}

const photo = (color: string) => sharp({ create: { width: 1200, height: 800, channels: 3, background: color } }).jpeg().toBuffer();

describe("§NNN GET /api/admin/media — what «Din galerie» lists", () => {
  let db: TestDatabase;
  let close: () => Promise<void>;
  let editor: StaffUser;
  const staff = async (role: StaffUser["role"]) =>
    (await db.insert(staffUsers).values({ email: `${role.toLowerCase()}@dev.test`, displayName: role, role }).returning())[0];

  beforeAll(async () => {
    ({ db, close } = await createTestDatabase());
    state.db = db;
  });
  afterAll(async () => close());

  beforeEach(async () => {
    await resetTables(db);
    editor = await staff("ADMIN");
    state.actor = editor;
  });

  /** Three pictures a minute apart, the oldest first, plus a film's automatic poster, newest of all. */
  async function seed() {
    const at = (minute: number) => new Date(Date.UTC(2026, 8, 27, 10, minute));
    const old = await uploadBodyImage(db, { actorId: editor.id, file: await photo("#111111"), originalFilename: "Hartă-veche.jpg" });
    const middle = await uploadBodyImage(db, { actorId: editor.id, file: await photo("#222222"), originalFilename: "afis.jpg" });
    const newest = await uploadBodyImage(db, { actorId: editor.id, file: await photo("#333333"), originalFilename: "portret.jpg" });
    await db.update(mediaAssets).set({ createdAt: at(1) }).where(eq(mediaAssets.id, old.assetId));
    await db.update(mediaAssets).set({ createdAt: at(2) }).where(eq(mediaAssets.id, middle.assetId));
    await db.update(mediaAssets).set({ createdAt: at(3) }).where(eq(mediaAssets.id, newest.assetId));
    const fixture = await sharp({ create: { width: 480, height: 360, channels: 3, background: "#224488" } }).jpeg().toBuffer();
    await ensureYoutubePoster(db, "dQw4w9WgXcQ", { fetchImpl: (async () => new Response(new Uint8Array(fixture), { status: 200 })) as typeof fetch });
    await db.update(mediaAssets).set({ createdAt: at(4) }).where(eq(mediaAssets.keyPrefix, "yt-dQw4w9WgXcQ"));
    // The oldest is used on a standing page.
    await createPage(db, {
      actor: editor,
      fields: {
        navOrder: "10",
        translations: {
          ro: {
            slug: "despre",
            title: "Despre",
            body: JSON.stringify({ type: "doc", content: [{ type: "image", attrs: { src: old.src, alt: "Harta", width: 1200, height: 800 } }] }),
            seoTitle: "",
            seoDescription: "",
          },
          en: { slug: "about", title: "About", body: "", seoTitle: "", seoDescription: "" },
        },
      },
    });
    return { old, middle, newest };
  }

  it("lists the newest first, with the stored size and weight, and leaves a film's poster out", async () => {
    const { old, middle, newest } = await seed();
    const { status, assets } = await list();
    expect(status).toBe(200);
    expect(assets.map((asset) => asset.id)).toEqual([newest.assetId, middle.assetId, old.assetId]);
    const [row] = await db.select().from(mediaAssets).where(eq(mediaAssets.id, newest.assetId));
    expect(assets[0]).toMatchObject({ name: "portret.jpg", width: row.width, height: row.height, bytes: row.byteSize, uses: [], poster: false });
    expect(assets[0].bytes).toBeGreaterThan(0);
  });

  it("offers a film's automatic poster only when the poster picker asks", async () => {
    await seed();
    const { assets } = await list("?posters=1");
    expect(assets).toHaveLength(4);
    expect(assets[0]).toMatchObject({ poster: true });
  });

  it("finds a picture by name, accents and case ignored, and by where it is used", async () => {
    const { old } = await seed();
    expect((await list("?q=HARTA")).assets.map((asset) => asset.id)).toEqual([old.assetId]);
    expect((await list(`?q=${encodeURIComponent("hartă")}`)).assets.map((asset) => asset.id)).toEqual([old.assetId]);
    const onPages = await list("?source=page");
    expect(onPages.assets.map((asset) => asset.id)).toEqual([old.assetId]);
    expect(onPages.assets[0].uses).toEqual(["page"]);
    expect((await list("?source=album")).assets).toEqual([]);
    // An unknown source is no narrowing, never an error.
    expect((await list("?source=nowhere")).assets).toHaveLength(3);
  });

  it("answers 403 to a volunteer, and lists for every role that may put a picture somewhere", async () => {
    await seed();
    state.actor = await staff("CONTRIBUTOR");
    expect(await list()).toEqual({ status: 403, assets: [] });
    for (const role of ["COPYWRITER", "MODERATOR", "SUPERADMIN"] as const) {
      state.actor = await staff(role);
      expect((await list()).status, role).toBe(200);
    }
  });
});
