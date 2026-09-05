import { describe, expect, it } from "vitest";
import { resolveAliasRedirect } from "@/i18n/aliases";
import { routing } from "@/i18n/routing";
import { isPrivatePath } from "@/shared/security/private-paths";

/**
 * The URLs people type that are not the ones this application serves (`src/i18n/aliases.ts`).
 *
 * `/sign-in` and `/autentificare` already work unprefixed, because next-intl resolves an
 * internal route name to each locale's own path. `/login` did not, and answered 404 — which
 * reads as "there is no backoffice here" rather than "that is not what it is called".
 */
describe("sign-in aliases", () => {
  it("sends an unprefixed /login to the unprefixed sign-in route, for next-intl to negotiate", () => {
    // Not `/ro/autentificare`: guessing the default locale here would make `/login` behave
    // differently from `/admin`, which negotiates from Accept-Language like everything else.
    expect(resolveAliasRedirect("/login")).toBe("/sign-in");
  });

  it("keeps the locale a visitor asked for", () => {
    expect(resolveAliasRedirect("/ro/login")).toBe("/ro/autentificare");
    expect(resolveAliasRedirect("/en/login")).toBe("/en/sign-in");
  });

  it("reads the destination from the route table rather than repeating it", () => {
    // Renaming the sign-in path must not leave the alias pointing at a 404, so the target is
    // looked up rather than written out. This asserts the lookup, not a literal.
    const localized = routing.pathnames["/sign-in"] as Record<string, string>;
    expect(resolveAliasRedirect("/en/login")).toBe(`/en${localized.en}`);
  });

  it.each([
    "/",
    "/ro",
    "/en",
    "/evenimente",
    "/ro/evenimente",
    "/ro/admin",
    "/login/extra",
    "/ro/login/extra",
    "/not-an-alias",
  ])("leaves %s alone", (pathname) => {
    expect(resolveAliasRedirect(pathname)).toBeNull();
  });

  /**
   * The redirect is a response of its own. A staff path that is never indexed must not acquire
   * an indexable doorway pointing at it.
   */
  it("treats an alias as a private path, so the redirect is noindex and uncached", () => {
    expect(isPrivatePath("/login")).toBe(true);
    expect(isPrivatePath("/ro/login")).toBe(true);
  });
});
