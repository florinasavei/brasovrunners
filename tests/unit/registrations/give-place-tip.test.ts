import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PlacesTaken } from "@/modules/registrations/domain/capacity";

/**
 * `DECISIONS.md` §NNN — «Dă-i un loc» on a full race stays, and an «i» beside it says why the press
 * will be refused, in the refusal banner's own words (§589), which now end by saying what to do
 * first: raise the event's capacity. No overbooking from the desk (AGENTS.md §10.6).
 */
let currentLocale: "ro" | "en" = "ro";
let full: PlacesTaken | null = null;

vi.mock("next-intl/server", async () => {
  const { createTranslator } = await import("next-intl");
  const ro = (await import("../../../messages/ro.json")).default;
  const en = (await import("../../../messages/en.json")).default;
  return {
    getTranslations: async (namespace: string) =>
      createTranslator({ locale: currentLocale, messages: currentLocale === "ro" ? ro : en, namespace: namespace as "Admin" }),
  };
});

// The door read is the database's; the render only asks whether the race is full, and with what.
vi.mock("@/modules/registrations/give-place-tip", async () => {
  const { getTranslations } = await import("next-intl/server");
  const { placesTakenValues } = await import("@/modules/registrations/domain/capacity");
  return {
    givePlaceRefusalAhead: async () => (full ? (await getTranslations("Admin"))("errors.NO_FREE_PLACE", placesTakenValues(full)) : null),
  };
});

const { default: GivePlaceButton } = await import("@/modules/registrations/ui/GivePlaceButton");
const { createTranslator } = await import("next-intl");
const { noFreePlace, noFreePlaceValues } = await import("@/modules/registrations/domain/capacity");
const ro = (await import("../../../messages/ro.json")).default;
const en = (await import("../../../messages/en.json")).default;

const render = async (locale: "ro" | "en") => {
  currentLocale = locale;
  return renderToStaticMarkup(await GivePlaceButton({ eventId: "event" }));
};

describe("§NNN «Dă-i un loc» says why before the press", () => {
  beforeEach(() => {
    full = null;
  });

  it("on a full race: the button stays, with an «i» whose words are the refusal's, in both languages", async () => {
    full = noFreePlace(3, { confirmed: 1, pendingDeclarationHolds: 0, unexpiredWaitlistOfferedHolds: 0, familyReservations: 2 });
    const roHtml = await render("ro");
    expect(roHtml).toContain("Dă-i un loc");
    expect(roHtml).toContain(
      'aria-label="Cursa e plină: locuri 3, confirmați 1, declarații de semnat 0, oferite 0, rezervate familiilor 2. Mărește întâi capacitatea evenimentului."',
    );
    // The «i» is a plain button: a tap on it reads the sentence, it never submits the press's form.
    expect(roHtml.match(/type="button"/g)?.length ?? 0).toBeGreaterThanOrEqual(1);
    expect(roHtml).toMatch(/<button[^>]*type="button"[^>]*aria-label="Cursa e plină/);
    expect(roHtml.match(/type="submit"/g)?.length ?? 0).toBeLessThanOrEqual(1);
    const enHtml = await render("en");
    expect(enHtml).toContain("Give a place");
    expect(enHtml).toContain("The race is full: places 3, confirmed 1, declarations to sign 0, offered 0, reserved for families 2. Raise the event&#x27;s capacity first.");
  });

  it("with a place free: the button alone, no «i»", async () => {
    expect(noFreePlace(3, { confirmed: 1, pendingDeclarationHolds: 0, unexpiredWaitlistOfferedHolds: 0, familyReservations: 1 })).toBeNull();
    expect(noFreePlace(null, { confirmed: 9, pendingDeclarationHolds: 0, unexpiredWaitlistOfferedHolds: 0 })).toBeNull();
    const html = await render("ro");
    expect(html).toContain("Dă-i un loc");
    expect(html).not.toContain("Cursa e plină");
    expect(html).not.toContain("aria-label=");
  });

  it("the refusal banner ends by saying what to do first, in both languages", () => {
    const values = noFreePlaceValues("NO_FREE_PLACE", { capacity: "3", confirmed: "1", declaration: "0", offered: "0", family: "2" });
    const banner = (messages: typeof ro, locale: "ro" | "en") => createTranslator({ locale, messages, namespace: "Admin" })("errors.NO_FREE_PLACE", values);
    expect(banner(ro, "ro").endsWith("Mărește întâi capacitatea evenimentului.")).toBe(true);
    expect(banner(en as typeof ro, "en").endsWith("Raise the event's capacity first.")).toBe(true);
    // Plain words, inside §511's 200 characters, with the numbers in.
    expect(banner(ro, "ro").length).toBeLessThanOrEqual(200);
  });
});
