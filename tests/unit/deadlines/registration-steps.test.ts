import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
vi.mock("@/modules/public-cache/reads", () => ({
  cachedDeadlines: async () => deadlines,
  cachedFamilyRegistrationOpen: async () => gate.open,
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
