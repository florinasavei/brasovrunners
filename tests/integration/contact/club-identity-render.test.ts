import { createTranslator } from "next-intl";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { CLUB_NAME } from "@/theme/brand";

/**
 * §NNN — the club's legal identity, composed from the environment the legal texts read
 * (`CLUB_LEGAL_NAME`, `CLUB_REGISTRATION_NUMBER`, §132) and the site's one name (`CLUB_NAME`,
 * §215): the `line` on the «about» pages and the contact page, the `block` under the footer's bar.
 *
 * Every value here is made up — «Asociația Exemplu», «RO00000000», a phone of no network — and
 * the club's own never appears in the repository (the no-literal test beside this one).
 */
const state = vi.hoisted(() => ({
  locale: "ro" as "ro" | "en",
  env: {} as Record<string, string | undefined>,
  addresses: [] as string[],
  phone: null as string | null,
}));

vi.mock("@/shared/config/env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/shared/config/env")>();
  const env = new Proxy(actual.env, {
    get: (target, key) => (typeof key === "string" && key in state.env ? state.env[key] : Reflect.get(target, key)),
  });
  return { ...actual, env };
});

vi.mock("next-intl/server", () => ({
  getLocale: async () => state.locale,
  getTranslations: async (namespace: string) => {
    const catalogue = (state.locale === "ro" ? ro : en) as Record<string, object>;
    return createTranslator({ locale: state.locale, messages: catalogue[namespace] as Record<string, string>, namespace: undefined });
  },
}));

vi.mock("@/modules/public-cache/reads", () => ({
  cachedShownContactAddresses: async () => state.addresses,
  cachedPublicPhone: async () => state.phone,
}));

const { default: ClubIdentity } = await import("@/shared/ui/ClubIdentity");

const LEGAL_NAME = "Asociația Exemplu";
const CIF = "RO00000000";
const SEAT = "Strada Exemplu nr. 1";
const PHONE = "+40 123 456 789";
const SHOWN = "scrie@example.test";
const RECEIVES = "primeste@example.test";

const SET = {
  CLUB_LEGAL_NAME: LEGAL_NAME,
  CLUB_REGISTRATION_NUMBER: CIF,
  CLUB_REGISTERED_ADDRESS: SEAT,
  CONTACT_FORM_TO: RECEIVES,
  CLUB_FACEBOOK_URL: "https://www.facebook.com/exemplu",
  CLUB_INSTAGRAM_URL: "https://www.instagram.com/exemplu",
  CLUB_STRAVA_URL: "https://www.strava.com/clubs/exemplu",
};
const UNSET = {
  CLUB_LEGAL_NAME: undefined,
  CLUB_REGISTRATION_NUMBER: undefined,
  CLUB_REGISTERED_ADDRESS: undefined,
  CONTACT_FORM_TO: undefined,
  CLUB_FACEBOOK_URL: undefined,
  CLUB_INSTAGRAM_URL: undefined,
  CLUB_STRAVA_URL: undefined,
};

async function render(shape: "line" | "block"): Promise<string> {
  const element = shape === "line" ? await ClubIdentity({ shape: "line" }) : await ClubIdentity({ shape: "block" });
  return element ? renderToStaticMarkup(element) : "";
}

/** The text a reader sees: Emotion's inline `<style>` blocks and the tags dropped. */
const text = (html: string) =>
  html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

beforeEach(() => {
  state.locale = "ro";
  state.env = { ...SET };
  state.addresses = [SHOWN];
  state.phone = PHONE;
});

