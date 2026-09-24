import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { eventInputConstraints, translationInputConstraints } from "@/modules/content/events/constraints";
import { eventFieldsSchema, translationFieldsSchema } from "@/modules/content/events/fields";
import { albumInputConstraints, albumTranslationConstraints } from "@/modules/content/gallery/constraints";
import { pageInputConstraints, pageTranslationConstraints } from "@/modules/content/pages/constraints";
import { staffRegistrationConstraints } from "@/modules/registrations/constraints";
import { staffInviteConstraints } from "@/modules/staff-identity/constraints";
import { constraintsOf, htmlConstraints, textFieldConstraints } from "@/shared/forms/constraints";

/**
 * The browser refuses first what the server would refuse (`DECISIONS.md` §315; the owner: "nu ar
 * trebui sa pot crea evenimentul daca am campuri invalide!").
 *
 * The HTML constraints are read off the Zod schemas the services validate with, never typed a
 * second time, so these tests walk the schemas: every field the schema requires must render
 * `required`, every https rule `type="url"` with its pattern, every bounded number its `min` and
 * `max`. And the forms must actually ask — a required field whose box never reads its constraints
 * is the drift this exists to prevent, so the form sources are checked for the call.
 */
const read = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8");
// The event editor's boxes (§350): every box that renders an event field, read as one source.
const EVENT_FORM = ["KindBox", "WhenBox", "PlaceBox", "ProgrammeBox", "RegistrationBox", "StatusBox", "CourseBox", "LinksBox", "CoHostsBox", "PromotionBox"]
  .map((box) => read(`src/modules/content/events/ui/boxes/${box}.tsx`))
  .join("\n");
const TRANSLATION_FORM = read("src/modules/content/events/ui/TranslationFields.tsx");
const asksFor = (field: string) => EVENT_FORM.includes(`box("${field}"`) || EVENT_FORM.includes(`eventInputConstraints("${field}")`);

/** Fields of the event row that are not a box: ticks and islands with rules of their own. */
// `links` is an island of rows (§332) whose boxes read their constraints off `eventLinkRowSchema`.
const NOT_A_BOX = new Set(["featured", "isSpecial", "participantListVisibility", "bibDesign", "scheduleRows", "coHosts", "links", "locationAddress", "locationToBeAnnounced"]);

