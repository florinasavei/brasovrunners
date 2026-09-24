import { describe, expect, it } from "vitest";
import { isUuid } from "@/shared/ids";

/**
 * `isUuid` is the one shape check every admin `/…/[id]` route runs before handing `params.id`
 * to a `uuid` column (found during the dev-SSR investigation, §NNN): a malformed id used to
 * reach PostgreSQL and come back as a 500 rather than the 404 an unknown id already gets.
 */
describe("isUuid", () => {
  it("accepts a lower-case uuid", () => {
    expect(isUuid("3fa85f64-5717-4562-b3fc-2c963f66afa6")).toBe(true);
  });

  it("accepts an upper-case uuid — Postgres itself is case-insensitive on the way in", () => {
    expect(isUuid("3FA85F64-5717-4562-B3FC-2C963F66AFA6")).toBe(true);
  });

  it("accepts a mixed-case uuid", () => {
    expect(isUuid("3fA85F64-5717-4562-b3FC-2c963F66aFa6")).toBe(true);
  });

  it("refuses a word that is not a uuid at all", () => {
    expect(isUuid("nope")).toBe(false);
  });

  it("refuses an empty string", () => {
    expect(isUuid("")).toBe(false);
  });

  it("refuses a uuid with an extra character — too long is still refused", () => {
    expect(isUuid("3fa85f64-5717-4562-b3fc-2c963f66afa6x")).toBe(false);
  });

  it("refuses a uuid missing its last character — too short is refused", () => {
    expect(isUuid("3fa85f64-5717-4562-b3fc-2c963f66afa")).toBe(false);
  });

  it("refuses a uuid with the hyphens in the wrong place", () => {
    expect(isUuid("3fa85f6457-17-4562-b3fc-2c963f66afa6")).toBe(false);
  });

  it("refuses a uuid missing its hyphens", () => {
    expect(isUuid("3fa85f6457174562b3fc2c963f66afa6")).toBe(false);
  });

  it("refuses a non-hex character in place of a hex digit", () => {
    expect(isUuid("3fa85f64-5717-4562-b3fc-2c963f66afzg")).toBe(false);
  });

  it("refuses surrounding whitespace", () => {
    expect(isUuid(" 3fa85f64-5717-4562-b3fc-2c963f66afa6")).toBe(false);
    expect(isUuid("3fa85f64-5717-4562-b3fc-2c963f66afa6 ")).toBe(false);
  });
});
