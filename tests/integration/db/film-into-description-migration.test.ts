import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseRichText } from "@/modules/content/rich-text/domain/schema";

/**
 * Migration `0092_film_into_description` (§481; the owner, 2026-09-27: «Cardul cu filmul poate să
 * dispară pentru că putem pune YouTube direct în descrierea completă»), proven on real PostgreSQL
 * (PGlite): the database is built up to the migration before it, events are written the way the
 * film section stored them, and then the rest of the migrations run over them — as
 * `yarn db:migrate:env` runs them over production.
 *
 * - an event with a film and a description in both languages: the film is appended to the END of
 *   each language's description, as the node the rich-text schema parses, with its stored poster;
 * - a language with no description gets one that is only the film;
 * - a description that already shows that film gets no second copy;
 * - a link no video id can be read from, and an event with no film, are untouched;
 * - every touched translation's version moves on (a stale editor tab is refused, not obeyed);
 * - the columns stay, and the file only writes rows — no drop, no rename (AGENTS.md §7.6).
 */
const MIGRATIONS = "src/db/migrations";
const TAG = "0092_film_into_description";

type Journal = { entries: Array<{ idx: number; tag: string; when: number }> };

const POSTER = "https://media.example.test/qa/yt-dQw4w9WgXcQ/web.webp";
const paragraph = (text: string) => ({ type: "paragraph", content: [{ type: "text", text }] });
const doc = (...content: unknown[]) => ({ type: "doc", content });
const FILM_NODE = (videoId: string, poster: string | null) => ({
  type: "youtube",
  attrs: { videoId, caption: "", widthPercent: 100, align: "block", poster, posterSource: poster ? "youtube" : null },
});

let client: PGlite;
let folder: string;
const ids: Record<string, string> = {};

async function insertEvent(name: string, videoUrl: string | null, posterUrl: string | null) {
  const { rows } = await client.query<{ id: string }>(
    "INSERT INTO events (type, starts_at, video_url, video_poster_url) VALUES ('RACE', '2026-11-21T08:00:00Z', $1, $2) RETURNING id",
    [videoUrl, posterUrl],
  );
  ids[name] = rows[0].id;
}

async function insertTranslation(name: string, locale: "ro" | "en", body: unknown) {
  await client.query("INSERT INTO event_translations (event_id, locale, slug, title, body_json) VALUES ($1, $2, $3, $4, $5)", [
    ids[name],
    locale,
    `${name}-${locale}`,
    `${name} ${locale}`,
    body === null ? null : JSON.stringify(body),
  ]);
}

async function translation(name: string, locale: "ro" | "en") {
  const { rows } = await client.query<{ body_json: unknown; version: number }>(
    "SELECT body_json, version FROM event_translations WHERE event_id = $1 AND locale = $2",
    [ids[name], locale],
  );
  return rows[0];
}

beforeAll(async () => {
  const journal = JSON.parse(readFileSync(`${MIGRATIONS}/meta/_journal.json`, "utf8")) as Journal;
  const position = journal.entries.findIndex((entry) => entry.tag === TAG);
  expect(position, "the journal lists the migration").toBeGreaterThan(0);
  expect(journal.entries[position].when, "sorts after the migration before it").toBeGreaterThan(journal.entries[position - 1].when);

  // Every migration before this one, in a folder of its own.
  folder = mkdtempSync(path.join(tmpdir(), "film-into-description-"));
  cpSync(MIGRATIONS, folder, { recursive: true });
  writeFileSync(path.join(folder, "meta", "_journal.json"), JSON.stringify({ ...journal, entries: journal.entries.slice(0, position) }));

  client = new PGlite();
  await migrate(drizzle(client), { migrationsFolder: folder });

  // The race with last year's film, a description in Romanian and none in English.
  await insertEvent("race", "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s", POSTER);
  await insertTranslation("race", "ro", doc(paragraph("Crosul Tâmpei")));
  await insertTranslation("race", "en", null);
  // A short link whose film the organizer already pasted into the English description.
  await insertEvent("pasted", "https://youtu.be/abcdefghijk", null);
  await insertTranslation("pasted", "ro", doc(paragraph("Alergare")));
  await insertTranslation("pasted", "en", doc(FILM_NODE("abcdefghijk", null), paragraph("Run")));
  // A shorts link with a poster this site did not store (never copied into a node).
  await insertEvent("shorts", "https://m.youtube.com/shorts/ABCDEFGHIJK", "https://elsewhere.example.test/poster.jpg");
  await insertTranslation("shorts", "ro", doc());
  await insertTranslation("shorts", "en", doc());
  // A link no id can be read from, and an event with no film at all.
  await insertEvent("vimeo", "https://vimeo.example.test/1", null);
  await insertTranslation("vimeo", "ro", doc(paragraph("Nimic")));
  await insertEvent("plain", null, null);
  await insertTranslation("plain", "ro", doc(paragraph("Fără film")));

  // Then this migration over those rows — and no further: contract migration 0093 (§NNN) drops the
  // two columns, and the last case below runs it on its own.
  writeFileSync(path.join(folder, "meta", "_journal.json"), JSON.stringify({ ...journal, entries: journal.entries.slice(0, position + 1) }));
  await migrate(drizzle(client), { migrationsFolder: folder });
});

afterAll(async () => {
  await client?.close();
  if (folder) rmSync(folder, { recursive: true, force: true });
});

