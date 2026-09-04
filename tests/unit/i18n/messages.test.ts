import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { routing } from "@/i18n/routing";

/**
 * BR-REQ-040-04 — no untranslated user-facing strings.
 *
 * Criterion 1 requires the catalogues to have identical key sets and identical interpolation
 * placeholders. This is the cheapest failure in the project to introduce — add a key to one
 * file, forget the other, and the missing locale renders the raw key to a visitor.
 */

type Messages = Record<string, unknown>;

function flatten(messages: Messages, prefix = ""): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(messages)) {
    const full = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === "object") {
      Object.assign(out, flatten(value as Messages, full));
    } else {
      out[full] = String(value);
    }
  }
  return out;
}

/** ICU placeholders such as {km} or {count, plural, ...} — the name is what must match. */
function placeholders(message: string): string[] {
  return [...message.matchAll(/\{(\w+)/g)].map((m) => m[1]).sort();
}

const roFlat = flatten(ro);
const enFlat = flatten(en);

describe("BR-REQ-040-04 criterion 1 catalogue parity", () => {
  it("covers every locale the routing declares", () => {
    // If a third locale is added, this test must grow with it rather than silently
    // continuing to compare only two files.
    expect([...routing.locales].sort()).toEqual(["en", "ro"]);
  });

  it("has identical key sets in both catalogues", () => {
    const roKeys = Object.keys(roFlat).sort();
    const enKeys = Object.keys(enFlat).sort();

    expect(roKeys.filter((k) => !enKeys.includes(k)), "keys missing from en.json").toEqual([]);
    expect(enKeys.filter((k) => !roKeys.includes(k)), "keys missing from ro.json").toEqual([]);
  });

  it("uses identical interpolation placeholders for every key", () => {
    for (const key of Object.keys(roFlat)) {
      if (!(key in enFlat)) continue; // reported by the previous test
      expect(placeholders(roFlat[key]), `placeholders differ for "${key}"`).toEqual(
        placeholders(enFlat[key]),
      );
    }
  });

  it("has no empty message in either catalogue", () => {
    for (const [locale, flat] of [
      ["ro", roFlat],
      ["en", enFlat],
    ] as const) {
      for (const [key, value] of Object.entries(flat)) {
        expect(value.trim(), `${locale}.json has an empty message for "${key}"`).not.toBe("");
      }
    }
  });
});

/**
 * Every key the source actually asks for must exist.
 *
 * The parity test above proves the two files agree with each other; it cannot catch a key
 * that exists in neither. A typo in `t("meetingPont")` renders the literal key to a visitor,
 * which is exactly the failure BR-REQ-040-04 exists to prevent, and neither TypeScript nor
 * the linter sees it.
 */
function sourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, acc);
    else if (/\.tsx?$/.test(entry)) acc.push(full);
  }
  return acc;
}

