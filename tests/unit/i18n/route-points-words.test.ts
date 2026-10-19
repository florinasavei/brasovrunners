import { describe, expect, it } from "vitest";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";

/**
 * BR-REQ-011-01 — the owner's words for the table under the route's maps (§833, 2026-10-19):
 * «Puncte pe traseu» / "Points on the route", never «puncte de control» / "checkpoints" in a
 * sentence a person reads. One test pins every surface at once: the public heading, the preview,
 * the editor, the bib settings, the toasts, the import's notes and the diff's labels.
 */

type Messages = Record<string, unknown>;

function flatten(messages: Messages, prefix = ""): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(messages)) {
    const full = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === "object") Object.assign(out, flatten(value as Messages, full));
    else out[full] = String(value);
  }
  return out;
}

/** The text a person reads: ICU placeholders such as {checkpoint} are code, not words. */
function words(value: string): string {
  return value.replace(/\{[^}]*\}/g, "");
}

const roFlat = flatten(ro);
const enFlat = flatten(en);

describe("BR-REQ-011-01 «Puncte pe traseu»", () => {
  it("names the public table «Puncte pe traseu» / \"Points on the route\"", () => {
    expect(roFlat["Event.checkpoints.heading"]).toBe("Puncte pe traseu");
    expect(enFlat["Event.checkpoints.heading"]).toBe("Points on the route");
  });

  it("has no Romanian sentence that says «de control» about a point", () => {
    const hits = Object.entries(roFlat).filter(([, v]) => /(?:puncte?\w*|punct\w*) de control/i.test(words(v)));
    expect(hits, JSON.stringify(hits)).toEqual([]);
  });

  it("has no English sentence that says «checkpoint»", () => {
    const hits = Object.entries(enFlat).filter(([, v]) => /check-?points?/i.test(words(v)));
    expect(hits, JSON.stringify(hits)).toEqual([]);
  });
});
