import { describe, expect, it } from "vitest";
import { birthDateEchoText as echoText } from "@/modules/registrations/ui/birth-date-echo";
import { registrationSubmissionSchema, staffRegistrationSubmissionSchema } from "@/modules/registrations/fields";

// BR-REQ-031-04: the birth date read back in words with the age on the event day, and the
// city required on the public form (§NNN).
describe("BR-REQ-031-04 birth date echo", () => {
  const template = "{date} · {age} on the event day";

  it("says the day in words and the age on the event's day", () => {
    const line = echoText("1990-04-03", "2026-11-21", "en", template);
    expect(line).toContain("1990");
    expect(line).toContain("36 years on the event day");
  });

  it("counts the birthday not yet reached on the event day", () => {
    expect(echoText("1990-12-01", "2026-11-21", "ro", "{date} · {age}")).toMatch(/35 de ani$/);
  });

  it("says nothing for a partial or future date", () => {
    expect(echoText("", "2026-11-21", "en", template)).toBe("");
    expect(echoText("1990-04", "2026-11-21", "en", template)).toBe("");
    expect(echoText("2030-01-01", "2026-11-21", "en", template)).toBe("");
  });
});

describe("BR-REQ-031-04 city required on the public form", () => {
  it("the public schema has no optional city; the staff schema does", () => {
    const pub = (s: unknown) => (s as { safeParse: (v: unknown) => { success: boolean } }).safeParse(undefined).success;
    const inner = (schema: unknown) => (schema as { shape: Record<string, unknown> }).shape.city;
    expect(pub(inner(registrationSubmissionSchema))).toBe(false);
    expect(pub(inner(staffRegistrationSubmissionSchema))).toBe(true);
  });
});
