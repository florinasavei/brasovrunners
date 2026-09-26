import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { actionKeyOf } from "@/shared/forms/action-key";
import type { FormOutcome } from "@/shared/forms/outcome";
import {
  ACTION_FORM_ATTRIBUTE,
  ACTION_KEY_ATTRIBUTE,
  entriesFromPress,
  mergeServerFields,
  rememberSubmission,
  type Submission,
  takeSubmission,
  transportFailureOf,
  UNEXPECTED_RESPONSE_MESSAGE,
} from "@/shared/forms/save-fallback";

/**
 * §NNN — a backoffice save that a corporate network refused is sent again as a plain browser POST.
 *
 * What is decided here, without a browser: which failures are the network's (and so start the
 * fallback) and which are not — a refusal, a redirect, a server error, a missing action; which
 * presses already hold the no-JavaScript fields and which need the page's HTML; how the server's
 * fields and the typed values are put together; and the key the server stamps on a form. The
 * browser half — the plain POST landing, the notice after it — is `tests/e2e/save-fallback.spec.ts`.
 */
const ROOT = path.resolve(__dirname, "../../..");
const read = (relative: string) => readFileSync(path.join(ROOT, relative), "utf8").replace(/\r\n/g, "\n");

function withCode(message: string, code: string): Error {
  const error = new Error(message);
  Object.defineProperty(error, "__NEXT_ERROR_CODE", { value: code, enumerable: false });
  return error;
}

function press(overrides: Partial<Submission> = {}): Submission {
  return {
    entries: [["name", "Cros"]],
    url: "/ro/admin/emails",
    key: "abc",
    formId: null,
    ordinal: 0,
    siblings: 1,
    submitter: null,
    at: Date.now(),
    ...overrides,
  };
}

describe("§NNN which failures are the network's", () => {
  it("a fetch that never got an answer is a network failure", () => {
    expect(transportFailureOf(new TypeError("Failed to fetch"))).toBe("network");
    expect(transportFailureOf(new TypeError("Load failed"))).toBe("network");
  });

  it("an answer that is not a Server Action's — a proxy's block page — is one too, by Next's code or its words", () => {
    expect(transportFailureOf(withCode(UNEXPECTED_RESPONSE_MESSAGE, "E394"))).toBe("unexpected");
    expect(transportFailureOf(new Error(UNEXPECTED_RESPONSE_MESSAGE))).toBe("unexpected");
  });

  it("a refusal is never one: it is a returned state, not an error", () => {
    const refusal: FormOutcome = { error: "VALIDATION_ERROR", fields: ["name"], values: {} };
    expect(transportFailureOf(refusal)).toBeNull();
    expect(transportFailureOf(null)).toBeNull();
    expect(transportFailureOf(undefined)).toBeNull();
    expect(transportFailureOf("VALIDATION_ERROR")).toBeNull();
  });

  it("Next's own signals and the server's errors are not: they carry a digest", () => {
    const redirect = Object.assign(new Error("NEXT_REDIRECT"), { digest: "NEXT_REDIRECT;push;/ro/admin;303;" });
    const notFound = Object.assign(new Error("NEXT_HTTP_ERROR_FALLBACK;404"), { digest: "NEXT_HTTP_ERROR_FALLBACK;404" });
    const serverError = Object.assign(new Error("An error occurred in the Server Components render."), { digest: "2060393594" });
    expect(transportFailureOf(redirect)).toBeNull();
    expect(transportFailureOf(notFound)).toBeNull();
    expect(transportFailureOf(serverError)).toBeNull();
    // Even a TypeError, if the server raised it.
    expect(transportFailureOf(Object.assign(new TypeError("x is undefined"), { digest: "1" }))).toBeNull();
  });

  it("a Server Action a new deployment no longer knows is not: a plain post would fail the same way", () => {
    expect(transportFailureOf(withCode('Server Action "abc" was not found on the server.', "E715"))).toBeNull();
    // A provider's own error text (Vercel's text/plain 5xx) is the server's, not the network's.
    expect(transportFailureOf(new Error("An error occurred with your deployment"))).toBeNull();
  });
});

