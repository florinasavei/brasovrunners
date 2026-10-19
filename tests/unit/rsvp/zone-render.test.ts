import type { ReactElement } from "react";
import { renderToReadableStream } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { accountIdentity, accountPublicName } from "@/modules/rsvp/domain/account-identity";
import { parseZoneRsvpOutcome, ZONE_RSVP_OUTCOMES, zoneRsvpAnchor } from "@/modules/rsvp/domain/zone-outcome";

/**
 * §822 («Vin!» in the members' zone; amends §812) — what the row under a run in «Alergări» draws, in both languages, and the pure rules
 * the zone's action builds its identity with. The action and the page are proved against a database in
 * `tests/integration/rsvp/zone-rsvp.test.ts`; the whole journey in `tests/e2e/rsvp.spec.ts`.
 */
const state = vi.hoisted(() => ({ language: "ro" as "ro" | "en" }));
const messages = { ro, en };

vi.mock("next-intl/server", async () => {
  const { createTranslator } = await import("next-intl");
  return {
    getTranslations: async (namespace: string | { namespace: string }) =>
      createTranslator({ locale: state.language, messages: messages[state.language] as never, namespace: (typeof namespace === "string" ? namespace : namespace.namespace) as never }),
  };
});
vi.mock("@/app/[locale]/members-area/runs/actions", () => ({ answerAsMemberAction: async () => {}, leaveAsMemberAction: async () => {} }));

const { default: ZoneRsvp } = await import("@/modules/rsvp/ui/ZoneRsvp");

const EVENT_ID = "11111111-1111-4111-8111-111111111111";

async function html(element: ReactElement): Promise<string> {
  const stream = await renderToReadableStream(element);
  await stream.allReady;
  return (await new Response(stream).text()).replace(/<style[^>]*>[\s\S]*?<\/style>/g, "").replace(/<script[^>]*>[\s\S]*?<\/script>/g, "");
}

const row = async (props: { going?: boolean; count?: number; publicName?: string | null }, locale: "ro" | "en" = "ro") => {
  state.language = locale;
  return html(await ZoneRsvp({ locale, eventId: EVENT_ID, going: false, count: 0, publicName: "Ana Membru", ...props }));
};

beforeEach(() => {
  state.language = "ro";
});

describe("§822 the zone's row under a run that takes answers", () => {
  it("offers «Vin!» and the unticked tick «Vreau să apar cu numele» with the name it would show, in Română", async () => {
    const markup = await row({ count: 3 });
    expect(markup).toContain(`id="${zoneRsvpAnchor(EVENT_ID)}"`);
    expect(markup).toContain('data-testid="zone-rsvp"');
    expect(markup).toContain('data-going="false"');
    expect(markup).toContain("3 vin");
    expect(markup).toMatch(/<button[^>]*type="submit"[^>]*>(?:<span[^>]*>)?(?:<svg[\s\S]*?<\/svg>)?[\s\S]*?Vin!/);
    // The tick is a real checkbox, off by default, with the name it would publish said under it.
    expect(markup).toMatch(/<input[^>]*type="checkbox"[^>]*name="showName"|<input[^>]*name="showName"[^>]*type="checkbox"/);
    expect(markup).not.toMatch(/<input[^>]*name="showName"[^>]*checked/);
    expect(markup).toContain("Vreau să apar cu numele");
    expect(markup).toContain("Pe pagina alergării apari ca „Ana Membru”.");
    // The form posts the event and the language, and nothing of the person's: no address, no name, no role.
    expect(markup).toContain(`name="eventId" value="${EVENT_ID}"`);
    expect(markup).toContain('name="uiLocale" value="ro"');
    expect(markup).not.toMatch(/name="(email|displayName|name|role)"/);
    expect(markup).not.toContain("zone-rsvp-going");
  });

  it("says it in English", async () => {
    const markup = await row({ count: 1 }, "en");
    expect(markup).toContain("1 coming");
    expect(markup).toContain("I&#x27;m coming!");
    expect(markup).toContain("I want my name to show");
    expect(markup).toContain("On the run&#x27;s page you show as “Ana Membru”.");
    expect(markup).toContain('name="uiLocale" value="en"');
  });

  it("asks to be the first when nobody has answered, and draws no empty count", async () => {
    const markup = await row({ count: 0 });
    expect(markup).toContain('data-testid="zone-rsvp-empty"');
    expect(markup).toContain("Fii primul care spune că vine.");
    expect(markup).not.toContain('data-testid="zone-rsvp-count"');
  });

  it("says «Tu vii ✓» beside «Nu mai vin» once the account answered, and offers no second «Vin!» and no tick", async () => {
    const markup = await row({ going: true, count: 4 });
    expect(markup).toContain('data-going="true"');
    expect(markup).toMatch(/data-testid="zone-rsvp-going"[^>]*>Tu vii ✓</);
    expect(markup).toContain("Nu mai vin");
    expect(markup).toContain("4 vin");
    expect(markup).not.toContain('name="showName"');
    // «Vin!» is not drawn at all: the one press left is the one that takes the answer back.
    expect(markup).not.toMatch(/>Vin!</);
    expect(await row({ going: true, count: 4 }, "en")).toMatch(/data-testid="zone-rsvp-going"[^>]*>You&#x27;re coming ✓</);
  });

  it("draws no tick for an account with no name to show: nothing to publish, nothing to ask", async () => {
    const markup = await row({ publicName: null });
    expect(markup).not.toContain('name="showName"');
    expect(markup).toContain("Vin!");
  });
});

describe("§822 the identity the zone answers as (§812's source `account`)", () => {
  const account = { email: "ana@example.test", displayName: "  Ana   Membru " };

  it("is verified and made from the account alone: its address, its name cleaned, the language of the page", () => {
    expect(accountIdentity(account, "ro", false)).toEqual({ email: "ana@example.test", displayName: "Ana Membru", showName: false, locale: "ro", source: "account", verified: true });
    expect(accountIdentity(account, "en", true)).toMatchObject({ source: "account", verified: true, locale: "en" });
  });

  it("shows the name only on the person's own tick, and only when there is a name", () => {
    expect(accountIdentity(account, "ro", false).showName).toBe(false);
    expect(accountIdentity(account, "ro", true).showName).toBe(true);
    // A tick with nothing to show shows nothing, whatever was posted.
    expect(accountIdentity({ email: "x@example.test", displayName: "   " }, "ro", true).showName).toBe(false);
    expect(accountIdentity({ email: "x@example.test", displayName: null }, "ro", true)).toMatchObject({ showName: false, displayName: null });
    expect(accountPublicName(account)).toBe("Ana Membru");
    expect(accountPublicName({ displayName: "" })).toBeNull();
  });
});

describe("§822 what the address says after a press", () => {
  it("knows three codes and nothing else", () => {
    expect([...ZONE_RSVP_OUTCOMES]).toEqual(["went", "left", "closed"]);
    for (const code of ZONE_RSVP_OUTCOMES) expect(parseZoneRsvpOutcome(code)).toBe(code);
    expect(parseZoneRsvpOutcome(["left", "went"])).toBe("left");
    for (const other of [undefined, "", "Went", "went ", "<script>", "1"]) expect(parseZoneRsvpOutcome(other)).toBeNull();
  });

  it("has a sentence for each, in both languages", () => {
    for (const catalogue of [ro, en]) {
      for (const code of ZONE_RSVP_OUTCOMES) expect(catalogue.Members.rsvp.outcome[code].length).toBeGreaterThan(0);
      expect(catalogue.Members.rsvp.nameHelp).toContain("{name}");
    }
  });
});