describe("§481 migration 0092_film_into_description — the film section's links move into the descriptions", () => {
  it("appends the film to the END of each language's description, with the stored poster, as the schema parses it", async () => {
    const ro = await translation("race", "ro");
    expect(ro.body_json).toEqual(doc(paragraph("Crosul Tâmpei"), FILM_NODE("dQw4w9WgXcQ", POSTER)));
    expect(parseRichText(ro.body_json).content?.at(-1)).toEqual({
      type: "youtube",
      attrs: { videoId: "dQw4w9WgXcQ", caption: "", widthPercent: 100, align: "block", poster: POSTER, posterSource: "youtube" },
    });
  });

  it("gives a language with no description one that is only the film", async () => {
    const en = await translation("race", "en");
    expect(en.body_json).toEqual(doc(FILM_NODE("dQw4w9WgXcQ", POSTER)));
    expect(() => parseRichText(en.body_json)).not.toThrow();
  });

  it("reads a short link, and never adds a second copy of a film already in the description", async () => {
    expect((await translation("pasted", "ro")).body_json).toEqual(doc(paragraph("Alergare"), FILM_NODE("abcdefghijk", null)));
    const en = await translation("pasted", "en");
    expect(en.body_json).toEqual(doc(FILM_NODE("abcdefghijk", null), paragraph("Run")));
    expect(en.version).toBe(1);
  });

  it("reads a shorts link, and leaves a poster this site did not store out of the node (the next save fetches one)", async () => {
    const ro = await translation("shorts", "ro");
    expect(ro.body_json).toEqual(doc(FILM_NODE("ABCDEFGHIJK", null)));
    expect(() => parseRichText(ro.body_json)).not.toThrow();
  });

  it("leaves a link no video id can be read from, and an event with no film, exactly as they were", async () => {
    expect(await translation("vimeo", "ro")).toEqual({ body_json: doc(paragraph("Nimic")), version: 1 });
    expect(await translation("plain", "ro")).toEqual({ body_json: doc(paragraph("Fără film")), version: 1 });
  });

  it("moves each touched translation's version on, so a tab opened before it is refused as stale", async () => {
    expect((await translation("race", "ro")).version).toBe(2);
    expect((await translation("race", "en")).version).toBe(2);
    expect((await translation("pasted", "ro")).version).toBe(2);
  });

  it("keeps the two columns — their drop is a later contract migration — and writes rows only (AGENTS.md §7.6)", async () => {
    const { rows } = await client.query<{ column_name: string }>(
      "SELECT column_name FROM information_schema.columns WHERE table_name = 'events' AND column_name IN ('video_url', 'video_poster_url') ORDER BY column_name",
    );
    expect(rows.map((row) => row.column_name)).toEqual(["video_poster_url", "video_url"]);
    const { rows: race } = await client.query<{ video_url: string | null }>("SELECT video_url FROM events WHERE id = $1", [ids.race]);
    expect(race[0].video_url).toBe("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s");
    const sql = readFileSync(`${MIGRATIONS}/${TAG}.sql`, "utf8").replace(/--[^\n]*/g, "");
    expect(sql).not.toMatch(/\b(DROP|RENAME|ALTER|CREATE)\b/i);
    expect(sql).toMatch(/UPDATE "event_translations"/);
  });
});

/**
 * The contract that follows it (§NNN): migration 0093 drops `events.video_url`,
 * `events.video_poster_url` and their CHECK in the release after BR-V2.08 stopped reading them —
 * and nothing the films moved into is touched. Runs last in this file, over the same rows, as
 * `yarn db:migrate:env` runs every pending migration over production.
 */
describe("§NNN migration 0093_film_columns_and_six_links_retired — the film columns go, the films stay", () => {
  it("drops the two columns and their CHECK, and leaves every description and version as 0092 left it", async () => {
    const before = {
      race: [await translation("race", "ro"), await translation("race", "en")],
      pasted: [await translation("pasted", "ro"), await translation("pasted", "en")],
      plain: await translation("plain", "ro"),
    };

    await migrate(drizzle(client), { migrationsFolder: MIGRATIONS });

    const { rows: columns } = await client.query<{ column_name: string }>(
      "SELECT column_name FROM information_schema.columns WHERE table_name = 'events' AND column_name IN ('video_url', 'video_poster_url')",
    );
    expect(columns).toEqual([]);
    const { rows: checks } = await client.query<{ conname: string }>("SELECT conname FROM pg_constraint WHERE conname = 'events_video_url_is_https'");
    expect(checks).toEqual([]);

    expect([await translation("race", "ro"), await translation("race", "en")]).toEqual(before.race);
    expect([await translation("pasted", "ro"), await translation("pasted", "en")]).toEqual(before.pasted);
    expect(await translation("plain", "ro")).toEqual(before.plain);
    const { rows: events } = await client.query<{ n: number }>("SELECT count(*)::int AS n FROM events");
    expect(events[0].n).toBe(5);
  });

  it("is a contract alone in its file, naming the release that stopped using what it drops (AGENTS.md §7.6)", () => {
    const text = readFileSync(`${MIGRATIONS}/0093_film_columns_and_six_links_retired.sql`, "utf8");
    expect(text).toMatch(/^-- contract: BR-V2\.08 /m);
    const sql = text.replace(/--[^\n]*/g, "");
    expect(sql).toMatch(/DROP COLUMN "video_url"/);
    expect(sql).toMatch(/DROP COLUMN "video_poster_url"/);
    expect(sql).not.toMatch(/\b(ADD|CREATE|INSERT|UPDATE)\b/i);
  });
});