describe("§NNN the identity line", () => {
  it("reads «<legal name> (<site name>) · CIF <CIF>» from the environment and the constant", async () => {
    const html = await render("line");
    expect(html).toContain('data-testid="club-identity-line"');
    expect(text(html)).toBe(`${LEGAL_NAME} (${CLUB_NAME}) · CIF ${CIF}`);
    // One secondary line that wraps at 320 px rather than widening the page.
    expect(html).toMatch(/overflow-wrap:\s*anywhere|MuiTypography-body2/);
  });

  it("leaves the CIF out while it is unset, and says nothing at all without the legal name", async () => {
    state.env.CLUB_REGISTRATION_NUMBER = undefined;
    expect(text(await render("line"))).toBe(`${LEGAL_NAME} (${CLUB_NAME})`);
    state.env = { ...UNSET };
    expect(await render("line")).toBe("");
  });

  it("writes the label once when the variable carries its own («CIF …», as the legal texts read it)", async () => {
    state.env.CLUB_REGISTRATION_NUMBER = `CIF ${CIF}`;
    expect(text(await render("line"))).toBe(`${LEGAL_NAME} (${CLUB_NAME}) · CIF ${CIF}`);
    expect(text(await render("block"))).toContain(`C.I.F. ${CIF}`);
    expect(text(await render("block"))).not.toContain("CIF CIF");
  });

  it("never shows the seat", async () => {
    expect(await render("line")).not.toContain(SEAT);
  });
});

describe("§NNN the footer's identity block", () => {
  it("has the three columns: the legal name with the site's name, C.I.F. and the country; the marks; Contact", async () => {
    const html = await render("block");
    const words = text(html);
    expect(html).toContain('aria-label="Datele clubului"');
    expect(html).toContain('data-testid="club-identity-name"');
    expect(words).toContain(`${LEGAL_NAME} (${CLUB_NAME})`);
    expect(words).toContain(`C.I.F. ${CIF}`);
    expect(words).toContain("România");

    // The bar's own list of marks, each opening in a new tab, named for its network.
    expect(html).toContain('data-testid="club-identity-social"');
    for (const [name, href] of [["Facebook", SET.CLUB_FACEBOOK_URL], ["Instagram", SET.CLUB_INSTAGRAM_URL], ["Strava", SET.CLUB_STRAVA_URL]]) {
      expect(html).toContain(`href="${href}"`);
      expect(html).toContain(`aria-label="${name}"`);
    }

    // «Contact»: the address shown (§442), the public phone, «Scrie-ne» to the form — each with its glyph.
    // A paragraph in the heading's style, never an <h2>: the block adds no section to any page's outline.
    expect(html).toMatch(/<p[^>]*>Contact<\/p>/);
    expect(html).not.toMatch(/<h[1-6]/);
    expect(html).toContain(`href="mailto:${SHOWN}"`);
    expect(html).toContain('href="tel:+40123456789"');
    expect(words).toContain(PHONE);
    expect(html).toMatch(/href="\/ro\/contact"[^>]*data-testid="club-identity-write"|data-testid="club-identity-write"[^>]*href="\/ro\/contact"/);
    expect(words).toContain("Scrie-ne");
    expect((html.match(/<svg/g) ?? []).length).toBeGreaterThanOrEqual(6);
  });

  it("shows neither the seat nor who receives the form's messages", async () => {
    const html = await render("block");
    expect(html).not.toContain(SEAT);
    expect(html).not.toContain(RECEIVES);
  });

  it("collapses gracefully when nothing is set: no name column, no marks, no phone — «Scrie-ne» stays", async () => {
    state.env = { ...UNSET };
    state.addresses = [];
    state.phone = null;
    const html = await render("block");
    expect(html).not.toContain('data-testid="club-identity-name"');
    expect(html).not.toContain('data-testid="club-identity-social"');
    expect(html).not.toContain('data-testid="club-identity-phone"');
    expect(html).not.toContain('data-testid="club-identity-email"');
    expect(html).not.toContain("C.I.F.");
    expect(html).not.toContain("România");
    expect(text(html)).toBe("Contact Scrie-ne");
  });

  it("speaks English on the English site", async () => {
    state.locale = "en";
    const html = await render("block");
    const words = text(html);
    expect(html).toContain(`aria-label="The club's details"`.replace("'", "&#x27;"));
    expect(words).toContain("Romania");
    expect(words).toContain("Write to us");
    expect(html).toContain('href="/en/contact"');
    expect(text(await render("line"))).toBe(`${LEGAL_NAME} (${CLUB_NAME}) · CIF ${CIF}`);
  });
});