describe("the event form's constraints are the schema's (§315)", () => {
  it("renders `required` on every box whose schema refuses an empty box", () => {
    const required = Object.keys(eventFieldsSchema.shape).filter(
      (field) => !NOT_A_BOX.has(field) && eventInputConstraints(field as keyof typeof eventFieldsSchema.shape).required,
    );
    // The fields that are genuinely required today — a new required rule lands here by itself.
    expect(required.sort()).toEqual(["eventStatus", "locationName", "registrationMode", "startsAtWallTime", "timezone", "type"]);
    for (const field of required) {
      expect(asksFor(field), `the editor's boxes read the constraints of "${field}"`).toBe(true);
    }
  });

  it("renders `required` on the title and the address in every language, and nowhere else there", () => {
    const required = Object.keys(translationFieldsSchema.shape).filter(
      (field) => translationInputConstraints(field as keyof typeof translationFieldsSchema.shape).required,
    );
    expect(required.sort()).toEqual(["slug", "title"]);
    for (const field of required) {
      expect(TRANSLATION_FORM.includes(`box("${field}")`), `TranslationFields reads the constraints of "${field}"`).toBe(true);
    }
    // A summary may be saved empty on a draft — it is publication that asks for it (§170).
    expect(translationInputConstraints("excerptBody").required).toBeUndefined();
  });

  it("gives every https link type=url and a pattern that insists on https", () => {
    for (const field of ["mapUrl", "routeUrl", "stravaEventUrl", "facebookEventUrl", "externalRegistrationUrl"] as const) {
      const constraints = eventInputConstraints(field);
      expect(constraints, field).toMatchObject({ type: "url", pattern: "[Hh][Tt][Tt][Pp][Ss]://.*" });
      expect(constraints.required, field).toBeUndefined();
      expect(asksFor(field), `the editor's boxes read the constraints of "${field}"`).toBe(true);
    }
  });

  it("bounds every number the schema bounds, whole numbers only", () => {
    expect(eventInputConstraints("capacity")).toMatchObject({ type: "number", min: 1, max: 100_000, step: 1 });
    expect(eventInputConstraints("distanceMeters")).toMatchObject({ type: "number", min: 0, max: 500_000, step: 1 });
    expect(eventInputConstraints("elevationGainMeters")).toMatchObject({ type: "number", min: 0, max: 20_000, step: 1 });
    expect(eventInputConstraints("bibStartNumber")).toMatchObject({ type: "number", min: 1, max: 99_000, step: 1 });
    expect(eventInputConstraints("durationMinutes")).toMatchObject({ type: "number", min: 1, max: 7 * 24 * 60, step: 1 });
    expect(eventInputConstraints("confirmationOpensDaysBefore")).toMatchObject({ type: "number", min: 0, max: 60 });
    expect(eventInputConstraints("confirmationDeadlineDaysBefore")).toMatchObject({ type: "number", min: 0, max: 60 });
    // The event's minimum age (§329): the database's CHECK, zero (no minimum) to ninety-nine.
    expect(eventInputConstraints("minAge")).toMatchObject({ type: "number", min: 0, max: 99, step: 1 });
    // Optional: an empty capacity is "no limit", never a refusal; an empty minimum is fourteen.
    expect(eventInputConstraints("capacity").required).toBeUndefined();
    expect(eventInputConstraints("minAge").required).toBeUndefined();
    expect(asksFor("minAge"), "the editor's boxes read the constraints of the minimum age").toBe(true);
  });

  it("carries every ceiling and the address's shape, as a pattern the browser compiles", () => {
    expect(translationInputConstraints("title")).toMatchObject({ required: true, maxLength: 200 });
    expect(translationInputConstraints("seoDescription")).toMatchObject({ maxLength: 320 });
    const slug = translationInputConstraints("slug");
    expect(slug).toMatchObject({ required: true, maxLength: 120 });
    // Anchors off — the browser anchors a pattern itself — and valid under the `v` flag that
    // current browsers compile `pattern` with, or the attribute is silently ignored.
    const compiled = new RegExp(`^(?:${slug.pattern})$`, "v");
    expect(compiled.test("alergare-de-duminica")).toBe(true);
    expect(compiled.test("Alergare de duminică")).toBe(false);
    // The schema trims before it tests, so the server takes a pasted "my-race " as "my-race";
    // the browser must not refuse what the server accepts. A space inside is still refused.
    for (const padded of ["my-race ", " my-race", "\tmy-race\n"]) {
      expect(compiled.test(padded), JSON.stringify(padded)).toBe(true);
      expect(translationFieldsSchema.shape.slug.safeParse(padded).success, JSON.stringify(padded)).toBe(true);
    }
    expect(compiled.test("my race")).toBe(false);
    expect(eventInputConstraints("locationName")).toMatchObject({ required: true, maxLength: 200 });
  });

  it("types no ceiling or bound by hand on a box the schema describes", () => {
    for (const source of [EVENT_FORM, TRANSLATION_FORM]) {
      expect(source).not.toMatch(/htmlInput:\s*\{\s*(min|max|maxLength|minLength|pattern):/);
    }
  });
});

describe("the other backoffice forms read their schemas the same way", () => {
  it("the page editor: title and address required, the order a bounded whole number", () => {
    expect(pageTranslationConstraints("title")).toMatchObject({ required: true, maxLength: 200 });
    expect(pageTranslationConstraints("slug")).toMatchObject({ required: true, maxLength: 120 });
    expect(pageTranslationConstraints("body").required).toBeUndefined();
    // "" is 0, so the order is never required.
    expect(pageInputConstraints("navOrder")).toEqual({ type: "number", min: 0, max: 1000, step: 1 });
  });

  it("the album: the date required in its shape, the title and address required", () => {
    // Trimmed before it is tested, so the pattern leaves room for spaces at either end.
    expect(albumInputConstraints("takenOn")).toMatchObject({ required: true, pattern: "\\s*(?:\\d{4}-\\d{2}-\\d{2})\\s*" });
    expect(albumTranslationConstraints("title")).toMatchObject({ required: true, maxLength: 200 });
    expect(albumTranslationConstraints("description")).toEqual({ maxLength: 1000 });
  });

  it("adding a colleague: an address the browser checks, a name required, both with ceilings", () => {
    expect(staffInviteConstraints("email")).toEqual({ required: true, type: "email", maxLength: 320 });
    expect(staffInviteConstraints("displayName")).toEqual({ required: true, maxLength: 200 });
  });

  it("a registration entered by staff: the name and address required, every detail optional", () => {
    expect(staffRegistrationConstraints("firstName")).toEqual({ required: true, maxLength: 100 });
    expect(staffRegistrationConstraints("email")).toEqual({ required: true, type: "email", maxLength: 320 });
    // Optional here and required on the public form (BR-REQ-031-04 criterion 5): the staff
    // schema accepts an absent city, which is what a blank box becomes.
    expect(staffRegistrationConstraints("city")).toEqual({ maxLength: 120 });
    expect(staffRegistrationConstraints("emergencyContactName")).toEqual({ maxLength: 200 });
  });
});

describe("htmlConstraints, the reader itself", () => {
  it("asks the schema what an empty box arrives as", () => {
    const optionalCity = z.string().trim().min(1).max(120).optional();
    // Posted as "" it is refused; handed on as absent it is not.
    expect(htmlConstraints(optionalCity).required).toBe(true);
    expect(htmlConstraints(optionalCity, { blankIsAbsent: true }).required).toBeUndefined();
  });

  it("reads a minimum length above one, and never repeats `required` as a minimum of one", () => {
    expect(htmlConstraints(z.string().min(3).max(500))).toEqual({ required: true, minLength: 3, maxLength: 500 });
    expect(htmlConstraints(z.string().min(1))).toEqual({ required: true });
  });

  it("widens a pattern for surrounding spaces only when a trim runs before it", () => {
    // Zod runs checks in the order they were chained: a trim after the regex does not help it,
    // and a lower-casing is an overwrite too but is not a trim.
    expect(htmlConstraints(z.string().trim().regex(/^[a-z]+$/)).pattern).toBe("\\s*(?:[a-z]+)\\s*");
    expect(htmlConstraints(z.string().regex(/^[a-z]+$/).trim()).pattern).toBe("[a-z]+");
    expect(htmlConstraints(z.string().toLowerCase().regex(/^[a-z]+$/)).pattern).toBe("[a-z]+");
  });

  it("reads through a pipe into a bounded number", () => {
    const order = z
      .string()
      .transform((value) => Number(value))
      .pipe(z.number().int().min(0).max(10));
    expect(htmlConstraints(order)).toMatchObject({ type: "number", min: 0, max: 10, step: 1 });
  });

  it("lets a schema's own `html` metadata win, for a rule a refine hides", () => {
    const hidden = z
      .string()
      .refine((value) => value.startsWith("https://"))
      .meta({ html: { type: "url", pattern: "https://.*" } });
    expect(htmlConstraints(hidden)).toMatchObject({ type: "url", pattern: "https://.*" });
  });

  it("answers an unknown field with nothing, and hands a TextField its props", () => {
    expect(constraintsOf(z.object({ a: z.string() }), "b")).toEqual({});
    expect(textFieldConstraints({ required: true, type: "number", min: 1 }, { inputMode: "numeric" })).toEqual({
      required: true,
      type: "number",
      slotProps: { htmlInput: { required: true, type: "number", min: 1, inputMode: "numeric" } },
    });
  });
});
