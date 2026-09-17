import { readLocalObject } from "@/modules/media/storage";

/**
 * Serves a stored photo in the two modes that have no bucket — `local` (a developer's disk)
 * and `fake` (tests). In `r2` mode the address of a photo is Cloudflare's, this route is never
 * linked, and asking it for anything is a 404. Only ever WebP variants this application wrote.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ key: string[] }> },
): Promise<Response> {
  const { key } = await context.params;
  const object = await readLocalObject(key.join("/"));
  if (!object) return new Response(null, { status: 404 });
  return new Response(new Uint8Array(object.body), {
    status: 200,
    headers: {
      "Content-Type": object.contentType,
      "Content-Length": String(object.body.byteLength),
      "Cache-Control": "public, max-age=3600",
    },
  });
}
