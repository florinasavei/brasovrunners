import { describe, expect, it } from "vitest";
import { parseInline, plainInline } from "@/modules/legal-documents/domain/inline";

/** BR-REQ-053-01 criterion 12 (`DECISIONS.md` §127) — links and pictures inside a legal paragraph. */
describe("links and pictures in a legal paragraph", () => {
  it("reads a link and a picture out of the text, and leaves the rest as typed", () => {
    expect(parseInline("Regulamentul este pe [pagina evenimentului](https://example.ro/e) și [scrie-ne](mailto:club@example.ro).")).toEqual([
      { kind: "text", text: "Regulamentul este pe " },
      { kind: "link", text: "pagina evenimentului", href: "https://example.ro/e" },
      { kind: "text", text: " și " },
      { kind: "link", text: "scrie-ne", href: "mailto:club@example.ro" },
      { kind: "text", text: "." },
    ]);
    expect(parseInline("![Harta traseului](https://pictures.example/harta.webp)")).toEqual([{ kind: "image", alt: "Harta traseului", src: "https://pictures.example/harta.webp" }]);
    expect(parseInline("[termenii](/ro/legal/termeni)")).toEqual([{ kind: "link", text: "termenii", href: "/ro/legal/termeni" }]);
  });

  it("refuses what is not https, mailto or a path — the mark stays words", () => {
    expect(parseInline("[x](javascript:alert(1))")).toEqual([{ kind: "text", text: "[x](javascript:alert(1))" }]);
    expect(parseInline("[x](http://insecure.example)")).toEqual([{ kind: "text", text: "[x](http://insecure.example)" }]);
    expect(parseInline("![x](data:image/png;base64,AAAA)")).toEqual([{ kind: "text", text: "![x](data:image/png;base64,AAAA)" }]);
    expect(parseInline("[x](//evil.example)")).toEqual([{ kind: "text", text: "[x](//evil.example)" }]);
    expect(parseInline("plain text")).toEqual([{ kind: "text", text: "plain text" }]);
  });

  it("flattens for a PDF: the words with the address, the picture as its caption", () => {
    expect(plainInline("Vezi [regulamentul](https://example.ro/r).")).toBe("Vezi regulamentul (https://example.ro/r).");
    expect(plainInline("![Harta](https://p.example/h.webp)")).toBe("Harta");
  });
});
