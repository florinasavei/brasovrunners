import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { eventFormFieldName, THEN_FIELD, THEN_PUBLISH } from "@/modules/content/events/form-names";
import { DomainError } from "@/shared/errors/domain-error";
import { fieldId, keptValuesOf, NEVER_KEPT, refused } from "@/shared/forms/outcome";

/**
 * A refused backoffice submit keeps what was typed (`DECISIONS.md` §315; the owner: "if I submit
 * an invalid form (eg: event creation) the entire page gets cleared").
 *
 * The action returns the refusal as `useActionState`'s state instead of redirecting, and the
 * state carries every posted string back to the boxes. What these hold down is the helper:
 * values in, values out; the framework's own fields and the ones meant to be retyped never
 * kept; a bug never flattened into a friendly refusal; and no size limit, because nothing here
 * rides in a cookie.
 */
function formOf(entries: Array<[string, string | Blob]>): FormData {
  const form = new FormData();
  for (const [name, value] of entries) form.append(name, value);
  return form;
}

describe("keptValuesOf", () => {
  it("keeps every posted string by name, a repeated name with all its values", () => {
    const form = formOf([
      ["translations.ro.title", "Crosul de toamnă"],
      ["event.locationName", "Parcul Tractorul"],
      ["weekday", "1"],
      ["weekday", "3"],
    ]);

    expect(keptValuesOf(form)).toEqual({
      "translations.ro.title": ["Crosul de toamnă"],
      "event.locationName": ["Parcul Tractorul"],
      weekday: ["1", "3"],
    });
  });

  it("drops the framework's own fields, a file, and every name meant to be typed again", () => {
    const form = formOf([
      ["$ACTION_REF_1", ""],
      ["$ACTION_1:0", '{"id":"abc"}'],
      ["photo", new Blob(["jpeg"], { type: "image/jpeg" })],
      ["typedConfirmation", "GDPR 2"],
      ["confirmName", "Ana Pop"],
      ["confirmCount", "12"],
      ["typedTitle", "Crosul de toamnă"],
      ["confirm", "on"],
      ["reason", "a cerut ștergerea"],
    ]);

    expect(keptValuesOf(form)).toEqual({ reason: ["a cerut ștergerea"] });
    for (const name of ["typedConfirmation", "confirmName", "confirmCount", "typedTitle", "password"]) {
      expect(NEVER_KEPT.has(name), name).toBe(true);
    }
  });

  it("drops what a form names on top, and keeps a value no cookie could hold", () => {
    // A rich-text body of tens of kilobytes: the reason the refusal is a returned state and not
    // the public form's sealed cookie (§286), which drops a draft past 3.8 KB.
    const body = JSON.stringify({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "x".repeat(60_000) }] }] });
    const form = formOf([
      ["translations.ro.body", body],
      ["reset", "1"],
    ]);

    const kept = keptValuesOf(form, ["reset"]);
    expect(kept).toEqual({ "translations.ro.body": [body] });
    expect(kept["translations.ro.body"][0].length).toBeGreaterThan(4_096);
  });
});

describe("refused", () => {
  it("turns a domain error into the state the form renders from, names and values apart", () => {
    const form = formOf([
      ["translations.en.title", ""],
      ["event.capacity", "0"],
    ]);
    const error = new DomainError("VALIDATION_ERROR", "translations.en.title: too short; capacity: out of range", [
      "translations.en.title",
      "capacity",
    ]);

    expect(refused(error, form, { fieldNames: (failure) => failure.fields.map(eventFormFieldName) })).toEqual({
      error: "VALIDATION_ERROR",
      fields: ["translations.en.title", "event.capacity"],
      values: { "translations.en.title": [""], "event.capacity": ["0"] },
    });
  });

  it("never carries the service's message, which may quote what was typed", () => {
    const outcome = refused(new DomainError("CONFLICT", "version 3 expected, found 4 — Ana's text"), formOf([]));
    expect(JSON.stringify(outcome)).not.toContain("Ana");
    expect(outcome).toEqual({ error: "CONFLICT", fields: [], values: {} });
  });

  it("rethrows anything that is not a domain error: a bug is not a refusal", () => {
    const bug = new TypeError("cannot read properties of undefined");
    expect(() => refused(bug, formOf([]))).toThrow(bug);
  });
});

describe("the event form's names", () => {
  it("maps the service's field paths to the boxes the form posts", () => {
    expect(eventFormFieldName("translations.ro.slug")).toBe("translations.ro.slug");
    expect(eventFormFieldName("capacity")).toBe("event.capacity");
    expect(eventFormFieldName("startsAtWallTime")).toBe("event.startsAtDate");
    expect(eventFormFieldName("raceStartsAt")).toBe("event.raceStartsAtDate");
    expect(eventFormFieldName("scheduleRows.2.time")).toBe("event.schedule[2].time");
    expect(eventFormFieldName("coHosts.0.url")).toBe("event.coHosts[0].url");
    // A partner's link, by both indices — the more specific shape, checked first.
    expect(eventFormFieldName("coHosts.1.links.2.url")).toBe("event.coHosts[1].links[2].url");
    // A partner's own link list — "too many links on this card".
    expect(eventFormFieldName("coHosts.0.links")).toBe("event.coHosts[0].links");
    // The whole list of partners — "too many partners on this event".
    expect(eventFormFieldName("coHosts")).toBe("event.coHosts");
    // A partner's description in one language only (§352): the card's own empty box.
    expect(eventFormFieldName("coHosts.0.descriptionEn")).toBe("event.coHosts[0].descriptionEn");
    expect(eventFormFieldName("coHosts.1.links.0.labelRo")).toBe("event.coHosts[1].links[0].labelRo");
    // An event text in one language only (§352): the other language's box, as the form posts it.
    expect(eventFormFieldName("translations.en.body")).toBe("translations.en.body");
  });

  it("passes the create form's repeat rule through, and points the plain summary at the rich box", () => {
    // The action's own cadence refusal names `repeat.cadence`; prefixed as an event column it
    // became `event.repeat.cadence`, a link to nothing shown under its raw name.
    expect(eventFormFieldName("repeat.cadence")).toBe("repeat.cadence");
    expect(eventFormFieldName("repeat.until")).toBe("repeat.until");
    // `repeatEvent`'s weekday refusal, prefixed by the create: the ticks post a bare `weekday`.
    expect(eventFormFieldName("repeat.weekday")).toBe("weekday");
    // The schema's `excerpt` is derived from `excerptBody`, the box the editor actually posts.
    expect(eventFormFieldName("translations.en.excerpt")).toBe("translations.en.excerptBody");
    expect(eventFormFieldName("translations.en.excerptBody")).toBe("translations.en.excerptBody");
    expect(eventFormFieldName("translations.ro.body")).toBe("translations.ro.body");
  });

  it("keeps the second button's marker in a plain module, not beside the button", () => {
    // A constant exported from a `"use client"` file is a client reference on the server; the
    // action would compare the posted "publish" with a proxy object and never publish.
    expect([THEN_FIELD, THEN_PUBLISH]).toEqual(["then", "publish"]);
    const actions = readFileSync(path.join(process.cwd(), "src/app/[locale]/admin/actions.ts"), "utf8");
    expect(actions).toMatch(/import \{[^}]*THEN_FIELD[^}]*\} from "@\/modules\/content\/events\/form-names"/);
    expect(actions).not.toContain("ui/CreateAndPublishButton");
  });

  it("gives a box on a shared page an id of its own form", () => {
    expect(fieldId("reason")).toBe("field-reason");
    expect(fieldId("reason", "erase")).toBe("field-erase-reason");
  });
});
