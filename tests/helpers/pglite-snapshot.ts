import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";

/**
 * A migrated PostgreSQL, built once and loaded by every test file (the test-suite decision of 2026-10-20, amending §171).
 *
 * `createTestDatabase()` used to start a fresh PGlite and apply every migration — 177 of them — in each of the ~370
 * files that need a database: about three and a half seconds of WebAssembly start-up and DDL per file, on the owner's
 * machine and on CI's four cores alike, before the first test ran. Measured here: start 2.2 s, migrate 1.1 s; loading
 * the same data directory from a tarball 0.5 s. So the migrated data directory is dumped once per **migrations
 * tree** (`PGlite#dumpDataDir`, uncompressed, about 45 MB) into `node_modules/.cache/pglite/`, named by the SHA-256 of
 * the journal and every migration file, and each test file starts from that tarball (`loadDataDir`). A migration
 * added or changed makes a new name, so a stale snapshot is never loaded; the old files are left to the cache.
 *
 * Built by vitest's `globalSetup` before the workers start, so a cold cache costs one build, not one per worker;
 * `createTestDatabase` builds it itself when the file is missing (a runner without the global setup), writing to a
 * temporary name and renaming, so two processes racing never read a half-written tarball.
 *
 * The migration tests under `tests/integration/db/` build their own PGlite from the SQL files on purpose — they prove
 * the migrations, which a snapshot would assume — and do not use this.
 */
const MIGRATIONS = path.resolve("src/db/migrations");
const CACHE = path.resolve("node_modules/.cache/pglite");

/** The snapshot's name: the migrations as they are — the journal and every `.sql`, in name order. */
export function snapshotPath(): string {
  const hash = createHash("sha256");
  hash.update(readFileSync(path.join(MIGRATIONS, "meta", "_journal.json")));
  for (const file of readdirSync(MIGRATIONS).filter((name) => name.endsWith(".sql")).sort()) {
    hash.update(file);
    hash.update(readFileSync(path.join(MIGRATIONS, file)));
  }
  return path.join(CACHE, `migrated-${hash.digest("hex").slice(0, 16)}.tar`);
}

/** The migrated data directory as a tarball on disk, built now if it is not there; its path. */
export async function ensureSnapshot(): Promise<string> {
  const file = snapshotPath();
  if (existsSync(file)) return file;
  const client = new PGlite();
  try {
    await migrate(drizzle(client), { migrationsFolder: MIGRATIONS });
    const dump = await client.dumpDataDir("none");
    mkdirSync(CACHE, { recursive: true });
    const temporary = `${file}.${process.pid}.tmp`;
    writeFileSync(temporary, Buffer.from(await dump.arrayBuffer()));
    // Atomic on every platform the suite runs on: a reader sees the whole file or none.
    renameSync(temporary, file);
  } finally {
    await client.close();
  }
  return file;
}

/** A PGlite started from the snapshot: every migration applied, no rows, in about half a second. */
export async function migratedPglite(): Promise<PGlite> {
  const file = await ensureSnapshot();
  const client = new PGlite({ loadDataDir: new Blob([readFileSync(file)]) });
  await client.waitReady;
  return client;
}
