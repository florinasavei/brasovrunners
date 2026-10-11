import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A named submit button is busy only for its own press, and the held-press valve gives back the
 * name and value the caller passed. Source-level, like `held-press-is-sent.test.ts`: the unit suite
 * has no DOM, and what must stay true is two lines in one component.
 */
const ROOT = path.resolve(__dirname, "../../..");
const source = readFileSync(path.join(ROOT, "src/shared/ui/SubmitButton.tsx"), "utf8");

describe("SubmitButton with a name", () => {
  it("is pending only when the form's pending data carries its own name and value", () => {
    expect(source).toMatch(
      /const pending = name === undefined \? status\.pending : status\.pending && status\.data\?\.get\(name\) === value;/,
    );
  });

  it("the valve restores the caller's name and value instead of removing them", () => {
    expect(source).toMatch(/const callerName = button\.getAttribute\("name"\);/);
    expect(source).toMatch(/const callerValue = button\.getAttribute\("value"\);/);
    expect(source).toMatch(/finally \{\s*if \(byValve\) \{[\s\S]*?else button\.setAttribute\("name", callerName\);[\s\S]*?else button\.setAttribute\("value", callerValue\);/);
  });
});
