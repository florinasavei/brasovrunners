import { createTranslator } from "next-intl";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { type ClubIdentityShown, DEFAULT_CLUB_IDENTITY_SHOWN } from "@/modules/contact/domain/club-identity";
import { CLUB_NAME } from "@/theme/brand";

/**
 * §565 — the club's legal identity, composed from the environment the legal texts read
 * (`CLUB_LEGAL_NAME`, `CLUB_REGISTRATION_NUMBER`, §132) and the site's one name (`CLUB_NAME`,
 * §215): one line, «<legal name> (<site name>) · CIF <CIF>», in two shapes — a paragraph at the end
 * of the listing, the «about» pages and the contact page, and a span inside the footer's «Despre
 * club, contact și termeni», where the hotfix (#293) moved it from the block §565 drew under the bar.
 * §890: the caller names its place, and «Ce arată site-ul despre asociație» ticks where the name,
 * the seat and the email show.
 *
 * Every value here is made up — «Asociația Exemplu», «RO00000000» — and the club's own never
 * appears in the repository (the no-literal test beside this one).
 */
const state = vi.hoisted(() => ({
  locale: "ro" as "ro" | "en",
  env: {} as Record<string, string | undefined>,
  shown: undefined as unknown,
}));

vi.mock("@/shared/config/env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/shared/config/env")>();
  const env = new Proxy(actual.env, {
    get: (target, key) => (typeof key === "string" && key in state.env ? state.env[key] : Reflect.get(target, key)),
  });
  return { ...actual, env };
});

vi.mock("next-intl/server", () => ({
  getTranslations: async (namespace: string) => {
    const catalogue = (state.locale === "ro" ? ro : en) as Record<string, object>;
    return createTranslator({ locale: state.locale, messages: catalogue[namespace] as Record<string, string>, namespace: undefined });
  },
}));

vi.mock("@/modules/public-cache/reads", () => ({
  cachedClubIdentityShown: async () => state.shown,
  cachedShownContactAddresses: async () => [EMAIL],
}));

const { default: ClubIdentity } = await import("@/shared/ui/ClubIdentity");

const LEGAL_NAME = "Asociația Exemplu";
const CIF = "RO00000000";
/** The configuration's full seat, flat and all — what the site must never print. */
const SEAT = "Strada Exemplu nr. 1, bl. 2, sc. A, ap. 3";
/** What the club typed for the site. */
const SHOWN_SEAT = "Strada Exemplu nr. 1, Localitate";
const EMAIL = "contact@example.org";
const LINE = `${LEGAL_NAME} (${CLUB_NAME}) · CIF ${CIF}`;
const PLACES = ["home", "contact", "pages", "footer"] as const;

const SET = { CLUB_LEGAL_NAME: LEGAL_NAME, CLUB_REGISTRATION_NUMBER: CIF, CLUB_REGISTERED_ADDRESS: SEAT };
const UNSET = { CLUB_LEGAL_NAME: undefined, CLUB_REGISTRATION_NUMBER: undefined, CLUB_REGISTERED_ADDRESS: undefined };

async function render(place: (typeof PLACES)[number]): Promise<string> {
  const element = await ClubIdentity({ place });
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
  state.shown = DEFAULT_CLUB_IDENTITY_SHOWN;
});

describe("§565 the identity line", () => {
  it("reads «<legal name> (<site name>) · CIF <CIF>» from the environment and the constant", async () => {
    const html = await render("contact");
    expect(html).toContain('data-testid="club-identity-line"');
    expect(text(html)).toBe(LINE);
    // One secondary line that wraps at 320 px rather than widening the page.
    expect(html).toMatch(/overflow-wrap:\s*anywhere|MuiTypography-body2/);
  });

  it("leaves the CIF out while it is unset, and says nothing at all without the legal name, in any place", async () => {
    for (const place of PLACES) {
      state.env = { ...SET, CLUB_REGISTRATION_NUMBER: undefined };
      expect(text(await render(place)), place).toBe(`${LEGAL_NAME} (${CLUB_NAME})`);
      state.env = { ...UNSET };
      expect(await render(place), place).toBe("");
    }
  });

  it("writes the label once when the variable carries its own («CIF …», as the legal texts read it)", async () => {
    state.env.CLUB_REGISTRATION_NUMBER = `CIF ${CIF}`;
    for (const place of PLACES) expect(text(await render(place)), place).toBe(LINE);
  });

  it("shows neither the seat nor the email while nothing is stored", async () => {
    for (const place of PLACES) {
      const html = await render(place);
      expect(html, place).not.toContain(SEAT);
      expect(html, place).not.toContain(EMAIL);
    }
  });
});

describe("§890 each line where it is ticked", () => {
  it("shows the seat and the email only in the places ticked for them, and the name only in its own", async () => {
    state.shown = { name: ["contact", "footer"], seat: ["contact"], email: ["contact", "pages"], seatAddress: SHOWN_SEAT } satisfies ClubIdentityShown;
    expect(text(await render("contact"))).toBe(`${LINE} Sediul: ${SHOWN_SEAT} Email: ${EMAIL}`);
    expect(text(await render("pages"))).toBe(`Email: ${EMAIL}`);
    expect(text(await render("footer"))).toBe(LINE);
    expect(await render("home")).toBe("");
  });

  it("prints the seat typed in the card, never CLUB_REGISTERED_ADDRESS, and none while the box is empty", async () => {
    state.shown = { name: [], seat: ["home"], email: [], seatAddress: SHOWN_SEAT } satisfies ClubIdentityShown;
    const html = await render("home");
    expect(text(html)).toBe(`Sediul: ${SHOWN_SEAT}`);
    expect(html).not.toContain(SEAT);
    state.shown = { name: [], seat: ["home"], email: [], seatAddress: null } satisfies ClubIdentityShown;
    expect(await render("home")).toBe("");
  });
});

describe("§565 the identity inside the footer's fold (the hotfix, #293)", () => {
  it("is the same one line, a span of the panel's own words: no block, no heading, no link, no glyph", async () => {
    const html = await render("footer");
    expect(html).toContain('data-testid="footer-club-identity"');
    // One element holding the words and nothing else: what §565's block carried besides them (the
    // country, «C.I.F.», the marks, «Contact», «Scrie-ne») the bar and the fold already say, once.
    expect(html.replace(/<style[^>]*>[\s\S]*?<\/style>/g, "")).toMatch(/^<span[^>]*>[^<]*<\/span>$/);
    expect(text(html)).toBe(LINE);
    // It wraps inside the panel at 320 px rather than widening the page.
    expect(html).toMatch(/overflow-wrap:\s*anywhere/);
  });

  it("speaks English on the English site: the same line in every place", async () => {
    state.locale = "en";
    for (const place of PLACES) expect(text(await render(place)), place).toBe(LINE);
  });
});