describe("§NNN what the plain POST carries", () => {
  it("a form the server drew already holds its action's fields, and goes as it is", () => {
    const entries: Submission["entries"] = [
      ["$ACTION_REF_1", ""],
      ["$ACTION_1:0", '{"id":"abc","bound":"$@1"}'],
      ["$ACTION_KEY", "k1"],
      ["reminderHours", "48"],
    ];
    expect(entriesFromPress(press({ entries }))).toEqual(entries);
  });

  it("a form the browser drew has none, and needs the page's HTML", () => {
    expect(entriesFromPress(press())).toBeNull();
  });

  it("a button the server drew with an action of its own names it, and that is enough", () => {
    const entries: Submission["entries"] = [["eventRef", "e1"], ["$ACTION_ID_def", ""]];
    expect(entriesFromPress(press({ entries, submitter: { name: "$ACTION_ID_def", index: 2, text: "Șterge", ownAction: false } }))).toEqual(entries);
  });

  it("a button the browser drew with an action of its own always needs the page's HTML, or the form's own verb would run", () => {
    const entries: Submission["entries"] = [["$ACTION_REF_1", ""], ["eventRef", "e1"]];
    expect(entriesFromPress(press({ entries, submitter: { name: "", index: 2, text: "Șterge", ownAction: true } }))).toBeNull();
  });

  it("puts the server's fields first, the typed values after, and the pressed button's action last — the last one named wins", () => {
    const submission = press({
      entries: [["$ACTION_STALE", "x"], ["eventRef", "e1"], ["eventRef", "e2"], ["confirmedVerb", "Șterge"]],
      submitter: { name: "confirmedVerb", index: 2, text: "Șterge", ownAction: true },
    });
    const merged = mergeServerFields(submission, { fields: [["$ACTION_REF_1", ""], ["$ACTION_1:0", "{}"]], submitter: ["$ACTION_ID_def", ""] });
    expect(merged).toEqual([
      ["$ACTION_REF_1", ""],
      ["$ACTION_1:0", "{}"],
      ["eventRef", "e1"],
      ["eventRef", "e2"],
      ["$ACTION_ID_def", ""],
    ]);
  });

  it("keeps a plain button's own name and value when the server's fields name no button", () => {
    const submission = press({ entries: [["direction", "up"]], submitter: { name: "direction", index: 0, text: "Sus", ownAction: false } });
    expect(mergeServerFields(submission, { fields: [["$ACTION_ID_move", ""]], submitter: null })).toEqual([
      ["$ACTION_ID_move", ""],
      ["direction", "up"],
    ]);
  });
});

describe("§NNN the press the admin boundary replays", () => {
  it("is handed out once, and only while it is recent", () => {
    const now = Date.now();
    rememberSubmission(press({ at: now }));
    expect(takeSubmission(now + 1000)?.url).toBe("/ro/admin/emails");
    expect(takeSubmission(now + 1000)).toBeNull();
    rememberSubmission(press({ at: now }));
    expect(takeSubmission(now + 10 * 60_000)).toBeNull();
  });
});

