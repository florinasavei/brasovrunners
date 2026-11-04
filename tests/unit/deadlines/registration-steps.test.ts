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

// The page's language: Română unless a case says otherwise.
const lang = vi.hoisted(() => ({ current: "ro" as "ro" | "en" }));
vi.mock("next-intl/server", async () => {
  const { createTranslator } = await import("next-intl");
  const catalogues = {
    ro: (await import("../../../messages/ro.json")).default,
    en: (await import("../../../messages/en.json")).default,
  };
  return {
    getLocale: async () => lang.current,
    getTranslations: async (namespace: string) =>
      createTranslator({ locale: lang.current, messages: catalogues[lang.current] as typeof catalogues.ro, namespace: namespace as "Registration" }),
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

/** The steps as a page draws them; a place reaches the waiting list by itself («Da») unless a case says otherwise. */
async function render(props: Partial<Parameters<typeof RegistrationSteps>[0]>): Promise<string> {
  return renderToStaticMarkup((await RegistrationSteps({ byItself: true, ...props })) as ReactElement).replace(/<style[^>]*>[\s\S]*?<\/style>/g, "");
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

/**
 * §908 — the waiting list's step says who gives the places. While no place reaches the line by itself («Nu», or
 * «Locurile libere le dau doar eu»: `byItself` false, which every caller reads through `offersByItself`), the
 * organizers' words — never «Când se eliberează un loc», nor an order of registration the organizers do not keep;
 * «Da» keeps today's sentence. Both languages, with the club's offer window in either.
 */
describe("§908 the waiting list's step says who gives the places", () => {
  beforeEach(() => {
    lang.current = "ro";
  });

  it("«Da»: a freed place is offered in order, in Română and English", async () => {
    expect(await render({ byItself: true })).toContain(
      "Intri pe lista de așteptare, în ordinea înscrierii. Când se eliberează un loc, primești un email cu oferta și ai 6 ore să semnezi declarația.",
    );
    lang.current = "en";
    expect(await render({ byItself: true })).toContain(
      "You join the waiting list, in order of registration. When a place frees up, you get an offer by email and 6 hours to sign the declaration.",
    );
  });

  it("«Nu» or the tick: the organizers give the places, in Română and English", async () => {
    const ro = await render({ byItself: false });
    expect(ro).toContain(
      "Intri pe lista de așteptare. Locurile le dau organizatorii, pe rând: când îți pot da unul, primești un email cu oferta și ai 6 ore să semnezi declarația.",
    );
    expect(ro).not.toContain("Când se eliberează un loc");
    expect(ro).not.toContain("în ordinea înscrierii");
    lang.current = "en";
    const en = await render({ byItself: false });
    expect(en).toContain(
      "You join the waiting list. The organizers give out the places one at a time: when they can give you one, you get an offer by email and 6 hours to sign the declaration.",
    );
    expect(en).not.toContain("When a place frees up");
    expect(en).not.toContain("in order of registration");
  });

  it("is in both catalogues, under 200 characters with the longest offer window", async () => {
    const ro = (await import("../../../messages/ro.json")).default;
    const en = (await import("../../../messages/en.json")).default;
    for (const catalogue of [ro, en]) {
      expect(catalogue.Registration.steps.waitingList.bodyByHand.replace("{offer}", "167 de ore").length).toBeLessThan(200);
    }
  });

  /*
    The declaration's step ends on what a lapsed hold does with a waiting list (the review of this branch): «apoi trece
    la următorul» only while a place reaches the line by itself — with «Nu» or the tick the place stays free for the
    organizers' «Trimite-i oferta» (`Admin.registrations.placeDeadlines.releaseManual`), so they may give it.
  */
  it("the declaration's step: «Da» passes a lapsed hold to the next in line, «Nu» or the tick leave the place to the organizers (ro, en)", async () => {
    expect(await declarationStep({ byItself: true })).toBe(
      "Din același email, o semnezi online sau pe hârtie, la masa de înscrieri în ziua cursei. Locul e ținut o oră; dacă e listă de așteptare, apoi trece la următorul.",
    );
    expect(await declarationStep({ byItself: false })).toBe(
      "Din același email, o semnezi online sau pe hârtie, la masa de înscrieri în ziua cursei. Locul e ținut o oră; dacă e listă de așteptare, organizatorii îl pot da apoi altcuiva.",
    );
    lang.current = "en";
    expect(await declarationStep({ byItself: true })).toBe(
      "From that same email, sign it online or on paper at the registration desk on race day. Your place is held for one hour; if there is a waiting list, it then goes to the next in line.",
    );
    expect(await declarationStep({ byItself: false })).toBe(
      "From that same email, sign it online or on paper at the registration desk on race day. Your place is held for one hour; if there is a waiting list, the organizers may then give it to someone else.",
    );
  });

  it("with a participation window the declaration's step speaks of the hold alone: the same words whoever gives the places (ro, en)", async () => {
    for (const locale of ["ro", "en"] as const) {
      lang.current = locale;
      // A deadline before the start (`bodyLater`) and one at the start (`bodyLaterAtStart`).
      for (const window of [
        { opensDays: 10, deadlineDays: 2 },
        { opensDays: 7, deadlineDays: 0 },
      ]) {
        const auto = await declarationStep({ byItself: true, window });
        expect(await declarationStep({ byItself: false, window }), `${locale}, ${window.deadlineDays} days`).toBe(auto);
        expect(auto).not.toMatch(/trece la următorul|organizatorii|next in line|organizers/);
      }
    }
  });

  /*
    «Eliberează singur locurile nesemnate la termen» (§914): with the release on, an unsigned place goes at the deadline
    whoever waits — so the step says that, and no paper at the desk, which comes after the deadline. A deadline at the
    start releases nothing new: its words stay.
  */
  it("with the release at the deadline the step says the unsigned place goes then, even with nobody waiting (ro, en)", async () => {
    expect(await declarationStep({ window: { opensDays: 10, deadlineDays: 2, releases: true } })).toBe(
      "Cursa e gratuită, așa că îți cerem o confirmare: cu 10 zile înainte de start primești un email și semnezi declarația online. Poți semna și mai devreme. Dacă nu semnezi până cu 2 zile înainte de start, locul se eliberează, chiar dacă nu așteaptă nimeni.",
    );
    expect(await declarationStep({ window: { opensDays: 7, deadlineDays: 0, releases: true } })).toBe(await declarationStep({ window: { opensDays: 7, deadlineDays: 0 } }));
    lang.current = "en";
    expect(await declarationStep({ window: { opensDays: 10, deadlineDays: 2, releases: true } })).toBe(
      "The race is free, so we ask for a confirmation: 10 days before the start you get an email and sign the declaration online. You can sign earlier too. If you do not sign by 2 days before the start, the place is released, even if nobody is waiting.",
    );
    expect(await declarationStep({ window: { opensDays: 10, deadlineDays: 2, releases: false } })).toContain("If there is a waiting list, the place is held until");
  });
});

/** The third step as drawn — what stands between its title and the fourth's — without the markup. */
async function declarationStep(props: Partial<Parameters<typeof RegistrationSteps>[0]>): Promise<string> {
  const catalogue = lang.current === "ro" ? (await import("../../../messages/ro.json")).default : (await import("../../../messages/en.json")).default;
  const { declaration, confirmed } = catalogue.Registration.steps;
  const html = await render(props);
  const from = html.indexOf(`3. ${declaration.title}`);
  const to = html.indexOf(`4. ${confirmed.title}`);
  if (from < 0 || to < from) throw new Error("the declaration's step is not between the second and the fourth");
  return html.slice(from + `3. ${declaration.title}`.length, to).replace(/<[^>]+>/g, "");
}