describe("BR-REQ-040-04 every key used in src/ resolves", () => {
  it("finds no message key that is missing from the catalogues", () => {
    const missing: string[] = [];

    for (const file of sourceFiles(path.join(process.cwd(), "src"))) {
      const text = readFileSync(file, "utf8");

      // The namespace a file translates under, e.g. getTranslations("Event").
      const namespaces = [
        ...text.matchAll(/(?:getTranslations|useTranslations)\(\s*["'`](\w+)["'`]/g),
      ].map((m) => m[1]);
      // Also the object form: getTranslations({ locale, namespace: "Site" }).
      namespaces.push(
        ...[...text.matchAll(/namespace:\s*["'`](\w+)["'`]/g)].map((m) => m[1]),
      );
      if (namespaces.length === 0) continue;

      // Static keys only. A template literal such as t(`kind.${event.kind}`) is checked by
      // the exhaustiveness of the enum it interpolates, not here.
      for (const match of text.matchAll(/\bt\w*\(\s*["']([\w.]+)["']\s*[),]/g)) {
        const key = match[1];
        const resolves = namespaces.some((ns) => `${ns}.${key}` in roFlat);
        if (!resolves) {
          missing.push(`${path.relative(process.cwd(), file)}: ${namespaces.join("|")}.${key}`);
        }
      }
    }

    expect(missing, "message keys used in src/ but absent from the catalogues").toEqual([]);
  });

  it("resolves the dynamic event-kind keys for every kind in the enum", async () => {
    // t(`kind.${event.kind}`) is dynamic, so the parity test cannot see it. The enum is the
    // contract: every kind must have a label in both locales or a page renders "kind.RACE".
    const { EVENT_KINDS } = await import("@/modules/events/domain/event-kind");
    for (const kind of EVENT_KINDS) {
      expect(roFlat[`Event.kind.${kind}`], `ro label for ${kind}`).toBeDefined();
      expect(enFlat[`Event.kind.${kind}`], `en label for ${kind}`).toBeDefined();
    }
  });

  it("resolves a label for every registration state the domain can return", () => {
    const states = [
      "NOT_APPLICABLE",
      "EXTERNAL",
      "NOT_YET_OPEN",
      "OPEN",
      "CLOSED",
      "EVENT_CANCELLED",
    ];
    for (const state of states) {
      expect(roFlat[`Event.registrationState.${state}`], `ro label for ${state}`).toBeDefined();
      expect(enFlat[`Event.registrationState.${state}`], `en label for ${state}`).toBeDefined();
    }
  });
});

/**
 * The backoffice interpolates four sets of keys, and none of them is visible to the static
 * scan above: statuses, transitions, roles and error codes are all built from a value. Each
 * set has a single source of truth in the code, so the contract is checkable — and a missing
 * one renders "Admin.errors.CONFLICT" to an organizer at the worst possible moment.
 */
describe("BR-REQ-040-04 the backoffice keys the source builds dynamically", () => {
  it("has a label for every editorial status and every transition", async () => {
    const { EDITORIAL_STATUSES } = await import("@/modules/staff-identity/domain/roles");
    for (const status of EDITORIAL_STATUSES) {
      expect(roFlat[`Admin.status.${status}`], `ro label for ${status}`).toBeDefined();
      expect(enFlat[`Admin.status.${status}`], `en label for ${status}`).toBeDefined();
      // Every status is also a possible destination of a transition button.
      expect(roFlat[`Admin.transition.${status}`], `ro action for ${status}`).toBeDefined();
      expect(enFlat[`Admin.transition.${status}`], `en action for ${status}`).toBeDefined();
    }
  });

  it("has a label for every staff role", async () => {
    const { STAFF_ROLES } = await import("@/modules/staff-identity/domain/roles");
    for (const role of STAFF_ROLES) {
      expect(roFlat[`Admin.roles.${role}`], `ro label for ${role}`).toBeDefined();
      expect(enFlat[`Admin.roles.${role}`], `en label for ${role}`).toBeDefined();
    }
  });

  it("has a code and a name for every locale the switcher offers", async () => {
    // The header interpolates both, once per locale, so a third locale would render
    // "Site.languageCode.de" in the header of every page.
    const { routing } = await import("@/i18n/routing");
    for (const locale of routing.locales) {
      expect(roFlat[`Site.languageCode.${locale}`], `ro code for ${locale}`).toBeDefined();
      expect(enFlat[`Site.languageCode.${locale}`], `en code for ${locale}`).toBeDefined();
      expect(roFlat[`Site.languageName.${locale}`], `ro name for ${locale}`).toBeDefined();
      expect(enFlat[`Site.languageName.${locale}`], `en name for ${locale}`).toBeDefined();
    }
  });

  it("names each language in its own words, identically in both catalogues", () => {
    // An endonym is not translated: "Română" is what a Romanian speaker looks for in an
    // English interface, which is the whole point of a language switcher.
    expect(roFlat["Site.languageName.ro"]).toBe(enFlat["Site.languageName.ro"]);
    expect(roFlat["Site.languageName.en"]).toBe(enFlat["Site.languageName.en"]);
  });

  it("has a flag file for every locale the switcher shows", async () => {
    // `public/flags/` is generated from flag-icons by `yarn flags:sync`, so this catches both
    // a locale added without a flag and a file renamed upstream — either of which renders a
    // broken image in the header of every page.
    const { routing } = await import("@/i18n/routing");
    const flagOf: Record<string, string> = { ro: "ro", en: "gb" };

    for (const locale of routing.locales) {
      const file = path.join(process.cwd(), "public", "flags", `${flagOf[locale]}.svg`);
      expect(existsSync(file), `flag for ${locale}: ${flagOf[locale]}.svg`).toBe(true);
    }
  });

  it("has a message for every domain error code the backoffice can be handed", () => {
    // The codes are a union type, so they cannot be enumerated at runtime; they are listed
    // here instead, and the list is short enough to keep honest.
    for (const code of [
      "UNAUTHENTICATED",
      "FORBIDDEN",
      "NOT_FOUND",
      "VALIDATION_ERROR",
      "CONFLICT",
    ]) {
      expect(roFlat[`Admin.errors.${code}`], `ro message for ${code}`).toBeDefined();
      expect(enFlat[`Admin.errors.${code}`], `en message for ${code}`).toBeDefined();
    }
  });
});
