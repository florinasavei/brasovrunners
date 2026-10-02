import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_DEADLINES } from "@/modules/deadlines/domain/deadlines";

/**
 * §377 × §91 — the five steps on the form and the event page promise exactly what the allocator
 * keeps: the club's link, hold and offer, and this event's reminder — in words that agree with the
 * number — read through the public data cache, never from a constant.
 */
const deadlines = { confirmationHours: 12, holdMinutes: 60, offerHours: 6, reminderHours: 48, selfCheckinHours: 24, raceWeekDays: 7, seriesHorizonDays: 56 };

vi.mock("next-intl/server", async () => {
  const { createTranslator } = await import("next-intl");
  const messages = (await import("../../../messages/ro.json")).default;
  return {
    getLocale: async () => "ro",
    getTranslations: async (namespace: string) => createTranslator({ locale: "ro", messages, namespace: namespace as "Registration" }),
  };
});
// Whether a second runner may be registered on one address yet (§389, `family-gate.ts`).
const gate = { open: false };
// Whether the terms in force carry the club's right to refuse (§636, `cachedRefusalDisclosed`); `fails` stands for an unread cache.
const refusal = { on: false, fails: false };
vi.mock("@/modules/public-cache/reads", () => ({
  cachedDeadlines: async () => deadlines,
  cachedFamilyRegistrationOpen: async () => gate.open,
  cachedRefusalDisclosed: async () => {
    if (refusal.fails) throw new Error("the cache is unread");
    return refusal.on;
  },
}));

const { default: RegistrationSteps } = await import("@/modules/registrations/ui/RegistrationSteps");

async function render(props: Parameters<typeof RegistrationSteps>[0]): Promise<string> {
  return renderToStaticMarkup((await RegistrationSteps(props)) as ReactElement).replace(/<style[^>]*>[\s\S]*?<\/style>/g, "");
}

describe("§377 the five steps say the club's numbers", () => {
  beforeEach(() => {
    deadlines.reminderHours = 48;
  });

  it("says the link, the hold, the offer and the reminder as the club set them", async () => {
    const html = await render({});
    expect(html).toContain("Apasă-l în 12 ore");
    expect(html).toContain("Locul e ținut o oră;");
    expect(html).toContain("ai 6 ore să semnezi declarația");
    expect(html).toContain("Îți trimitem un reminder cu 2 zile înainte de start.");
    expect(html).not.toMatch(/48 de ore|30 de minute|24 de ore|două zile/);
  });

  it("says this event's own reminder lead, and none at all when it sends none", async () => {
    expect(await render({ reminderHoursBefore: 72 })).toContain("Îți trimitem un reminder cu 3 zile înainte de start.");
    const none = await render({ reminderHoursBefore: 0 });
    expect(none).not.toContain("reminder");
    deadlines.reminderHours = 0;
    expect(await render({})).not.toContain("reminder");
    expect(await render({ reminderHoursBefore: 24 })).toContain("cu o zi înainte de start");
  });

  it("says the participation window in words that agree with its days", async () => {
    const html = await render({ window: { opensDays: 10, deadlineDays: 2 } });
    expect(html).toContain("cu 10 zile înainte de start primești un email");
    expect(html).toContain("până cu 2 zile înainte de start");
    expect(await render({ window: { opensDays: 7, deadlineDays: 1 } })).toContain("cu o săptămână înainte de start");
  });
});

describe("§389 the five steps say how a family registers on one address", () => {
  beforeEach(() => {
    gate.open = false;
  });

  it("says to send the form again with the person's name and birth date, and to confirm from the email — once the schema allows it (§446)", async () => {
    gate.open = true;
    const html = await render({});
    expect(html).toContain("Înscrii pe altcineva cu aceeași adresă?");
    expect(html).toContain("Trimite din nou formularul cu numele complet și data nașterii persoanei — primești un email în care confirmi cu un buton.");
    expect(html).toContain('data-testid="steps-family"');
  });

  it("promises nothing while one address still holds one registration per event", async () => {
    const html = await render({});
    expect(html).not.toContain("Înscrii pe altcineva");
    expect(html).not.toContain("steps-family");
  });
});

/**
 * §636 — the club's right to refuse a registration, one step at the end of the fold, only while the
 * terms in force carry it (§618: nothing is said that the terms in force do not say).
 */
describe("§636 the fold says the club may refuse, behind the terms in force", () => {
  beforeEach(() => {
    gate.open = false;
    refusal.on = false;
    refusal.fails = false;
  });

  it("says it, in the terms' own grounds summed up, while the terms in force carry the clause", async () => {
    refusal.on = true;
    const html = await render({});
    expect(html).toContain('data-testid="steps-refusal"');
    expect(html).toContain("Clubul poate refuza o înscriere");
    expect(html).toContain("Doar pe un motiv obiectiv din termeni");
    expect(html).toContain("niciodată pe unul interzis de lege.");
    // The last item of the list, after the waiting list.
    expect(html.indexOf("steps-refusal")).toBeGreaterThan(html.indexOf("Dacă nu mai sunt locuri"));
  });

  it("is exactly today's fold without the clause, and when the terms cannot be read", async () => {
    const without = await render({});
    expect(without).not.toContain("steps-refusal");
    expect(without).not.toContain("Clubul poate refuza");
    refusal.fails = true;
    expect(await render({})).toBe(without);
  });

  it("the editor's preview says what its own settings say, never the cache", async () => {
    refusal.on = true;
    const preview = (refusalOn: boolean) => render({ settings: { deadlines: DEFAULT_DEADLINES, familyOpen: false, refusalOn } });
    expect(await preview(false)).not.toContain("steps-refusal");
    refusal.on = false;
    expect(await preview(true)).toContain("steps-refusal");
  });

  it("is in both catalogues, each string under 200 characters", async () => {
    const ro = (await import("../../../messages/ro.json")).default;
    const en = (await import("../../../messages/en.json")).default;
    expect(en.Registration.steps.refusal.title).toBe("The club may refuse a registration");
    for (const catalogue of [ro, en]) {
      for (const text of Object.values(catalogue.Registration.steps.refusal)) expect(text.length).toBeLessThan(200);
    }
  });

  /**
   * The summary says «Doar» / "Only", so it is read as the whole list: it names each of the terms'
   * five grounds, briefly, and none the terms do not have (§618's paragraph, `refusal-clause.ts`).
   */
  it("names all five of the terms' grounds, in both languages", async () => {
    const ro = (await import("../../../messages/ro.json")).default;
    const en = (await import("../../../messages/en.json")).default;
    const words = {
      ro: ["condiții neîndeplinite", "date false sau incomplete", "capacitate", "siguranță", "conduită", "încălcarea termenilor"],
      en: ["conditions not met", "false or incomplete details", "capacity", "safety", "conduct", "a breach of the terms"],
    };
    for (const word of words.ro) expect(ro.Registration.steps.refusal.body).toContain(word);
    for (const word of words.en) expect(en.Registration.steps.refusal.body).toContain(word);
  });
});
