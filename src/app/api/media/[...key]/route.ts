import { isRouteGpxKey, routeGpxHeaders } from "@/modules/events/domain/route-gpx";
import { readLocalObject } from "@/modules/media/storage";

/**
 * Serves a stored object in the two modes that have no bucket — `local` (a developer's disk)
 * and `fake` (tests). In `r2` mode the address of an object is Cloudflare's, this route is never
 * linked, and asking it for anything is a 404. Only ever objects this application wrote: the WebP
 * variants of a picture, and since §718 the GPX of «Traseul», which goes out as a file to save
 * under its own name (`routeGpxHeaders`) — the header R2 stores with the object.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ key: string[] }> },
): Promise<Response> {
  const { key } = await context.params;
  const path = key.join("/");
  const object = await readLocalObject(path);
  if (!object) return new Response(null, { status: 404 });
  const gpx = isRouteGpxKey(path) ? routeGpxHeaders(path) : null;
  return new Response(new Uint8Array(object.body), {
    status: 200,
    headers: {
      "Content-Type": gpx ? gpx.contentType : object.contentType,
      "Content-Length": String(object.body.byteLength),
      "Cache-Control": "public, max-age=3600",
      ...(gpx ? { "Content-Disposition": gpx.contentDisposition, "X-Content-Type-Options": "nosniff" } : {}),
    },
  });
}
