import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { DeleteObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { env } from "@/shared/config/env";

/**
 * Where a photo's bytes live, behind the four-method adapter of AGENTS.md §17 — three of
 * them; "read metadata" is the database's job here, because the row records the dimensions and
 * size at upload and nothing needs to ask the bucket.
 *
 * Three implementations, chosen by `env.STORAGE_MODE` (derived, `env.ts`):
 *
 *   - `local`: files under `.media/` in the working directory, served back by
 *     `/api/media/[...key]` — a developer's laptop needs no bucket;
 *   - `fake`: a Map in this process, served by the same route — the test suites need no disk;
 *   - `r2`: Cloudflare R2 through its S3 API, read back at `R2_PUBLIC_BASE_URL` — Cloudflare
 *     serves the image, never a function, and egress is free.
 *
 * `unconfigured` is the fourth state and not an implementation: a deployed environment whose
 * five `R2_*` variables are not all set has no storage, and asking for one is refused with the
 * sentence the organizer needs rather than a stack trace.
 *
 * Keys are opaque and prefixed with the environment (`qa/…`, `production/…`), so two
 * environments can share one bucket without either seeing the other's photos; the objects
 * are always the two WebP variants of an asset, `<prefix>/web.webp` and `<prefix>/thumb.webp`.
 */

export type StoredVariant = "web" | "thumb";

export type Storage = {
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  delete(key: string): Promise<void>;
  /** The address a browser loads the object from. */
  publicUrl(key: string): string;
};

export class StorageUnavailableError extends Error {
  constructor() {
    super("photo storage is not configured for this environment (SETUP.md §32)");
    this.name = "StorageUnavailableError";
  }
}

/** The object key of one variant of one asset: environment, opaque prefix, variant. */
export function objectKey(keyPrefix: string, variant: StoredVariant): string {
  return `${env.APP_ENV}/${keyPrefix}/${variant}.webp`;
}

const LOCAL_ROOT = path.join(process.cwd(), ".media");

/** Refuses a key that could escape the directory. Keys are ours, but the route echoes them. */
function safeLocalPath(key: string): string {
  const resolved = path.resolve(LOCAL_ROOT, key);
  if (!resolved.startsWith(LOCAL_ROOT + path.sep)) throw new Error(`refusing key ${key}`);
  return resolved;
}

const localStorage: Storage = {
  async put(key, body) {
    const file = safeLocalPath(key);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, body);
  },
  async delete(key) {
    await rm(safeLocalPath(key), { force: true });
  },
  publicUrl(key) {
    return `${env.APP_BASE_URL}/api/media/${key}`;
  },
};

/** One Map per process: the test suites and the end-to-end server each get their own. */
const fakeObjects = new Map<string, { body: Buffer; contentType: string }>();

const fakeStorage: Storage = {
  async put(key, body, contentType) {
    fakeObjects.set(key, { body, contentType });
  },
  async delete(key) {
    fakeObjects.delete(key);
  },
  publicUrl(key) {
    return `${env.APP_BASE_URL}/api/media/${key}`;
  },
};

/** What `/api/media/[...key]` serves in `local` and `fake` mode. Null when nothing is there. */
export async function readLocalObject(key: string): Promise<{ body: Buffer; contentType: string } | null> {
  if (env.STORAGE_MODE === "fake") return fakeObjects.get(key) ?? null;
  if (env.STORAGE_MODE === "local") {
    try {
      return { body: await readFile(safeLocalPath(key)), contentType: "image/webp" };
    } catch {
      return null;
    }
  }
  return null;
}

let r2Client: S3Client | undefined;

function r2Storage(): Storage {
  const bucket = env.R2_BUCKET as string;
  const client = (r2Client ??= new S3Client({
    region: "auto",
    endpoint: env.R2_ENDPOINT,
    credentials: {
      accessKeyId: env.R2_ACCESS_KEY_ID as string,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY as string,
    },
  }));
  return {
    async put(key, body, contentType) {
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: body,
          ContentType: contentType,
          // A year, immutable: the key never changes meaning, and a replaced photo is a new key.
          CacheControl: "public, max-age=31536000, immutable",
        }),
      );
    },
    async delete(key) {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    },
    publicUrl(key) {
      return `${(env.R2_PUBLIC_BASE_URL as string).replace(/\/$/, "")}/${key}`;
    },
  };
}

export function getStorage(): Storage {
  switch (env.STORAGE_MODE) {
    case "local":
      return localStorage;
    case "fake":
      return fakeStorage;
    case "r2":
      return r2Storage();
    case "unconfigured":
      throw new StorageUnavailableError();
  }
}

/** For the task board and the uploader's empty state: can this environment take a photo? */
export function isStorageConfigured(): boolean {
  return env.STORAGE_MODE !== "unconfigured";
}
