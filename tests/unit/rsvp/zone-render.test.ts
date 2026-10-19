import type { ReactElement } from "react";
import { renderToReadableStream } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { accountIdentity, accountPublicName } from "@/modules/rsvp/domain/account-identity";
import { isNameZoneOutcome, isRefusedZoneOutcome, parseZoneRsvpOutcome, ZONE_RSVP_OUTCOMES, zoneRsvpAnchor, zoneRsvpTitleId } from "@/modules/rsvp/domain/zone-outcome";

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
vi.mock("@/app/[locale]/members-area/runs/actions", () => ({ answerAsMemberAction: async () => {}, leaveAsMemberAction: async () => {}, setNameAsMemberAction: async () => {} }));

const { default: ZoneRsvp } = await import("@/modules/rsvp/ui/ZoneRsvp");

const EVENT_ID = "11111111-1111-4111-8111-111111111111";

async function html(element: ReactElement): Promise<string> {
  const stream = await renderToReadableStream(element);
  await stream.allReady;
  return (await new Response(stream).text()).replace(/<style[^>]*>[\s\S]*?<\/style>/g, "").replace(/<script[^>]*>[\s\S]*?<\/script>/g, "");
}

const row = async (props: { going?: boolean; count?: number; publicName?: string | null; showName?: boolean; name?: string | null }, locale: "ro" | "en" = "ro") => {
  state.language = locale;
  return html(await ZoneRsvp({ locale, eventId: EVENT_ID, titleId: zoneRsvpTitleId(EVENT_ID), going: false, count: 0, publicName: "Ana Membru", showName: false, name: null, ...props }));
};

beforeEach(() => {
  state.language = "ro";
});

