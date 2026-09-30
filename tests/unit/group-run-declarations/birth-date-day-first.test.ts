import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import BirthDateField from "@/modules/registrations/ui/BirthDateField";

/**
 * §NNN (applying §561 to §440's box) — the group run's signing page asks a birth date only above
 * eighteen, and it drew the browser's own `type="date"` box for it: month first on an English
 * phone. It now draws the registration form's `BirthDateField` — typed day first, «11.05.1990»,
 * the same placeholder, the date in words with the age on the run's day as its helper, the run's
 * minimum age refused under it — and the action reads the typed text with the same
 * `normalizeTypedDate`, so the service still gets `YYYY-MM-DD`. BR-REQ-033-02.
 */
const ROOT = path.resolve(__dirname, "../../..");
const read = (relative: string) => readFileSync(path.join(ROOT, relative), "utf8").replace(/\r\n/g, "\n");
const PAGE = "src/app/[locale]/events/[slug]/declaration/page.tsx";
const ACTION = "src/app/[locale]/events/[slug]/declaration/actions.ts";

const signed = vi.hoisted(() => ({ inputs: [] as Array<{ birthDate?: string }> }));

vi.mock("@/db/client", () => ({ getDb: () => ({}) }));
vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, set: () => undefined, delete: () => undefined }),
}));
vi.mock("next-intl/server", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getTranslations: async () => (key: string) => key,
}));
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  redirect: (url: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { redirectTo: url });
  },
}));
vi.mock("@/modules/registrations/bot-check", () => ({ botCheckIsOn: async () => false }));
vi.mock("@/modules/registrations/form-draft", () => ({ clearFormDraft: async () => undefined, stashDraftValues: async () => undefined }));
vi.mock("@/modules/events/members-only", () => ({ membersViewer: async () => null }));
vi.mock("@/modules/group-run-declarations/service", () => ({
  signGroupRunDeclaration: async (_db: unknown, input: { birthDate?: string }) => {
    signed.inputs.push(input);
    return { outcome: "signed" };
  },
}));

const { signGroupRunDeclarationAction } = await import("@/app/[locale]/events/[slug]/declaration/actions");

async function press(birthDate: string | null): Promise<string | undefined> {
  const form = new FormData();
  for (const [name, value] of Object.entries({ locale: "en", slug: "trail-run", eventId: "e", documentId: "d", contentSha256: "h", accepted: "on", typedName: "Ana Pop", email: "ana@example.test" })) {
    form.set(name, value);
  }
  if (birthDate !== null) form.set("birthDate", birthDate);
  const thrown = await signGroupRunDeclarationAction(form).then(
    () => null,
    (error: unknown) => error,
  );
  expect((thrown as { redirectTo?: string } | null)?.redirectTo ?? "").toContain("done=1");
  return signed.inputs.at(-1)?.birthDate;
}

beforeEach(() => {
  signed.inputs.length = 0;
});

describe("§NNN the group run's signing page draws the typed, day-first birth date", () => {
  it("uses the registration form's `BirthDateField`, never the browser's date box", () => {
    const page = read(PAGE);
    expect(page).toContain('import BirthDateField from "@/modules/registrations/ui/BirthDateField"');
    expect(page).toMatch(/<BirthDateField\s+id="birthDate"\s+name="birthDate"/);
    expect(page).not.toContain('type="date"');
    // The same words as the registration form: placeholder, the date in words, the unreadable refusal.
    for (const key of ['formCopy("birthDatePlaceholder")', 'formCopy("birthDateUnreadable")', 'formCopy("birthDateEcho"', "tooYoung={tooYoungWords}", "eventDay={runDay}"]) {
      expect(page, key).toContain(key);
    }
  });

  function render(locale: "ro" | "en", props: { defaultValue?: string; error?: boolean; errorText?: string } = {}) {
    const words = locale === "ro" ? ro : en;
    const minimumAge = locale === "ro" ? "20 de ani" : "20 years";
    const help = words.Event.groupRunDeclaration.page.birthDateHelp.replace("{age}", minimumAge);
    const tooYoung = words.Event.groupRunDeclaration.page.tooYoung.replace("{age}", minimumAge);
    return renderToStaticMarkup(
      createElement(BirthDateField, {
        id: "birthDate",
        name: "birthDate",
        label: words.Event.groupRunDeclaration.page.fields.birthDate,
        required: true,
        autoComplete: "bday",
        help,
        errorText: props.errorText ?? help,
        min: "1906-09-29",
        max: "2007-04-21",
        eventDay: "2027-04-21",
        locale,
        echoTemplate: words.Registration.birthDateEcho,
        placeholder: words.Registration.birthDatePlaceholder,
        unreadable: words.Registration.birthDateUnreadable,
        tooYoung,
        defaultValue: props.defaultValue,
        error: props.error,
      }),
    );
  }

  it("in English too the box is a typed text box showing the date day first, with the day-first placeholder", () => {
    for (const locale of ["ro", "en"] as const) {
      const html = render(locale, { defaultValue: "1990-05-11" });
      const input = html.match(/<input[^>]*name="birthDate"[^>]*>/)?.[0] ?? "";
      expect(input, locale).not.toBe("");
      expect(input, locale).not.toContain('type="date"');
      expect(input, locale).toContain('type="text"');
      expect(input, locale).toContain('value="11.05.1990"');
      expect(input, locale).toContain(`placeholder="${locale === "ro" ? "ZZ.LL.AAAA" : "DD.MM.YYYY"}"`);
      expect(input, locale).toContain('id="birthDate"');
      expect(input, locale).toContain('data-max="2007-04-21"');
    }
  });

  it("the helper is the run's help at rest and the date in words with the age on the run's day", () => {
    const html = render("en", { defaultValue: "11.05.1990" });
    expect(html).toContain("For the run&#x27;s minimum age: 20 years");
    expect(html).toContain("Friday, 11 May 1990 · 36 years on the event day");
  });

  it("a date under the run's minimum age says the rule under the box, in red", () => {
    const html = render("ro", { defaultValue: "22.04.2007" });
    expect(html).toContain("Vârsta minimă pentru această alergare este 20 de ani");
    expect(html).toContain("Mui-error");
  });
});

describe("§NNN the signing action reads the typed date as the registration form does", () => {
  it("posts `YYYY-MM-DD` to the service for a day-first date, whatever the separator", async () => {
    expect(read(ACTION)).toContain('normalizeTypedDate(text(form, "birthDate"))');
    for (const typed of ["11.05.1990", "11/05/1990", "11-5-1990", "11051990", " 11.05.1990 "]) {
      expect(await press(typed), typed).toBe("1990-05-11");
    }
  });

  it("keeps the posted shape, hands the service what is no date for it to refuse, and nothing when the run asks none", async () => {
    expect(await press("1990-05-11")).toBe("1990-05-11");
    expect(await press("31.02.1990")).toBe("31.02.1990");
    expect(await press("")).toBeUndefined();
    expect(await press(null)).toBeUndefined();
  });
});
