import { describe, expect, it } from "vitest";
import { readRegistrationForm } from "@/modules/registrations/form-mapping";
import { registrationSubmissionSchema, staffRegistrationSubmissionSchema } from "@/modules/registrations/fields";

/**
 * BR-REQ-031-04, BR-REQ-031-05 — the form's field names reach the schema.
 *
 * This file exists because of a bug that shipped. `submitRegistration` takes `unknown`, which is
 * right for a boundary that parses untrusted input and has one consequence: adding a field to
 * the schema without adding it to the server action compiles perfectly and then rejects every
 * submission on the deployed site as a generic validation error.
 *
 * The names below are the `name=` attributes the registration page renders. If somebody adds a
 * required field to the schema and not to the mapping, criterion 1 fails here — in `yarn test`,
 * in a second, without a browser or a deployment.
 */

/** Exactly what a browser posts for a filled-in public form. */
function filledForm(overrides: Record<string, string> = {}): FormData {
  const form = new FormData();
  const values: Record<string, string> = {
    locale: "ro",
    slug: "crosul-aniversar-brasov-runners",
    firstName: "Ana",
    lastName: "Popescu",
    email: "ana@example.org",
    birthDate: "1990-05-17",
    // MUI renders a select's value into an input carrying the field's name; these are its
    // defaults, which is what a form submitted without touching them actually posts.
    sex: "UNSPECIFIED",
    nationality: "RO",
    tshirtSize: "NONE",
    city: "Brașov",
    phone: "+40711111111",
    emergencyContactName: "Ion Popescu",
    emergencyContactPhone: "+40722222222",
    honeypot: "",
    renderedAt: "2026-09-05T10:00:00.000Z",
    ...overrides,
  };

  for (const [name, value] of Object.entries(values)) form.set(name, value);
  // A checkbox is absent unless ticked; ticked, it is the string "on".
  form.set("privacyAcknowledged", "on");
  return form;
}

describe("BR-REQ-031-04 the rendered form reaches the schema", () => {
  it("accepts what the public form posts when only the text fields are filled in", () => {
    const parsed = registrationSubmissionSchema.safeParse(readRegistrationForm(filledForm(), "ro"));

    expect(parsed.error?.issues.map((issue) => issue.path.join("."))).toBeUndefined();
    expect(parsed.success).toBe(true);
  });

  it("leaves an untouched optional field absent rather than empty", () => {
    const values = readRegistrationForm(filledForm(), "ro");

    // BR-REQ-039-02: an empty display name means "nothing chosen", and `resolveDisplayName`
    // must see `undefined` so it falls back to the legal name instead of publishing a blank.
    expect(values.displayName).toBeUndefined();
    expect(values.clubName).toBeUndefined();
    expect(values.healthNotes).toBeUndefined();
  });

  it("reads a chosen display name", () => {
    const values = readRegistrationForm(filledForm({ displayName: "  Ana P.  " }), "ro");
    expect(values.displayName).toBe("Ana P.");
  });

  it("refuses health text without its own consent, and accepts it with", () => {
    const withoutConsent = readRegistrationForm(filledForm({ healthNotes: "astm" }), "ro");
    expect(registrationSubmissionSchema.safeParse(withoutConsent).success).toBe(false);

    const form = filledForm({ healthNotes: "astm" });
    form.set("healthConsent", "on");
    expect(registrationSubmissionSchema.safeParse(readRegistrationForm(form, "ro")).success).toBe(true);
  });

  it("refuses the public form when a race detail is missing", () => {
    for (const missing of ["firstName", "lastName", "birthDate", "city", "phone", "emergencyContactName", "emergencyContactPhone"]) {
      const form = filledForm();
      form.set(missing, "");
      const parsed = registrationSubmissionSchema.safeParse(readRegistrationForm(form, "ro"));
      expect(parsed.success, `${missing} should be required on the public form`).toBe(false);
    }
  });

  it("accepts the same gaps from an organizer entering somebody who telephoned", () => {
    // BR-REQ-031-04 criterion 5. The staff entry point has its own mapping, which turns an
    // unanswered field into an absent one rather than an empty string — so what is asserted
    // here is the schema half: the details a caller can withhold really are optional.
    const relayed = {
      ...readRegistrationForm(filledForm(), "ro"),
      birthDate: undefined,
      sex: undefined,
      nationality: undefined,
      city: undefined,
      phone: undefined,
      emergencyContactName: undefined,
      emergencyContactPhone: undefined,
    };

    expect(staffRegistrationSubmissionSchema.safeParse(relayed).success).toBe(true);
    // And the same payload is refused on the public form, which is the whole point of two
    // entry points rather than one relaxed schema.
    expect(registrationSubmissionSchema.safeParse(relayed).success).toBe(false);
  });
});