describe("§822 the zone's row under a run that takes answers", () => {
  it("offers «Vin!» and the unticked tick «Vreau să apar cu numele» with the name it would show, in Română", async () => {
    const markup = await row({ count: 3 });
    expect(markup).toContain(`id="${zoneRsvpAnchor(EVENT_ID)}"`);
    // Each form is named by the run's title link, so a list of forms says which «Vin!» is which.
    expect(markup).toContain(`aria-labelledby="${zoneRsvpTitleId(EVENT_ID)}"`);
    expect(markup).toContain('data-testid="zone-rsvp"');
    expect(markup).toContain('data-going="false"');
    expect(markup).toContain("3 vin");
    expect(markup).toMatch(/<button[^>]*type="submit"[^>]*>(?:<span[^>]*>)?(?:<svg[\s\S]*?<\/svg>)?[\s\S]*?Vin!/);
    // The tick is a real checkbox, off by default, with the name it would publish said under it.
    expect(markup).toMatch(/<input[^>]*type="checkbox"[^>]*name="showName"|<input[^>]*name="showName"[^>]*type="checkbox"/);
    expect(markup).not.toMatch(/<input[^>]*name="showName"[^>]*checked/);
    expect(markup).toContain("Vreau să apar cu numele");
    expect(markup).toContain("Dacă bifezi, apari ca „Ana Membru” pe pagina alergării și la „Cine vine”.");
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
    expect(markup).toContain("If you tick it, you show as “Ana Membru” on the run&#x27;s page and under “Who&#x27;s coming”.");
    expect(markup).toContain('name="uiLocale" value="en"');
  });

  it("asks to be the first when nobody has answered, and draws no empty count", async () => {
    const markup = await row({ count: 0 });
    expect(markup).toContain('data-testid="zone-rsvp-empty"');
    expect(markup).toContain("Fii primul care spune că vine.");
    expect(markup).not.toContain('data-testid="zone-rsvp-count"');
  });

  it("says «Tu vii ✓» beside «Nu mai vin» once the account answered, and offers no second «Vin!»", async () => {
    const markup = await row({ going: true, count: 4 });
    expect(markup).toContain('data-going="true"');
    expect(markup).toMatch(/data-testid="zone-rsvp-going"[^>]*>Tu vii ✓</);
    expect(markup).toContain("Nu mai vin");
    expect(markup).toContain("4 vin");
    // «Vin!» is not drawn at all: the one press left is the one that takes the answer back.
    expect(markup).not.toMatch(/>Vin!</);
    expect(await row({ going: true, count: 4 }, "en")).toMatch(/data-testid="zone-rsvp-going"[^>]*>You&#x27;re coming ✓</);
  });

  it("keeps the name tick «Numele meu apare la „Cine vine”» on «Tu vii ✓»: a real checkbox in its own form, drawn as the answer keeps it (§827)", async () => {
    const off = await row({ going: true, count: 2, showName: false, name: "Ana" });
    expect(off).toContain('data-testid="zone-rsvp-name"');
    expect(off).toContain("Numele meu apare la „Cine vine”");
    expect(off).toMatch(/<input[^>]*type="checkbox"[^>]*name="showName"|<input[^>]*name="showName"[^>]*type="checkbox"/);
    expect(off).not.toMatch(/<input[^>]*name="showName"[^>]*checked/);
    // The answer holds a name: the box stands prefilled with it, and the help says which name the tick shows and that it stays saved.
    expect(off).toMatch(/<input[^>]*name="name"[^>]*value="Ana"|<input[^>]*value="Ana"[^>]*name="name"/);
    expect(off).toContain("Cu bifa apari ca „Ana”");
    expect(off).toContain("numele rămâne păstrat");
    expect(off).toContain("Salvează");
    const on = await row({ going: true, count: 2, showName: true, name: "Ana" });
    expect(on).toMatch(/<input[^>]*name="showName"[^>]*checked|<input[^>]*checked[^>]*name="showName"/);
    // The form carries the event and the language and nothing of the person's: no address, no role.
    expect(on).not.toMatch(/name="(email|displayName|role)"/);
    expect(on).toContain(`name="eventId" value="${EVENT_ID}"`);
  });

  it("asks for a name only when neither the answer nor the account has one, and says which name the account would show otherwise", async () => {
    const nobody = await row({ going: true, showName: false, name: null, publicName: null });
    expect(nobody).toContain('name="name"');
    expect(nobody).toContain("Numele tău");
    expect(nobody).toContain("Bifează și scrie numele cu care vrei să apari.");
    // The account has a name and the answer none: the tick uses it, the help says which — no box.
    const account = await row({ going: true, showName: false, name: null, publicName: "Ana Membru" });
    expect(account).not.toContain('name="name"');
    expect(account).toContain("Dacă bifezi, apari ca „Ana Membru” pe pagina alergării și la „Cine vine”.");
  });

  it("says the same tick in English", async () => {
    const markup = await row({ going: true, showName: true, name: "Ana" }, "en");
    expect(markup).toContain("My name shows under “Who&#x27;s coming”");
    expect(markup).toContain("Save");
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
    // Unticked, the name is not even kept: the account's name is the person's to show, never to store (§143, §396).
    expect(accountIdentity(account, "ro", false)).toEqual({ email: "ana@example.test", displayName: null, showName: false, locale: "ro", source: "account", verified: true });
    expect(accountIdentity(account, "ro", true)).toMatchObject({ displayName: "Ana Membru", showName: true });
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
  it("knows seven codes and nothing else", () => {
    expect([...ZONE_RSVP_OUTCOMES]).toEqual(["went", "left", "closed", "shown", "hidden", "name", "none"]);
    for (const code of ZONE_RSVP_OUTCOMES) expect(parseZoneRsvpOutcome(code)).toBe(code);
    expect(parseZoneRsvpOutcome(["left", "went"])).toBe("left");
    for (const other of [undefined, "", "Went", "went ", "<script>", "1"]) expect(parseZoneRsvpOutcome(other)).toBeNull();
  });

  it("has a sentence for each, in both languages", () => {
    for (const catalogue of [ro, en]) {
      // The name tick's four are the event page's own sentences (`Event.rsvp.nameOutcome`), the rest the zone's.
      for (const code of ZONE_RSVP_OUTCOMES) {
        const sentence = isNameZoneOutcome(code) ? catalogue.Event.rsvp.nameOutcome[code] : catalogue.Members.rsvp.outcome[code];
        expect(sentence.length).toBeGreaterThan(0);
      }
      expect(isRefusedZoneOutcome("closed") && isRefusedZoneOutcome("name") && isRefusedZoneOutcome("none")).toBe(true);
      expect(isRefusedZoneOutcome("shown") || isRefusedZoneOutcome("went")).toBe(false);
      expect(catalogue.Members.rsvp.nameHelp).toContain("{name}");
    }
  });
});
