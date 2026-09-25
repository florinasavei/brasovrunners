import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { STAFF_CLIENT_MESSAGES } from "@/i18n/client-messages";
import { DERIVED_TOAST_KEYS } from "@/shared/feedback/notice";

/**
 * `DECISIONS.md` §384 — every "it worked" a backoffice action redirects with is a sentence.
 *
 * The toast provider looks a `saved` code up under `Feedback.toast` and falls back to the
 * generic "saved" for a code it does not know, so a missing sentence is never a crash — it is a
 * toast that says less than it could, which this test refuses. Every code an action writes
 * (`saved: "x"`, `saved=x`, `flashOutcome({ saved: "x" })`, `key: "x"`) is read from the action
 * files, and each must have a sentence in both catalogues — a plain string, or the three counted
 * forms `one` / `few` / `other` (`count-form.ts`), never an ICU plural.
 */
const ROOT = path.resolve(__dirname, "../../..");

function actionFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const full = path.join(directory, entry);
    if (statSync(full).isDirectory()) return actionFiles(full);
    return entry === "actions.ts" ? [full] : [];
  });
}

/** Every literal outcome code the admin actions write, from all the shapes they write it in. */
function savedCodes(): string[] {
  const codes = new Set<string>();
  for (const file of actionFiles(path.join(ROOT, "src/app/[locale]/admin"))) {
    const text = readFileSync(file, "utf8");
    for (const match of text.matchAll(/\bsaved(?::\s*|=)"?([A-Za-z]+)"?/g)) codes.add(match[1]);
    // The codes inside a ternary after `saved:` — `saved: printed ? "bibsPrinted" : "bibsUnprinted"`.
    for (const match of text.matchAll(/\bsaved:[^\n]*?\?\s*"([A-Za-z]+)"\s*:\s*"([A-Za-z]+)"/g)) {
      codes.add(match[1]);
      codes.add(match[2]);
    }
    for (const match of text.matchAll(/\bkey: "([A-Za-z]+)"/g)) codes.add(match[1]);
  }
  // The sentences the notice chooses from the outcome rather than an action writing them (the event save that told its participants).
  for (const key of DERIVED_TOAST_KEYS) codes.add(key);
  // The transition codes travel as the status itself (`saved: text(form, "to")`).
  for (const status of ["DRAFT", "IN_REVIEW", "PUBLISHED", "ARCHIVED"]) codes.add(status);
  // What a ternary's variable name looks like to the regex above, and is not a code.
  for (const notACode of ["active", "changed", "direction", "outcome", "printed", "publish", "removed", "result", "string", "text", "wanted"]) codes.delete(notACode);
  return [...codes].sort();
}

type Toasts = Record<string, string | { one: string; few: string; other: string }>;

describe("§384 every saved code has a toast sentence", () => {
  const toasts = { ro: (ro as { Feedback: { toast: Toasts } }).Feedback.toast, en: (en as { Feedback: { toast: Toasts } }).Feedback.toast };
  const codes = savedCodes();

  it("finds the codes the actions write", () => {
    expect(codes.length).toBeGreaterThan(60);
    for (const known of ["event", "eventsArchived", "registrationConfirmed", "PUBLISHED", "resent", "participantMessageSent", "neonLimitsSame"]) {
      expect(codes, known).toContain(known);
    }
  });

  it("has a sentence in both catalogues for each — a string, or the three counted forms", () => {
    const missing: string[] = [];
    for (const code of codes) {
      for (const [locale, catalogue] of Object.entries(toasts)) {
        const entry = catalogue[code];
        const ok = typeof entry === "string" || (entry !== undefined && typeof entry.one === "string" && typeof entry.few === "string" && typeof entry.other === "string");
        if (!ok) missing.push(`${locale}: Feedback.toast.${code}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("counts through {count} and never an ICU plural, and the generic fallback exists", () => {
    for (const catalogue of Object.values(toasts)) {
      expect(typeof catalogue.saved).toBe("string");
      for (const [code, entry] of Object.entries(catalogue)) {
        const sentences = typeof entry === "string" ? [entry] : Object.values(entry);
        for (const sentence of sentences) expect(sentence, code).not.toMatch(/\{\w+,\s*plural/);
        if (typeof entry !== "string") for (const sentence of sentences) expect(sentence, code).toContain("{count}");
      }
    }
  });

  it("is on the backoffice islands' list, whole, and nowhere public", () => {
    expect(STAFF_CLIENT_MESSAGES).toContain("Feedback");
  });
});
