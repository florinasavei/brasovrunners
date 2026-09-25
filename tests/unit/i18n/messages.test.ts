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

      // Static keys only. A template literal such as t(`type.${event.type}`) is checked by
      // the exhaustiveness of the enum it interpolates, not here.
      for (const match of text.matchAll(/\bt\w*\(\s*["']([\w.]+)["']\s*[),]/g)) {
        const key = match[1];
        const resolves = namespaces.some((ns) => `${ns}.${key}` in roFlat);
        if (!resolves) {
          missing.push(`${path.relative(process.cwd(), file)}: ${namespaces.join("|")}.${key}`);
        }
      }
      // And `t.raw("key")`, which the pattern above does not see: a template the client fills
      // itself (§370, below), or a list or a sub-tree (`desk.how`, `guide.sections`).
      for (const match of text.matchAll(/\bt\w*\.raw\(\s*["']([\w.]+)["']\s*\)/g)) {
        const key = match[1];
        const resolves = namespaces.some(
          (ns) => `${ns}.${key}` in roFlat || Object.keys(roFlat).some((known) => known.startsWith(`${ns}.${key}.`)),
        );
        if (!resolves) {
          missing.push(`${path.relative(process.cwd(), file)}: ${namespaces.join("|")}.${key} (raw)`);
        }
      }
    }

    expect(missing, "message keys used in src/ but absent from the catalogues").toEqual([]);
  });

  /**
   * §370 — a message with an argument is either formatted with its values or read raw, never
   * looked up bare.
   *
   * `t("forms.incompleteFirst")` — "Completează mai întâi: {field}", a template `SubmitButton`
   * fills in the browser with the first empty field's label — worked on production and on QA by
   * accident of next-intl's fast path: a production build returns a message unformatted when no
   * values are passed. A development build compiles it anyway, to report missing arguments, finds
   * `{field}` without a value, logs a FORMATTING_ERROR and returns the key. So under `yarn dev`
   * every backoffice form's hint read "Admin.forms.incompleteFirst" and could never name the
   * field, and the gallery's upload counter read "Admin.gallery.uploaded" — which is why the
   * gallery spec failed against `next dev` and passed against a build. `t.raw` is the lookup
   * that means "the template itself", and says so in both builds.
   *
   * A tag is the same trap: `Devs.neon.unavailable` said `--project-id <id>`, which a production
   * build printed as written and a development build refused as an unclosed tag, showing
   * "Devs.neon.unavailable" on `/devs`. A literal angle bracket is written `'<id>'`, ICU's quote,
   * which both builds print as `<id>`.
   */
  it("never looks up a message that has an argument or a tag without passing its values", () => {
    const bare: string[] = [];

    for (const file of sourceFiles(path.join(process.cwd(), "src"))) {
      const text = readFileSync(file, "utf8");
      const namespaces = [
        ...[...text.matchAll(/(?:getTranslations|useTranslations)\(\s*["'`](\w+)["'`]/g)].map((m) => m[1]),
        ...[...text.matchAll(/namespace:\s*["'`](\w+)["'`]/g)].map((m) => m[1]),
      ];

      for (const match of text.matchAll(/\bt\w*\(\s*["']([\w.]+)["']\s*\)/g)) {
        for (const ns of namespaces) {
          const message = roFlat[`${ns}.${match[1]}`];
          if (message !== undefined && /\{\w|(?<!')</.test(message)) {
            bare.push(`${path.relative(process.cwd(), file)}: ${ns}.${match[1]} = ${JSON.stringify(message)}`);
          }
        }
      }
    }

    expect(bare, "pass the values, or read the template with t.raw(…) when the client fills it").toEqual([]);
  });

  it("resolves the dynamic event type and surface keys for every value in each enum", async () => {
    // t(`type.${event.type}`) and t(`surface.${event.surface}`) are dynamic, so the parity
    // test cannot see them. The enums are the contract: every value must have a label in both
    // locales or a page renders "type.RACE" (BR-REQ-010-01 criterion 1).
    const { EVENT_TYPES, EVENT_SURFACES } = await import("@/modules/events/domain/event-type");
    for (const type of EVENT_TYPES) {
      expect(roFlat[`Event.type.${type}`], `ro label for ${type}`).toBeDefined();
      expect(enFlat[`Event.type.${type}`], `en label for ${type}`).toBeDefined();
    }
    for (const surface of EVENT_SURFACES) {
      expect(roFlat[`Event.surface.${surface}`], `ro label for ${surface}`).toBeDefined();
      expect(enFlat[`Event.surface.${surface}`], `en label for ${surface}`).toBeDefined();
    }
    // The five difficulty levels (§412): the public pill reads `Event.difficultyValues`, the
    // editor's select `Admin.editor.difficultyValues` — both, in both locales, for every level.
    const { DIFFICULTY_LEVELS } = await import("@/modules/events/domain/difficulty");
    for (const level of DIFFICULTY_LEVELS) {
      for (const key of [`Event.difficultyValues.${level}`, `Admin.editor.difficultyValues.${level}`]) {
        expect(roFlat[key], `ro label ${key}`).toBeDefined();
        expect(enFlat[key], `en label ${key}`).toBeDefined();
      }
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
 * The backoffice interpolates keys the static scan above cannot see, because they are built
 * from a value: an error code, a locale. Each set has a single source of truth in the code, so
 * the contract is checkable — and a missing one renders "Admin.errors.CONFLICT" to an organizer
 * at the worst possible moment.
 *
 * The backoffice's *enum* labels are no longer among them. Editorial status, transitions, staff
 * roles, event status, registration mode and registration status moved out of both catalogues
 * into `modules/staff-identity/domain/staff-labels.ts`, in Romanian only (`DECISIONS.md` §35).
 * Their exhaustiveness is checked below, against the enums themselves rather than against two
 * copies of the same words.
 */
describe("BR-REQ-040-04 the backoffice keys the source builds dynamically", () => {
  it("has a Romanian label for every backoffice enum value, and no second copy", async () => {
    const { EDITORIAL_STATUSES, STAFF_ROLES } = await import(
      "@/modules/staff-identity/domain/roles"
    );
    const labels = await import("@/modules/staff-identity/domain/staff-labels");
    const { registrationStatus } = await import("@/db/schema/registrations");

    for (const status of EDITORIAL_STATUSES) {
      expect(labels.EDITORIAL_STATUS_LABEL[status], `label for ${status}`).toBeTruthy();
      // Every status is also a possible destination of a transition button, and the word for
      // the action is not the word for the state.
      expect(labels.EDITORIAL_TRANSITION_LABEL[status], `action for ${status}`).toBeTruthy();
    }
    for (const role of STAFF_ROLES) {
      expect(labels.STAFF_ROLE_LABEL[role], `label for ${role}`).toBeTruthy();
    }
    for (const status of registrationStatus.enumValues) {
      expect(labels.REGISTRATION_STATUS_LABEL[status], `label for ${status}`).toBeTruthy();
    }
    // The journey's six steps name the same lifecycle (§145), so the same rule.
    const { JOURNEY_STEPS } = await import("@/modules/registrations/domain/journey");
    for (const step of JOURNEY_STEPS) {
      expect(labels.JOURNEY_STEP_LABEL[step], `label for ${step}`).toBeTruthy();
    }

    // And the catalogues no longer carry them: two copies of the same seven words is what this
    // move removed, so a key creeping back in is a regression rather than a nicety.
    const journeySteps = new RegExp(`^Admin\\.registrations\\.journey\\.(${JOURNEY_STEPS.join("|")})$`);
    for (const key of Object.keys(roFlat)) {
      expect(
        /^Admin\.(status|transition|roles|eventStatus|registrationMode)\./.test(key) ||
          key.startsWith("Admin.registrations.status.") ||
          journeySteps.test(key),
        `${key} belongs in staff-labels.ts, not in the catalogues`,
      ).toBe(false);
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
