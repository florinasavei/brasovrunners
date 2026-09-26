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
  boundaryFailureOf,
  forgetSubmission,
  RECENT_PRESS_MS,
  recentSubmission,
  rememberSubmission,
  type Submission,
  transportFailureOf,
  UNEXPECTED_RESPONSE_MESSAGE,
} from "@/shared/forms/save-fallback";

/**
 * §436 — a backoffice save that a corporate network refused is sent again as a plain browser POST.
 *
 * What is decided here, without a browser: which failures are the network's (and so start the
 * fallback) and which are not — a refusal, a redirect, a server error, a missing action; which
 * presses already hold the no-JavaScript fields and which need the page's HTML; how the server's
 * fields and the typed values are put together; and the key the server stamps on a form. The
 * browser half — the plain POST landing, the notice after it — has no spec: the owner cut the
 * browser run on 2026-09-26 (§436), so it is proved on QA by hand from a blocked network.
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

describe("§436 which failures are the network's", () => {
  it("a fetch that never got an answer is a network failure, in every browser's words", () => {
    expect(transportFailureOf(new TypeError("Failed to fetch"))).toBe("network");
    expect(transportFailureOf(new TypeError("NetworkError when attempting to fetch resource."))).toBe("network");
    expect(transportFailureOf(new TypeError("Load failed"))).toBe("network");
  });

  it("any other TypeError is a bug in the page, never the network", () => {
    expect(transportFailureOf(new TypeError("Cannot read properties of null (reading 'value')"))).toBeNull();
    expect(transportFailureOf(new TypeError("x is not a function"))).toBeNull();
    expect(transportFailureOf(new TypeError("undefined is not an object (evaluating 'a.b')"))).toBeNull();
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

describe("§436 what the plain POST carries", () => {
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

describe("§436 the press the admin boundary offers back", () => {
  it("is read only while it is recent, and forgotten once its button sent it", () => {
    const now = Date.now();
    rememberSubmission(press({ at: now }));
    expect(recentSubmission(now + 1000)?.url).toBe("/ro/admin/emails");
    // Read, not taken: a second render of the boundary sees the same press.
    expect(recentSubmission(now + 1000)?.url).toBe("/ro/admin/emails");
    expect(recentSubmission(now + RECENT_PRESS_MS + 1)).toBeNull();
    forgetSubmission();
    expect(recentSubmission(now + 1000)).toBeNull();
  });

  it("a fetch failure or E394 right after a press is a blocked save", () => {
    const now = Date.now();
    const recent = press({ at: now - 2000 });
    expect(boundaryFailureOf(new TypeError("Failed to fetch"), recent, now)).toBe("network");
    expect(boundaryFailureOf(withCode(UNEXPECTED_RESPONSE_MESSAGE, "E394"), recent, now)).toBe("unexpected");
  });

  it("a plain TypeError from a render is never one, even right after a press", () => {
    const now = Date.now();
    expect(boundaryFailureOf(new TypeError("Cannot read properties of null (reading 'title')"), press({ at: now - 500 }), now)).toBeNull();
  });

  it("no press, or an old one, is never one — whatever the error", () => {
    const now = Date.now();
    expect(boundaryFailureOf(new TypeError("Failed to fetch"), null, now)).toBeNull();
    expect(boundaryFailureOf(new TypeError("Failed to fetch"), press({ at: now - RECENT_PRESS_MS - 1 }), now)).toBeNull();
  });
});

describe("§436 the key the server stamps on a form", () => {
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

describe("§436 the island offers the simple way and never sends it on its own", () => {
  const island = read("src/shared/forms/ActionFormIsland.tsx");
  const guarded = island.slice(island.indexOf("const guardedAction"), island.indexOf("// The notice's button"));
  const notice = read("src/shared/forms/SaveBlockedNotice.tsx");
  const fallback = read("src/shared/forms/save-fallback.ts");

  it("renders the Server Action on the server — that is what writes the no-JavaScript fields — and the guarded one in the browser", () => {
    expect(island).toContain('useActionState(typeof window === "undefined" ? action : guardedAction, null)');
  });

  it("the decision offers, never sends: a transport failure draws the notice and returns the state as it was", () => {
    expect(guarded).toMatch(/if \(!transportFailureOf\(error\) \|\| !form\.current\) throw error;\s*setBlocked\(true\);\s*return previous;/);
    expect(guarded).not.toContain("replayNatively");
    expect(guarded).not.toContain("describeSubmission");
  });

  it("the button sends: the replay runs only from the notice's button, with the form as it stands", () => {
    expect(island).toMatch(/const sendSimple = async \(\): Promise<boolean> => \{[\s\S]*?return replayNatively\(describeSubmission\(element, lastSubmitter\.current\)\);/);
    expect(island).toContain("<SaveBlockedNotice onSend={sendSimple} />");
    expect(island.match(/replayNatively\(/g)).toHaveLength(1);
    expect(notice).toContain("onClick={send}");
    expect(notice).toContain("void onSend()");
  });

  it("sets the cookie only inside the replay — so only when that button was pressed", () => {
    expect(fallback.match(/document\.cookie = `\$\{SAVE_FALLBACK_COOKIE\}=1/g)).toHaveLength(1);
    expect(fallback.slice(fallback.indexOf("export async function replayNatively"))).toContain("document.cookie = `${SAVE_FALLBACK_COOKIE}=1");
  });

  it("the admin boundary offers the same button, and throws every other error on to the one the backoffice always had", () => {
    const boundary = read("src/app/[locale]/admin/error.tsx");
    expect(boundary).toMatch(/if \(!press\) throw error;/);
    expect(boundary).toContain("<SaveBlockedNotice kept={false} onSend={sendSimple} />");
    expect(boundary).not.toContain("useEffect");
  });
});

describe("§436 the words, in both languages", () => {
  type Catalogue = { Network: Record<string, unknown>; Admin: { guide: Record<string, string> } };
  const catalogues = { ro: ro as unknown as Catalogue, en: en as unknown as Catalogue };

  const keysOf = (tree: Record<string, unknown>, prefix = ""): string[] =>
    Object.entries(tree).flatMap(([key, value]) =>
      value && typeof value === "object" ? keysOf(value as Record<string, unknown>, `${prefix}${key}.`) : [`${prefix}${key}`],
    );

  it("has every Network key in both catalogues", () => {
    expect(keysOf(catalogues.ro.Network).sort()).toEqual(keysOf(catalogues.en.Network).sort());
  });

  it("says, after the simple path, that it was tried — only the §384 confirmation says it landed", () => {
    expect(catalogues.ro.Network.fallback).toBe(
      "Rețeaua de la birou a blocat cererea de salvare, așa că am încercat calea simplă. Salvarea a ajuns doar dacă vezi și mesajul de confirmare; dacă nu apare, verifică pagina și încearcă de pe telefon sau de pe altă rețea.",
    );
    expect(catalogues.en.Network.fallback).toBe(
      "The office network blocked the save request, so we tried the simple path. The save went through only if you also see the confirmation message; if it does not appear, check the page and try from your phone or another network.",
    );
    for (const catalogue of Object.values(catalogues)) expect(catalogue.Network.fallback).not.toMatch(/am trimis-o|went through the simple path/);
  });

  it("offers the simple way as one button, with the sentence that says when not to press — the dispatcher's words", () => {
    const roBlocked = catalogues.ro.Network.blocked as Record<string, string>;
    const enBlocked = catalogues.en.Network.blocked as Record<string, string>;
    expect(roBlocked.send).toBe("Trimite pe calea simplă");
    expect(enBlocked.send).toBe("Send the simple way");
    expect(roBlocked.already).toBe("Dacă ai primit deja mesajul că s-a salvat, nu apăsa — verifică pagina.");
    expect(enBlocked.already).toBe("If you already got the message that it saved, do not press — check the page.");
    // A transport failure does not prove nothing was saved: only the failed button says nothing left.
    for (const words of [roBlocked, enBlocked]) {
      for (const key of ["title", "kept", "notKept"]) expect(words[key]).not.toMatch(/Nu s-a salvat nimic|Nothing was saved/);
    }
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