describe("§NNN the key the server stamps on a form", () => {
  it("is the Server Action's id, and its bound arguments folded in", () => {
    const action = Object.assign(async () => null, { $$id: "7f00aa", $$bound: null });
    expect(actionKeyOf(action)).toBe("7f00aa");
    const bound = Object.assign(async () => null, { $$id: "7f00aa", $$bound: ["event-1"] });
    const other = Object.assign(async () => null, { $$id: "7f00aa", $$bound: ["event-2"] });
    expect(actionKeyOf(bound)).toMatch(/^7f00aa\.[0-9a-f]{8}$/);
    expect(actionKeyOf(bound)).toBe(actionKeyOf(Object.assign(async () => null, { $$id: "7f00aa", $$bound: ["event-1"] })));
    expect(actionKeyOf(bound)).not.toBe(actionKeyOf(other));
  });

  it("is absent for anything that is not a Server Action reference", () => {
    expect(actionKeyOf(async () => null)).toBeUndefined();
    expect(actionKeyOf("/api/admin/x")).toBeUndefined();
    expect(actionKeyOf(undefined)).toBeUndefined();
    const circular: unknown[] = [];
    circular.push(circular);
    expect(actionKeyOf(Object.assign(async () => null, { $$id: "7f00aa", $$bound: circular }))).toBeUndefined();
  });

  it("is written on the form under the attribute the fallback searches for", () => {
    const island = read("src/shared/forms/ActionFormIsland.tsx");
    expect(ACTION_KEY_ATTRIBUTE).toBe("data-action-key");
    expect(ACTION_FORM_ATTRIBUTE).toBe("data-action-form");
    expect(island).toContain('data-action-key={actionKey} data-action-form=""');
    expect(read("src/shared/forms/ActionForm.tsx")).toContain("actionKey={actionKeyOf(props.action)}");
  });
});

describe("§NNN the island catches only the transport, and the server still renders the action itself", () => {
  const island = read("src/shared/forms/ActionFormIsland.tsx");

  it("renders the Server Action on the server — that is what writes the no-JavaScript fields — and the guarded one in the browser", () => {
    expect(island).toContain('useActionState(typeof window === "undefined" ? action : guardedAction, null)');
  });

  it("rethrows everything that is not a transport failure, and replays before it says anything", () => {
    const guarded = island.slice(island.indexOf("const guardedAction"), island.indexOf("const [state, formAction]"));
    expect(guarded).toMatch(/if \(!transportFailureOf\(error\) \|\| !element\) throw error;/);
    expect(guarded).toMatch(/if \(await replayNatively\(describeSubmission\(element, lastSubmitter\.current\)\)\) return new Promise<never>\(\(\) => \{\}\);\s*setBlocked\(true\);\s*return previous;/);
  });

  it("the admin boundary throws every other error on to the one the backoffice always had", () => {
    expect(read("src/app/[locale]/admin/error.tsx")).toMatch(/if \(!failure\) throw error;/);
  });
});

describe("§NNN the words, in both languages", () => {
  type Catalogue = { Network: Record<string, unknown>; Admin: { guide: Record<string, string> } };
  const catalogues = { ro: ro as unknown as Catalogue, en: en as unknown as Catalogue };

  const keysOf = (tree: Record<string, unknown>, prefix = ""): string[] =>
    Object.entries(tree).flatMap(([key, value]) =>
      value && typeof value === "object" ? keysOf(value as Record<string, unknown>, `${prefix}${key}.`) : [`${prefix}${key}`],
    );

  it("has every Network key in both catalogues", () => {
    expect(keysOf(catalogues.ro.Network).sort()).toEqual(keysOf(catalogues.en.Network).sort());
  });

  it("says, after the simple path, what happened and what to do — the owner's sentence", () => {
    expect(catalogues.ro.Network.fallback).toBe(
      "Rețeaua de la birou a blocat cererea de salvare; am trimis-o pe calea simplă. Dacă salvarea nu reușește, încearcă de pe telefon sau de pe altă rețea — datele completate rămân aici.",
    );
    expect(catalogues.en.Network.fallback).toBe(
      "The office network blocked the save request; it went through the simple path. If a save fails, try from your phone or another network — what you typed stays here.",
    );
  });

  it("names the host to allow through a placeholder, never a literal", () => {
    for (const catalogue of Object.values(catalogues)) {
      const page = catalogue.Network.page as Record<string, Record<string, string>>;
      for (const probe of ["saves", "post", "pictures", "botCheck"]) expect(page[probe].allow).toContain("{host}");
    }
  });

  it("links the guide to the network check", () => {
    expect(catalogues.ro.Admin.guide.networkLink).toBe("Verifică rețeaua");
    expect(catalogues.en.Admin.guide.networkLink).toBe("Check the network");
    expect(read("src/app/[locale]/admin/guide/page.tsx")).toContain('<Link href="/admin/network">{t("guide.networkLink")}</Link>');
  });
});
