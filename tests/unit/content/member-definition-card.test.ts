import { readFileSync } from "node:fs";
import { type ComponentProps, createElement, type ReactElement } from "react";
import { renderToReadableStream } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { MEMBER_DEFINITION_MAX } from "@/modules/content/members/member-definition";
import TranslateProvider, { type TranslateAction } from "@/modules/translate/ui/TranslateProvider";

/**
 * §NNN — «Pagini» → «Membri» → «Cine e membru» as the server draws it: a named card (the house's `Panel`
 * with its glyph and its state on the line), the helper sentence, the two languages as the page's own tabs
 * «RO» | «EN» over two boxes, the platform's words as the empty boxes' placeholder, «Tradu din română» under
 * the English one only, and for a reader who may not write it the sentence in force and no form.
 */
const messages = { ro, en } as const;

vi.mock("@/app/[locale]/admin/pages/members/actions", () => ({ saveMemberDefinitionAction: async () => null }));

const { default: DefinitionCard } = await import("@/app/[locale]/admin/pages/members/DefinitionCard");
const { createTranslator, NextIntlClientProvider } = await import("next-intl");

const translate: TranslateAction = async () => ({ ok: false, reason: "notConfigured" });
const REFUSALS = { errors: {}, fields: {}, fieldsIntro: "", fieldError: "", kept: "", keptConflict: "" };
const PLATFORM = { ro: ro.Registration.clubMemberDefinition, en: en.Registration.clubMemberDefinition };
const CLUB_RO = "Ai fost la cel puțin 5 alergări de grup în ultimele 3 luni.";
const CLUB_EN = "You have joined at least 5 group runs in the last 3 months.";

async function html(element: ReactElement): Promise<string> {
  const stream = await renderToReadableStream(element, { onError: () => {} });
  await stream.allReady;
  return (await new Response(stream).text()).replace(/<style[\s\S]*?<\/style>/g, "").replace(/<!-- -->/g, "").replaceAll("&#x27;", "'");
}

async function draw(over: Partial<ComponentProps<typeof DefinitionCard>> = {}, locale: "ro" | "en" = "ro", offer = { action: translate, setupHref: null }) {
  const words = createTranslator({ locale, messages: messages[locale], namespace: "Admin" });
  const props = {
    definition: { ro: null, en: null },
    platformWords: PLATFORM,
    locale,
    words,
    messages: REFUSALS,
    mayEdit: true,
    ...over,
  } as unknown as ComponentProps<typeof DefinitionCard>;
  const intl = { locale, messages: { Translate: messages[locale].Translate, Admin: messages[locale].Admin } } as unknown as ComponentProps<typeof NextIntlClientProvider>;
  return html(createElement(NextIntlClientProvider, intl, createElement(TranslateProvider, { offer } as ComponentProps<typeof TranslateProvider>, createElement(DefinitionCard, props))));
}

/** One element's opening tag by its name. */
const tagOf = (page: string, element: "input" | "textarea", name: string) => new RegExp(`<${element}\\b[^>]*\\bname="${name}"[^>]*>`).exec(page)?.[0] ?? "";

