import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { env } from "@/shared/config/env";
import { formerKeyPrefixOf, isLadderKeyPrefix, LADDER_WIDTHS } from "./ladder";

/**
 * Where a photo's bytes live, behind AGENTS.md §17's adapter ("read metadata" is the row's job).
 * `env.STORAGE_MODE`: `local` (`.media/`, served by `/api/media/[...key]`), `fake` (an in-process
 * Map, same route), `r2` (served by Cloudflare at `R2_PUBLIC_BASE_URL`), or `unconfigured`
 * (refused with a readable sentence).
 *
 * Keys are prefixed with the environment so environments can share one bucket:
 * `<env>/<prefix>/{web,thumb,<width>w}.webp` (§414).
 */

/** `web` (the master), `thumb`, or a rung of the ladder by its width (§414, `ladder.ts`). */
export type StoredVariant = "web" | "thumb" | number;

export type Storage = {
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  /** The object's bytes, or `null` (§281): for snapshots read back when the database failed. */
  get(key: string): Promise<Buffer | null>;
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
  return `${env.APP_ENV}/${keyPrefix}/${typeof variant === "number" ? `${variant}w` : variant}.webp`;
}

/**
 * Every object an asset may own, every rung included whatever its width (§414): deleting a key
 * never written is a no-op, so callers need not know the picture's width.
 */
export function assetObjectKeys(keyPrefix: string): string[] {
  const keys = [objectKey(keyPrefix, "web"), objectKey(keyPrefix, "thumb")];
  if (isLadderKeyPrefix(keyPrefix)) {
    keys.push(...LADDER_WIDTHS.map((width) => objectKey(keyPrefix, width)));
    /* The two files a §430 conversion kept at the old address. */
    const former = formerKeyPrefixOf(keyPrefix);
    keys.push(objectKey(former, "web"), objectKey(former, "thumb"));
  }
  return keys;
}

/** Remove every object of an asset, best effort: the row is already gone (§66 "rows first"). */
export async function deleteAssetObjects(storage: Storage, keyPrefix: string): Promise<void> {
  for (const key of assetObjectKeys(keyPrefix)) await storage.delete(key).catch(() => undefined);
}

const LOCAL_ROOT = path.join(process.cwd(), ".media");

/** Refuses a key that could escape the directory. Keys are ours, but the route echoes them. */
function safeLocalPath(key: string): string {
  const resolved = path.resolve(LOCAL_ROOT, key);
  if (!resolved.startsWith(LOCAL_ROOT + path.sep)) throw new Error(`refusing key ${key}`);
  return resolved;
}

const localStorage: Storage = {
  async get(key) {
    try {
      return await readFile(safeLocalPath(key));
    } catch {
      return null;
    }
  },
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

/**
 * One Map per process, on `globalThis`: a production build gives each route its own module
 * instance, and two Maps would keep serving a deleted photo.
 */
const fakeObjects: Map<string, { body: Buffer; contentType: string }> = ((
  globalThis as { __brFakeMedia?: Map<string, { body: Buffer; contentType: string }> }
).__brFakeMedia ??= new Map());

/** A fake-store miss falls back to `.media/`, read-only, under `E2E_FAKE_MEDIA_FROM_DISK` (§430). */
async function fakeObject(key: string): Promise<{ body: Buffer; contentType: string } | null> {
  const stored = fakeObjects.get(key);
  if (stored) return stored;
  if (!env.E2E_FAKE_MEDIA_FROM_DISK) return null;
  try {
    return { body: await readFile(safeLocalPath(key)), contentType: "image/webp" };
  } catch {
    return null;
  }
}

const fakeStorage: Storage = {
  async put(key, body, contentType) {
    fakeObjects.set(key, { body, contentType });
  },
  async get(key) {
    return (await fakeObject(key))?.body ?? null;
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
  if (env.STORAGE_MODE === "fake") return fakeObject(key);
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
    async get(key) {
      try {
        const answer = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
        const bytes = await answer.Body?.transformToByteArray();
        return bytes ? Buffer.from(bytes) : null;
      } catch {
        // Missing or failing, the answer is "no copy": this path already follows a database failure.
        return null;
      }
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

/**
 * The address a body carries: https on R2, a site-relative path otherwise — the only two shapes
 * `rich-text/domain/schema.ts` accepts.
 */
export function bodyImageSrc(key: string): string {
  const url = getStorage().publicUrl(key);
  return url.startsWith("https://") ? url : new URL(url).pathname;
}

/** The host a browser reads pictures from, for the network check (§436, §66). */
export function publicPictureHost(): string {
  return new URL(env.STORAGE_MODE === "r2" && env.R2_PUBLIC_BASE_URL ? env.R2_PUBLIC_BASE_URL : env.APP_BASE_URL).host;
}

/** For the task board and the uploader's empty state: can this environment take a photo? */
export function isStorageConfigured(): boolean {
  return env.STORAGE_MODE !== "unconfigured";
}
