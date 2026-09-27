import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * §NNN — the album uploader's two lines describe one photo (§437's review leftovers).
 *
 * In a multi-file upload whose last file failed, «Fotografia aleasă» named the failed file while
 * the stored line still showed the photo before it: the stored facts were cleared once, before the
 * loop, and set only on a success. They are cleared at the start of every file now. No DOM runner
 * in this repository, so the source says it.
 */
const read = (...parts: string[]) => readFileSync(path.join(process.cwd(), ...parts), "utf8").replace(/\r\n/g, "\n");

describe("BR-REQ-054-01 the album uploader's lines describe the same photo (§437)", () => {
  it("clears the stored facts at the start of each file, not once before the loop", () => {
    const uploader = read("src", "modules", "content", "gallery", "ui", "PhotoUploader.tsx");
    const loop = uploader.indexOf("for (const [index, file] of list.entries()) {");
    expect(loop).toBeGreaterThan(-1);
    const clear = uploader.indexOf("setLastStored(null);", loop);
    const firstTry = uploader.indexOf("try {", loop);
    expect(clear).toBeGreaterThan(loop);
    expect(clear).toBeLessThan(firstTry);
    // And nowhere before the loop: a clear there alone is the defect.
    expect(uploader.slice(0, loop)).not.toContain("setLastStored(null);");
  });

  it("the upload routes' ceiling note counts «Originală»'s encodes", () => {
    for (const route of [
      ["src", "app", "api", "admin", "media", "route.ts"],
      ["src", "app", "api", "admin", "gallery", "[id]", "photos", "route.ts"],
    ]) {
      const text = read(...route);
      expect(text, route.join("/")).toContain("export const maxDuration = 60;");
      expect(text, route.join("/")).not.toContain("nine WebP encodes");
      expect(text, route.join("/")).toContain("ten WebP encodes");
    }
  });
});
