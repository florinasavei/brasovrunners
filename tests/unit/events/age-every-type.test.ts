import { readFileSync } from "node:fs";
import path from "node:path";
import type { ReactElement } from "react";
import { renderToReadableStream, renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { EditableEvent } from "@/modules/content/events/repository";
import type { LanguageEntry } from "@/modules/content/events/ui/boxes/box-kit";
import { EVENT_TYPES, publicAgeRule } from "@/modules/events/domain/event-type";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";

/**
 * `DECISIONS.md` §505 — the minimum age is one box in the editor's «Regulamentul» for every event
 * type, and the event's page says it for every type, inside «Condiții de participare» (§498) after
 * the rules, no longer as a «Vârstă» row of the facts (amending §329's "only where the club counts
 * it"). Where the club takes the registrations, the form's own sentence (§410); anywhere else the
 * minimum with the parent's consent below eighteen. Never under fourteen (§515): an event saved
 * with 0 reads as fourteen (`effectiveMinimumAge`), so every event states a minimum.
 */
vi.mock("next-intl/server", async () => {
  const { createFormatter, createTranslator: translator } = await import("next-intl");
  return {
    getTranslations: async (namespace: string) => translator({ locale: "ro", messages: ro, namespace: namespace as "Event" }),
    getFormatter: async () => createFormatter({ locale: "ro", timeZone: "Europe/Bucharest" }),
    getLocale: async () => "ro",
  };
});
vi.mock("@/i18n/navigation", async () => {
  const { createElement } = await import("react");
  return { Link: ({ href, children }: { href: string; children: unknown }) => createElement("a", { href }, children as string), getPathname: () => "/" };
});
// The rules' language tabs are a client island with a rich-text editor; the age box is what is read here.
vi.mock("@/shared/ui/LocaleTabPanels", () => ({ default: () => null }));

const { default: EventAgeRule } = await import("@/modules/events/ui/EventAgeRule");
const { RulesBox } = await import("@/modules/content/events/ui/boxes/TextBoxes");

const MINOR_CONSENT = "Vârsta minimă: 16 ani. Sub 18 ani, participarea se face cu acordul unui părinte.";

const ageOf = async (event: { type: (typeof EVENT_TYPES)[number]; registrationMode: "NONE" | "INTERNAL" | "EXTERNAL"; minAge: number }) => {
  const element = await EventAgeRule({ event });
  return element ? renderToStaticMarkup(element) : "";
};

describe("§505 the page says the minimum age for every type", () => {
  it("chooses the sentence by where the registrations are taken", () => {
    // The club's own door: the form's sentence, the parent's clause by the number (§329, §410).
    expect(publicAgeRule({ type: "RACE", registrationMode: "INTERNAL", minAge: 14 })).toBe("minimumAndGuardian");
    expect(publicAgeRule({ type: "RACE", registrationMode: "INTERNAL", minAge: 18 })).toBe("minimumOnly");
    // An older event's 0 reads as fourteen (§515): the minimum and the parent, never «no minimum».
    expect(publicAgeRule({ type: "RACE", registrationMode: "INTERNAL", minAge: 0 })).toBe("minimumAndGuardian");
    // Every type, registered elsewhere or not at all: the minimum with the parent's consent under
    // eighteen, the minimum alone from eighteen; 0 reads as fourteen.
    for (const type of EVENT_TYPES) {
      for (const registrationMode of ["NONE", "EXTERNAL"] as const) {
        expect(publicAgeRule({ type, registrationMode, minAge: 16 }), `${type} ${registrationMode}`).toBe("minimumAndConsent");
        expect(publicAgeRule({ type, registrationMode, minAge: 18 }), `${type} ${registrationMode}`).toBe("minimumOnly");
        expect(publicAgeRule({ type, registrationMode, minAge: 0 }), `${type} ${registrationMode}`).toBe("minimumAndConsent");
      }
    }
    // A group run is turned up to whatever its hidden mode says (§111): the consent, not a registration.
    expect(publicAgeRule({ type: "GROUP_RUN", registrationMode: "INTERNAL", minAge: 14 })).toBe("minimumAndConsent");
  });

  it("the consent sentence is the owner's, in both languages", () => {
    expect(ro.Registration.ageRule.minimumAndConsent).toBe("Vârsta minimă: {age}. Sub 18 ani, participarea se face cu acordul unui părinte.");
    expect(en.Registration.ageRule.minimumAndConsent).toBe("Minimum age: {age}. Under 18, a parent's consent is needed to take part.");
  });

  it("a group run says the minimum with the parent's consent, under its own «Vârstă» heading", async () => {
    const html = await ageOf({ type: "GROUP_RUN", registrationMode: "NONE", minAge: 16 });
    expect(html).toMatch(/<h3[^>]*id="age-title"[^>]*>Vârstă<\/h3>/);
    expect(html).toContain(MINOR_CONSENT);
  });

  it("an event registered elsewhere says it too; eighteen and over, the minimum alone", async () => {
    expect(await ageOf({ type: "RACE", registrationMode: "EXTERNAL", minAge: 16 })).toContain(MINOR_CONSENT);
    const adult = await ageOf({ type: "RACE", registrationMode: "EXTERNAL", minAge: 20 });
    expect(adult).toContain("Vârsta minimă: 20 de ani.");
    expect(adult).not.toContain("părinte");
  });

  it("a race the club registers says the form's own sentence (§410)", async () => {
    expect(await ageOf({ type: "RACE", registrationMode: "INTERNAL", minAge: 14 })).toContain(
      "Vârsta minimă: 14 ani. Sub 18 ani, înscrierea se face de un părinte sau tutore, cu acordul acestuia.",
    );
  });

  it("an older event's 0 says fourteen, never «no minimum» (§515)", async () => {
    expect(await ageOf({ type: "GROUP_RUN", registrationMode: "NONE", minAge: 0 })).toContain(
      "Vârsta minimă: 14 ani. Sub 18 ani, participarea se face cu acordul unui părinte.",
    );
  });

  it("is drawn inside «Condiții de participare», after the rules and before the photographs notice — no longer a facts row", () => {
    const page = readFileSync(path.join(process.cwd(), "src/modules/events/ui/EventPageView.tsx"), "utf8");
    const fold = page.slice(page.indexOf('data-testid="conditions-fold"'), page.indexOf("<OpenFoldFromHash />"));
    expect(fold.indexOf('id="rules"')).toBeGreaterThan(-1);
    expect(fold.indexOf('id="rules"')).toBeLessThan(fold.indexOf("<EventAgeRule "));
    expect(fold.indexOf("<EventAgeRule ")).toBeLessThan(fold.indexOf("<EventPhotosNotice />"));
    const facts = readFileSync(path.join(process.cwd(), "src/modules/events/ui/EventFacts.tsx"), "utf8");
    expect(facts).not.toContain('key: "age"');
  });
});

describe("§505 the staff preview says the age as the page does", () => {
  const preview = readFileSync(path.join(process.cwd(), "src/app/[locale]/preview/events/[id]/page.tsx"), "utf8");

  it("renders EventAgeRule with the preview's event, after the rules", () => {
    expect(preview).toContain("<EventAgeRule event={preview} />");
    expect(preview.indexOf('id="rules"')).toBeLessThan(preview.indexOf("<EventAgeRule "));
    // The mapping is `preview-view.ts` since §NNN, shared with the preview before saving.
    expect(readFileSync(path.join(process.cwd(), "src/modules/content/events/preview-view.ts"), "utf8")).toMatch(/minAge: event\.minAge/);
  });

  it("a race and a group run in the preview's shape get the page's sentences", async () => {
    expect(await ageOf({ type: "RACE", registrationMode: "INTERNAL", minAge: 14 })).toContain("înscrierea se face de un părinte sau tutore");
    expect(await ageOf({ type: "GROUP_RUN", registrationMode: "NONE", minAge: 14 })).toContain("Vârsta minimă: 14 ani. Sub 18 ani, participarea se face cu acordul unui părinte.");
  });
});

describe("§505 the editor's one box, for every type", () => {
  const languages: LanguageEntry[] = (["ro", "en"] as const).map((locale) => ({
    label: locale,
    mayEdit: true,
    translation: { locale, title: "", slug: "", excerpt: null, excerptJson: null, bodyJson: null, rulesJson: null, scheduleJson: null, checklist: null, locationName: null } as never,
  }));
  // `LanguageTabs` is an async component inside the box, so the render must wait for it.
  const rulesBox = async (type: string, mayEditSettings = true) => {
    const element = (await RulesBox({ languages, event: { type, minAge: 16, registrationMode: "NONE" } as unknown as EditableEvent, mayEditSettings })) as ReactElement;
    const stream = await renderToReadableStream(element);
    await stream.allReady;
    return (await new Response(stream).text()).replace(/<!-- -->/g, "");
  };

  it("«Regulamentul» posts exactly one `event.minAge` whatever the type", async () => {
    for (const type of EVENT_TYPES) {
      const html = await rulesBox(type);
      expect(html.match(/name="event\.minAge"/g) ?? [], type).toHaveLength(1);
      expect(html, type).toContain("Vârsta minimă de participare");
    }
  });

  it("the box's help says the floor, 14, never «0 for no limit» (§515)", async () => {
    const html = await rulesBox("GROUP_RUN");
    expect(html).toContain("Cel puțin 14 ani, împliniți în ziua evenimentului.");
    expect(html).not.toContain("fără limită");
  });

  it("a role without settings rights reads the number instead of the box", async () => {
    const html = await rulesBox("GROUP_RUN", false);
    expect(html).not.toContain('name="event.minAge"');
    expect(html).toContain("Vârsta minimă 16 ani");
  });

  it("the label and the help are the owner's words, in both languages", () => {
    expect(ro.Admin.editor.minAge).toBe("Vârsta minimă de participare");
    expect(en.Admin.editor.minAge).toBe("Minimum age to take part");
    expect(ro.Admin.editor.minAgeHelp).toBe(
      "Cel puțin {default} ani, împliniți în ziua evenimentului. Între {default} și 17 ani, înscrierea o face un părinte sau tutore, iar declarația o semnează minorul și părintele.",
    );
    expect(en.Admin.editor.minAgeHelp).toBe(
      "At least {default}, reached by the day of the event. From {default} to 17, a parent or legal guardian registers the runner, and the declaration is signed by the minor and the parent.",
    );
    for (const catalogue of [ro, en]) {
      expect(catalogue.Admin.editor.boxes.summary.age.from).toContain("{age}");
      expect(catalogue.Admin.editor.boxes.summary.age.from).not.toMatch(/\d/);
      expect(catalogue.Admin.editor.minAgeReadOnly).toContain("{age}");
    }
  });
});
