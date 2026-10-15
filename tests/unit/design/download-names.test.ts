import ts from "typescript";
import { describe, expect, it } from "vitest";
import { byFile, type Hit, type Source, SOURCES, stringLiterals } from "./scan";

/**
 * BR-REQ-060-01, §NNN — a download's name is built in one place, `src/shared/http/content-disposition.ts`.
 *
 * A raw ``Content-Disposition: attachment; filename="${title}"`` crashes the whole download with a 500
 * («Cannot convert argument to a ByteString») the moment the title has an «Ș», a «ț» or an en dash — the
 * participants' Excel export, 2026-10-15. Seventeen routes had the same line. This refuses a header
 * literal that spells `filename=` or `filename*=` anywhere in `src/` but the helper; comments, which
 * explain the header, are not literals and are not scanned. There is no list of exceptions to grow:
 * call `contentDisposition(type, fileName)`.
 */
const HELPER = "src/shared/http/content-disposition.ts";
const FILENAME_PARAMETER = /filename\*?\s*=/i;

function headerHits(source: Source): Hit[] {
  if (source.file === HELPER) return [];
  return stringLiterals(source)
    .filter((literal) => FILENAME_PARAMETER.test(literal.text))
    .map((literal) => ({ file: source.file, line: literal.line, text: `a "filename=" header literal: ${literal.text.trim().slice(0, 60)}` }));
}

const sample = (file: string, text: string): Source => ({ file, text, tree: ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS) });

describe("BR-REQ-060-01 §NNN every download's name goes through contentDisposition()", () => {
  it("scans the whole of src/ and the helper is where it should be", () => {
    expect(SOURCES.length).toBeGreaterThan(500);
    expect(SOURCES.some((source) => source.file === HELPER)).toBe(true);
  });

  it("no file but the helper writes a filename= header literal", () => {
    const offenders = byFile(SOURCES.flatMap(headerHits));
    expect(offenders, [...offenders].map(([file, hits]) => `${file}:${hits.map((hit) => hit.line).join(",")}`).join("\n")).toEqual(new Map());
  });

  it("sees a template literal, a string and a filename* — and ignores a comment", () => {
    expect(headerHits(sample("src/x.ts", "const a = `attachment; filename=\"${name}\"`;"))).toHaveLength(1);
    expect(headerHits(sample("src/x.ts", "const a = 'attachment; filename=\"x.csv\"';"))).toHaveLength(1);
    expect(headerHits(sample("src/x.ts", "const a = \"filename*=UTF-8''x\";"))).toHaveLength(1);
    expect(headerHits(sample("src/x.ts", "// attachment; filename=\"x\"\nconst a = 1;"))).toHaveLength(0);
    expect(headerHits(sample(HELPER, "const a = `attachment; filename=\"${name}\"`;"))).toHaveLength(0);
  });
});
