import { describe, expect, it } from "vitest";
import { isPrivatePath } from "@/shared/security/private-paths";

/**
 * BR-REQ-051-02 criterion 2 — a preview is noindex and never publicly cached.
 * BR-REQ-060-01 — the backoffice is not public content.
 *
 * The proxy adds `X-Robots-Tag: noindex` and a private, no-store cache policy to these paths.
 * The pages set their own metadata too, but a redirect or a 404 never renders metadata, and
 * those are exactly the responses an anonymous request to the backoffice produces.
 */
describe("BR-REQ-051-02 which paths must never be indexed or cached", () => {
  it.each([
    "/ro/admin",
    "/ro/admin/events/8f0c",
    "/en/admin/staff",
    "/ro/previzualizare/evenimente/8f0c",
    "/en/preview/events/8f0c",
    "/ro/autentificare",
    "/en/sign-in",
    // Unprefixed, on its way to being redirected to a locale.
    "/admin",
  ])("treats %s as private", (path) => {
    expect(isPrivatePath(path)).toBe(true);
  });

  it.each([
    "/ro",
    "/ro/evenimente",
    "/ro/evenimente/crosul-aniversar-brasov-runners",
    "/en/events/tampa-trail",
    "/sitemap.xml",
    "/",
  ])("leaves %s public", (path) => {
    expect(isPrivatePath(path)).toBe(false);
  });

  it("matches whole segments, not prefixes of longer words", () => {
    // A public event whose slug begins with a private word must stay public.
    expect(isPrivatePath("/ro/evenimente/administrare-club")).toBe(false);
    expect(isPrivatePath("/en/events/preview-of-the-season")).toBe(false);
  });
});
