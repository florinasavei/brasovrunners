import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { pollsForNewBuild } from "@/shared/ui/new-build";

/**
 * §NNN — an open tab on a public page asks for nothing on a timer. The owner, 2026-09-29: «dacă
 * site-ul stă în idle nu vreau să consum nimic!». Work happens because a person did something.
 *
 * The one timer that used to poll from every page, the new-build notice, now polls only in the
 * backoffice (`pollsForNewBuild`); a public tab asks once when it is shown again. And no client
 * island may start an interval unless it is named below with its reason, so a keep-alive or a
 * poll added later is decided rather than slipped in.
 */
describe("§NNN which tabs ask for a new build on a timer", () => {
  it("is the backoffice and /devs, in both languages", () => {
    for (const path of ["/ro/admin", "/en/admin/events/123", "/ro/devs", "/en/devs/docs/SETUP"]) expect(pollsForNewBuild(path), path).toBe(true);
  });

  it("is never a public page, a form or a token page", () => {
    for (const path of [
      "/ro/evenimente",
      "/en/events/crosul",
      "/ro/evenimente/crosul/inscriere",
      "/ro/calendar",
      "/ro/contact",
      "/ro/inscrierile-mele",
      "/ro/zona-membri",
      "/ro/autentificare",
      "/",
      "",
      null,
      undefined,
    ]) {
      expect(pollsForNewBuild(path), String(path)).toBe(false);
    }
  });
});

/** Every client island that starts an interval, with why it is not a poll of the network. */
const ALLOWED_INTERVALS: Record<string, string> = {
  // Gated by `pollsForNewBuild`: the backoffice only, cleared while hidden.
  "src/shared/ui/NewBuildNotice.tsx": "backoffice only",
  // The YouTube player's handshake after a person opened the film: bounded tries, a postMessage, no request.
  "src/shared/ui/VideoVolumeBar.tsx": "bounded handshake after a click",
};

function clientFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) files.push(...clientFiles(path));
    else if (/\.tsx?$/.test(entry) && /^\s*["']use client["']/.test(readFileSync(path, "utf8"))) files.push(path);
  }
  return files;
}

describe("§NNN no client island polls or keeps alive on a timer", () => {
  it("starts an interval only where it is named with its reason", () => {
    const root = process.cwd();
    const offenders = clientFiles(join(root, "src"))
      .filter((path) => /\bsetInterval\s*\(/.test(readFileSync(path, "utf8")))
      .map((path) => relative(root, path).replace(/\\/g, "/"))
      .filter((path) => !(path in ALLOWED_INTERVALS));
    expect(offenders).toEqual([]);
  });

  it("keeps the new-build notice's timer behind the backoffice rule", () => {
    const source = readFileSync(join(process.cwd(), "src/shared/ui/NewBuildNotice.tsx"), "utf8");
    expect(source).toMatch(/pollsForNewBuild\(usePathname\(\)\)/);
    expect(source).toMatch(/if \(!polls\) return;\s*timer = window\.setInterval/);
  });
});