describe("§NNN the «Cine e membru» card on «Membri»", () => {
  it("is a named card with its glyph, the helper sentence and the state on its line", async () => {
    const page = await draw();
    expect(page).toContain('data-testid="members-definition"');
    expect(page).toContain('id="members-definition"');
    expect(page).toContain("Cine e membru");
    expect(page).toContain(ro.Admin.members.definition.intro);
    expect(page).toContain(ro.Admin.members.definition.asideDefault);
    // The card's glyph before its heading, decorative (`Panel`).
    expect(page).toMatch(/<svg[^>]*aria-hidden="true"[^>]*data-testid="CardMembershipIcon"/);
    // A closed fold until opened (§336): a `<details>` with no `open`.
    expect(page).toMatch(/<details[^>]*id="members-definition"/);
    expect(/<details[^>]*id="members-definition"[^>]*\sopen/.test(page)).toBe(false);
  });

  it("draws the two languages as the page's tabs over two boxes posting the names the action reads", async () => {
    const page = await draw();
    expect(page).toContain('id="members-definition-tab-ro"');
    expect(page).toContain('id="members-definition-tab-en"');
    for (const name of ["memberDefinitionRo", "memberDefinitionEn"]) {
      const box = tagOf(page, "textarea", name);
      expect(box, name).not.toBe("");
      expect(box).toContain(`maxLength="${MEMBER_DEFINITION_MAX}"`);
    }
    expect(tagOf(page, "textarea", "memberDefinitionRo")).toContain('lang="ro"');
    expect(tagOf(page, "textarea", "memberDefinitionEn")).toContain('lang="en"');
    expect(page).toContain('name="uiLocale" value="ro"');
    expect(page).toContain(ro.Admin.members.definition.help.replace("{max}", String(MEMBER_DEFINITION_MAX)));
  });

  it("shows the platform's words, each in its language, as the empty boxes' placeholder", async () => {
    const page = await draw();
    expect(tagOf(page, "textarea", "memberDefinitionRo")).toContain(`placeholder="${PLATFORM.ro}"`);
    expect(tagOf(page, "textarea", "memberDefinitionEn")).toContain(`placeholder="${PLATFORM.en}"`);
    expect(PLATFORM.ro).toBe("Am fost la cel puțin 3 alergări de grup în ultimele 6 luni.");
    expect(PLATFORM.en).toBe("I have joined at least 3 group runs in the last 6 months.");
  });

  it("opens with the club's own words in the boxes and says so on its line", async () => {
    const page = await draw({ definition: { ro: CLUB_RO, en: CLUB_EN } });
    expect(page).toContain(`>${CLUB_RO}</textarea>`);
    expect(page).toContain(`>${CLUB_EN}</textarea>`);
    expect(page).toContain(ro.Admin.members.definition.asideWritten);
    expect(page).not.toContain(ro.Admin.members.definition.asideDefault);
  });

  it("offers «Tradu din română» under the English box only, and greys nothing while a key is set", async () => {
    const page = await draw();
    const english = /id="members-definition-panel-en"[\s\S]*$/.exec(page)?.[0] ?? "";
    const romanian = /id="members-definition-panel-ro"[\s\S]*?id="members-definition-panel-en"/.exec(page)?.[0] ?? "";
    expect(english).toContain('data-translate-for="memberDefinitionEn"');
    expect(romanian).not.toContain("data-translate-for");
    // No translation offered on the page (a role that writes nothing): no button at all.
    expect(await draw({}, "ro", null as never)).not.toContain("data-translate-for");
  });

  it("says it in English on the English backoffice", async () => {
    const page = await draw({ definition: { ro: CLUB_RO, en: CLUB_EN } }, "en");
    expect(page).toContain("Who is a member");
    expect(page).toContain(en.Admin.members.definition.intro);
    expect(page).toContain(en.Admin.members.definition.asideWritten);
    expect(page).toContain('name="uiLocale" value="en"');
  });

  it("is the sentence in force and no form for a reader who may not write it", async () => {
    const platform = await draw({ mayEdit: false });
    expect(platform).not.toContain("<form");
    expect(platform).toMatch(new RegExp(`data-testid="members-definition-words"[^>]*>${PLATFORM.ro}<`));

    const written = await draw({ mayEdit: false, definition: { ro: CLUB_RO, en: CLUB_EN } }, "en");
    expect(written).not.toContain("<form");
    expect(written).toMatch(new RegExp(`data-testid="members-definition-words"[^>]*>${CLUB_EN}<`));
  });
});

describe("§NNN the card is wired the house's way", () => {
  const read = (file: string) => readFileSync(file, "utf8");

  it("is on the members' page, saved by its own action, never behind the page's publish switch", () => {
    const page = read("src/app/[locale]/admin/pages/members/page.tsx");
    expect(page).toContain("<DefinitionCard");
    expect(page).toContain("readMemberDefinition");
    // The names its boxes post are in the refusal summary's map.
    expect(page).toContain("memberDefinitionRo: t(");
    expect(page).toContain("memberDefinitionEn: t(");
    const actions = read("src/app/[locale]/admin/pages/members/actions.ts");
    expect(actions).toContain("saveMemberDefinitionAction");
    expect(actions).toMatch(/saveMemberDefinitionAction[\s\S]*?requireStaffCapability\(canEditMembersPage\)/);
    expect(actions).not.toMatch(/saveMemberDefinitionAction[\s\S]{0,600}setMembersPagePublished/);
  });

  it("carries a message for every word it draws, in both languages, and the toast of its save", () => {
    for (const catalogue of [ro, en]) {
      const definition = catalogue.Admin.members.definition;
      for (const key of ["heading", "intro", "asideWritten", "asideDefault", "ro", "en", "help"] as const) expect(definition[key], key).toBeTruthy();
      expect(catalogue.Feedback.toast.memberDefinitionSaved).toBeTruthy();
      expect(catalogue.Registration.clubMemberDefinition).toBeTruthy();
      expect(catalogue.Registration).not.toHaveProperty("clubMemberHint");
    }
  });
});
