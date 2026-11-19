import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * §996 — a scan is what the desk opens, never a link that prefetched the page (the owner, 2026-11-19: «vreau si tracing pentru
 * voluntarim [voluntari] gen cine a scanat, cine a marcat prezent»). The scanned page (`/admin/checkin/<code>`) records a scan when it is
 * drawn; a Next `<Link>` to it in view would prefetch it — a request with `Next-Router-Prefetch`, which the page refuses as a scan
 * by that header (`tests/integration/race-day/scan-record.test.ts`) — and would cost a function per view besides. So every
 * `<Link>` in `src/` that names the scanned page says `prefetch={false}`; the one there is, the registration's «Deschide la masă»,
 * also says it comes from that page (`from: OPENED_FROM_REGISTRATION`), which records no scan at all. The QR's own address, the
 * desk verbs' redirects and «Scanează» reach the page without a `<Link>`.
 */
const SRC = path.join(process.cwd(), "src");

function sourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, acc);
    else if (/\.tsx$/.test(entry)) acc.push(full);
  }
  return acc;
}

/** Every `<Link …>` opening tag of a source, whole — its braces balanced, so an arrow or a `>` inside `{…}` does not end it. */
function linkTags(source: string): string[] {
  const tags: string[] = [];
  for (let start = source.indexOf("<Link"); start >= 0; start = source.indexOf("<Link", start + 1)) {
    if (/[A-Za-z]/.test(source[start + 5] ?? "")) continue;
    let depth = 0;
    let end = start;
    for (; end < source.length; end += 1) {
      const char = source[end];
      if (char === "{") depth += 1;
      else if (char === "}") depth -= 1;
      else if (char === ">" && depth === 0) break;
    }
    tags.push(source.slice(start, end + 1));
  }
  return tags;
}

describe("§996 no <Link> prefetches the scanned page", () => {
  const links = sourceFiles(SRC).flatMap((file) =>
    linkTags(readFileSync(file, "utf8"))
      .filter((tag) => tag.includes('"/admin/checkin/[code]"'))
      .map((tag) => ({ file: path.relative(process.cwd(), file).replaceAll("\\", "/"), tag })),
  );

  it("finds the links it is about", () => {
    expect(links.map((link) => link.file)).toContain("src/app/[locale]/admin/registrations/[id]/page.tsx");
  });

  // A link is the backoffice looking, never a code scanned at the table: each says so (`from=registration`), so none records a scan.
  it("is never prefetched, and says it comes from the backoffice's own page", () => {
    for (const { file, tag } of links) {
      expect(tag, file).toMatch(/\bprefetch=\{false\}/);
      expect(tag, file).toMatch(/from: OPENED_FROM_REGISTRATION/);
    }
  });

  it("reads a tag whole, an arrow inside its braces included", () => {
    expect(linkTags(`<Link href={{ pathname: "/admin/checkin/[code]" }} onClick={() => a > b} prefetch={false}>x</Link>`)).toEqual([
      `<Link href={{ pathname: "/admin/checkin/[code]" }} onClick={() => a > b} prefetch={false}>`,
    ]);
    expect(linkTags(`<LinkButton href="/a">`)).toEqual([]);
  });
});
