import { describe, expect, it } from "vitest";
import { compareSchemaVersion } from "@/db/schema-version";

/**
 * The comparison behind the schema-drift check (`DECISIONS.md` §31).
 *
 * Pure, and tested apart from the query, because the states that matter are the ones that are
 * awkward to arrange against a real database: one nobody has ever migrated, and one that is
 * ahead of the code because a deployment was rolled back.
 */
describe("compareSchemaVersion", () => {
  const EXPECTED = "1788547201806";

  it("is ok when the applied head is the one this build expects", () => {
    expect(compareSchemaVersion({ expectedWhen: EXPECTED, appliedWhen: EXPECTED })).toBe("ok");
  });

  it("is behind when the database has not caught up — the failure this exists for", () => {
    // One migration older. This is the state where the public pages 500 and `select 1` passes.
    expect(compareSchemaVersion({ expectedWhen: EXPECTED, appliedWhen: "1788514995323" })).toBe(
      "behind",
    );
  });

  it("is behind when nothing has ever been applied", () => {
    // No bookkeeping table at all: a fresh database, or the wrong database entirely.
    expect(compareSchemaVersion({ expectedWhen: EXPECTED, appliedWhen: null })).toBe("behind");
  });

  it("is ahead when the database was migrated by a newer deployment than this one", () => {
    // What a rollback looks like. Whether it breaks anything depends on what the migration did,
    // so it is reported rather than judged.
    expect(compareSchemaVersion({ expectedWhen: EXPECTED, appliedWhen: "1788600000000" })).toBe(
      "ahead",
    );
  });

  it("is unknown when the build carries no expectation, rather than guessing", () => {
    expect(compareSchemaVersion({ expectedWhen: null, appliedWhen: EXPECTED })).toBe("unknown");
  });

  it("compares as 64-bit integers, not as numbers or strings", () => {
    // Millisecond journal stamps are already 13 digits. "9" > "10" as strings, and precision
    // goes quietly at 2^53 as numbers; neither failure would be visible in a small fixture.
    expect(
      compareSchemaVersion({ expectedWhen: "10000000000000000", appliedWhen: "9999999999999999" }),
    ).toBe("behind");
    expect(
      compareSchemaVersion({ expectedWhen: "9007199254740993", appliedWhen: "9007199254740992" }),
    ).toBe("behind");
  });
});
